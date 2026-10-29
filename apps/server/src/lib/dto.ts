import type { Prisma } from '@prisma/client';
import {
  INTEGRATIONS,
  ROLE_PERMISSIONS,
  capabilitySchema,
  describeCommand,
  type ActivityDto,
  type Capability,
  type CommandDto,
  type ConnectivityState,
  type DeviceCategory,
  type DeviceCommand,
  type DeviceDto,
  type DeviceState,
  type HomeDto,
  type HomeRole,
  type IntegrationDto,
  type IntegrationType,
  type NotificationDto,
  type SceneExecutionDto,
} from '@smartnest/shared';

export const deviceInclude = {
  capabilities: true,
  room: { select: { name: true } },
  integration: { select: { type: true, name: true, isDemo: true, status: true } },
} satisfies Prisma.DeviceInclude;

export type DeviceWithRelations = Prisma.DeviceGetPayload<{ include: typeof deviceInclude }>;

export function parseCapabilities(rows: { type: string; config: Prisma.JsonValue }[]): Capability[] {
  const out: Capability[] = [];
  for (const r of rows) {
    const parsed = capabilitySchema.safeParse({ ...(r.config as object), type: r.type });
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export function toDeviceDto(d: DeviceWithRelations): DeviceDto {
  return {
    id: d.id,
    homeId: d.homeId,
    integrationId: d.integrationId,
    integrationType: d.integration.type as IntegrationType,
    integrationName: d.integration.name,
    isDemo: d.integration.isDemo,
    externalId: d.externalId,
    name: d.name,
    category: d.category as DeviceCategory,
    deviceType: d.deviceType,
    manufacturer: d.manufacturer,
    model: d.model,
    roomId: d.roomId,
    roomName: d.room?.name ?? null,
    isFavourite: d.isFavourite,
    isHidden: d.isHidden,
    capabilities: parseCapabilities(d.capabilities),
    state: (d.state ?? {}) as DeviceState,
    connectivity: d.connectivity as ConnectivityState,
    stateUpdatedAt: d.stateUpdatedAt?.toISOString() ?? null,
    lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
    lastCommandAt: d.lastCommandAt?.toISOString() ?? null,
    lastError: d.lastError,
    integrationDisconnected: d.integration.status === 'disconnected',
    createdAt: d.createdAt.toISOString(),
  };
}

export function toHomeDto(
  h: Prisma.HomeGetPayload<object>,
  role: HomeRole,
): HomeDto {
  return {
    id: h.id,
    name: h.name,
    role,
    isDemo: h.isDemo,
    timezone: h.timezone,
    locale: h.locale,
    temperatureUnit: h.temperatureUnit === 'F' ? 'F' : 'C',
    latitude: h.latitude,
    longitude: h.longitude,
    currency: h.currency,
    tariffPerKWh: h.tariffPerKWh,
    retentionDays: { activity: h.retentionActivityDays, stateSnapshots: h.retentionSnapshotDays, cameraEvents: h.retentionCameraDays },
    permissions: [...ROLE_PERMISSIONS[role]],
    onboardingCompleted: h.onboardingCompleted,
    createdAt: h.createdAt.toISOString(),
  };
}

export function toIntegrationDto(i: Prisma.IntegrationGetPayload<object>, counts: { devices: number; discoveredNotImported: number }): IntegrationDto {
  return {
    id: i.id,
    type: i.type as IntegrationType,
    name: i.name,
    status: i.status as IntegrationDto['status'],
    statusMessage: i.statusMessage,
    baseUrl: i.baseUrl,
    isDemo: i.isDemo,
    lastSyncAt: i.lastSyncAt?.toISOString() ?? null,
    lastConnectedAt: i.lastConnectedAt?.toISOString() ?? null,
    deviceCount: counts.devices,
    discoveredNotImported: counts.discoveredNotImported,
    supportLevel: INTEGRATIONS[i.type as IntegrationType]?.supportLevel ?? 'planned',
    createdAt: i.createdAt.toISOString(),
  };
}

export function toCommandDto(
  c: Prisma.DeviceCommandGetPayload<{ include: { result: true; device: { select: { name: true } } } }>,
): CommandDto {
  const command = c.command as unknown as DeviceCommand;
  return {
    id: c.id,
    deviceId: c.deviceId,
    deviceName: c.device.name,
    command,
    description: describeCommand(command),
    status: c.status as CommandDto['status'],
    verified: c.verified,
    errorCode: (c.result?.errorCode ?? null) as CommandDto['errorCode'],
    errorMessage: c.result?.errorMessage ?? null,
    source: c.source as CommandDto['source'],
    createdAt: c.createdAt.toISOString(),
    completedAt: c.completedAt?.toISOString() ?? null,
  };
}

export function toActivityDto(a: Prisma.ActivityEventGetPayload<object>): ActivityDto {
  return {
    id: a.id,
    type: a.type as ActivityDto['type'],
    title: a.title,
    detail: a.detail,
    severity: a.severity as ActivityDto['severity'],
    result: a.result as ActivityDto['result'],
    source: a.source as ActivityDto['source'],
    actorName: a.actorName,
    deviceId: a.deviceId,
    deviceName: a.deviceName,
    roomId: a.roomId,
    category: a.category as DeviceCategory | null,
    createdAt: a.createdAt.toISOString(),
    isDemo: a.isDemo,
  };
}

export function toNotificationDto(n: Prisma.NotificationGetPayload<object>): NotificationDto {
  return {
    id: n.id,
    title: n.title,
    body: n.body,
    severity: n.severity as NotificationDto['severity'],
    category: n.category,
    link: n.link,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}

export function toSceneExecutionDto(e: Prisma.SceneExecutionGetPayload<object>): SceneExecutionDto {
  return {
    id: e.id,
    sceneId: e.sceneId,
    status: e.status as SceneExecutionDto['status'],
    startedAt: e.startedAt.toISOString(),
    completedAt: e.completedAt?.toISOString() ?? null,
    source: e.source as SceneExecutionDto['source'],
    results: (e.results ?? []) as SceneExecutionDto['results'],
  };
}

export const json = (v: unknown) => v as Prisma.InputJsonValue;
