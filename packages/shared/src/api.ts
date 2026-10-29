import { z } from 'zod';
import type { Capability, ConnectivityState, DeviceState } from './capabilities.js';
import { DEVICE_CATEGORIES, type DeviceCategory, type IntegrationType, type SupportLevel } from './catalogue.js';
import { deviceCommandSchema, type CommandErrorCode, type CommandStatus, type DeviceCommand } from './commands.js';
import type { AutomationAction, AutomationCondition, AutomationExecutor, AutomationTrigger } from './automation.js';
import { homeRoleSchema, type HomeRole, type Permission } from './permissions.js';
import type { DashboardWidget } from './dashboard.js';

// ─── Request schemas ──────────────────────────────────────────────────────

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128)
  .refine((p) => /[a-zA-Z]/.test(p) && /\d/.test(p), 'Include at least one letter and one number');

export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(254),
  password: passwordSchema,
});
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password').max(128),
});
export const forgotPasswordSchema = z.object({ email: z.string().trim().toLowerCase().email() });
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(200), password: passwordSchema });
export const reauthSchema = z.object({ password: z.string().min(1).max(128) });
export const updateProfileSchema = z.object({ name: z.string().trim().min(1).max(80) });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema });

export const homeInputSchema = z.object({
  name: z.string().trim().min(1, 'Name your home').max(80),
  timezone: z.string().min(1).max(64),
  locale: z.string().min(2).max(16).default('en-GB'),
  temperatureUnit: z.enum(['C', 'F']).default('C'),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  currency: z.string().length(3).nullable().optional(),
  /** Electricity tariff per kWh. Bill estimates are only shown when this is set. */
  tariffPerKWh: z.number().min(0).max(10).nullable().optional(),
});
export const homeUpdateSchema = homeInputSchema.partial().extend({
  retentionDays: z
    .object({ activity: z.number().int().min(7).max(730), stateSnapshots: z.number().int().min(1).max(90), cameraEvents: z.number().int().min(1).max(365) })
    .partial()
    .optional(),
});

export const inviteSchema = z.object({ email: z.string().trim().toLowerCase().email(), role: homeRoleSchema.exclude(['owner']) });
export const updateMemberSchema = z.object({ role: homeRoleSchema });

export const roomInputSchema = z.object({
  name: z.string().trim().min(1, 'Name the room').max(60),
  icon: z.string().min(1).max(40).default('home'),
  coverImageUrl: z.string().url().max(500).nullable().optional(),
  isFavourite: z.boolean().optional(),
});
export const reorderSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(500) });

export const deviceUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  roomId: z.string().nullable().optional(),
  isFavourite: z.boolean().optional(),
  isHidden: z.boolean().optional(),
  category: z.enum(DEVICE_CATEGORIES).optional(),
});
export const bulkDeviceSchema = z.object({
  ids: z.array(z.string()).min(1).max(200),
  update: z.object({ roomId: z.string().nullable().optional(), isFavourite: z.boolean().optional(), isHidden: z.boolean().optional() }),
});

export const deviceListQuerySchema = z.object({
  q: z.string().max(100).optional(),
  roomId: z.string().optional(),
  category: z.enum(DEVICE_CATEGORIES).optional(),
  manufacturer: z.string().max(80).optional(),
  integrationId: z.string().optional(),
  connectivity: z.enum(['online', 'offline', 'unavailable', 'unknown']).optional(),
  operating: z.enum(['on', 'off', 'unknown']).optional(),
  favourite: z.enum(['true', 'false']).optional(),
  battery: z.enum(['low', 'ok', 'none']).optional(),
  capability: z.string().max(40).optional(),
  includeHidden: z.enum(['true', 'false']).optional(),
  sort: z.enum(['name', 'room', 'updated', 'connectivity', 'category']).default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});
export type DeviceListQuery = z.infer<typeof deviceListQuerySchema>;

export const homeAssistantConnectSchema = z.object({
  name: z.string().trim().min(1).max(60).default('Home Assistant'),
  baseUrl: z
    .string()
    .trim()
    .url('Enter the full URL, e.g. http://homeassistant.local:8123')
    .max(300)
    .refine((u) => /^https?:\/\//.test(u), 'URL must start with http:// or https://'),
  accessToken: z.string().trim().min(20, 'Paste the long-lived access token').max(1000),
});

export const importDevicesSchema = z.object({
  devices: z
    .array(
      z.object({
        externalId: z.string().min(1).max(255),
        name: z.string().trim().min(1).max(80),
        roomId: z.string().nullable(),
        category: z.enum(DEVICE_CATEGORIES).optional(),
      }),
    )
    .min(1)
    .max(500),
});

export const sceneActionInputSchema = z.object({
  deviceId: z.string().min(1),
  command: deviceCommandSchema,
  order: z.number().int().min(0).default(0),
});
export const sceneInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  icon: z.string().min(1).max(40).default('sparkles'),
  description: z.string().max(300).default(''),
  roomId: z.string().nullable().optional(),
  executionMode: z.enum(['parallel', 'sequential']).default('parallel'),
  isFavourite: z.boolean().default(false),
  /** Locks/alarm actions are rejected unless explicitly allowed; activation then needs confirmation. */
  allowSensitiveActions: z.boolean().default(false),
  actions: z.array(sceneActionInputSchema).min(1).max(50),
});
export type SceneInput = z.infer<typeof sceneInputSchema>;

export const notificationPreferencesSchema = z.object({
  criticalSecurity: z.boolean(),
  deviceOffline: z.boolean(),
  lowBattery: z.boolean(),
  automationFailures: z.boolean(),
  integrationFailures: z.boolean(),
  energyThresholds: z.boolean(),
  energyThresholdW: z.number().int().min(100).max(100000).nullable(),
});
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  criticalSecurity: true,
  deviceOffline: true,
  lowBattery: true,
  automationFailures: true,
  integrationFailures: true,
  energyThresholds: false,
  energyThresholdW: null,
};

export const userPreferencesSchema = z.object({
  temperatureUnit: z.enum(['C', 'F', 'home']).default('home'),
  reducedMotion: z.enum(['system', 'on', 'off']).default('system'),
  defaultHomeId: z.string().nullable().optional(),
  deviceView: z.enum(['grid', 'list']).default('grid'),
  notifications: notificationPreferencesSchema.optional(),
});
export type UserPreferences = z.infer<typeof userPreferencesSchema>;

// ─── Response DTOs ────────────────────────────────────────────────────────

export interface UserDto {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

export interface SessionDto {
  id: string;
  current: boolean;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

export interface HomeSummaryDto {
  id: string;
  name: string;
  role: HomeRole;
  isDemo: boolean;
  timezone: string;
}

export interface HomeDto extends HomeSummaryDto {
  locale: string;
  temperatureUnit: 'C' | 'F';
  latitude: number | null;
  longitude: number | null;
  currency: string | null;
  tariffPerKWh: number | null;
  retentionDays: { activity: number; stateSnapshots: number; cameraEvents: number };
  permissions: Permission[];
  onboardingCompleted: boolean;
  createdAt: string;
}

export interface MemberDto {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: HomeRole;
  joinedAt: string;
}

export interface InvitationDto {
  id: string;
  email: string;
  role: HomeRole;
  expiresAt: string;
  createdAt: string;
  /** Only returned once, at creation time, because no email channel is configured. */
  inviteUrl?: string;
}

export interface RoomDto {
  id: string;
  name: string;
  icon: string;
  coverImageUrl: string | null;
  isFavourite: boolean;
  sortOrder: number;
  deviceCount: number;
  onlineCount: number;
  activeCount: number;
  /** Aggregated from sensors in the room — absent when no sensor reports it */
  environment: { temperature?: number; humidity?: number; co2?: number };
}

export interface DeviceDto {
  id: string;
  homeId: string;
  integrationId: string;
  integrationType: IntegrationType;
  integrationName: string;
  isDemo: boolean;
  externalId: string;
  name: string;
  category: DeviceCategory;
  deviceType: string | null;
  manufacturer: string | null;
  model: string | null;
  roomId: string | null;
  roomName: string | null;
  isFavourite: boolean;
  isHidden: boolean;
  capabilities: Capability[];
  state: DeviceState;
  connectivity: ConnectivityState;
  stateUpdatedAt: string | null;
  lastSeenAt: string | null;
  lastCommandAt: string | null;
  lastError: string | null;
  /** True when the integration that owns the device has been disconnected */
  integrationDisconnected: boolean;
  createdAt: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DeviceCountsDto {
  total: number;
  online: number;
  offline: number;
  unavailable: number;
  unknown: number;
}

export interface CommandDto {
  id: string;
  deviceId: string;
  deviceName: string;
  command: DeviceCommand;
  description: string;
  status: CommandStatus;
  /** Whether the result was verified via state read-back (vs. acknowledgement only) */
  verified: boolean;
  errorCode: CommandErrorCode | null;
  errorMessage: string | null;
  source: 'user' | 'scene' | 'automation';
  createdAt: string;
  completedAt: string | null;
}

export interface IntegrationDto {
  id: string;
  type: IntegrationType;
  name: string;
  status: 'connected' | 'connecting' | 'error' | 'auth_failed' | 'disconnected';
  statusMessage: string | null;
  baseUrl: string | null;
  isDemo: boolean;
  lastSyncAt: string | null;
  lastConnectedAt: string | null;
  deviceCount: number;
  discoveredNotImported: number;
  supportLevel: SupportLevel;
  createdAt: string;
}

export interface DiscoveredDeviceDto {
  externalId: string;
  name: string;
  category: DeviceCategory;
  deviceType: string | null;
  manufacturer: string | null;
  model: string | null;
  capabilities: Capability[];
  connectivity: ConnectivityState;
  suggestedRoom: string | null;
  alreadyImported: boolean;
  importedDeviceId: string | null;
}

export interface SceneDto {
  id: string;
  name: string;
  icon: string;
  description: string;
  roomId: string | null;
  executionMode: 'parallel' | 'sequential';
  isFavourite: boolean;
  allowSensitiveActions: boolean;
  requiresConfirmation: boolean;
  actions: { id: string; deviceId: string; deviceName: string; command: DeviceCommand; description: string; order: number; deviceAvailable: boolean }[];
  lastExecution: SceneExecutionDto | null;
  createdAt: string;
  updatedAt: string;
}

export interface SceneExecutionDto {
  id: string;
  sceneId: string;
  status: 'running' | 'succeeded' | 'partial' | 'failed';
  startedAt: string;
  completedAt: string | null;
  source: 'user' | 'automation';
  results: { actionId: string; deviceId: string; deviceName: string; description: string; status: CommandStatus | 'skipped'; message: string | null; commandId: string | null }[];
}

export interface AutomationDto {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  isDraft: boolean;
  executor: AutomationExecutor;
  externalId: string | null;
  triggers: AutomationTrigger[];
  conditions: AutomationCondition[];
  conditionOperator: 'and' | 'or';
  actions: AutomationAction[];
  cooldownSeconds: number;
  allowSensitiveActions: boolean;
  lastRunAt: string | null;
  lastRunStatus: AutomationExecutionDto['status'] | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationExecutionDto {
  id: string;
  automationId: string;
  status: 'running' | 'succeeded' | 'partial' | 'failed' | 'skipped' | 'simulated';
  triggeredBy: string;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
  steps: { index: number; type: string; description: string; status: 'ok' | 'failed' | 'skipped' | 'simulated'; message: string | null }[];
}

export const ACTIVITY_TYPES = [
  'device.command',
  'device.state',
  'device.connectivity',
  'device.battery_low',
  'device.added',
  'device.removed',
  'scene.executed',
  'automation.executed',
  'automation.failed',
  'security.event',
  'camera.event',
  'integration.connected',
  'integration.error',
  'integration.disconnected',
  'home.member',
  'energy.threshold',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export type Severity = 'info' | 'success' | 'warning' | 'critical';

export interface ActivityDto {
  id: string;
  type: ActivityType;
  title: string;
  detail: string | null;
  severity: Severity;
  result: 'success' | 'failure' | 'pending' | null;
  source: 'user' | 'automation' | 'scene' | 'integration' | 'system';
  actorName: string | null;
  deviceId: string | null;
  deviceName: string | null;
  roomId: string | null;
  category: DeviceCategory | null;
  createdAt: string;
  isDemo: boolean;
}

export interface NotificationDto {
  id: string;
  title: string;
  body: string;
  severity: Severity;
  category: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface CameraDto {
  device: DeviceDto;
  live: boolean;
  snapshot: boolean;
  isDemo: boolean;
  activeViewers: number;
  lastFrameAt: string | null;
  events: { id: string; title: string; createdAt: string }[];
}

export interface EnergyDto {
  available: boolean;
  /** Integrations/devices supplying the data */
  sources: { deviceId: string; deviceName: string; kind: 'consumption' | 'solar' | 'battery' | 'ev'; isDemo: boolean }[];
  currentPowerW: number | null;
  solarPowerW: number | null;
  batteryLevel: number | null;
  evCharging: { deviceId: string; name: string; charging: boolean; powerW: number | null }[];
  totals: { todayKWh: number | null; weekKWh: number | null; monthKWh: number | null; solarTodayKWh: number | null };
  series: { t: string; consumptionKWh: number; solarKWh: number }[];
  perDevice: { deviceId: string; name: string; kWh: number; currentW: number | null }[];
  tariff: { perKWh: number; currency: string } | null;
  thresholdW: number | null;
  range: { from: string; to: string; bucket: 'hour' | 'day' };
}

export interface NetworkDto {
  available: boolean;
  sources: { integrationId: string; integrationName: string; isDemo: boolean }[];
  routers: { id: string; name: string; kind: 'router' | 'access_point' | 'switch'; status: 'online' | 'offline' | 'unknown'; clients: number | null; uptimeSeconds: number | null; firmware: string | null; deviceId: string | null }[];
  clients: {
    id: string;
    name: string;
    ip: string | null;
    mac: string | null;
    connection: 'wifi' | 'ethernet' | 'unknown';
    signalDbm: number | null;
    lastSeenAt: string | null;
    online: boolean;
    smartHomeDeviceId: string | null;
  }[];
  bandwidth: { downMbps: number; upMbps: number; measuredAt: string } | null;
  guestNetwork: { enabled: boolean; supported: boolean } | null;
  health: 'good' | 'degraded' | 'down' | 'unknown';
}

export interface SearchResultDto {
  devices: { id: string; name: string; roomName: string | null; category: DeviceCategory }[];
  rooms: { id: string; name: string; icon: string }[];
  scenes: { id: string; name: string; icon: string }[];
  automations: { id: string; name: string; enabled: boolean }[];
  integrations: { id: string; name: string; type: IntegrationType }[];
  activity: { id: string; title: string; createdAt: string }[];
}

export interface DashboardDto {
  widgets: DashboardWidget[];
  isDefault: boolean;
}

export interface AuditLogDto {
  id: string;
  action: string;
  actorName: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
}

export interface CatalogueDto {
  categories: { id: DeviceCategory; label: string; icon: string; types: string[]; typicalCapabilities: string[]; supportedBy: IntegrationType[] }[];
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

// ─── Real-time events (server → browser over authenticated WebSocket) ──

export type RealtimeEvent =
  | { type: 'device.updated'; homeId: string; device: DeviceDto }
  | { type: 'device.removed'; homeId: string; deviceId: string }
  | { type: 'command.updated'; homeId: string; command: CommandDto }
  | { type: 'integration.updated'; homeId: string; integration: IntegrationDto }
  | { type: 'activity.created'; homeId: string; activity: ActivityDto }
  | { type: 'notification.created'; homeId: string; notification: NotificationDto }
  | { type: 'scene.execution'; homeId: string; execution: SceneExecutionDto }
  | { type: 'automation.execution'; homeId: string; execution: AutomationExecutionDto }
  | { type: 'camera.viewers'; homeId: string; deviceId: string; activeViewers: number }
  | { type: 'home.changed'; homeId: string };

export type RealtimeClientMessage = { type: 'subscribe'; homeId: string } | { type: 'ping' };
