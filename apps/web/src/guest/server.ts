import type { FetchArgs, FetchBaseQueryError } from '@reduxjs/toolkit/query';
import {
  CATEGORY_INFO,
  DEVICE_CATEGORIES,
  INTEGRATIONS,
  INTEGRATION_TYPES,
  LOW_BATTERY_THRESHOLD,
  automationInputSchema,
  describeCommand,
  hasCapability,
  isSensitiveCommand,
  sceneInputSchema,
  validateAutomation,
  validateCommandForCapabilities,
  type ActivityDto,
  type AutomationDto,
  type AutomationExecutionDto,
  type AutomationInput,
  type CatalogueDto,
  type CommandDto,
  type DeviceCommand,
  type DeviceDto,
  type DeviceState,
  type DiscoveredDeviceDto,
  type EnergyDto,
  type HomeDto,
  type IntegrationDto,
  type NetworkDto,
  type NotificationDto,
  type RoomDto,
  type SceneDto,
  type SceneExecutionDto,
  type SearchResultDto,
} from '@smartnest/shared';
import { cameraDataUri } from './cameraImage';
import {
  ALL_PERMISSIONS, DEMO_INTEGRATION_ID, GUEST_NAME, HA_INTEGRATION_ID, HOME_ID, POWER_ON, createGuestDb, deviceId as deviceIdFor, mulberry32,
  type DeviceRecord, type GuestDb, type IntegrationRecord, type SceneRecord,
} from './data';
import { emitGuestEvent } from './events';
import { endGuestSession, isGuest } from './session';

/**
 * In-browser stand-in for the SmartNest API, used only in guest mode. It
 * answers the same routes with the same response shapes as apps/server, keeps
 * changes in memory (lost on reload) and publishes the real-time events the
 * WebSocket would, so the UI behaves as it does against a real backend.
 */

type Result = { data: unknown } | { error: FetchBaseQueryError };

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}
const badRequest = (m: string) => new HttpError(400, 'bad_request', m);
const notFound = (what: string) => new HttpError(404, 'not_found', `${what} not found.`);
const unavailableInGuest = (what: string) => new HttpError(403, 'guest_mode', `${what} isn't available in guest mode. Sign in to a SmartNest server to use it.`);

// ─── State ────────────────────────────────────────────────────────────────

let db: GuestDb | null = null;
let ticker: number | null = null;
let seq = 0;
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(++seq).toString(36)}`;
const nowIso = () => new Date().toISOString();

function getDb(): GuestDb {
  if (!db) {
    db = createGuestDb();
    recomputeMeter();
    ticker = window.setInterval(tick, 15_000);
  }
  return db;
}

/** Forget the in-memory home and stop the simulation (sign-out). */
export function resetGuestServer(): void {
  db = null;
  if (ticker) window.clearInterval(ticker);
  ticker = null;
}

// ─── DTO mapping ──────────────────────────────────────────────────────────

const integrationOf = (d: DeviceRecord) => getDb().integrations.find((i) => i.id === d.integrationId);

function toDevice(d: DeviceRecord): DeviceDto {
  const integ = integrationOf(d);
  const room = d.roomId ? getDb().rooms.find((r) => r.id === d.roomId) : undefined;
  return {
    id: d.id, homeId: HOME_ID, integrationId: d.integrationId, integrationType: integ?.type ?? 'demo', integrationName: integ?.name ?? 'Integration', isDemo: !!integ?.isDemo,
    externalId: d.externalId, name: d.name, category: d.category, deviceType: d.deviceType, manufacturer: d.manufacturer, model: d.model, roomId: d.roomId, roomName: room?.name ?? null,
    isFavourite: d.isFavourite, isHidden: d.isHidden, capabilities: d.capabilities, state: structuredClone(d.state), connectivity: d.connectivity, stateUpdatedAt: d.stateUpdatedAt,
    lastSeenAt: d.lastSeenAt, lastCommandAt: d.lastCommandAt, lastError: d.lastError, integrationDisconnected: integ?.status === 'disconnected', createdAt: d.createdAt,
  };
}

function toRoom(r: GuestDb['rooms'][number]): RoomDto {
  const visible = getDb().devices.filter((d) => d.roomId === r.id && !d.isHidden);
  const avg = (key: string) => {
    const v = visible.filter((d) => d.connectivity === 'online').map((d) => d.state.measurements?.[key]).filter((x): x is number => typeof x === 'number');
    return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : undefined;
  };
  const environment: RoomDto['environment'] = {};
  const t = avg('temperature');
  const h = avg('humidity');
  const c = avg('co2');
  if (t !== undefined) environment.temperature = t;
  if (h !== undefined) environment.humidity = h;
  if (c !== undefined) environment.co2 = c;
  return {
    ...r,
    deviceCount: visible.length,
    onlineCount: visible.filter((d) => d.connectivity === 'online').length,
    activeCount: visible.filter((d) => d.state.on === true).length,
    environment,
  };
}

function toIntegration(i: IntegrationRecord): IntegrationDto {
  const s = getDb();
  return {
    ...i,
    deviceCount: s.devices.filter((d) => d.integrationId === i.id).length,
    discoveredNotImported: s.notImported[i.id]?.length ?? 0,
    supportLevel: INTEGRATIONS[i.type].supportLevel,
  };
}

function toScene(s: SceneRecord): SceneDto {
  const devices = getDb().devices;
  const actions = [...s.actions].sort((a, b) => a.order - b.order).map((a) => {
    const d = devices.find((x) => x.id === a.deviceId);
    return { id: a.id, deviceId: a.deviceId, deviceName: d?.name ?? 'Removed device', command: a.command, description: describeCommand(a.command), order: a.order, deviceAvailable: d?.connectivity === 'online', caps: d?.capabilities ?? [] };
  });
  return {
    id: s.id, name: s.name, icon: s.icon, description: s.description, roomId: s.roomId, executionMode: s.executionMode, isFavourite: s.isFavourite, allowSensitiveActions: s.allowSensitiveActions,
    requiresConfirmation: actions.some((a) => isSensitiveCommand(a.command, a.caps)),
    actions: actions.map(({ caps: _c, ...rest }) => rest),
    lastExecution: getDb().sceneExecutions.find((e) => e.sceneId === s.id) ?? null,
    createdAt: s.createdAt, updatedAt: s.updatedAt,
  };
}

function toHome(): HomeDto {
  return { ...getDb().home, role: 'owner', permissions: ALL_PERMISSIONS };
}

// ─── Lookups ──────────────────────────────────────────────────────────────

function findDevice(id: string): DeviceRecord {
  const d = getDb().devices.find((x) => x.id === id);
  if (!d) throw notFound('Device');
  return d;
}
function findRoom(id: string) {
  const r = getDb().rooms.find((x) => x.id === id);
  if (!r) throw notFound('Room');
  return r;
}
function findScene(id: string) {
  const s = getDb().scenes.find((x) => x.id === id);
  if (!s) throw notFound('Scene');
  return s;
}
function findAutomation(id: string) {
  const a = getDb().automations.find((x) => x.id === id);
  if (!a) throw notFound('Automation');
  return a;
}
function findIntegration(id: string) {
  const i = getDb().integrations.find((x) => x.id === id);
  if (!i) throw notFound('Integration');
  return i;
}

// ─── Side effects: activity, notifications, device state ─────────────────

function addActivity(a: Omit<ActivityDto, 'id' | 'createdAt' | 'isDemo' | 'deviceId' | 'deviceName' | 'roomId' | 'category'> & { device?: DeviceRecord }) {
  const { device, ...rest } = a;
  const item: ActivityDto = {
    ...rest, id: uid('act'), createdAt: nowIso(), isDemo: true,
    deviceId: device?.id ?? null, deviceName: device?.name ?? null, roomId: device?.roomId ?? null, category: device?.category ?? null,
  };
  getDb().activity.unshift(item);
  emitGuestEvent({ type: 'activity.created', homeId: HOME_ID, activity: item });
}

function addNotification(n: Pick<NotificationDto, 'title' | 'body' | 'severity' | 'category' | 'link'>) {
  const item: NotificationDto = { ...n, id: uid('n'), readAt: null, createdAt: nowIso() };
  getDb().notifications.unshift(item);
  emitGuestEvent({ type: 'notification.created', homeId: HOME_ID, notification: item });
}

const emitDevice = (d: DeviceRecord) => emitGuestEvent({ type: 'device.updated', homeId: HOME_ID, device: toDevice(d) });

/** Whole-home meter follows the simulated loads, like the server's demo adapter. */
function recomputeMeter(): DeviceRecord | null {
  const s = getDb();
  const meter = s.devices.find((d) => d.id === deviceIdFor('meter'));
  if (!meter) return null;
  const loads = Object.keys(POWER_ON).map((k) => s.devices.find((d) => d.id === deviceIdFor(k))?.state.powerW ?? 0).reduce((a, b) => a + b, 0);
  meter.state = { ...meter.state, powerW: Math.round(320 + loads + Math.random() * 120) };
  return meter;
}

function applyState(d: DeviceRecord, patch: DeviceState) {
  d.state = { ...d.state, ...patch };
  const key = d.id.replace(/^dev-/, '').replace(/-/g, '_');
  if (patch.on !== undefined && POWER_ON[key]) {
    d.state.powerW = patch.on ? POWER_ON[key]![0] : POWER_ON[key]![1];
    if (key === 'ev_charger') {
      d.state.charging = patch.on;
      d.state.chargingState = patch.on ? 'Charging' : 'Idle';
    }
    const meter = recomputeMeter();
    if (meter) emitDevice(meter);
  }
  d.stateUpdatedAt = nowIso();
  d.lastSeenAt = d.stateUpdatedAt;
  emitDevice(d);
}

/** The state a command leads to (mirrors the demo adapter's simulation). */
function nextState(s: DeviceState, cmd: DeviceCommand): DeviceState {
  switch (cmd.action) {
    case 'turnOn':
      return { on: true, ...(s.brightness === 0 ? { brightness: 80 } : {}), ...(s.mediaState === 'off' ? { mediaState: 'idle' } : {}), ...(s.hvacMode === 'off' ? { hvacMode: 'auto' } : {}) };
    case 'turnOff':
      return { on: false, ...(s.brightness !== undefined ? { brightness: 0 } : {}), ...(s.mediaState ? { mediaState: 'off' } : {}), ...(s.hvacMode ? { hvacMode: 'off', hvacAction: 'off' } : {}) };
    case 'setBrightness':
      return { brightness: cmd.value, on: cmd.value > 0 };
    case 'setColor':
      return { colorRgb: cmd.rgb, on: true };
    case 'setColorTemperature':
      return { colorTemperatureK: cmd.kelvin, on: true };
    case 'setTargetTemperature':
      return { targetTemperature: cmd.value };
    case 'setHvacMode':
      return { hvacMode: cmd.mode, on: cmd.mode !== 'off', hvacAction: cmd.mode === 'off' ? 'off' : cmd.mode === 'cool' ? 'cooling' : cmd.mode === 'heat' ? 'heating' : 'idle' };
    case 'setFanSpeed':
      return { fanSpeed: cmd.speed };
    case 'setSwingMode':
      return { swingMode: cmd.mode };
    case 'open':
      return { position: 100, coverState: 'open' };
    case 'close':
      return { position: 0, coverState: 'closed' };
    case 'setPosition':
      return { position: cmd.value, coverState: cmd.value === 0 ? 'closed' : 'open' };
    case 'stop':
      return { coverState: 'stopped' };
    case 'lock':
      return { lockState: 'locked', locked: true };
    case 'unlock':
      return { lockState: 'unlocked', locked: false };
    case 'arm':
      return { alarmState: cmd.mode };
    case 'disarm':
      return { alarmState: 'disarmed' };
    case 'mediaCommand':
      if (cmd.command === 'play') return { mediaState: 'playing', on: true };
      if (cmd.command === 'pause') return { mediaState: 'paused' };
      if (cmd.command === 'stop') return { mediaState: 'idle' };
      return { mediaTitle: cmd.command === 'next' ? 'Next track' : 'Previous track' };
    case 'setVolume':
      return { volume: cmd.value };
    case 'setMuted':
      return { muted: cmd.muted };
    case 'selectSource':
      return { mediaSource: cmd.source };
    case 'setMotionDetection':
      return { motionDetectionEnabled: cmd.enabled };
    case 'vacuumCommand':
      if (cmd.command === 'start') return { vacuumState: 'cleaning' };
      if (cmd.command === 'pause') return { vacuumState: 'paused' };
      if (cmd.command === 'returnToBase') return { vacuumState: 'docked' };
      return {};
    case 'openValve':
      return { valveOpen: true };
    case 'closeValve':
      return { valveOpen: false };
    case 'custom':
      return cmd.actionId === 'eco_program' ? { on: true } : {};
    default:
      return {};
  }
}

/** A visible in-between state for slow physical actions (covers, locks, alarm, vacuum). */
function transitionalState(s: DeviceState, cmd: DeviceCommand): DeviceState | null {
  switch (cmd.action) {
    case 'open':
    case 'close':
    case 'setPosition': {
      const target = cmd.action === 'open' ? 100 : cmd.action === 'close' ? 0 : cmd.value;
      const from = s.position ?? 0;
      return target === from ? null : { coverState: target > from ? 'opening' : 'closing' };
    }
    case 'lock':
      return { lockState: 'locking' };
    case 'unlock':
      return { lockState: 'unlocking' };
    case 'arm':
      return { alarmState: 'arming' };
    case 'vacuumCommand':
      return cmd.command === 'returnToBase' ? { vacuumState: 'returning' } : null;
    default:
      return null;
  }
}

const later = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

/** Dispatch a command: returns it pending at once, then walks it through sent → confirmed/failed/timed out. */
function dispatchCommand(d: DeviceRecord, command: DeviceCommand, source: CommandDto['source']): { command: CommandDto; done: Promise<CommandDto> } {
  const s = getDb();
  const cmd: CommandDto = {
    id: uid('cmd'), deviceId: d.id, deviceName: d.name, command, description: describeCommand(command), status: 'pending', verified: false,
    errorCode: null, errorMessage: null, source, createdAt: nowIso(), completedAt: null,
  };
  s.commands.unshift(cmd);
  d.lastCommandAt = cmd.createdAt;
  const update = (patch: Partial<CommandDto>) => {
    Object.assign(cmd, patch);
    emitGuestEvent({ type: 'command.updated', homeId: HOME_ID, command: { ...cmd } });
  };

  const done = (async () => {
    await later(150);
    update({ status: 'sent' });
    const integ = integrationOf(d);
    if (integ?.status === 'disconnected') {
      await later(250);
      update({ status: 'failed', errorCode: 'integration_disconnected', errorMessage: `${integ.name} is disconnected.`, completedAt: nowIso() });
    } else if (d.connectivity !== 'online') {
      await later(300);
      update({ status: 'failed', errorCode: 'device_unavailable', errorMessage: 'The device is offline and did not receive the command.', completedAt: nowIso() });
    } else if (d.unresponsive) {
      await later(6000);
      update({ status: 'timed_out', errorCode: 'not_confirmed', errorMessage: 'The device acknowledged the command but did not report the requested state in time.', completedAt: nowIso() });
    } else {
      const transitional = transitionalState(d.state, command);
      if (transitional) {
        applyState(d, transitional);
        await later(1300);
      } else {
        await later(350 + Math.random() * 450);
      }
      const patch = nextState(d.state, command);
      if (Object.keys(patch).length) applyState(d, patch);
      update({ status: 'confirmed', verified: Object.keys(patch).length > 0, completedAt: nowIso() });
    }
    if (source === 'user') {
      const ok = cmd.status === 'confirmed';
      const sensitive = isSensitiveCommand(command, d.capabilities);
      addActivity({
        type: sensitive ? 'security.event' : 'device.command',
        title: ok ? `${d.name}: ${cmd.description}` : `${d.name}: ${cmd.description} ${cmd.status === 'failed' ? 'failed' : 'was not confirmed'}`,
        detail: ok ? null : cmd.errorMessage,
        severity: ok ? (sensitive ? 'warning' : 'success') : 'warning',
        result: ok ? 'success' : 'failure',
        source: 'user',
        actorName: GUEST_NAME,
        device: d,
      });
    }
    return { ...cmd };
  })();
  return { command: { ...cmd }, done };
}

// ─── Scenes & automations ─────────────────────────────────────────────────

function activateScene(scene: SceneRecord, source: 'user' | 'automation'): SceneExecutionDto {
  const s = getDb();
  const ordered = [...scene.actions].sort((a, b) => a.order - b.order);
  const exec: SceneExecutionDto = {
    id: uid('sx'), sceneId: scene.id, status: 'running', startedAt: nowIso(), completedAt: null, source,
    results: ordered.map((a) => ({ actionId: a.id, deviceId: a.deviceId, deviceName: s.devices.find((d) => d.id === a.deviceId)?.name ?? 'Removed device', description: describeCommand(a.command), status: 'pending', message: null, commandId: null })),
  };
  s.sceneExecutions.unshift(exec);
  const publish = () => emitGuestEvent({ type: 'scene.execution', homeId: HOME_ID, execution: structuredClone(exec) });

  const runAction = async (i: number) => {
    const a = ordered[i]!;
    const r = exec.results[i]!;
    const d = s.devices.find((x) => x.id === a.deviceId);
    if (!d) {
      Object.assign(r, { status: 'skipped', message: 'The device was removed from SmartNest.' });
      publish();
      return;
    }
    const { command, done } = dispatchCommand(d, a.command, 'scene');
    Object.assign(r, { status: 'sent', commandId: command.id });
    publish();
    const final = await done;
    Object.assign(r, { status: final.status, message: final.errorMessage });
    publish();
  };

  void (async () => {
    await later(50);
    if (scene.executionMode === 'sequential') {
      for (let i = 0; i < ordered.length; i++) await runAction(i);
    } else {
      await Promise.all(ordered.map((_, i) => runAction(i)));
    }
    const ok = exec.results.filter((r) => r.status === 'confirmed').length;
    exec.status = ok === exec.results.length ? 'succeeded' : ok ? 'partial' : 'failed';
    exec.completedAt = nowIso();
    publish();
    addActivity({
      type: 'scene.executed',
      title: exec.status === 'succeeded' ? `${scene.name} activated` : exec.status === 'partial' ? `${scene.name} partly completed` : `${scene.name} failed`,
      detail: `${ok} of ${exec.results.length} actions confirmed.`,
      severity: exec.status === 'succeeded' ? 'success' : 'warning',
      result: exec.status === 'succeeded' ? 'success' : 'failure',
      source: source === 'user' ? 'scene' : 'automation',
      actorName: source === 'user' ? GUEST_NAME : null,
    });
  })();
  return structuredClone(exec);
}

function describeAction(a: AutomationInput['actions'][number]): string {
  const s = getDb();
  switch (a.type) {
    case 'deviceCommand':
      return `${s.devices.find((d) => d.id === a.deviceId)?.name ?? 'Device'}: ${describeCommand(a.command)}`;
    case 'activateScene':
      return `Run scene “${s.scenes.find((x) => x.id === a.sceneId)?.name ?? 'Scene'}”`;
    case 'notify':
      return `Notify “${a.title}”`;
    case 'delay':
      return `Wait ${a.seconds} s`;
    case 'runAutomation':
      return `Run automation “${s.automations.find((x) => x.id === a.automationId)?.name ?? 'Automation'}”`;
  }
}

function runAutomation(a: AutomationDto, triggeredBy: string, simulate: boolean): AutomationExecutionDto {
  const s = getDb();
  const steps: AutomationExecutionDto['steps'] = a.actions.map((x, index) => {
    let status: 'ok' | 'failed' | 'skipped' | 'simulated' = simulate ? 'simulated' : 'ok';
    let message: string | null = simulate ? 'Would run (test only, nothing was changed).' : null;
    if (!simulate) {
      if (x.type === 'deviceCommand') {
        const d = s.devices.find((dd) => dd.id === x.deviceId);
        if (!d) [status, message] = ['failed', 'The device no longer exists.'];
        else if (d.connectivity !== 'online') [status, message] = ['failed', 'The device is offline.'];
        else dispatchCommand(d, x.command, 'automation');
      } else if (x.type === 'activateScene') {
        const scene = s.scenes.find((sc) => sc.id === x.sceneId);
        if (scene) activateScene(scene, 'automation');
        else [status, message] = ['failed', 'The scene no longer exists.'];
      } else if (x.type === 'notify') {
        addNotification({ title: x.title, body: x.message, severity: x.severity, category: 'automation', link: `/automations/${a.id}` });
      } else if (x.type === 'delay') {
        message = 'Delays are skipped in guest mode.';
      }
    }
    return { index, type: x.type, description: describeAction(x), status, message };
  });
  const failed = steps.filter((x) => x.status === 'failed').length;
  const exec: AutomationExecutionDto = {
    id: uid('ax'), automationId: a.id, status: simulate ? 'simulated' : failed === 0 ? 'succeeded' : failed === steps.length ? 'failed' : 'partial',
    triggeredBy, startedAt: nowIso(), completedAt: nowIso(), error: failed ? `${failed} step${failed === 1 ? '' : 's'} failed.` : null, steps,
  };
  s.automationExecutions.unshift(exec);
  if (!simulate) {
    a.lastRunAt = exec.startedAt;
    a.lastRunStatus = exec.status;
    addActivity({ type: failed ? 'automation.failed' : 'automation.executed', title: `${a.name} ran`, detail: triggeredBy, severity: failed ? 'warning' : 'success', result: failed ? 'failure' : 'success', source: 'automation', actorName: null });
  }
  emitGuestEvent({ type: 'automation.execution', homeId: HOME_ID, execution: exec });
  return exec;
}

function automationIssues(input: AutomationInput, selfId?: string) {
  const s = getDb();
  const issues = validateAutomation(input, {
    devices: new Map(s.devices.map((d) => [d.id, { capabilities: d.capabilities.map((c) => c.type), name: d.name }])),
    sceneIds: new Set(s.scenes.map((x) => x.id)),
    roomIds: new Set(s.rooms.map((r) => r.id)),
    automationGraph: new Map(s.automations.map((a) => [a.id, a.actions.flatMap((x) => (x.type === 'runAutomation' ? [x.automationId] : []))])),
    selfId,
    homeHasLocation: s.home.latitude !== null && s.home.longitude !== null,
  });
  const automationIds = new Set(s.automations.map((a) => a.id));
  input.actions.forEach((x, i) => {
    if (x.type === 'runAutomation' && !automationIds.has(x.automationId)) issues.push({ path: `actions.${i}`, message: 'Action refers to an automation that no longer exists.', severity: 'error' });
  });
  return issues;
}

function parseAutomation(body: unknown): AutomationInput {
  const parsed = automationInputSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, 'validation_error', parsed.error.issues[0]?.message ?? 'Invalid automation.');
  return parsed.data;
}

function saveAutomation(input: AutomationInput, existing?: AutomationDto): AutomationDto {
  const issues = automationIssues(input, existing?.id);
  const err = issues.find((i) => i.severity === 'error');
  if (!input.isDraft && err) throw new HttpError(400, 'invalid_automation', err.message);
  const s = getDb();
  const base = { ...input, enabled: input.isDraft ? false : input.enabled, updatedAt: nowIso() };
  if (existing) {
    Object.assign(existing, base);
    return existing;
  }
  const a: AutomationDto = { ...base, id: uid('auto'), executor: 'smartnest', externalId: null, lastRunAt: null, lastRunStatus: null, createdAt: nowIso() };
  s.automations.unshift(a);
  return a;
}

function saveScene(body: unknown, existing?: SceneRecord): SceneRecord {
  const parsed = sceneInputSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, 'validation_error', parsed.error.issues[0]?.message ?? 'Invalid scene.');
  const input = parsed.data;
  input.actions.forEach((a, i) => {
    const d = getDb().devices.find((x) => x.id === a.deviceId);
    if (!d) throw badRequest(`Action ${i + 1}: device not found in this home.`);
    const v = validateCommandForCapabilities(a.command, d.capabilities);
    if (!v.ok) throw badRequest(`Action ${i + 1} (${d.name}): ${v.message}`);
    if (isSensitiveCommand(a.command, d.capabilities) && !input.allowSensitiveActions) {
      throw badRequest(`Action ${i + 1} (${d.name}) is security-sensitive. Enable "Allow sensitive actions" to include it.`);
    }
  });
  const data = {
    name: input.name, icon: input.icon, description: input.description, roomId: input.roomId ?? null, executionMode: input.executionMode, isFavourite: input.isFavourite,
    allowSensitiveActions: input.allowSensitiveActions, actions: input.actions.map((a, i) => ({ id: uid('sa'), deviceId: a.deviceId, command: a.command, order: a.order ?? i })), updatedAt: nowIso(),
  };
  if (existing) return Object.assign(existing, data);
  const scene: SceneRecord = { ...data, id: uid('scene'), createdAt: nowIso() };
  getDb().scenes.push(scene);
  return scene;
}

// ─── Read models: device list, history, energy, network ──────────────────

function listDevices(q: Record<string, string>) {
  const s = getDb();
  const term = q.q?.toLowerCase();
  let items = s.devices.filter((d) => {
    if (q.includeHidden !== 'true' && d.isHidden) return false;
    if (term) {
      const room = s.rooms.find((r) => r.id === d.roomId)?.name ?? '';
      if (![d.name, d.manufacturer ?? '', d.model ?? '', room].some((v) => v.toLowerCase().includes(term))) return false;
    }
    if (q.roomId && d.roomId !== (q.roomId === 'none' ? null : q.roomId)) return false;
    if (q.category && d.category !== q.category) return false;
    if (q.manufacturer && d.manufacturer !== q.manufacturer) return false;
    if (q.integrationId && d.integrationId !== q.integrationId) return false;
    if (q.connectivity && d.connectivity !== q.connectivity) return false;
    if (q.favourite && d.isFavourite !== (q.favourite === 'true')) return false;
    if (q.capability && !d.capabilities.some((c) => c.type === q.capability)) return false;
    if (q.operating === 'on' && d.state.on !== true) return false;
    if (q.operating === 'off' && d.state.on !== false) return false;
    if (q.operating === 'unknown' && d.connectivity === 'online' && d.state.on !== undefined) return false;
    const battery = d.state.batteryLevel;
    if (q.battery === 'low' && !(battery !== undefined && battery <= LOW_BATTERY_THRESHOLD)) return false;
    if (q.battery === 'ok' && !(battery !== undefined && battery > LOW_BATTERY_THRESHOLD)) return false;
    if (q.battery === 'none' && hasCapability(d.capabilities, 'battery')) return false;
    return true;
  });
  const dir = q.order === 'desc' ? -1 : 1;
  const roomName = (d: DeviceRecord) => s.rooms.find((r) => r.id === d.roomId)?.name ?? '￿';
  const by = (f: (d: DeviceRecord) => string) => (a: DeviceRecord, b: DeviceRecord) => dir * f(a).localeCompare(f(b)) || a.name.localeCompare(b.name);
  const sort = q.sort ?? 'name';
  items = [...items].sort(
    sort === 'room' ? by(roomName)
    : sort === 'updated' ? by((d) => d.stateUpdatedAt ?? '')
    : sort === 'connectivity' ? by((d) => d.connectivity)
    : sort === 'category' ? by((d) => d.category)
    : by((d) => d.name),
  );
  const page = Math.max(1, Number(q.page ?? 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 24) || 24));
  return { items: items.slice((page - 1) * pageSize, page * pageSize).map(toDevice), total: items.length, page, pageSize };
}

/** Plausible sampled state history ending in the device's current state. */
function deviceHistory(d: DeviceRecord, hours: number) {
  const now = Date.now();
  const stepMin = hours <= 6 ? 5 : hours <= 24 ? 15 : 60;
  const count = Math.floor((hours * 60) / stepMin);
  const rnd = mulberry32([...d.id].reduce((a, c) => a + c.charCodeAt(0), 0));
  const key = d.id.replace(/^dev-/, '').replace(/-/g, '_');
  const cur = d.state;
  const history: { t: string; state: DeviceState; connectivity: string }[] = [];
  for (let i = count; i >= 1; i--) {
    const t = now - i * stepMin * 60_000;
    const date = new Date(t);
    const hour = date.getHours() + date.getMinutes() / 60;
    const day = Math.sin(((hour - 15) / 24) * 2 * Math.PI); // peaks mid-afternoon
    const daylight = Math.max(0, Math.sin(((hour - 6) / 13) * Math.PI));
    const evening = hour >= 17 && hour <= 23;
    const noise = rnd() - 0.5;
    const st: DeviceState = {};
    if (cur.measurements) {
      const m: Record<string, number> = {};
      for (const [k, v] of Object.entries(cur.measurements)) {
        const r1 = (x: number) => Math.round(x * 10) / 10;
        m[k] =
          k === 'temperature' ? r1(v + 1.4 * day + noise * 0.3)
          : k === 'humidity' ? Math.round(v - 5 * day + noise * 2)
          : k === 'co2' ? Math.round(v + (evening ? 260 : 0) - 120 * daylight + noise * 40)
          : k === 'pm25' ? Math.max(1, Math.round(v + noise * 4 + (hour >= 18 && hour <= 20 ? 6 : 0)))
          : k === 'illuminance' ? Math.max(0, Math.round(daylight * 620 + 15 + noise * 30))
          : k === 'soil_moisture' ? Math.round(v + ((i % 288) / 288) * 6 + noise)
          : k === 'pressure' ? Math.round(v + 3 * Math.sin(t / 172_800_000) + noise)
          : r1(v + noise * Math.max(1, Math.abs(v) * 0.05));
      }
      st.measurements = m;
      if (cur.currentTemperature !== undefined && m.temperature !== undefined) st.currentTemperature = m.temperature;
    }
    if (cur.powerW !== undefined) {
      if (key === 'meter') st.powerW = Math.round((0.35 + (hour >= 7 && hour <= 9 ? 0.6 : 0) + (evening ? 1.1 : 0) + rnd() * 0.3) * 1000);
      else if (key === 'solar') st.powerW = Math.round(daylight * (3800 + rnd() * 600));
      else if (key === 'battery') st.powerW = Math.round(daylight > 0.3 ? 900 * daylight : evening ? -1100 : -150);
      else if (POWER_ON[key]) {
        const on = key === 'garage_freezer' ? rnd() < 0.45 : key === 'office_plug' ? hour >= 9 && hour <= 18 : key === 'living_ac' ? hour >= 13 && hour <= 20 : key === 'ev_charger' ? hour < 5 : key === 'kitchen_coffee' ? hour >= 7 && hour < 7.5 : key === 'living_tv' ? hour >= 19 && hour <= 22.5 : false;
        st.powerW = on ? Math.round(POWER_ON[key]![0] * (0.9 + rnd() * 0.2)) : POWER_ON[key]![1];
        if (cur.on !== undefined) st.on = on;
      } else st.powerW = Math.max(0, Math.round(cur.powerW * (0.8 + rnd() * 0.4)));
    }
    if (cur.brightness !== undefined) {
      const on = evening || (hour >= 6.5 && hour <= 8);
      st.on = on;
      st.brightness = on ? Math.max(10, Math.min(100, (cur.brightness || 70) + Math.round(noise * 10))) : 0;
    } else if (cur.position !== undefined) {
      st.position = hour >= 7 && hour < 21 ? (cur.position || 100) : 0;
    } else if (cur.on !== undefined && st.on === undefined) {
      st.on = hour >= 18 && hour <= 23;
    }
    if (cur.batteryLevel !== undefined) st.batteryLevel = Math.min(100, Math.round(cur.batteryLevel + (i * stepMin) / 60 / 40));
    if (cur.targetTemperature !== undefined) st.targetTemperature = cur.targetTemperature;
    history.push({ t: date.toISOString(), state: st, connectivity: d.connectivity === 'online' || i > count / 4 ? 'online' : d.connectivity });
  }
  history.push({ t: new Date(now).toISOString(), state: structuredClone(cur), connectivity: d.connectivity });
  if (d.connectivity !== 'online') return { history: history.slice(0, Math.ceil(history.length * 0.75)) };
  return { history };
}

function startOfDayUtc(t: number) {
  const x = new Date(t);
  x.setUTCHours(0, 0, 0, 0);
  return x.getTime();
}
function startOfLocalDay(t: number) {
  const x = new Date(t);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}
const round3 = (v: number) => Math.round(v * 1000) / 1000;

function energy(q: Record<string, string>): EnergyDto {
  const s = getDb();
  const now = Date.now();
  const H = 3_600_000;
  let from: number;
  let to = now;
  let bucket: 'hour' | 'day' = 'hour';
  switch (q.range ?? 'today') {
    case 'live':
      from = now - 6 * H;
      break;
    case '7d':
      from = now - 7 * 24 * H;
      bucket = 'day';
      break;
    case '30d':
      from = now - 30 * 24 * H;
      bucket = 'day';
      break;
    case 'custom': {
      if (!q.from || !q.to) throw badRequest('Custom range needs "from" and "to".');
      from = new Date(q.from).getTime();
      to = new Date(q.to).getTime();
      if (!(to > from)) throw badRequest('"to" must be after "from".');
      bucket = to - from > 3 * 24 * H ? 'day' : 'hour';
      break;
    }
    default:
      from = startOfLocalDay(now);
      to = from + 24 * H;
  }
  const energyDevices = s.devices.filter((d) => d.capabilities.some((c) => c.type === 'power' || c.type === 'energy' || c.type === 'charging'));
  const sources: EnergyDto['sources'] = [];
  let currentPowerW: number | null = null;
  let solarPowerW: number | null = null;
  let batteryLevel: number | null = null;
  const evCharging: EnergyDto['evCharging'] = [];
  for (const d of energyDevices) {
    const role = d.energyRole ?? 'device';
    if (role !== 'device') sources.push({ deviceId: d.id, deviceName: d.name, kind: role, isDemo: !!integrationOf(d)?.isDemo });
    if (d.connectivity !== 'online') continue;
    if (role === 'consumption' && d.state.powerW !== undefined) currentPowerW = (currentPowerW ?? 0) + d.state.powerW;
    if (role === 'solar' && d.state.powerW !== undefined) solarPowerW = (solarPowerW ?? 0) + d.state.powerW;
    if (role === 'battery' && d.state.batteryLevel !== undefined) batteryLevel = d.state.batteryLevel;
    if (role === 'ev') evCharging.push({ deviceId: d.id, name: d.name, charging: !!d.state.charging, powerW: d.state.powerW ?? null });
  }
  const startOf = (t: number) => (bucket === 'hour' ? Math.floor(t / H) * H : startOfDayUtc(t));
  const series = new Map<number, { consumptionKWh: number; solarKWh: number }>();
  for (let t = startOf(from); t < to; t += bucket === 'hour' ? H : 24 * H) series.set(t, { consumptionKWh: 0, solarKWh: 0 });
  const perDevice = new Map<string, number>();
  for (const r of s.energy) {
    if (r.t < from || r.t >= to) continue;
    const b = series.get(startOf(r.t));
    if (b) {
      if (r.kind === 'consumption') b.consumptionKWh += r.kWh;
      if (r.kind === 'solar') b.solarKWh += r.kWh;
    }
    if (r.kind === 'device' || r.kind === 'ev') perDevice.set(r.deviceId, (perDevice.get(r.deviceId) ?? 0) + r.kWh);
  }
  const sumSince = (since: number, kind: string) => round3(s.energy.filter((r) => r.kind === kind && r.t >= since).reduce((a, r) => a + r.kWh, 0));
  const dayStart = startOfLocalDay(now);
  return {
    available: true,
    sources,
    currentPowerW,
    solarPowerW,
    batteryLevel,
    evCharging,
    totals: { todayKWh: sumSince(dayStart, 'consumption'), weekKWh: sumSince(now - 7 * 24 * H, 'consumption'), monthKWh: sumSince(now - 30 * 24 * H, 'consumption'), solarTodayKWh: sumSince(dayStart, 'solar') },
    series: [...series.entries()].map(([t, v]) => ({ t: new Date(t).toISOString(), consumptionKWh: round3(v.consumptionKWh), solarKWh: round3(v.solarKWh) })),
    perDevice: [...perDevice.entries()]
      .map(([id, kWh]) => {
        const d = s.devices.find((x) => x.id === id);
        return { deviceId: id, name: d?.name ?? 'Removed device', kWh: round3(kWh), currentW: d?.state.powerW ?? null };
      })
      .sort((a, b) => b.kWh - a.kWh),
    tariff: s.home.tariffPerKWh !== null && s.home.currency ? { perKWh: s.home.tariffPerKWh, currency: s.home.currency } : null,
    thresholdW: s.preferences.notifications?.energyThresholdW ?? null,
    range: { from: new Date(from).toISOString(), to: new Date(to).toISOString(), bucket },
  };
}

function network(): NetworkDto {
  const now = Date.now();
  const ago = (sec: number) => new Date(now - sec * 1000).toISOString();
  const client = (id: string, name: string, ip: string, connection: 'wifi' | 'ethernet', signalDbm: number | null, seenAgo: number, key: string | null = null) => ({
    id, name, ip, mac: null, connection, signalDbm, lastSeenAt: ago(seenAgo), online: seenAgo < 600, smartHomeDeviceId: key && getDb().devices.some((d) => d.id === deviceIdFor(key)) ? deviceIdFor(key) : null,
  });
  return {
    available: true,
    sources: [{ integrationId: DEMO_INTEGRATION_ID, integrationName: 'Demo Home', isDemo: true }],
    routers: [
      { id: 'router', name: 'Main Router', kind: 'router', status: 'online', clients: 14, uptimeSeconds: 864_000 + (Math.floor(now / 1000) % 86400), firmware: 'demo-1.4.2', deviceId: deviceIdFor('router') },
      { id: 'ap-upstairs', name: 'Mesh Point – Upstairs', kind: 'access_point', status: 'online', clients: 6, uptimeSeconds: 432_000, firmware: 'demo-1.4.2', deviceId: null },
      { id: 'ap-garden', name: 'Mesh Point – Garden', kind: 'access_point', status: 'offline', clients: null, uptimeSeconds: null, firmware: 'demo-1.4.0', deviceId: null },
    ],
    clients: [
      client('c1', 'Laptop', '192.168.1.21', 'wifi', -48, 12),
      client('c2', 'Phone', '192.168.1.22', 'wifi', -55, 30),
      client('c3', 'Tablet', '192.168.1.23', 'wifi', -67, 3600),
      client('c4', 'Workstation', '192.168.1.10', 'ethernet', null, 5),
      client('c5', 'Television', '192.168.1.40', 'ethernet', null, 20, 'living_tv'),
      client('c6', 'Doorbell Camera', '192.168.1.51', 'wifi', -62, 8, 'doorbell_cam'),
      client('c7', 'Garden Camera', '192.168.1.52', 'wifi', -74, 15, 'garden_cam'),
      client('c8', 'Garage Camera', '192.168.1.53', 'wifi', -81, 5400, 'garage_cam'),
      client('c9', 'EV Charger', '192.168.1.60', 'wifi', -70, 40, 'ev_charger'),
      client('c10', 'Solar Inverter', '192.168.1.61', 'ethernet', null, 10, 'solar'),
      client('c11', 'Office Speaker', '192.168.1.70', 'wifi', -51, 25, 'office_speaker'),
      client('c12', 'Robot Vacuum', '192.168.1.71', 'wifi', -64, 90, 'vacuum'),
      client('c13', 'Home Assistant', '192.168.1.5', 'ethernet', null, 3),
      client('c14', 'Unknown device', '192.168.1.99', 'wifi', -77, 200),
      client('c15', 'Games Console', '192.168.1.30', 'ethernet', null, 7200),
    ],
    bandwidth: { downMbps: 182 + Math.round(Math.random() * 40), upMbps: 38 + Math.round(Math.random() * 8), measuredAt: new Date(now).toISOString() },
    guestNetwork: { enabled: false, supported: false },
    health: 'degraded',
  };
}

/** Gentle sensor drift every 15 s so values move like a live home. */
function tick() {
  if (!isGuest()) {
    resetGuestServer();
    return;
  }
  const s = db;
  if (!s) return;
  const jitter = (v: number, amount: number, min: number, max: number, decimals = 1) =>
    Math.round(Math.min(max, Math.max(min, v + (Math.random() - 0.5) * 2 * amount)) * 10 ** decimals) / 10 ** decimals;
  for (const d of s.devices) {
    if (d.connectivity !== 'online') continue;
    const st = d.state;
    let changed = false;
    if (st.measurements) {
      const m = { ...st.measurements };
      if (m.temperature !== undefined) m.temperature = jitter(m.temperature, 0.15, 15, 32);
      if (m.humidity !== undefined) m.humidity = jitter(m.humidity, 0.8, 25, 85, 0);
      if (m.co2 !== undefined) m.co2 = jitter(m.co2, 25, 420, 1600, 0);
      if (m.pm25 !== undefined) m.pm25 = jitter(m.pm25, 1, 1, 60, 0);
      if (m.illuminance !== undefined) m.illuminance = jitter(m.illuminance, 15, 0, 800, 0);
      st.measurements = m;
      if (m.temperature !== undefined && st.currentTemperature !== undefined) st.currentTemperature = m.temperature;
      changed = true;
    }
    if (d.id === deviceIdFor('solar')) {
      const hour = new Date().getHours();
      st.powerW = Math.round(Math.max(0, Math.sin(((hour - 6) / 13) * Math.PI)) * (3800 + Math.random() * 600));
      changed = true;
    }
    if (st.energyKWh !== undefined && st.powerW) {
      st.energyKWh = Math.round((st.energyKWh + (st.powerW / 1000) * (15 / 3600)) * 10000) / 10000;
      changed = true;
    }
    if (changed) {
      d.stateUpdatedAt = nowIso();
      d.lastSeenAt = d.stateUpdatedAt;
    }
  }
  recomputeMeter();
  const hall = s.devices.find((d) => d.id === deviceIdFor('hall_motion'));
  if (hall && Math.random() < 0.15) {
    applyState(hall, { motion: true });
    window.setTimeout(() => hall.state.motion && applyState(hall, { motion: false }), 30_000);
  }
  for (const d of s.devices) if (d.connectivity === 'online' && (d.state.measurements || d.state.powerW !== undefined)) emitDevice(d);
}

// ─── Routes ───────────────────────────────────────────────────────────────

interface Ctx {
  params: Record<string, string>;
  query: Record<string, string>;
  body: Record<string, unknown>;
}
type Handler = (c: Ctx) => unknown;
const routes: { method: string; parts: string[]; handler: Handler }[] = [];
const on = (method: string, pattern: string, handler: Handler) => routes.push({ method, parts: pattern.split('/').filter(Boolean), handler });
const H = '/homes/:homeId';

// Auth
on('GET', '/auth/me', () => ({ user: getDb().user, preferences: getDb().preferences }));
on('POST', '/auth/login', () => ({ user: getDb().user }));
on('POST', '/auth/register', () => ({ user: getDb().user }));
on('POST', '/auth/logout', () => {
  endGuestSession();
  resetGuestServer();
  return null;
});
on('POST', '/auth/forgot-password', () => ({ ok: true, message: 'If an account exists for that email, a reset link has been sent.' }));
on('POST', '/auth/reset-password', () => ({ ok: true }));
on('POST', '/auth/reauth', () => ({ ok: true, validForSeconds: 300 }));
on('PATCH', '/auth/profile', ({ body }) => {
  const s = getDb();
  if (typeof body.name === 'string' && body.name.trim()) {
    s.user.name = body.name.trim();
    const me = s.members.find((m) => m.userId === s.user.id);
    if (me) me.name = s.user.name;
  }
  return { user: s.user };
});
on('POST', '/auth/change-password', () => ({ ok: true }));
on('GET', '/auth/sessions', () => ({ sessions: getDb().sessions }));
on('DELETE', '/auth/sessions/:id', ({ params }) => {
  const s = getDb();
  s.sessions = s.sessions.filter((x) => x.id !== params.id || x.current);
  return null;
});
on('PUT', '/auth/preferences', ({ body }) => {
  const s = getDb();
  s.preferences = { ...s.preferences, ...(body as object) };
  return { preferences: s.preferences };
});

// Catalogue & invitations
on('GET', '/catalogue/integrations', () => ({ integrations: INTEGRATION_TYPES.map((t) => ({ ...INTEGRATIONS[t], implemented: t === 'demo' || t === 'home_assistant' })) }));
on('GET', '/catalogue/devices', (): CatalogueDto => ({
  categories: DEVICE_CATEGORIES.filter((c) => c !== 'other').map((c) => ({ ...CATEGORY_INFO[c], supportedBy: INTEGRATION_TYPES.filter((t) => INTEGRATIONS[t].supportedCategories.includes(c)) })),
}));
on('GET', '/invitations/preview', () => {
  throw unavailableInGuest('Accepting invitations');
});
on('POST', '/invitations/accept', () => {
  throw unavailableInGuest('Accepting invitations');
});

// Homes & members
on('GET', '/homes', () => {
  const h = toHome();
  return { homes: [{ id: h.id, name: h.name, role: h.role, isDemo: h.isDemo, timezone: h.timezone }] };
});
on('POST', '/homes', () => {
  throw unavailableInGuest('Creating another home');
});
on('POST', '/homes/demo', () => {
  throw unavailableInGuest('Creating another home');
});
on('GET', H, () => ({ home: toHome() }));
on('PATCH', H, ({ body }) => {
  const s = getDb();
  const { retentionDays, homeId: _id, ...rest } = body as Partial<HomeDto> & { homeId?: string };
  s.home = { ...s.home, ...rest, retentionDays: { ...s.home.retentionDays, ...(retentionDays ?? {}) } };
  return { home: toHome() };
});
on('POST', `${H}/onboarding-complete`, () => ({ home: toHome() }));
on('POST', `${H}/demo-integration`, () => ({ ok: true }));
on('DELETE', H, () => null); // The sample home cannot really be deleted; it is restored on the next load.
on('POST', `${H}/delete-data`, ({ body }) => {
  const s = getDb();
  const deleted: Record<string, number> = {};
  if (body.activity) {
    deleted.activity = s.activity.length;
    s.activity = [];
  }
  if (body.notifications) {
    deleted.notifications = s.notifications.length;
    s.notifications = [];
  }
  if (body.commands) {
    deleted.commands = s.commands.length;
    s.commands = [];
  }
  if (body.energy) {
    deleted.energy = s.energy.length;
    s.energy = [];
  }
  if (body.history) deleted.history = 0;
  return { deleted };
});
on('GET', `${H}/members`, () => ({ members: getDb().members }));
on('PATCH', `${H}/members/:memberId`, ({ params, body }) => {
  const m = getDb().members.find((x) => x.id === params.memberId);
  if (!m) throw notFound('Member');
  if (m.userId === getDb().user.id) throw badRequest('You cannot change your own role.');
  m.role = body.role as typeof m.role;
  return { ok: true };
});
on('DELETE', `${H}/members/:memberId`, ({ params }) => {
  const s = getDb();
  if (s.members.find((x) => x.id === params.memberId)?.userId === s.user.id) throw badRequest('The owner cannot be removed.');
  s.members = s.members.filter((x) => x.id !== params.memberId);
  return null;
});
on('GET', `${H}/invitations`, () => ({ invitations: getDb().invitations }));
on('POST', `${H}/invitations`, ({ body }) => {
  const s = getDb();
  const email = String(body.email ?? '').trim().toLowerCase();
  if (s.members.some((m) => m.email === email)) throw badRequest('That person is already a member of this home.');
  const invitation = { id: uid('inv'), email, role: body.role as 'admin' | 'member' | 'guest', expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(), createdAt: nowIso() };
  s.invitations.unshift(invitation);
  return { invitation: { ...invitation, inviteUrl: `${window.location.origin}${import.meta.env.BASE_URL}invite?token=guest-mode-sample-${invitation.id}` } };
});
on('DELETE', `${H}/invitations/:inviteId`, ({ params }) => {
  const s = getDb();
  s.invitations = s.invitations.filter((x) => x.id !== params.inviteId);
  return null;
});
on('GET', `${H}/audit`, () => ({ logs: getDb().audit }));

// Rooms
on('GET', `${H}/rooms`, () => ({ rooms: [...getDb().rooms].sort((a, b) => a.sortOrder - b.sortOrder).map(toRoom) }));
on('GET', `${H}/rooms/:roomId`, ({ params }) => ({ room: toRoom(findRoom(params.roomId!)) }));
on('POST', `${H}/rooms`, ({ body }) => {
  const s = getDb();
  const name = String(body.name ?? '').trim();
  if (!name) throw badRequest('Name the room');
  const room = { id: uid('room'), name, icon: String(body.icon ?? 'home'), coverImageUrl: (body.coverImageUrl as string | null) ?? null, isFavourite: false, sortOrder: s.rooms.length };
  s.rooms.push(room);
  return { room: toRoom(room) };
});
on('PUT', `${H}/rooms/order`, ({ body }) => {
  const ids = (body.ids as string[]) ?? [];
  getDb().rooms.forEach((r) => {
    const i = ids.indexOf(r.id);
    if (i >= 0) r.sortOrder = i;
  });
  return { ok: true };
});
on('PATCH', `${H}/rooms/:roomId`, ({ params, body }) => {
  const r = findRoom(params.roomId!);
  const { homeId: _h, roomId: _r, ...rest } = body as Record<string, unknown>;
  Object.assign(r, rest);
  return { room: toRoom(r) };
});
on('DELETE', `${H}/rooms/:roomId`, ({ params }) => {
  const s = getDb();
  findRoom(params.roomId!);
  s.rooms = s.rooms.filter((r) => r.id !== params.roomId);
  for (const d of s.devices) if (d.roomId === params.roomId) d.roomId = null;
  return null;
});
on('POST', `${H}/rooms/:roomId/actions`, ({ params, body }) => {
  findRoom(params.roomId!);
  const action = body.action as 'lightsOn' | 'lightsOff' | 'allOff';
  const targets = getDb().devices.filter((d) => {
    if (d.roomId !== params.roomId || d.isHidden || !hasCapability(d.capabilities, 'onOff')) return false;
    if (action === 'allOff') return ['lighting', 'electrical', 'entertainment', 'climate'].includes(d.category);
    return d.category === 'lighting';
  });
  const command: DeviceCommand = action === 'lightsOn' ? { capability: 'onOff', action: 'turnOn' } : { capability: 'onOff', action: 'turnOff' };
  return { commands: targets.map((d) => dispatchCommand(d, command, 'user').command), targeted: targets.length };
});

// Devices
on('GET', `${H}/devices`, ({ query }) => listDevices(query));
on('GET', `${H}/devices/counts`, () => {
  const visible = getDb().devices.filter((d) => !d.isHidden);
  const n = (c: string) => visible.filter((d) => d.connectivity === c).length;
  return { total: visible.length, online: n('online'), offline: n('offline'), unavailable: n('unavailable'), unknown: n('unknown') };
});
on('GET', `${H}/devices/facets`, () => {
  const devices = getDb().devices;
  return { manufacturers: [...new Set(devices.map((d) => d.manufacturer).filter((m): m is string => !!m))].sort(), categories: [...new Set(devices.map((d) => d.category))].sort() };
});
on('POST', `${H}/devices/bulk`, ({ body }) => {
  const ids = (body.ids as string[]) ?? [];
  const update = (body.update ?? {}) as Partial<Pick<DeviceRecord, 'roomId' | 'isFavourite' | 'isHidden'>>;
  const devices = getDb().devices.filter((d) => ids.includes(d.id));
  for (const d of devices) {
    Object.assign(d, update);
    emitDevice(d);
  }
  return { updated: devices.length };
});
on('GET', `${H}/devices/:deviceId`, ({ params }) => {
  const d = findDevice(params.deviceId!);
  return { device: toDevice(d), metadata: { energyRole: d.energyRole, demoNote: d.demoNote } };
});
on('PATCH', `${H}/devices/:deviceId`, ({ params, body }) => {
  const d = findDevice(params.deviceId!);
  const { homeId: _h, deviceId: _d, energyRole, ...rest } = body as Record<string, unknown>;
  Object.assign(d, rest);
  if (energyRole) d.energyRole = energyRole as DeviceRecord['energyRole'];
  emitDevice(d);
  return { device: toDevice(d) };
});
on('DELETE', `${H}/devices/:deviceId`, ({ params }) => {
  const s = getDb();
  const d = findDevice(params.deviceId!);
  s.devices = s.devices.filter((x) => x.id !== d.id);
  emitGuestEvent({ type: 'device.removed', homeId: HOME_ID, deviceId: d.id });
  addActivity({ type: 'device.removed', title: `${d.name} removed from SmartNest`, detail: 'It can be re-imported from its integration.', severity: 'info', result: null, source: 'user', actorName: GUEST_NAME });
  return null;
});
on('POST', `${H}/devices/:deviceId/refresh`, ({ params }) => {
  const d = findDevice(params.deviceId!);
  d.lastSeenAt = nowIso();
  return { device: toDevice(d) };
});
on('POST', `${H}/devices/:deviceId/commands`, ({ params, body }) => {
  const d = findDevice(params.deviceId!);
  const command = body.command as DeviceCommand;
  const v = validateCommandForCapabilities(command, d.capabilities);
  if (!v.ok) throw new HttpError(400, v.code, v.message);
  return { command: dispatchCommand(d, command, 'user').command };
});
on('GET', `${H}/devices/:deviceId/commands`, ({ params }) => {
  findDevice(params.deviceId!);
  return { commands: getDb().commands.filter((c) => c.deviceId === params.deviceId).slice(0, 25) };
});
on('GET', `${H}/devices/:deviceId/history`, ({ params, query }) => deviceHistory(findDevice(params.deviceId!), Math.min(168, Math.max(1, Number(query.hours ?? 24) || 24))));
on('GET', `${H}/commands/:commandId`, ({ params }) => {
  const c = getDb().commands.find((x) => x.id === params.commandId);
  if (!c) throw notFound('Command');
  return { command: c };
});

// Integrations
const discoveredFor = (i: IntegrationRecord): DiscoveredDeviceDto[] => {
  const s = getDb();
  const imported = s.devices.filter((d) => d.integrationId === i.id).map((d) => ({
    externalId: d.externalId, name: d.name, category: d.category, deviceType: d.deviceType, manufacturer: d.manufacturer, model: d.model, capabilities: d.capabilities,
    connectivity: d.connectivity, suggestedRoom: s.rooms.find((r) => r.id === d.roomId)?.name ?? null, alreadyImported: true, importedDeviceId: d.id,
  }));
  return [...(s.notImported[i.id] ?? []), ...imported];
};
on('GET', `${H}/integrations`, () => ({ integrations: getDb().integrations.map(toIntegration) }));
on('GET', `${H}/integrations/:integrationId`, ({ params }) => {
  const i = findIntegration(params.integrationId!);
  return { integration: toIntegration(i), definition: INTEGRATIONS[i.type] };
});
on('POST', `${H}/integrations/home-assistant`, ({ body }) => {
  const s = getDb();
  const i: IntegrationRecord = {
    id: uid('int'), type: 'home_assistant', name: String(body.name ?? 'Home Assistant'), status: 'connected', statusMessage: null, baseUrl: String(body.baseUrl ?? ''), isDemo: false,
    lastSyncAt: nowIso(), lastConnectedAt: nowIso(), createdAt: nowIso(),
  };
  s.integrations.push(i);
  s.notImported[i.id] = structuredClone(s.notImported[HA_INTEGRATION_ID] ?? []);
  addActivity({ type: 'integration.connected', title: `${i.name} connected`, detail: null, severity: 'success', result: 'success', source: 'user', actorName: GUEST_NAME });
  return { integration: toIntegration(i), discovered: discoveredFor(i) };
});
on('POST', `${H}/integrations/demo`, () => {
  const i = findIntegration(DEMO_INTEGRATION_ID);
  return { integration: toIntegration(i) };
});
on('POST', `${H}/integrations/:integrationId/discover`, ({ params }) => {
  const i = findIntegration(params.integrationId!);
  i.lastSyncAt = nowIso();
  return { discovered: discoveredFor(i) };
});
on('GET', `${H}/integrations/:integrationId/discovered`, ({ params }) => ({ discovered: discoveredFor(findIntegration(params.integrationId!)) }));
on('POST', `${H}/integrations/:integrationId/import`, ({ params, body }) => {
  const s = getDb();
  const i = findIntegration(params.integrationId!);
  const wanted = (body.devices as { externalId: string; name: string; roomId: string | null }[]) ?? [];
  const results = wanted.map((w) => {
    const existing = s.devices.find((d) => d.integrationId === i.id && d.externalId === w.externalId);
    if (existing) return { externalId: w.externalId, deviceId: existing.id, status: 'already_imported' as const, connectivity: existing.connectivity, tested: false, message: null };
    const pending = s.notImported[i.id]?.find((x) => x.externalId === w.externalId);
    if (!pending) return { externalId: w.externalId, deviceId: null, status: 'not_found' as const, connectivity: null, tested: false, message: 'The integration no longer reports this device.' };
    const d: DeviceRecord = {
      id: uid('dev'), integrationId: i.id, externalId: pending.externalId, name: w.name || pending.name, category: pending.category, deviceType: pending.deviceType, manufacturer: pending.manufacturer, model: pending.model,
      roomId: w.roomId, isFavourite: false, isHidden: false, capabilities: pending.capabilities, connectivity: pending.connectivity, lastError: null, lastCommandAt: null, energyRole: null, demoNote: null,
      state: pending.capabilities.some((c) => c.type === 'onOff') ? { on: false } : pending.capabilities.some((c) => c.type === 'sensor') ? { measurements: { temperature: 21.4 }, batteryLevel: 95 } : {},
      stateUpdatedAt: nowIso(), lastSeenAt: nowIso(), createdAt: nowIso(),
    };
    if (pending.capabilities.some((c) => c.type === 'volume')) d.state = { mediaState: 'idle', volume: 25, muted: false };
    s.devices.push(d);
    s.notImported[i.id] = (s.notImported[i.id] ?? []).filter((x) => x.externalId !== w.externalId);
    return { externalId: w.externalId, deviceId: d.id, status: 'imported' as const, connectivity: d.connectivity, tested: true, message: null };
  });
  const n = results.filter((r) => r.status === 'imported').length;
  if (n) addActivity({ type: 'device.added', title: `${n} device${n === 1 ? '' : 's'} imported from ${i.name}`, detail: null, severity: 'success', result: 'success', source: 'user', actorName: GUEST_NAME });
  return { results };
});
on('POST', `${H}/integrations/:integrationId/health`, ({ params }) => {
  const i = findIntegration(params.integrationId!);
  return i.status === 'disconnected' ? { ok: false, message: 'Not connected.' } : { ok: true };
});
on('POST', `${H}/integrations/:integrationId/reconnect`, ({ params }) => {
  const i = findIntegration(params.integrationId!);
  Object.assign(i, { status: 'connected', statusMessage: null, lastConnectedAt: nowIso(), lastSyncAt: nowIso() });
  emitGuestEvent({ type: 'integration.updated', homeId: HOME_ID, integration: toIntegration(i) });
  return { integration: toIntegration(i) };
});
on('POST', `${H}/integrations/:integrationId/disconnect`, ({ params }) => {
  const i = findIntegration(params.integrationId!);
  Object.assign(i, { status: 'disconnected', statusMessage: 'Disconnected by a user.' });
  for (const d of getDb().devices) if (d.integrationId === i.id) emitDevice(d);
  return { integration: toIntegration(i) };
});
on('DELETE', `${H}/integrations/:integrationId`, ({ params }) => {
  const s = getDb();
  const i = findIntegration(params.integrationId!);
  const removed = new Set(s.devices.filter((d) => d.integrationId === i.id).map((d) => d.id));
  s.devices = s.devices.filter((d) => !removed.has(d.id));
  s.integrations = s.integrations.filter((x) => x.id !== i.id);
  s.automations = s.automations.filter((a) => !(a.executor === 'home_assistant' && i.type === 'home_assistant'));
  for (const sc of s.scenes) sc.actions = sc.actions.filter((a) => !removed.has(a.deviceId));
  for (const id of removed) emitGuestEvent({ type: 'device.removed', homeId: HOME_ID, deviceId: id });
  return null;
});
on('POST', `${H}/integrations/:integrationId/sync-automations`, () => ({ count: getDb().automations.filter((a) => a.executor === 'home_assistant').length }));

// Cameras
on('GET', `${H}/cameras`, () => {
  const s = getDb();
  return {
    cameras: s.devices
      .filter((d) => hasCapability(d.capabilities, 'cameraStream'))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((d) => {
        const cap = hasCapability(d.capabilities, 'cameraStream')!;
        return {
          device: toDevice(d), live: cap.live, snapshot: cap.snapshot, isDemo: !!integrationOf(d)?.isDemo, activeViewers: 0, lastFrameAt: d.lastSeenAt,
          events: s.activity.filter((a) => a.deviceId === d.id && ['camera.event', 'security.event', 'device.connectivity'].includes(a.type)).slice(0, 10).map((a) => ({ id: a.id, title: a.title, createdAt: a.createdAt })),
        };
      }),
  };
});
on('POST', `${H}/cameras/:deviceId/token`, ({ params }) => {
  const d = findDevice(params.deviceId!);
  if (!hasCapability(d.capabilities, 'cameraStream')) throw notFound('Camera');
  const url = cameraDataUri(d.name, d.externalId);
  return { snapshotUrl: url, streamUrl: url, expiresIn: 60 };
});

// Scenes
on('GET', `${H}/scenes`, () => ({ scenes: getDb().scenes.map(toScene) }));
on('POST', `${H}/scenes`, ({ body }) => ({ scene: toScene(saveScene(body)) }));
on('GET', `${H}/scenes/:sceneId`, ({ params }) => ({ scene: toScene(findScene(params.sceneId!)) }));
on('PUT', `${H}/scenes/:sceneId`, ({ params, body }) => ({ scene: toScene(saveScene(body, findScene(params.sceneId!))) }));
on('PATCH', `${H}/scenes/:sceneId`, ({ params, body }) => {
  const sc = findScene(params.sceneId!);
  if (typeof body.isFavourite === 'boolean') sc.isFavourite = body.isFavourite;
  return { scene: toScene(sc) };
});
on('POST', `${H}/scenes/:sceneId/duplicate`, ({ params }) => {
  const sc = findScene(params.sceneId!);
  const copy: SceneRecord = { ...structuredClone(sc), id: uid('scene'), name: `${sc.name} (copy)`, isFavourite: false, createdAt: nowIso(), updatedAt: nowIso() };
  copy.actions = copy.actions.map((a) => ({ ...a, id: uid('sa') }));
  getDb().scenes.push(copy);
  return { scene: toScene(copy) };
});
on('DELETE', `${H}/scenes/:sceneId`, ({ params }) => {
  const s = getDb();
  findScene(params.sceneId!);
  s.scenes = s.scenes.filter((x) => x.id !== params.sceneId);
  return null;
});
on('POST', `${H}/scenes/:sceneId/activate`, ({ params }) => ({ execution: activateScene(findScene(params.sceneId!), 'user') }));
on('GET', `${H}/scenes/:sceneId/executions`, ({ params }) => ({ executions: getDb().sceneExecutions.filter((e) => e.sceneId === params.sceneId).slice(0, 20) }));

// Automations
on('GET', `${H}/automations`, () => ({ automations: getDb().automations }));
on('GET', `${H}/automations/export`, () => ({
  format: 'smartnest.automations.v1',
  exportedAt: nowIso(),
  automations: getDb().automations.filter((a) => a.executor === 'smartnest').map((a) => ({
    name: a.name, description: a.description, enabled: a.enabled, isDraft: a.isDraft, triggers: a.triggers, conditions: a.conditions, conditionOperator: a.conditionOperator, actions: a.actions,
    cooldownSeconds: a.cooldownSeconds, allowSensitiveActions: a.allowSensitiveActions,
  })),
}));
on('POST', `${H}/automations/import`, ({ body }) => {
  const list = Array.isArray(body) ? body : ((body.automations as unknown[]) ?? []);
  return {
    results: list.map((item) => {
      const name = String((item as { name?: unknown })?.name ?? 'Automation');
      try {
        const a = saveAutomation({ ...parseAutomation(item), enabled: false });
        return { name, ok: true, id: a.id };
      } catch (e) {
        return { name, ok: false, errors: [(e as Error).message] };
      }
    }),
  };
});
on('POST', `${H}/automations/validate`, ({ body }) => {
  const parsed = automationInputSchema.safeParse(body.automation);
  if (!parsed.success) return { valid: false, issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message, severity: 'error' })) };
  const issues = automationIssues(parsed.data, body.id as string | undefined);
  return { valid: !issues.some((i) => i.severity === 'error'), issues };
});
on('POST', `${H}/automations`, ({ body }) => {
  const input = parseAutomation(body);
  return { automation: saveAutomation(input), issues: automationIssues(input) };
});
on('GET', `${H}/automations/:automationId`, ({ params }) => ({ automation: findAutomation(params.automationId!) }));
on('PUT', `${H}/automations/:automationId`, ({ params, body }) => {
  const existing = findAutomation(params.automationId!);
  if (existing.executor === 'home_assistant') throw badRequest('This automation is managed in Home Assistant.');
  const input = parseAutomation(body);
  return { automation: saveAutomation(input, existing), issues: automationIssues(input, existing.id) };
});
on('POST', `${H}/automations/:automationId/enabled`, ({ params, body }) => {
  const a = findAutomation(params.automationId!);
  const enabled = !!body.enabled;
  if (enabled && a.isDraft) throw badRequest('Finish and save this draft before enabling it.');
  a.enabled = enabled;
  a.updatedAt = nowIso();
  return { automation: a };
});
on('POST', `${H}/automations/:automationId/run`, ({ params }) => {
  const a = findAutomation(params.automationId!);
  if (a.executor === 'home_assistant') return { execution: null, message: "Triggered in Home Assistant. Results appear in Home Assistant's trace view." };
  if (a.isDraft) throw badRequest('Drafts cannot be run. Use "Test" to simulate instead.');
  return { execution: runAutomation(a, `Run manually by ${getDb().user.name}`, false) };
});
on('POST', `${H}/automations/:automationId/simulate`, ({ params }) => ({ execution: runAutomation(findAutomation(params.automationId!), 'Test', true) }));
on('POST', `${H}/automations/:automationId/duplicate`, ({ params }) => {
  const a = findAutomation(params.automationId!);
  const copy: AutomationDto = { ...structuredClone(a), id: uid('auto'), name: `${a.name} (copy)`, enabled: false, executor: 'smartnest', externalId: null, lastRunAt: null, lastRunStatus: null, createdAt: nowIso(), updatedAt: nowIso() };
  getDb().automations.unshift(copy);
  return { automation: copy };
});
on('DELETE', `${H}/automations/:automationId`, ({ params }) => {
  const s = getDb();
  findAutomation(params.automationId!);
  s.automations = s.automations.filter((a) => a.id !== params.automationId);
  return null;
});
on('GET', `${H}/automations/:automationId/executions`, ({ params }) => ({ executions: getDb().automationExecutions.filter((e) => e.automationId === params.automationId).slice(0, 50) }));

// Activity & notifications
on('GET', `${H}/activity`, ({ query: q }) => {
  const term = q.q?.toLowerCase();
  const from = q.from ? new Date(q.from).getTime() : null;
  const to = q.to ? new Date(q.to).getTime() : null;
  const all = getDb().activity.filter((a) => {
    if (q.deviceId && a.deviceId !== q.deviceId) return false;
    if (q.roomId && a.roomId !== q.roomId) return false;
    if (q.category && a.category !== q.category) return false;
    if (q.severity && a.severity !== q.severity) return false;
    if (q.type && a.type !== q.type) return false;
    if (q.source && a.source !== q.source) return false;
    if (term && !`${a.title} ${a.detail ?? ''}`.toLowerCase().includes(term)) return false;
    const t = new Date(a.createdAt).getTime();
    if (from !== null && t < from) return false;
    if (to !== null && t > to) return false;
    return true;
  });
  const limit = Math.min(100, Math.max(1, Number(q.limit ?? 30) || 30));
  const start = q.cursor ? all.findIndex((a) => a.id === q.cursor) + 1 : 0;
  const items = all.slice(start, start + limit);
  return { items, nextCursor: start + limit < all.length ? items[items.length - 1]!.id : null };
});
on('GET', `${H}/notifications`, () => {
  const items = getDb().notifications.slice(0, 50);
  return { items, unread: getDb().notifications.filter((n) => !n.readAt).length };
});
on('POST', `${H}/notifications/read`, ({ body }) => {
  const ids = body.ids as string[] | undefined;
  for (const n of getDb().notifications) if (!n.readAt && (!ids || ids.includes(n.id))) n.readAt = nowIso();
  return { ok: true };
});

// Dashboard, energy, network, search
on('GET', `${H}/dashboard`, () => getDb().dashboard);
on('PUT', `${H}/dashboard`, ({ body }) => {
  getDb().dashboard = { widgets: body.widgets as GuestDb['dashboard']['widgets'], isDefault: false };
  return getDb().dashboard;
});
on('DELETE', `${H}/dashboard`, () => {
  const fresh = createGuestDb().dashboard;
  getDb().dashboard = fresh;
  return fresh;
});
on('GET', `${H}/energy`, ({ query }) => energy(query));
on('GET', `${H}/network`, () => network());
on('GET', `${H}/search`, ({ query }): SearchResultDto => {
  const s = getDb();
  const q = (query.q ?? '').trim().toLowerCase();
  const has = (v: string | null | undefined) => !!v && v.toLowerCase().includes(q);
  return {
    devices: s.devices.filter((d) => !d.isHidden && (has(d.name) || has(d.manufacturer))).slice(0, 8).map((d) => ({ id: d.id, name: d.name, roomName: s.rooms.find((r) => r.id === d.roomId)?.name ?? null, category: d.category })),
    rooms: s.rooms.filter((r) => has(r.name)).slice(0, 5).map((r) => ({ id: r.id, name: r.name, icon: r.icon })),
    scenes: s.scenes.filter((x) => has(x.name)).slice(0, 5).map((x) => ({ id: x.id, name: x.name, icon: x.icon })),
    automations: s.automations.filter((a) => has(a.name)).slice(0, 5).map((a) => ({ id: a.id, name: a.name, enabled: a.enabled })),
    integrations: s.integrations.filter((i) => has(i.name)).slice(0, 5).map((i) => ({ id: i.id, name: i.name, type: i.type })),
    activity: s.activity.filter((a) => has(a.title)).slice(0, 5).map((a) => ({ id: a.id, title: a.title, createdAt: a.createdAt })),
  };
});

// ─── Entry point ──────────────────────────────────────────────────────────

function match(method: string, path: string) {
  const parts = path.split('/').filter(Boolean);
  for (const r of routes) {
    if (r.method !== method || r.parts.length !== parts.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      const p = r.parts[i]!;
      if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(parts[i]!);
      else if (p !== parts[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { handler: r.handler, params };
  }
  return null;
}

/** Answers one RTK Query request from the in-memory sample home. Never touches the network. */
export async function guestBaseQuery(args: string | FetchArgs): Promise<Result> {
  const a: FetchArgs = typeof args === 'string' ? { url: args } : args;
  const method = (a.method ?? 'GET').toUpperCase();
  const [path = '', search = ''] = a.url.split('?');
  const query: Record<string, string> = Object.fromEntries(new URLSearchParams(search));
  for (const [k, v] of Object.entries((a.params ?? {}) as Record<string, unknown>)) if (v !== undefined && v !== null) query[k] = String(v);
  const body = (a.body && typeof a.body === 'object' ? a.body : {}) as Record<string, unknown>;

  // A little latency so loading states look as they do against a real server.
  await later(60 + Math.random() * 140);

  const found = match(method, path);
  if (!found) {
    if (import.meta.env.DEV) console.debug(`[guest mode] No sample data for ${method} ${path}; returning an empty response.`);
    return { data: method === 'GET' ? {} : { ok: true } };
  }
  if (found.params.homeId && found.params.homeId !== HOME_ID) return { error: { status: 404, data: { error: { code: 'not_found', message: 'Home not found.' } } } };
  try {
    const data = await found.handler({ params: found.params, query, body });
    return { data: data === undefined ? null : structuredClone(data) };
  } catch (e) {
    if (e instanceof HttpError) return { error: { status: e.status, data: { error: { code: e.code, message: e.message } } } };
    return { error: { status: 500, data: { error: { code: 'guest_error', message: (e as Error).message || 'Something went wrong.' } } } };
  }
}
