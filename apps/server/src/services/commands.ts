import {
  describeCommand,
  expectedStateMatcher,
  isSensitiveCommand,
  redactCommand,
  validateCommandForCapabilities,
  type CommandDto,
  type CommandErrorCode,
  type DeviceCommand,
  type DeviceState,
  type RealtimeEvent,
} from '@smartnest/shared';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { deviceInclude, json, parseCapabilities, toCommandDto, toDeviceDto } from '../lib/dto.js';
import { AppError, notFound } from '../lib/errors.js';
import { integrations } from '../integrations/manager.js';
import { AdapterError } from '../integrations/types.js';
import { logger } from '../logger.js';
import { recordActivity } from './activity.js';
import { audit } from './audit.js';
import { bus, pushRealtime, type DeviceChangedEvent } from './bus.js';
import { ingestDeviceUpdate, markRecentCommand } from './deviceState.js';

export interface ExecuteCommandInput {
  homeId: string;
  deviceId: string;
  command: DeviceCommand;
  userId: string | null;
  actorName: string | null;
  source: 'user' | 'scene' | 'automation';
  sourceId?: string | null;
  idempotencyKey?: string;
  ipAddress?: string | null;
}

export interface DispatchResult {
  command: CommandDto;
  /** Resolves with the terminal state (confirmed / failed / timed_out). */
  done: Promise<CommandDto>;
}

const commandInclude = { result: true, device: { select: { name: true } } } as const;
/** Read-back schedule (ms after acknowledgement) while waiting for confirmation */
const READBACK_SCHEDULE = [800, 2500, 5000];

/**
 * Command lifecycle:
 *  validate → record (pending) → send via adapter (sent) → wait for a state
 *  report or read-back that matches the requested state (confirmed) — or fail /
 *  time out. An HTTP 200 from an integration alone is never treated as success.
 */
export async function dispatchCommand(input: ExecuteCommandInput): Promise<DispatchResult> {
  const device = await prisma.device.findFirst({ where: { id: input.deviceId, homeId: input.homeId }, include: deviceInclude });
  if (!device) throw notFound('Device');
  const caps = parseCapabilities(device.capabilities);

  const validation = validateCommandForCapabilities(input.command, caps);
  if (!validation.ok) throw new AppError(400, validation.code, validation.message);

  if (input.idempotencyKey) {
    const existing = await prisma.deviceCommand.findUnique({
      where: { homeId_idempotencyKey: { homeId: input.homeId, idempotencyKey: input.idempotencyKey } },
      include: commandInclude,
    });
    if (existing) {
      if (existing.deviceId !== input.deviceId) throw new AppError(409, 'conflict', 'Idempotency key was already used for another device.');
      const dto = toCommandDto(existing);
      return { command: dto, done: waitForTerminal(existing.id, dto) };
    }
  }

  const sensitive = isSensitiveCommand(input.command, caps);
  const record = await prisma.deviceCommand.create({
    data: {
      homeId: input.homeId,
      deviceId: device.id,
      userId: input.userId,
      source: input.source,
      sourceId: input.sourceId ?? null,
      command: json(redactCommand(input.command)),
      status: 'pending',
      idempotencyKey: input.idempotencyKey ?? null,
    },
    include: commandInclude,
  });
  const initial = toCommandDto(record);
  pushRealtime({ type: 'command.updated', homeId: input.homeId, command: initial });
  if (sensitive) {
    await audit({ action: 'device.command.sensitive', userId: input.userId, homeId: input.homeId, targetType: 'device', targetId: device.id, metadata: { action: input.command.action, source: input.source }, ipAddress: input.ipAddress });
  }

  const done = runLifecycle(record.id, input, device.externalId, device.integrationId, caps).catch(async (e) => {
    logger.error({ err: (e as Error).message, commandId: record.id }, 'Command lifecycle crashed');
    return finalize(record.id, input, 'failed', false, 'integration_error', 'An internal error occurred while running the command.', null);
  });
  return { command: initial, done };
}

async function runLifecycle(
  commandId: string,
  input: ExecuteCommandInput,
  externalId: string,
  integrationId: string,
  caps: ReturnType<typeof parseCapabilities>,
): Promise<CommandDto> {
  const started = Date.now();
  const integration = await prisma.integration.findUniqueOrThrow({ where: { id: integrationId } });
  if (integration.status === 'disconnected') {
    return finalize(commandId, input, 'failed', false, 'integration_disconnected', `${integration.name} is disconnected. Reconnect it to control this device.`, null, started);
  }
  const adapter = integrations.tryGet(integrationId);
  if (!adapter || integration.status === 'auth_failed') {
    const code: CommandErrorCode = integration.status === 'auth_failed' ? 'integration_auth_failed' : 'integration_disconnected';
    return finalize(commandId, input, 'failed', false, code, integration.statusMessage ?? `${integration.name} is not connected right now.`, null, started);
  }

  // Register the confirmation waiter before sending so no event is missed.
  const matcher = expectedStateMatcher(input.command);
  let resolveMatch: (state: DeviceState) => void = () => undefined;
  const matched = new Promise<DeviceState>((r) => (resolveMatch = r));
  const listener = (e: DeviceChangedEvent) => {
    if (e.deviceId === input.deviceId && matcher?.(e.state)) resolveMatch(e.state);
  };
  if (matcher) bus.on('device.changed', listener);

  try {
    markRecentCommand(input.deviceId);
    try {
      await adapter.executeCommand(externalId, input.command, caps);
    } catch (e) {
      const err = e instanceof AdapterError ? e : new AdapterError('integration_error', (e as Error).message);
      return finalize(commandId, input, 'failed', false, err.code, err.message, null, started);
    }
    const sent = await prisma.deviceCommand.update({ where: { id: commandId }, data: { status: 'sent', sentAt: new Date() }, include: commandInclude });
    pushRealtime({ type: 'command.updated', homeId: input.homeId, command: toCommandDto(sent) });

    if (!matcher) {
      // Momentary commands (next track, PTZ nudge) can only be acknowledged, not verified.
      return finalize(commandId, input, 'confirmed', false, null, null, null, started);
    }

    const readBack = async () => {
      try {
        const r = await adapter.readState(externalId);
        if (!r) return;
        await ingestDeviceUpdate(integrationId, { externalId, state: r.state, connectivity: r.connectivity });
        if (matcher(r.state)) resolveMatch(r.state);
      } catch (e) {
        logger.debug({ err: (e as Error).message }, 'Read-back failed');
      }
    };
    const timers = READBACK_SCHEDULE.filter((ms) => ms < config.commandTimeoutMs).map((ms) => setTimeout(readBack, ms));
    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((r) => (timeoutHandle = setTimeout(() => r('timeout'), config.commandTimeoutMs)));
    const outcome = await Promise.race([matched, timeout]);
    timers.forEach(clearTimeout);
    clearTimeout(timeoutHandle);

    if (outcome === 'timeout') {
      await readBack(); // one last look before giving up
      const confirmedLate = await Promise.race([matched, Promise.resolve(null)]);
      if (confirmedLate) return finalize(commandId, input, 'confirmed', true, null, null, confirmedLate, started);
      return finalize(
        commandId,
        input,
        'timed_out',
        false,
        'not_confirmed',
        'The integration accepted the command, but the device did not report the requested state in time. Check the device.',
        null,
        started,
      );
    }
    return finalize(commandId, input, 'confirmed', true, null, null, outcome, started);
  } finally {
    if (matcher) bus.off('device.changed', listener);
  }
}

async function finalize(
  commandId: string,
  input: ExecuteCommandInput,
  status: 'confirmed' | 'failed' | 'timed_out',
  verified: boolean,
  errorCode: CommandErrorCode | null,
  errorMessage: string | null,
  confirmedState: DeviceState | null,
  started = Date.now(),
): Promise<CommandDto> {
  const now = new Date();
  const cmd = await prisma.deviceCommand.update({
    where: { id: commandId },
    data: {
      status,
      verified,
      completedAt: now,
      result: {
        create: { status, errorCode, errorMessage, confirmedState: confirmedState ? json(confirmedState) : undefined, durationMs: Date.now() - started },
      },
    },
    include: commandInclude,
  });
  const device = await prisma.device.update({
    where: { id: input.deviceId },
    data: status === 'confirmed' ? { lastCommandAt: now, lastError: null } : { lastError: errorMessage },
    include: deviceInclude,
  });
  const dto = toCommandDto(cmd);
  pushRealtime({ type: 'command.updated', homeId: input.homeId, command: dto });
  pushRealtime({ type: 'device.updated', homeId: input.homeId, device: toDeviceDto(device) });

  // Scene/automation runs log a single summary entry; user commands log each one.
  if (input.source === 'user' || status !== 'confirmed') {
    await recordActivity({
      homeId: input.homeId,
      type: 'device.command',
      title: `${describeCommand(input.command)} · ${device.name}`,
      detail: status === 'confirmed' ? (verified ? 'Confirmed by the device' : 'Acknowledged by the integration') : errorMessage,
      severity: status === 'confirmed' ? 'success' : 'warning',
      result: status === 'confirmed' ? 'success' : 'failure',
      source: input.source,
      actorUserId: input.userId,
      actorName: input.actorName,
      device: { id: device.id, name: device.name, roomId: device.roomId, category: device.category },
      metadata: { commandId, status, errorCode },
      isDemo: device.integration.isDemo,
    });
  }
  return dto;
}

/** For an idempotent replay: resolve when the original command reaches a terminal state. */
async function waitForTerminal(commandId: string, current: CommandDto): Promise<CommandDto> {
  if (['confirmed', 'failed', 'timed_out'].includes(current.status)) return current;
  return new Promise((resolve) => {
    const onEvent = (e: RealtimeEvent) => {
      if (e.type === 'command.updated' && e.command.id === commandId && ['confirmed', 'failed', 'timed_out'].includes(e.command.status)) {
        bus.off('realtime', onEvent);
        resolve(e.command);
      }
    };
    bus.on('realtime', onEvent);
  });
}

/** After a crash/restart, commands left in-flight can never be confirmed. */
export async function expireStaleCommands(): Promise<number> {
  const cutoff = new Date(Date.now() - config.commandTimeoutMs * 2);
  const stale = await prisma.deviceCommand.findMany({ where: { status: { in: ['pending', 'sent'] }, createdAt: { lt: cutoff } }, select: { id: true } });
  for (const c of stale) {
    await prisma.deviceCommand.update({
      where: { id: c.id },
      data: { status: 'timed_out', completedAt: new Date(), result: { create: { status: 'timed_out', errorCode: 'not_confirmed', errorMessage: 'Server restarted before the command was confirmed.' } } },
    });
  }
  return stale.length;
}
