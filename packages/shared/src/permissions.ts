import { z } from 'zod';

export const HOME_ROLES = ['owner', 'admin', 'member', 'guest'] as const;
export const homeRoleSchema = z.enum(HOME_ROLES);
export type HomeRole = (typeof HOME_ROLES)[number];

export const ROLE_LABELS: Record<HomeRole, string> = {
  owner: 'Home owner',
  admin: 'Administrator',
  member: 'Household member',
  guest: 'Guest',
};

export const ROLE_DESCRIPTIONS: Record<HomeRole, string> = {
  owner: 'Full control, including deleting the home and managing administrators.',
  admin: 'Manages integrations, devices, rooms, members, scenes and automations.',
  member: 'Controls devices (including locks and alarms), views cameras, runs scenes.',
  guest: 'Controls everyday devices such as lights and climate. No cameras, locks, alarms or settings.',
};

export const PERMISSIONS = [
  'home.view',
  'home.manage',
  'home.delete',
  'members.view',
  'members.manage',
  'rooms.manage',
  'devices.view',
  'devices.control',
  'devices.control.sensitive',
  'devices.manage',
  'integrations.view',
  'integrations.manage',
  'cameras.view',
  'cameras.control',
  'scenes.activate',
  'scenes.manage',
  'automations.view',
  'automations.manage',
  'energy.view',
  'network.view',
  'network.manage',
  'activity.view',
  'audit.view',
  'data.delete',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL: readonly Permission[] = PERMISSIONS;

/**
 * Role → permission matrix. This is the single source of truth and is enforced
 * by the backend on every request; the frontend uses it only to hide controls.
 */
export const ROLE_PERMISSIONS: Record<HomeRole, ReadonlySet<Permission>> = {
  owner: new Set(ALL),
  admin: new Set(ALL.filter((p) => p !== 'home.delete' && p !== 'data.delete')),
  member: new Set<Permission>([
    'home.view',
    'members.view',
    'devices.view',
    'devices.control',
    'devices.control.sensitive',
    'integrations.view',
    'cameras.view',
    'cameras.control',
    'scenes.activate',
    'automations.view',
    'energy.view',
    'network.view',
    'activity.view',
  ]),
  guest: new Set<Permission>(['home.view', 'devices.view', 'devices.control', 'scenes.activate']),
};

export function roleHasPermission(role: HomeRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

/** Whether `actor` may assign `target` role or change a member who holds `current` role. */
export function canManageRole(actor: HomeRole, target: HomeRole, current?: HomeRole): boolean {
  if (!roleHasPermission(actor, 'members.manage')) return false;
  if (actor === 'owner') return true;
  // Admins cannot create or modify owners or other admins.
  if (target === 'owner' || target === 'admin') return false;
  if (current === 'owner' || current === 'admin') return false;
  return true;
}

/**
 * Guests are additionally limited to "everyday" device categories even when a
 * capability is technically non-sensitive (e.g. they cannot open a garage door).
 */
export const GUEST_CONTROLLABLE_CATEGORIES: ReadonlySet<string> = new Set([
  'lighting',
  'electrical',
  'climate',
  'entertainment',
  'cleaning',
]);
