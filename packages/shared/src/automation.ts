import { z } from 'zod';
import { deviceCommandSchema, isSensitiveCommand } from './commands.js';

const id = z.string().min(1).max(64);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM');
const weekdays = z.array(z.number().int().min(0).max(6)).min(1).max(7);
const stateValue = z.union([z.string().max(64), z.number(), z.boolean()]);

/** Device state attributes automations may watch or compare. */
export const WATCHABLE_ATTRIBUTES = [
  'on', 'motion', 'contactOpen', 'occupied', 'present', 'hazardDetected', 'lockState', 'alarmState', 'coverState', 'hvacMode', 'mediaState', 'vacuumState', 'valveOpen', 'charging',
] as const;
export const NUMERIC_ATTRIBUTES = ['currentTemperature', 'targetTemperature', 'brightness', 'batteryLevel', 'powerW', 'energyKWh', 'position', 'volume', 'measurement'] as const;

export const triggerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('time'), at: hhmm, days: weekdays.default([0, 1, 2, 3, 4, 5, 6]) }),
  z.object({ type: z.literal('interval'), everyMinutes: z.number().int().min(5).max(1440) }),
  z.object({ type: z.literal('sun'), event: z.enum(['sunrise', 'sunset']), offsetMinutes: z.number().int().min(-180).max(180).default(0) }),
  z.object({ type: z.literal('deviceState'), deviceId: id, attribute: z.enum(WATCHABLE_ATTRIBUTES), to: stateValue.optional(), from: stateValue.optional() }),
  z.object({
    type: z.literal('numericThreshold'),
    deviceId: id,
    attribute: z.enum(NUMERIC_ATTRIBUTES),
    /** Measurement key when attribute = "measurement", e.g. "co2" */
    measurementKey: z.string().max(32).optional(),
    above: z.number().optional(),
    below: z.number().optional(),
  }),
  z.object({ type: z.literal('connectivity'), deviceId: id, to: z.enum(['online', 'offline', 'unavailable']) }),
  z.object({ type: z.literal('integrationEvent'), integrationId: id, eventType: z.string().min(1).max(64) }),
]);
export type AutomationTrigger = z.infer<typeof triggerSchema>;

export type AutomationCondition =
  | { type: 'timeWindow'; after: string; before: string; days?: number[] }
  | { type: 'deviceState'; deviceId: string; attribute: (typeof WATCHABLE_ATTRIBUTES)[number]; equals: string | number | boolean }
  | { type: 'numericState'; deviceId: string; attribute: (typeof NUMERIC_ATTRIBUTES)[number]; measurementKey?: string; above?: number; below?: number }
  | { type: 'roomState'; roomId: string; anyOn: boolean }
  | { type: 'presence'; anyoneHome: boolean }
  | { type: 'securityState'; deviceId: string; alarmState: string }
  | { type: 'group'; operator: 'and' | 'or'; conditions: AutomationCondition[] };

export const conditionSchema: z.ZodType<AutomationCondition> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('timeWindow'), after: hhmm, before: hhmm, days: weekdays.optional() }),
    z.object({ type: z.literal('deviceState'), deviceId: id, attribute: z.enum(WATCHABLE_ATTRIBUTES), equals: stateValue }),
    z.object({
      type: z.literal('numericState'),
      deviceId: id,
      attribute: z.enum(NUMERIC_ATTRIBUTES),
      measurementKey: z.string().max(32).optional(),
      above: z.number().optional(),
      below: z.number().optional(),
    }),
    z.object({ type: z.literal('roomState'), roomId: id, anyOn: z.boolean() }),
    z.object({ type: z.literal('presence'), anyoneHome: z.boolean() }),
    z.object({ type: z.literal('securityState'), deviceId: id, alarmState: z.string().max(32) }),
    z.object({ type: z.literal('group'), operator: z.enum(['and', 'or']), conditions: z.array(conditionSchema).min(1).max(20) }),
  ]),
);

export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('deviceCommand'), deviceId: id, command: deviceCommandSchema }),
  z.object({ type: z.literal('activateScene'), sceneId: id }),
  z.object({ type: z.literal('notify'), title: z.string().min(1).max(120), message: z.string().max(500).default(''), severity: z.enum(['info', 'warning', 'critical']).default('info') }),
  z.object({ type: z.literal('delay'), seconds: z.number().int().min(1).max(3600) }),
  z.object({ type: z.literal('runAutomation'), automationId: id }),
]);
export type AutomationAction = z.infer<typeof actionSchema>;

export const AUTOMATION_EXECUTORS = ['smartnest', 'home_assistant'] as const;
export type AutomationExecutor = (typeof AUTOMATION_EXECUTORS)[number];

export const automationInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).default(''),
  enabled: z.boolean().default(false),
  /** Draft automations are saved but never executed. */
  isDraft: z.boolean().default(false),
  triggers: z.array(triggerSchema).min(1).max(10),
  conditions: z.array(conditionSchema).max(20).default([]),
  conditionOperator: z.enum(['and', 'or']).default('and'),
  actions: z.array(actionSchema).min(1).max(30),
  /** Minimum seconds between runs — protects against runaway execution. */
  cooldownSeconds: z.number().int().min(0).max(86400).default(30),
  /** Sensitive device actions (unlock, disarm…) are rejected unless this is true. */
  allowSensitiveActions: z.boolean().default(false),
});
export type AutomationInput = z.infer<typeof automationInputSchema>;

export interface AutomationIssue {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface AutomationValidationContext {
  /** Device IDs in the home, with their capability types */
  devices: Map<string, { capabilities: string[]; name: string }>;
  sceneIds: Set<string>;
  roomIds: Set<string>;
  /** automationId → automation IDs it runs via runAutomation actions (for cycle detection) */
  automationGraph: Map<string, string[]>;
  selfId?: string;
  homeHasLocation: boolean;
}

/**
 * Semantic validation beyond the schema: references exist, capabilities are
 * supported, no self-triggering loops, no runAutomation cycles.
 */
export function validateAutomation(input: AutomationInput, ctx: AutomationValidationContext): AutomationIssue[] {
  const issues: AutomationIssue[] = [];
  const err = (path: string, message: string) => issues.push({ path, message, severity: 'error' });
  const warn = (path: string, message: string) => issues.push({ path, message, severity: 'warning' });

  input.triggers.forEach((t, i) => {
    const p = `triggers.${i}`;
    if ('deviceId' in t && !ctx.devices.has(t.deviceId)) err(p, 'Trigger refers to a device that no longer exists.');
    if (t.type === 'sun' && !ctx.homeHasLocation) err(p, 'Sunrise and sunset triggers need the home location (Settings → Home).');
    if (t.type === 'numericThreshold' && t.above === undefined && t.below === undefined) err(p, 'Set an "above" or "below" threshold.');
    if (t.type === 'numericThreshold' && t.above !== undefined && t.below !== undefined && t.above >= t.below) {
      err(p, '"Above" must be lower than "below" for a range.');
    }
  });

  const walkConditions = (conds: AutomationCondition[], base: string) => {
    conds.forEach((c, i) => {
      const p = `${base}.${i}`;
      if ('deviceId' in c && !ctx.devices.has(c.deviceId)) err(p, 'Condition refers to a device that no longer exists.');
      if (c.type === 'roomState' && !ctx.roomIds.has(c.roomId)) err(p, 'Condition refers to a room that no longer exists.');
      if (c.type === 'numericState' && c.above === undefined && c.below === undefined) err(p, 'Set an "above" or "below" value.');
      if (c.type === 'group') walkConditions(c.conditions, `${p}.conditions`);
    });
  };
  walkConditions(input.conditions, 'conditions');

  const triggerDevices = new Set(input.triggers.flatMap((t) => ('deviceId' in t ? [t.deviceId] : [])));
  let totalDelay = 0;

  input.actions.forEach((a, i) => {
    const p = `actions.${i}`;
    if (a.type === 'deviceCommand') {
      const dev = ctx.devices.get(a.deviceId);
      if (!dev) {
        err(p, 'Action refers to a device that no longer exists.');
        return;
      }
      if (!dev.capabilities.includes(a.command.capability)) err(p, `${dev.name} does not support ${a.command.capability}.`);
      if (isSensitiveCommand(a.command) && !input.allowSensitiveActions) {
        err(p, `"${a.command.action}" is a security-sensitive action. Enable "Allow sensitive actions" to use it.`);
      }
      if (triggerDevices.has(a.deviceId)) {
        const watching = input.triggers.find((t) => 'deviceId' in t && t.deviceId === a.deviceId);
        if (watching && watching.type === 'deviceState' && watching.attribute === 'on' && (a.command.action === 'turnOn' || a.command.action === 'turnOff')) {
          err(p, `This action changes ${dev.name}, which also triggers the automation — it would loop.`);
        } else {
          warn(p, `This action controls ${dev.name}, which is also a trigger. Cooldown protects against loops.`);
        }
      }
    }
    if (a.type === 'activateScene' && !ctx.sceneIds.has(a.sceneId)) err(p, 'Action refers to a scene that no longer exists.');
    if (a.type === 'delay') totalDelay += a.seconds;
    if (a.type === 'runAutomation') {
      if (a.automationId === ctx.selfId) err(p, 'An automation cannot run itself.');
      else if (ctx.selfId && reaches(ctx.automationGraph, a.automationId, ctx.selfId)) {
        err(p, 'This would create a cycle of automations running each other.');
      }
    }
  });

  if (totalDelay > 3600) err('actions', 'Total delay across actions cannot exceed one hour.');
  const intervalTrigger = input.triggers.find((t) => t.type === 'interval');
  if (input.cooldownSeconds < 5 && input.triggers.some((t) => t.type === 'deviceState' || t.type === 'numericThreshold')) {
    warn('cooldownSeconds', 'A cooldown below 5 seconds may cause rapid repeated runs.');
  }
  if (intervalTrigger && intervalTrigger.type === 'interval' && intervalTrigger.everyMinutes < 5) {
    err('triggers', 'Intervals shorter than 5 minutes are not allowed.');
  }
  return issues;
}

function reaches(graph: Map<string, string[]>, from: string, target: string, seen = new Set<string>()): boolean {
  if (from === target) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  return (graph.get(from) ?? []).some((next) => reaches(graph, next, target, seen));
}

export function describeTrigger(t: AutomationTrigger, deviceName: (id: string) => string = (x) => x): string {
  switch (t.type) {
    case 'time':
      return `At ${t.at}${t.days.length < 7 ? ` on ${t.days.map((d) => DAY_SHORT[d]).join(', ')}` : ' every day'}`;
    case 'interval':
      return `Every ${t.everyMinutes} minutes`;
    case 'sun':
      return `${t.offsetMinutes ? `${Math.abs(t.offsetMinutes)} min ${t.offsetMinutes < 0 ? 'before' : 'after'} ` : 'At '}${t.event}`;
    case 'deviceState':
      return `When ${deviceName(t.deviceId)} ${t.attribute} becomes ${String(t.to ?? 'any value')}`;
    case 'numericThreshold':
      return `When ${deviceName(t.deviceId)} ${t.measurementKey ?? t.attribute} is${t.above !== undefined ? ` above ${t.above}` : ''}${t.above !== undefined && t.below !== undefined ? ' and' : ''}${t.below !== undefined ? ` below ${t.below}` : ''}`;
    case 'connectivity':
      return `When ${deviceName(t.deviceId)} goes ${t.to}`;
    case 'integrationEvent':
      return `On integration event "${t.eventType}"`;
  }
}

export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
