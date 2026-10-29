import { LOW_BATTERY_THRESHOLD, type ConnectivityState, type DeviceState } from '@smartnest/shared';
import { prisma } from '../db.js';
import { deviceInclude, json, toDeviceDto } from '../lib/dto.js';
import { logger } from '../logger.js';
import type { AdapterDeviceUpdate } from '../integrations/types.js';
import { recordActivity } from './activity.js';
import { bus, pushRealtime } from './bus.js';
import { notifyHome } from './notifications.js';
import { recordEnergyDelta } from './energy.js';

const SNAPSHOT_INTERVAL_MS = 5 * 60_000;
const MOTION_ACTIVITY_INTERVAL_MS = 10 * 60_000;
/** Keys whose change always warrants a history snapshot */
const SIGNIFICANT_KEYS = new Set(['on', 'lockState', 'alarmState', 'coverState', 'hvacMode', 'contactOpen', 'hazardDetected', 'mediaState', 'vacuumState', 'valveOpen']);

const lastSnapshotAt = new Map<string, number>();
const lastMotionActivityAt = new Map<string, number>();
const recentCommandAt = new Map<string, number>();
const seenDedupeKeys = new Map<string, string>();

/** Called by the command service so state changes caused by our own commands are not double-logged. */
export function markRecentCommand(deviceId: string): void {
  recentCommandAt.set(deviceId, Date.now());
}

function diffKeys(a: DeviceState, b: DeviceState): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => JSON.stringify(a[k as keyof DeviceState]) !== JSON.stringify(b[k as keyof DeviceState]));
}

// Serialise updates per device so rapid events can't interleave read-modify-write.
const queues = new Map<string, Promise<void>>();

export function ingestDeviceUpdate(integrationId: string, update: AdapterDeviceUpdate): Promise<void> {
  const key = `${integrationId}:${update.externalId}`;
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev
    .then(() => applyUpdate(integrationId, update))
    .catch((e) => logger.error({ err: (e as Error).message, externalId: update.externalId }, 'Failed to ingest device update'));
  queues.set(key, next);
  void next.finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  });
  return next;
}

async function applyUpdate(integrationId: string, update: AdapterDeviceUpdate): Promise<void> {
  const dedupeKey = `${integrationId}:${update.externalId}`;
  if (update.dedupeKey && seenDedupeKeys.get(dedupeKey) === update.dedupeKey) return;
  if (update.dedupeKey) seenDedupeKeys.set(dedupeKey, update.dedupeKey);

  const device = await prisma.device.findUnique({
    where: { integrationId_externalId: { integrationId, externalId: update.externalId } },
    include: deviceInclude,
  });
  if (!device) return; // discovered but not imported — ignore

  const prevState = (device.state ?? {}) as DeviceState;
  let nextState: DeviceState = update.state ? { ...prevState, ...update.state } : { ...prevState };
  if (update.state?.measurements && prevState.measurements) nextState.measurements = { ...prevState.measurements, ...update.state.measurements };
  for (const k of update.clearKeys ?? []) delete nextState[k];
  if (update.connectivity && update.connectivity !== 'online' && update.connectivity !== 'unknown' && update.state && Object.keys(update.state).length === 0) {
    nextState = prevState; // keep last known values when device drops off
  }

  const prevConnectivity = device.connectivity as ConnectivityState;
  const connectivity = update.connectivity ?? prevConnectivity;
  const changedKeys = diffKeys(prevState, nextState);
  const now = update.observedAt ?? new Date();

  if (!changedKeys.length && connectivity === prevConnectivity) {
    // Nothing changed; just refresh lastSeen at most once a minute
    if (connectivity === 'online' && (!device.lastSeenAt || Date.now() - device.lastSeenAt.getTime() > 60_000)) {
      await prisma.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
    }
    return;
  }

  const updated = await prisma.device.update({
    where: { id: device.id },
    data: {
      state: json(nextState),
      connectivity,
      ...(changedKeys.length ? { stateUpdatedAt: now } : {}),
      ...(connectivity === 'online' ? { lastSeenAt: new Date() } : {}),
    },
    include: deviceInclude,
  });

  // History snapshot (throttled, retained per home settings)
  const lastSnap = lastSnapshotAt.get(device.id) ?? 0;
  if (connectivity !== prevConnectivity || changedKeys.some((k) => SIGNIFICANT_KEYS.has(k)) || Date.now() - lastSnap > SNAPSHOT_INTERVAL_MS) {
    lastSnapshotAt.set(device.id, Date.now());
    await prisma.deviceStateSnapshot.create({ data: { deviceId: device.id, homeId: device.homeId, state: json(nextState), connectivity } });
  }

  // Energy accounting from cumulative kWh counters
  if (changedKeys.includes('energyKWh') && prevState.energyKWh !== undefined && nextState.energyKWh !== undefined) {
    await recordEnergyDelta(updated, nextState.energyKWh - prevState.energyKWh, now);
  }

  pushRealtime({ type: 'device.updated', homeId: device.homeId, device: toDeviceDto(updated) });
  bus.emit('device.changed', {
    homeId: device.homeId,
    deviceId: device.id,
    integrationId,
    prevState,
    state: nextState,
    prevConnectivity,
    connectivity,
    changedKeys,
  });

  await recordSideEffects(updated, prevState, nextState, prevConnectivity, connectivity, changedKeys);
}

async function recordSideEffects(
  device: Awaited<ReturnType<typeof prisma.device.update>> & { integration: { isDemo: boolean; status: string } },
  prev: DeviceState,
  next: DeviceState,
  prevConn: ConnectivityState,
  conn: ConnectivityState,
  changed: string[],
): Promise<void> {
  const isDemo = device.integration.isDemo;
  const dev = { id: device.id, name: device.name, roomId: device.roomId, category: device.category };
  const base = { homeId: device.homeId, device: dev, isDemo, source: 'integration' as const };

  // Connectivity transitions (ignore unknown, which means "integration can't tell")
  if (prevConn !== conn && conn !== 'unknown' && prevConn !== 'unknown') {
    const wentDown = conn !== 'online';
    await recordActivity({
      ...base,
      type: 'device.connectivity',
      title: `${device.name} is ${conn}`,
      severity: wentDown ? 'warning' : 'success',
    });
    if (wentDown) {
      await notifyHome({
        homeId: device.homeId,
        category: 'deviceOffline',
        title: `${device.name} went ${conn}`,
        body: `SmartNest can no longer reach ${device.name}. Its last known state is shown until it reconnects.`,
        severity: 'warning',
        link: `/devices/${device.id}`,
      });
    }
  }

  // Low battery crossing
  if (changed.includes('batteryLevel') && next.batteryLevel !== undefined && next.batteryLevel <= LOW_BATTERY_THRESHOLD && (prev.batteryLevel ?? 100) > LOW_BATTERY_THRESHOLD) {
    await recordActivity({ ...base, type: 'device.battery_low', title: `${device.name} battery is low (${next.batteryLevel}%)`, severity: 'warning' });
    await notifyHome({ homeId: device.homeId, category: 'lowBattery', title: 'Low battery', body: `${device.name} is at ${next.batteryLevel}%.`, severity: 'warning', link: `/devices/${device.id}` });
  }

  // Safety hazards
  if (changed.includes('hazardDetected') && next.hazardDetected) {
    await recordActivity({ ...base, type: 'security.event', title: `Hazard detected by ${device.name}`, severity: 'critical' });
    await notifyHome({ homeId: device.homeId, category: 'criticalSecurity', title: `Alert: ${device.name}`, body: `${device.name} reports a hazard. Check the area immediately.`, severity: 'critical', link: `/devices/${device.id}` });
  }

  if (changed.includes('alarmState') && next.alarmState === 'triggered') {
    await recordActivity({ ...base, type: 'security.event', title: `${device.name} alarm triggered`, severity: 'critical' });
    await notifyHome({ homeId: device.homeId, category: 'criticalSecurity', title: 'Alarm triggered', body: `${device.name} has been triggered.`, severity: 'critical', link: `/devices/${device.id}` });
  }

  const commandRecent = Date.now() - (recentCommandAt.get(device.id) ?? 0) < 20_000;

  // Lock changes from outside SmartNest (keypad, key, other apps)
  if (changed.includes('lockState') && (next.lockState === 'locked' || next.lockState === 'unlocked' || next.lockState === 'jammed') && !commandRecent) {
    await recordActivity({ ...base, type: 'security.event', title: `${device.name} ${next.lockState}`, detail: 'Changed outside SmartNest', severity: next.lockState === 'jammed' ? 'critical' : 'info' });
  }

  // Motion (rate limited so busy sensors don't flood the timeline)
  if (changed.includes('motion') && next.motion) {
    const last = lastMotionActivityAt.get(device.id) ?? 0;
    if (Date.now() - last > MOTION_ACTIVITY_INTERVAL_MS) {
      lastMotionActivityAt.set(device.id, Date.now());
      await recordActivity({ ...base, type: device.category === 'security' && device.deviceType?.includes('camera') ? 'camera.event' : 'security.event', title: `Motion detected by ${device.name}`, severity: 'info' });
    }
  }

  // Door/window opened
  if (changed.includes('contactOpen') && prev.contactOpen !== undefined) {
    await recordActivity({ ...base, type: 'security.event', title: `${device.name} ${next.contactOpen ? 'opened' : 'closed'}`, severity: 'info' });
  }

  // On/off changes not caused by a SmartNest command (physical switch, other apps)
  if (changed.includes('on') && prev.on !== undefined && next.on !== undefined && !commandRecent) {
    await recordActivity({ ...base, type: 'device.state', title: `${device.name} turned ${next.on ? 'on' : 'off'}`, detail: 'Changed outside SmartNest' });
  }
}

/** Mark every device of an integration as connectivity-unknown (integration lost). */
export async function markIntegrationDevicesUnknown(integrationId: string): Promise<void> {
  const devices = await prisma.device.findMany({ where: { integrationId, NOT: { connectivity: 'unknown' } }, select: { id: true } });
  if (!devices.length) return;
  await prisma.device.updateMany({ where: { integrationId }, data: { connectivity: 'unknown' } });
  const refreshed = await prisma.device.findMany({ where: { integrationId }, include: deviceInclude });
  for (const d of refreshed) pushRealtime({ type: 'device.updated', homeId: d.homeId, device: toDeviceDto(d) });
}
