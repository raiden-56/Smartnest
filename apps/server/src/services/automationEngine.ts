import SunCalc from 'suncalc';
import {
  automationInputSchema,
  describeCommand,
  describeTrigger,
  roleHasPermission,
  type AutomationAction,
  type AutomationCondition,
  type AutomationExecutionDto,
  type AutomationTrigger,
  type DeviceState,
  type HomeRole,
} from '@smartnest/shared';
import { prisma } from '../db.js';
import { json } from '../lib/dto.js';
import { logger } from '../logger.js';
import { recordActivity } from './activity.js';
import { automationInclude, toAutomationDto, toExecutionDto, type AutomationWithRelations } from './automations.js';
import { bus, pushRealtime, type DeviceChangedEvent } from './bus.js';
import { dispatchCommand } from './commands.js';
import { notifyHome } from './notifications.js';
import { activateScene } from './scenes.js';
import { sleep, zonedNow } from './time.js';

const MAX_DEPTH = 3;
/** Runaway protection: more than this many runs in the window auto-disables the automation */
const RUNAWAY_MAX_RUNS = 20;
const RUNAWAY_WINDOW_MS = 10 * 60_000;

type Step = AutomationExecutionDto['steps'][number];

/**
 * SmartNest's automation engine. It only executes automations whose
 * executor is "smartnest"; Home Assistant automations run in HA and are never
 * evaluated here, so a rule can never run in both systems.
 */
class AutomationEngine {
  private cache = new Map<string, AutomationWithRelations[]>();
  private recentRuns = new Map<string, number[]>();
  private running = new Set<string>();
  private lastMinuteKey = new Map<string, string>();
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    bus.on('device.changed', (e) => void this.onDeviceChanged(e).catch((err) => logger.error({ err: err.message }, 'automation device trigger failed')));
    bus.on('integration.event', (e) => void this.onIntegrationEvent(e).catch((err) => logger.error({ err: err.message }, 'automation event trigger failed')));
  }

  invalidate(homeId: string): void {
    this.cache.delete(homeId);
  }

  private async active(homeId: string): Promise<AutomationWithRelations[]> {
    let list = this.cache.get(homeId);
    if (!list) {
      list = await prisma.automation.findMany({ where: { homeId, enabled: true, isDraft: false, executor: 'smartnest' }, include: automationInclude });
      this.cache.set(homeId, list);
    }
    return list;
  }

  // ─── Triggers ───────────────────────────────────────────────────────────

  private async onDeviceChanged(e: DeviceChangedEvent): Promise<void> {
    const list = await this.active(e.homeId);
    for (const a of list) {
      const dto = toAutomationDto(a);
      const hit = dto.triggers.find((t) => this.deviceTriggerMatches(t, e));
      if (hit) void this.run(a.id, describeTrigger(hit), 0);
    }
  }

  private deviceTriggerMatches(t: AutomationTrigger, e: DeviceChangedEvent): boolean {
    if (!('deviceId' in t) || t.deviceId !== e.deviceId) return false;
    if (t.type === 'deviceState') {
      if (!e.changedKeys.includes(t.attribute)) return false;
      const now = e.state[t.attribute as keyof DeviceState];
      const before = e.prevState[t.attribute as keyof DeviceState];
      if (t.to !== undefined && String(now) !== String(t.to)) return false;
      if (t.from !== undefined && String(before) !== String(t.from)) return false;
      return true;
    }
    if (t.type === 'numericThreshold') {
      const read = (s: DeviceState) => (t.attribute === 'measurement' ? s.measurements?.[t.measurementKey ?? ''] : (s[t.attribute as keyof DeviceState] as number | undefined));
      const inRange = (v: number | undefined) => v !== undefined && (t.above === undefined || v > t.above) && (t.below === undefined || v < t.below);
      // Edge-triggered: fire only when crossing into the range
      return inRange(read(e.state)) && !inRange(read(e.prevState));
    }
    if (t.type === 'connectivity') return e.prevConnectivity !== e.connectivity && e.connectivity === t.to;
    return false;
  }

  private async onIntegrationEvent(e: { homeId: string; integrationId: string; eventType: string }): Promise<void> {
    for (const a of await this.active(e.homeId)) {
      const hit = toAutomationDto(a).triggers.find((t) => t.type === 'integrationEvent' && t.integrationId === e.integrationId && t.eventType === e.eventType);
      if (hit) void this.run(a.id, describeTrigger(hit), 0);
    }
  }

  /** Called every minute by the scheduler. */
  async tickSchedules(now = new Date()): Promise<void> {
    const homes = await prisma.home.findMany({ where: { automations: { some: { enabled: true, executor: 'smartnest', isDraft: false } } } });
    for (const home of homes) {
      const z = zonedNow(home.timezone, now);
      const minuteKey = `${z.dateKey} ${z.hour}:${z.minute}`;
      if (this.lastMinuteKey.get(home.id) === minuteKey) continue; // never fire twice in the same minute
      this.lastMinuteKey.set(home.id, minuteKey);
      const minutesOfDay = z.hour * 60 + z.minute;
      for (const a of await this.active(home.id)) {
        for (const t of toAutomationDto(a).triggers) {
          let fire = false;
          if (t.type === 'time') {
            const [h, m] = t.at.split(':').map(Number) as [number, number];
            fire = h * 60 + m === minutesOfDay && t.days.includes(z.weekday);
          } else if (t.type === 'interval') {
            fire = Math.floor(now.getTime() / 60_000) % t.everyMinutes === 0;
          } else if (t.type === 'sun' && home.latitude !== null && home.longitude !== null) {
            const times = SunCalc.getTimes(now, home.latitude, home.longitude);
            const target = new Date(times[t.event].getTime() + t.offsetMinutes * 60_000);
            fire = Math.floor(target.getTime() / 60_000) === Math.floor(now.getTime() / 60_000);
          }
          if (fire) {
            void this.run(a.id, describeTrigger(t), 0);
            break;
          }
        }
      }
    }
  }

  // ─── Conditions ─────────────────────────────────────────────────────────

  private async evaluate(homeId: string, conds: AutomationCondition[], op: 'and' | 'or', timezone: string): Promise<boolean> {
    if (!conds.length) return true;
    const results: boolean[] = [];
    for (const c of conds) {
      const r = await this.evaluateOne(homeId, c, timezone);
      if (op === 'and' && !r) return false;
      if (op === 'or' && r) return true;
      results.push(r);
    }
    return op === 'and';
  }

  private async evaluateOne(homeId: string, c: AutomationCondition, timezone: string): Promise<boolean> {
    switch (c.type) {
      case 'group':
        return this.evaluate(homeId, c.conditions, c.operator, timezone);
      case 'timeWindow': {
        const z = zonedNow(timezone);
        const now = z.hour * 60 + z.minute;
        const [ah, am] = c.after.split(':').map(Number) as [number, number];
        const [bh, bm] = c.before.split(':').map(Number) as [number, number];
        const after = ah * 60 + am;
        const before = bh * 60 + bm;
        const inWindow = after <= before ? now >= after && now < before : now >= after || now < before;
        return inWindow && (!c.days || c.days.includes(z.weekday));
      }
      case 'deviceState':
      case 'numericState':
      case 'securityState': {
        const d = await prisma.device.findFirst({ where: { id: c.deviceId, homeId } });
        if (!d || d.connectivity !== 'online') return false; // unknown state never satisfies a condition
        const s = d.state as DeviceState;
        if (c.type === 'deviceState') return String(s[c.attribute as keyof DeviceState]) === String(c.equals);
        if (c.type === 'securityState') return s.alarmState === c.alarmState;
        const v = c.attribute === 'measurement' ? s.measurements?.[c.measurementKey ?? ''] : (s[c.attribute as keyof DeviceState] as number | undefined);
        return v !== undefined && (c.above === undefined || v > c.above) && (c.below === undefined || v < c.below);
      }
      case 'roomState': {
        const devices = await prisma.device.findMany({ where: { homeId, roomId: c.roomId, connectivity: 'online' } });
        const anyOn = devices.some((d) => (d.state as DeviceState).on === true);
        return anyOn === c.anyOn;
      }
      case 'presence': {
        const trackers = await prisma.device.findMany({ where: { homeId, capabilities: { some: { type: 'presence' } }, connectivity: 'online' } });
        if (!trackers.length) return false;
        const anyone = trackers.some((d) => (d.state as DeviceState).present === true);
        return anyone === c.anyoneHome;
      }
    }
  }

  // ─── Execution ──────────────────────────────────────────────────────────

  async run(automationId: string, triggeredBy: string, depth: number, opts: { simulate?: boolean; manual?: boolean; actorUserId?: string | null } = {}): Promise<AutomationExecutionDto | null> {
    const a = await prisma.automation.findUnique({ where: { id: automationId }, include: { ...automationInclude, home: true } });
    if (!a || a.executor !== 'smartnest') return null;
    if (!opts.manual && !opts.simulate && (!a.enabled || a.isDraft)) return null;
    if (depth > MAX_DEPTH) return null;

    // Cooldown and overlap protection (skip silently for automatic runs)
    if (!opts.simulate) {
      if (this.running.has(a.id)) return null;
      if (!opts.manual && a.lastRunAt && Date.now() - a.lastRunAt.getTime() < a.cooldownSeconds * 1000) return null;
      const runs = (this.recentRuns.get(a.id) ?? []).filter((t) => Date.now() - t < RUNAWAY_WINDOW_MS);
      if (runs.length >= RUNAWAY_MAX_RUNS) {
        await this.disableRunaway(a);
        return null;
      }
      runs.push(Date.now());
      this.recentRuns.set(a.id, runs);
    }

    const dto = toAutomationDto(a);
    const conditionsMet = await this.evaluate(a.homeId, dto.conditions, dto.conditionOperator, a.home.timezone);
    if (!conditionsMet && !opts.manual && !opts.simulate) return null; // automatic run, conditions false → nothing to record

    const exec = await prisma.automationExecution.create({
      data: { automationId: a.id, homeId: a.homeId, triggeredBy: opts.simulate ? `Simulation: ${triggeredBy}` : triggeredBy, depth, status: opts.simulate ? 'simulated' : 'running' },
    });

    const steps: Step[] = [];
    if (!conditionsMet) {
      steps.push({ index: 0, type: 'conditions', description: 'Conditions', status: 'skipped', message: 'Conditions are not met right now.' });
      const done = await prisma.automationExecution.update({ where: { id: exec.id }, data: { status: 'skipped', completedAt: new Date(), steps: json(steps) } });
      const out = toExecutionDto(done);
      pushRealtime({ type: 'automation.execution', homeId: a.homeId, execution: out });
      return out;
    }

    if (opts.simulate) {
      dto.actions.forEach((act, i) => steps.push({ index: i, type: act.type, description: describeAction(act), status: 'simulated', message: 'Not executed (simulation).' }));
      const done = await prisma.automationExecution.update({ where: { id: exec.id }, data: { completedAt: new Date(), steps: json(steps) } });
      return toExecutionDto(done);
    }

    this.running.add(a.id);
    try {
      for (let i = 0; i < dto.actions.length; i++) {
        const act = dto.actions[i]!;
        const step: Step = { index: i, type: act.type, description: describeAction(act), status: 'ok', message: null };
        try {
          step.message = await this.executeAction(a, act, depth, exec.id);
        } catch (e) {
          step.status = 'failed';
          step.message = (e as Error).message;
        }
        steps.push(step);
        await prisma.automationExecution.update({ where: { id: exec.id }, data: { steps: json(steps) } });
      }
    } finally {
      this.running.delete(a.id);
    }

    const failed = steps.filter((s) => s.status === 'failed').length;
    const status: AutomationExecutionDto['status'] = failed === 0 ? 'succeeded' : failed === steps.length ? 'failed' : 'partial';
    const finished = await prisma.automationExecution.update({
      where: { id: exec.id },
      data: { status, completedAt: new Date(), steps: json(steps), error: failed ? steps.filter((s) => s.status === 'failed').map((s) => `${s.description}: ${s.message}`).join('; ') : null },
    });
    await prisma.automation.update({ where: { id: a.id }, data: { lastRunAt: new Date(), lastRunStatus: status } });
    this.invalidate(a.homeId);
    const out = toExecutionDto(finished);
    pushRealtime({ type: 'automation.execution', homeId: a.homeId, execution: out });

    const isDemo = a.home.isDemo;
    await recordActivity({
      homeId: a.homeId,
      type: status === 'succeeded' ? 'automation.executed' : 'automation.failed',
      title: `Automation "${a.name}" ${status === 'succeeded' ? 'ran' : status === 'partial' ? 'partly failed' : 'failed'}`,
      detail: status === 'succeeded' ? `Triggered by: ${triggeredBy}` : out.error,
      severity: status === 'succeeded' ? 'success' : 'warning',
      result: status === 'succeeded' ? 'success' : 'failure',
      source: 'automation',
      actorUserId: opts.actorUserId ?? null,
      metadata: { automationId: a.id, executionId: exec.id },
      isDemo,
    });
    if (status !== 'succeeded') {
      await notifyHome({ homeId: a.homeId, category: 'automationFailures', title: `Automation "${a.name}" ${status === 'partial' ? 'partly failed' : 'failed'}`, body: out.error ?? 'One or more actions failed.', severity: 'warning', link: `/automations/${a.id}` });
    }
    return out;
  }

  private async executeAction(a: AutomationWithRelations & { home: { id: string } }, act: AutomationAction, depth: number, execId: string): Promise<string | null> {
    switch (act.type) {
      case 'deviceCommand': {
        const { done } = await dispatchCommand({ homeId: a.homeId, deviceId: act.deviceId, command: act.command, userId: null, actorName: `Automation: ${a.name}`, source: 'automation', sourceId: execId });
        const r = await done;
        if (r.status !== 'confirmed') throw new Error(r.errorMessage ?? `Command ${r.status.replace('_', ' ')}`);
        return r.verified ? 'Confirmed' : 'Acknowledged';
      }
      case 'activateScene': {
        const { done } = await activateScene({ homeId: a.homeId, sceneId: act.sceneId, userId: null, actorName: `Automation: ${a.name}`, source: 'automation', canControlSensitive: a.allowSensitiveActions });
        const r = await done;
        if (r.status !== 'succeeded') throw new Error(`Scene ${r.status}: ${r.results.filter((x) => x.status !== 'confirmed').map((x) => x.deviceName).join(', ')}`);
        return 'Scene completed';
      }
      case 'notify': {
        const n = await notifyHome({ homeId: a.homeId, category: 'general', title: act.title, body: act.message, severity: act.severity, link: `/automations/${a.id}` });
        return `In-app notification sent to ${n} member${n === 1 ? '' : 's'}`;
      }
      case 'delay':
        await sleep(act.seconds * 1000);
        return `Waited ${act.seconds}s`;
      case 'runAutomation': {
        const r = await this.run(act.automationId, `Automation "${a.name}"`, depth + 1);
        if (!r) return 'Skipped (disabled, cooling down or depth limit)';
        if (r.status === 'failed' || r.status === 'partial') throw new Error(`Nested automation ${r.status}`);
        return `Nested automation ${r.status}`;
      }
    }
  }

  private async disableRunaway(a: AutomationWithRelations): Promise<void> {
    await prisma.automation.update({ where: { id: a.id }, data: { enabled: false, lastRunStatus: 'failed' } });
    this.invalidate(a.homeId);
    this.recentRuns.delete(a.id);
    await recordActivity({ homeId: a.homeId, type: 'automation.failed', title: `Automation "${a.name}" was disabled`, detail: `It ran more than ${RUNAWAY_MAX_RUNS} times in 10 minutes, which looks like a loop.`, severity: 'critical', result: 'failure', source: 'system' });
    await notifyHome({ homeId: a.homeId, category: 'automationFailures', title: `"${a.name}" disabled to prevent a loop`, body: 'Review its triggers and actions before enabling it again.', severity: 'critical', link: `/automations/${a.id}` });
  }

  /** Whether the user may execute this automation's actions manually */
  canRunManually(role: HomeRole): boolean {
    return roleHasPermission(role, 'automations.manage');
  }
}

export function describeAction(act: AutomationAction): string {
  switch (act.type) {
    case 'deviceCommand':
      return describeCommand(act.command);
    case 'activateScene':
      return 'Activate scene';
    case 'notify':
      return `Notify: ${act.title}`;
    case 'delay':
      return `Wait ${act.seconds}s`;
    case 'runAutomation':
      return 'Run another automation';
  }
}

export const automationEngine = new AutomationEngine();
export { automationInputSchema };
