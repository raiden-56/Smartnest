import type { DeviceState } from '@smartnest/shared';
import { prisma } from '../db.js';
import { integrations } from '../integrations/manager.js';
import { logger } from '../logger.js';
import { automationEngine } from '../services/automationEngine.js';
import { expireStaleCommands } from '../services/commands.js';
import { energyRoleOf } from '../services/energy.js';
import { getNotificationPreferences, notifyHome } from '../services/notifications.js';
import { recordActivity } from '../services/activity.js';

const timers: NodeJS.Timeout[] = [];
const lastEnergyAlert = new Map<string, number>();

/**
 * Background jobs. SmartNest is designed to run as a single server instance
 * (integration connections are stateful); see docs/deployment.md.
 */
export function startScheduler(): void {
  const every = (ms: number, name: string, fn: () => Promise<unknown>) => {
    const t = setInterval(() => void fn().catch((e) => logger.error({ err: (e as Error).message, job: name }, 'job failed')), ms);
    t.unref?.();
    timers.push(t);
  };
  // Align the automation schedule tick to the start of each minute
  const msToNextMinute = 60_000 - (Date.now() % 60_000) + 500;
  const first = setTimeout(() => {
    void automationEngine.tickSchedules().catch(() => undefined);
    every(60_000, 'automation-schedules', () => automationEngine.tickSchedules());
  }, msToNextMinute);
  first.unref?.();
  timers.push(first);

  every(60_000, 'energy-thresholds', checkEnergyThresholds);
  every(5 * 60_000, 'ha-automation-sync', syncHomeAssistantAutomations);
  every(60 * 60_000, 'retention', runRetention);

  void expireStaleCommands().then((n) => n && logger.info(`Expired ${n} in-flight commands from a previous run`));
  const r = setTimeout(() => void runRetention().catch(() => undefined), 30_000);
  r.unref?.();
  timers.push(r);
}

export function stopScheduler(): void {
  for (const t of timers) clearInterval(t);
  timers.length = 0;
}

/** Retention and aggregation: high-frequency data is never kept indefinitely. */
export async function runRetention(): Promise<Record<string, number>> {
  const now = Date.now();
  const days = (n: number) => new Date(now - n * 86400_000);
  const out: Record<string, number> = {};
  const homes = await prisma.home.findMany({ select: { id: true, retentionActivityDays: true, retentionSnapshotDays: true, retentionCameraDays: true } });
  for (const h of homes) {
    out.snapshots = (out.snapshots ?? 0) + (await prisma.deviceStateSnapshot.deleteMany({ where: { homeId: h.id, recordedAt: { lt: days(h.retentionSnapshotDays) } } })).count;
    out.activity = (out.activity ?? 0) + (await prisma.activityEvent.deleteMany({ where: { homeId: h.id, type: { not: 'camera.event' }, createdAt: { lt: days(h.retentionActivityDays) } } })).count;
    out.cameraEvents = (out.cameraEvents ?? 0) + (await prisma.activityEvent.deleteMany({ where: { homeId: h.id, type: 'camera.event', createdAt: { lt: days(h.retentionCameraDays) } } })).count;
  }
  out.commands = (await prisma.deviceCommand.deleteMany({ where: { createdAt: { lt: days(90) } } })).count;
  out.sceneRuns = (await prisma.sceneExecution.deleteMany({ where: { startedAt: { lt: days(90) } } })).count;
  out.automationRuns = (await prisma.automationExecution.deleteMany({ where: { startedAt: { lt: days(90) } } })).count;
  out.notifications = (await prisma.notification.deleteMany({ where: { createdAt: { lt: days(90) } } })).count;
  out.energy = (await prisma.energyReading.deleteMany({ where: { periodStart: { lt: days(400) } } })).count;
  out.sessions = (await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } })).count;
  out.resetTokens = (await prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: new Date() } } })).count;
  out.invitations = (await prisma.invitation.deleteMany({ where: { expiresAt: { lt: days(30) } } })).count;
  logger.debug(out, 'Retention run complete');
  return out;
}

async function syncHomeAssistantAutomations(): Promise<void> {
  const list = await prisma.integration.findMany({ where: { type: 'home_assistant', status: 'connected' } });
  for (const i of list) await integrations.syncExternalAutomations(i.id).catch(() => undefined);
}

/** Notify members whose configured power threshold is exceeded by the whole-home meter (max once per hour). */
async function checkEnergyThresholds(): Promise<void> {
  const meters = await prisma.device.findMany({ where: { connectivity: 'online', capabilities: { some: { type: 'power' } } }, select: { id: true, homeId: true, state: true, metadata: true, name: true } });
  const byHome = new Map<string, number>();
  for (const m of meters) {
    if (energyRoleOf(m.metadata) !== 'consumption') continue;
    const w = (m.state as DeviceState).powerW;
    if (w !== undefined) byHome.set(m.homeId, (byHome.get(m.homeId) ?? 0) + w);
  }
  for (const [homeId, watts] of byHome) {
    const members = await prisma.homeMembership.findMany({ where: { homeId } });
    for (const mem of members) {
      const prefs = await getNotificationPreferences(mem.userId);
      if (!prefs.energyThresholds || !prefs.energyThresholdW || watts <= prefs.energyThresholdW) continue;
      const key = `${homeId}:${mem.userId}`;
      if (Date.now() - (lastEnergyAlert.get(key) ?? 0) < 3600_000) continue;
      lastEnergyAlert.set(key, Date.now());
      await notifyHome({ homeId, category: 'energyThresholds', title: 'High power use', body: `Current consumption is ${Math.round(watts)} W, above your ${prefs.energyThresholdW} W threshold.`, severity: 'warning', link: '/energy', onlyUserIds: [mem.userId] });
      await recordActivity({ homeId, type: 'energy.threshold', title: `Power above ${prefs.energyThresholdW} W (${Math.round(watts)} W)`, severity: 'warning', source: 'system' });
    }
  }
}
