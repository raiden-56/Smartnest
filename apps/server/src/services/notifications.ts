import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  roleHasPermission,
  userPreferencesSchema,
  type HomeRole,
  type NotificationPreferences,
  type Permission,
  type Severity,
} from '@smartnest/shared';
import { prisma } from '../db.js';
import { toNotificationDto } from '../lib/dto.js';
import { pushRealtime } from './bus.js';

export type NotificationCategory = 'criticalSecurity' | 'deviceOffline' | 'lowBattery' | 'automationFailures' | 'integrationFailures' | 'energyThresholds' | 'general';

/** Which permission a member needs to receive a category (e.g. guests don't get security alerts). */
const CATEGORY_PERMISSION: Record<NotificationCategory, Permission> = {
  criticalSecurity: 'devices.view',
  deviceOffline: 'devices.view',
  lowBattery: 'devices.view',
  automationFailures: 'automations.view',
  integrationFailures: 'integrations.view',
  energyThresholds: 'energy.view',
  general: 'home.view',
};

export async function getNotificationPreferences(userId: string): Promise<NotificationPreferences> {
  const pref = await prisma.userPreference.findUnique({ where: { userId } });
  const parsed = userPreferencesSchema.safeParse(pref?.data ?? {});
  return { ...DEFAULT_NOTIFICATION_PREFERENCES, ...(parsed.success ? parsed.data.notifications : {}) };
}

/**
 * Create in-app notifications for every member who has permission and has the
 * category enabled. In-app is the only channel implemented; email/push are
 * intentionally not sent (and are never sent for demo homes).
 */
export async function notifyHome(input: {
  homeId: string;
  category: NotificationCategory;
  title: string;
  body: string;
  severity?: Severity;
  link?: string | null;
  /** Only these users (still subject to permission + preference checks) */
  onlyUserIds?: string[];
}): Promise<number> {
  const members = await prisma.homeMembership.findMany({ where: { homeId: input.homeId, ...(input.onlyUserIds ? { userId: { in: input.onlyUserIds } } : {}) } });
  let sent = 0;
  for (const m of members) {
    if (!roleHasPermission(m.role as HomeRole, CATEGORY_PERMISSION[input.category])) continue;
    if (input.category !== 'general') {
      const prefs = await getNotificationPreferences(m.userId);
      if (!prefs[input.category]) continue;
    }
    const n = await prisma.notification.create({
      data: {
        homeId: input.homeId,
        userId: m.userId,
        title: input.title,
        body: input.body,
        severity: input.severity ?? 'info',
        category: input.category,
        link: input.link ?? null,
        channel: 'in_app',
      },
    });
    pushRealtime({ type: 'notification.created', homeId: input.homeId, notification: toNotificationDto(n) }, { userId: m.userId });
    sent++;
  }
  return sent;
}
