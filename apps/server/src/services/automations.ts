import type { Prisma } from '@prisma/client';
import {
  validateAutomation,
  type AutomationAction,
  type AutomationCondition,
  type AutomationDto,
  type AutomationExecutionDto,
  type AutomationInput,
  type AutomationIssue,
  type AutomationTrigger,
} from '@smartnest/shared';
import { prisma } from '../db.js';
import { json, parseCapabilities } from '../lib/dto.js';

export const automationInclude = {
  triggers: { orderBy: { order: 'asc' } },
  conditions: { orderBy: { order: 'asc' } },
  actions: { orderBy: { order: 'asc' } },
} satisfies Prisma.AutomationInclude;
export type AutomationWithRelations = Prisma.AutomationGetPayload<{ include: typeof automationInclude }>;

export function toAutomationDto(a: AutomationWithRelations): AutomationDto {
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    enabled: a.enabled,
    isDraft: a.isDraft,
    executor: a.executor as AutomationDto['executor'],
    externalId: a.externalId,
    triggers: a.triggers.map((t) => t.config as unknown as AutomationTrigger),
    conditions: a.conditions.map((c) => c.config as unknown as AutomationCondition),
    conditionOperator: a.conditionOperator as 'and' | 'or',
    actions: a.actions.map((x) => x.config as unknown as AutomationAction),
    cooldownSeconds: a.cooldownSeconds,
    allowSensitiveActions: a.allowSensitiveActions,
    lastRunAt: a.lastRunAt?.toISOString() ?? null,
    lastRunStatus: a.lastRunStatus as AutomationDto['lastRunStatus'],
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

export function toExecutionDto(e: Prisma.AutomationExecutionGetPayload<object>): AutomationExecutionDto {
  return {
    id: e.id,
    automationId: e.automationId,
    status: e.status as AutomationExecutionDto['status'],
    triggeredBy: e.triggeredBy,
    startedAt: e.startedAt.toISOString(),
    completedAt: e.completedAt?.toISOString() ?? null,
    error: e.error,
    steps: e.steps as AutomationExecutionDto['steps'],
  };
}

export async function validateAutomationForHome(homeId: string, input: AutomationInput, selfId?: string): Promise<AutomationIssue[]> {
  const [devices, scenes, rooms, automations, home] = await Promise.all([
    prisma.device.findMany({ where: { homeId }, include: { capabilities: true } }),
    prisma.scene.findMany({ where: { homeId }, select: { id: true } }),
    prisma.room.findMany({ where: { homeId }, select: { id: true } }),
    prisma.automation.findMany({ where: { homeId, executor: 'smartnest' }, include: { actions: { where: { type: 'runAutomation' } } } }),
    prisma.home.findUniqueOrThrow({ where: { id: homeId } }),
  ]);
  const graph = new Map(automations.map((a) => [a.id, a.actions.map((x) => (x.config as { automationId: string }).automationId)]));
  if (selfId) graph.set(selfId, input.actions.flatMap((a) => (a.type === 'runAutomation' ? [a.automationId] : [])));
  const issues = validateAutomation(input, {
    devices: new Map(devices.map((d) => [d.id, { name: d.name, capabilities: parseCapabilities(d.capabilities).map((c) => c.type) }])),
    sceneIds: new Set(scenes.map((s) => s.id)),
    roomIds: new Set(rooms.map((r) => r.id)),
    automationGraph: graph,
    selfId,
    homeHasLocation: home.latitude !== null && home.longitude !== null,
  });
  const automationIds = new Set(automations.map((a) => a.id));
  input.actions.forEach((a, i) => {
    if (a.type === 'runAutomation' && !automationIds.has(a.automationId)) issues.push({ path: `actions.${i}`, message: 'Action refers to an automation that no longer exists.', severity: 'error' });
  });
  return issues;
}

export async function saveAutomation(homeId: string, input: AutomationInput, userId: string, id?: string) {
  const children = {
    triggers: { create: input.triggers.map((t, i) => ({ order: i, type: t.type, config: json(t) })) },
    conditions: { create: input.conditions.map((c, i) => ({ order: i, type: c.type, config: json(c) })) },
    actions: { create: input.actions.map((a, i) => ({ order: i, type: a.type, config: json(a) })) },
  };
  const data = {
    name: input.name,
    description: input.description,
    enabled: input.isDraft ? false : input.enabled,
    isDraft: input.isDraft,
    conditionOperator: input.conditionOperator,
    cooldownSeconds: input.cooldownSeconds,
    allowSensitiveActions: input.allowSensitiveActions,
  };
  if (id) {
    return prisma.$transaction(async (tx) => {
      await tx.automationTrigger.deleteMany({ where: { automationId: id } });
      await tx.automationCondition.deleteMany({ where: { automationId: id } });
      await tx.automationAction.deleteMany({ where: { automationId: id } });
      return tx.automation.update({ where: { id }, data: { ...data, ...children }, include: automationInclude });
    });
  }
  return prisma.automation.create({ data: { ...data, homeId, executor: 'smartnest', createdById: userId, ...children }, include: automationInclude });
}
