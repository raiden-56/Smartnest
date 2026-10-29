import type { Prisma } from '@prisma/client';
import {
  describeCommand,
  isSensitiveCommand,
  validateCommandForCapabilities,
  type CommandDto,
  type DeviceCommand,
  type SceneDto,
  type SceneExecutionDto,
  type SceneInput,
} from '@smartnest/shared';
import { prisma } from '../db.js';
import { json, parseCapabilities, toSceneExecutionDto } from '../lib/dto.js';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import { recordActivity } from './activity.js';
import { pushRealtime } from './bus.js';
import { dispatchCommand } from './commands.js';

export const sceneInclude = {
  actions: { orderBy: { order: 'asc' }, include: { device: { include: { capabilities: true } } } },
  executions: { orderBy: { startedAt: 'desc' }, take: 1 },
} satisfies Prisma.SceneInclude;
type SceneWithRelations = Prisma.SceneGetPayload<{ include: typeof sceneInclude }>;

export function sceneRequiresConfirmation(actions: { command: DeviceCommand; caps: ReturnType<typeof parseCapabilities> }[]): boolean {
  return actions.some((a) => isSensitiveCommand(a.command, a.caps));
}

export function toSceneDto(s: SceneWithRelations): SceneDto {
  const actions = s.actions.map((a) => {
    const command = a.command as unknown as DeviceCommand;
    return {
      id: a.id,
      deviceId: a.deviceId,
      deviceName: a.device.name,
      command,
      description: describeCommand(command),
      order: a.order,
      deviceAvailable: a.device.connectivity === 'online',
      caps: parseCapabilities(a.device.capabilities),
    };
  });
  return {
    id: s.id,
    name: s.name,
    icon: s.icon,
    description: s.description,
    roomId: s.roomId,
    executionMode: s.executionMode as SceneDto['executionMode'],
    isFavourite: s.isFavourite,
    allowSensitiveActions: s.allowSensitiveActions,
    requiresConfirmation: sceneRequiresConfirmation(actions),
    actions: actions.map(({ caps: _c, ...rest }) => rest),
    lastExecution: s.executions[0] ? toSceneExecutionDto(s.executions[0]) : null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

/** Validate devices belong to the home, capabilities exist, and sensitive actions are opted in. */
export async function validateSceneInput(homeId: string, input: SceneInput): Promise<void> {
  const ids = [...new Set(input.actions.map((a) => a.deviceId))];
  const devices = await prisma.device.findMany({ where: { id: { in: ids }, homeId }, include: { capabilities: true } });
  const byId = new Map(devices.map((d) => [d.id, d]));
  input.actions.forEach((a, i) => {
    const d = byId.get(a.deviceId);
    if (!d) throw badRequest(`Action ${i + 1}: device not found in this home.`);
    const caps = parseCapabilities(d.capabilities);
    const v = validateCommandForCapabilities(a.command, caps);
    if (!v.ok) throw badRequest(`Action ${i + 1} (${d.name}): ${v.message}`);
    if (isSensitiveCommand(a.command, caps) && !input.allowSensitiveActions) {
      throw badRequest(`Action ${i + 1} (${d.name}) is security-sensitive. Enable "Allow sensitive actions" to include it.`);
    }
  });
  if (input.roomId) {
    const room = await prisma.room.findFirst({ where: { id: input.roomId, homeId } });
    if (!room) throw badRequest('Room not found in this home.');
  }
}

export async function saveScene(homeId: string, input: SceneInput, userId: string, sceneId?: string) {
  await validateSceneInput(homeId, input);
  const data = {
    name: input.name,
    icon: input.icon,
    description: input.description,
    roomId: input.roomId ?? null,
    executionMode: input.executionMode,
    isFavourite: input.isFavourite,
    allowSensitiveActions: input.allowSensitiveActions,
  };
  const actions = input.actions.map((a, i) => ({ deviceId: a.deviceId, command: json(a.command), order: a.order ?? i }));
  if (sceneId) {
    return prisma.$transaction(async (tx) => {
      await tx.sceneAction.deleteMany({ where: { sceneId } });
      return tx.scene.update({ where: { id: sceneId }, data: { ...data, actions: { create: actions } }, include: sceneInclude });
    });
  }
  return prisma.scene.create({ data: { ...data, homeId, createdById: userId, actions: { create: actions } }, include: sceneInclude });
}

export interface ActivateOptions {
  homeId: string;
  sceneId: string;
  userId: string | null;
  actorName: string | null;
  source: 'user' | 'automation';
  /** User confirmed sensitive actions in the UI */
  confirmed?: boolean;
  canControlSensitive: boolean;
  ipAddress?: string | null;
}

/**
 * Run a scene. Each action is a real device command with its own confirmation.
 * The execution is only "succeeded" when every action confirmed; otherwise it is
 * "partial" or "failed" — never reported as a complete success.
 */
export async function activateScene(opts: ActivateOptions): Promise<{ execution: SceneExecutionDto; done: Promise<SceneExecutionDto> }> {
  const scene = await prisma.scene.findFirst({ where: { id: opts.sceneId, homeId: opts.homeId }, include: sceneInclude });
  if (!scene) throw notFound('Scene');
  if (!scene.actions.length) throw badRequest('This scene has no actions. Its devices may have been removed.');
  const dto = toSceneDto(scene);
  if (dto.requiresConfirmation) {
    if (!opts.canControlSensitive) throw new AppError(403, 'forbidden', 'This scene contains security-sensitive actions you are not allowed to run.');
    if (opts.source === 'user' && !opts.confirmed) throw new AppError(428, 'confirmation_required', 'This scene includes security-sensitive actions. Confirm to continue.');
  }

  const exec = await prisma.sceneExecution.create({
    data: {
      sceneId: scene.id,
      homeId: opts.homeId,
      source: opts.source,
      triggeredById: opts.userId,
      status: 'running',
      results: json(
        scene.actions.map((a) => ({
          actionId: a.id,
          deviceId: a.deviceId,
          deviceName: a.device.name,
          description: describeCommand(a.command as unknown as DeviceCommand),
          status: 'pending',
          message: null,
          commandId: null,
        })),
      ),
    },
  });
  const initial = toSceneExecutionDto(exec);
  pushRealtime({ type: 'scene.execution', homeId: opts.homeId, execution: initial });

  const done = (async () => {
    const results = [...initial.results];
    const runAction = async (index: number) => {
      const action = scene.actions[index]!;
      try {
        const { command, done: finished } = await dispatchCommand({
          homeId: opts.homeId,
          deviceId: action.deviceId,
          command: action.command as unknown as DeviceCommand,
          userId: opts.userId,
          actorName: opts.actorName,
          source: 'scene',
          sourceId: exec.id,
          ipAddress: opts.ipAddress,
        });
        results[index] = { ...results[index]!, commandId: command.id, status: command.status };
        await publish();
        const final: CommandDto = await finished;
        results[index] = { ...results[index]!, status: final.status, message: final.errorMessage };
      } catch (e) {
        results[index] = { ...results[index]!, status: 'failed', message: (e as Error).message };
      }
      await publish();
    };
    const publish = async () => {
      const updated = await prisma.sceneExecution.update({ where: { id: exec.id }, data: { results: json(results) } });
      pushRealtime({ type: 'scene.execution', homeId: opts.homeId, execution: toSceneExecutionDto(updated) });
    };

    if (scene.executionMode === 'sequential') {
      for (let i = 0; i < scene.actions.length; i++) await runAction(i);
    } else {
      await Promise.all(scene.actions.map((_, i) => runAction(i)));
    }

    const ok = results.filter((r) => r.status === 'confirmed').length;
    const status: SceneExecutionDto['status'] = ok === results.length ? 'succeeded' : ok === 0 ? 'failed' : 'partial';
    const finished = await prisma.sceneExecution.update({ where: { id: exec.id }, data: { status, completedAt: new Date(), results: json(results) } });
    const finalDto = toSceneExecutionDto(finished);
    pushRealtime({ type: 'scene.execution', homeId: opts.homeId, execution: finalDto });
    const failedNames = results.filter((r) => r.status !== 'confirmed').map((r) => r.deviceName);
    const isDemo = (await prisma.integration.count({ where: { homeId: opts.homeId, isDemo: true } })) > 0 && scene.actions.every((a) => a.device.manufacturer === 'SmartNest Demo');
    await recordActivity({
      homeId: opts.homeId,
      type: 'scene.executed',
      title: `Scene "${scene.name}" ${status === 'succeeded' ? 'completed' : status === 'partial' ? 'partly completed' : 'failed'}`,
      detail: status === 'succeeded' ? `${ok} of ${results.length} actions confirmed` : `${ok} of ${results.length} actions confirmed. Not completed: ${failedNames.join(', ')}`,
      severity: status === 'succeeded' ? 'success' : 'warning',
      result: status === 'succeeded' ? 'success' : 'failure',
      source: opts.source === 'automation' ? 'automation' : 'user',
      actorUserId: opts.userId,
      actorName: opts.actorName,
      metadata: { sceneId: scene.id, executionId: exec.id },
      isDemo,
    });
    return finalDto;
  })();

  return { execution: initial, done };
}
