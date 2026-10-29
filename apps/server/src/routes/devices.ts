import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  GUEST_CONTROLLABLE_CATEGORIES,
  LOW_BATTERY_THRESHOLD,
  bulkDeviceSchema,
  createCommandRequestSchema,
  deviceListQuerySchema,
  deviceUpdateSchema,
  isSensitiveCommand,
  type DeviceCountsDto,
  type Paginated,
  type DeviceDto,
} from '@smartnest/shared';
import { prisma } from '../db.js';
import { deviceInclude, json, parseCapabilities, toCommandDto, toDeviceDto } from '../lib/dto.js';
import { AppError, badRequest, forbidden, notFound } from '../lib/errors.js';
import { integrations } from '../integrations/manager.js';
import { assertPermission, assertRecentReauth, ctx, homeAccess } from '../middleware/auth.js';
import { ah, commandLimiter, parse } from '../middleware/http.js';
import { recordActivity } from '../services/activity.js';
import { audit } from '../services/audit.js';
import { pushRealtime } from '../services/bus.js';
import { dispatchCommand } from '../services/commands.js';
import { ingestDeviceUpdate } from '../services/deviceState.js';
import { ENERGY_ROLES } from '../services/energy.js';

export const devicesRouter = Router({ mergeParams: true });

export async function deviceCounts(homeId: string): Promise<DeviceCountsDto> {
  const groups = await prisma.device.groupBy({ by: ['connectivity'], where: { homeId, isHidden: false }, _count: true });
  const get = (k: string) => groups.find((g) => g.connectivity === k)?._count ?? 0;
  const counts = { online: get('online'), offline: get('offline'), unavailable: get('unavailable'), unknown: get('unknown') };
  return { total: counts.online + counts.offline + counts.unavailable + counts.unknown, ...counts };
}

devicesRouter.get(
  '/',
  homeAccess('devices.view'),
  ah(async (req, res) => {
    const { home } = ctx(req);
    const q = parse(deviceListQuerySchema, req.query);
    const and: Prisma.DeviceWhereInput[] = [{ homeId: home.id }];
    if (q.includeHidden !== 'true') and.push({ isHidden: false });
    if (q.q) and.push({ OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { manufacturer: { contains: q.q, mode: 'insensitive' } }, { model: { contains: q.q, mode: 'insensitive' } }, { room: { name: { contains: q.q, mode: 'insensitive' } } }] });
    if (q.roomId) and.push({ roomId: q.roomId === 'none' ? null : q.roomId });
    if (q.category) and.push({ category: q.category });
    if (q.manufacturer) and.push({ manufacturer: q.manufacturer });
    if (q.integrationId) and.push({ integrationId: q.integrationId });
    if (q.connectivity) and.push({ connectivity: q.connectivity });
    if (q.favourite) and.push({ isFavourite: q.favourite === 'true' });
    if (q.capability) and.push({ capabilities: { some: { type: q.capability } } });
    if (q.operating === 'on') and.push({ state: { path: ['on'], equals: true } });
    if (q.operating === 'off') and.push({ state: { path: ['on'], equals: false } });
    if (q.operating === 'unknown') and.push({ OR: [{ connectivity: { not: 'online' } }, { state: { path: ['on'], equals: Prisma.AnyNull } }] });
    if (q.battery === 'low') and.push({ state: { path: ['batteryLevel'], lte: LOW_BATTERY_THRESHOLD } });
    if (q.battery === 'ok') and.push({ state: { path: ['batteryLevel'], gt: LOW_BATTERY_THRESHOLD } });
    if (q.battery === 'none') and.push({ capabilities: { none: { type: 'battery' } } });

    const where: Prisma.DeviceWhereInput = { AND: and };
    const dir = q.order;
    const orderBy: Prisma.DeviceOrderByWithRelationInput[] =
      q.sort === 'room' ? [{ room: { name: dir } }, { name: 'asc' }]
      : q.sort === 'updated' ? [{ stateUpdatedAt: { sort: dir, nulls: 'last' } }]
      : q.sort === 'connectivity' ? [{ connectivity: dir }, { name: 'asc' }]
      : q.sort === 'category' ? [{ category: dir }, { name: 'asc' }]
      : [{ name: dir }];

    const [total, devices] = await Promise.all([
      prisma.device.count({ where }),
      prisma.device.findMany({ where, include: deviceInclude, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    const body: Paginated<DeviceDto> = { items: devices.map(toDeviceDto), total, page: q.page, pageSize: q.pageSize };
    res.json(body);
  }),
);

devicesRouter.get(
  '/counts',
  homeAccess('devices.view'),
  ah(async (req, res) => {
    res.json(await deviceCounts(ctx(req).home.id));
  }),
);

/** Values for filter dropdowns */
devicesRouter.get(
  '/facets',
  homeAccess('devices.view'),
  ah(async (req, res) => {
    const { home } = ctx(req);
    const [manufacturers, categories] = await Promise.all([
      prisma.device.findMany({ where: { homeId: home.id, manufacturer: { not: null } }, distinct: ['manufacturer'], select: { manufacturer: true } }),
      prisma.device.findMany({ where: { homeId: home.id }, distinct: ['category'], select: { category: true } }),
    ]);
    res.json({ manufacturers: manufacturers.map((m) => m.manufacturer).filter(Boolean).sort(), categories: categories.map((c) => c.category).sort() });
  }),
);

devicesRouter.post(
  '/bulk',
  homeAccess('devices.manage'),
  ah(async (req, res) => {
    const { home, auth } = ctx(req);
    const { ids, update } = parse(bulkDeviceSchema, req.body);
    if (update.roomId) {
      const room = await prisma.room.findFirst({ where: { id: update.roomId, homeId: home.id } });
      if (!room) throw badRequest('Room not found in this home.');
    }
    const r = await prisma.device.updateMany({ where: { id: { in: ids }, homeId: home.id }, data: update });
    await audit({ action: 'device.bulk_update', userId: auth.userId, homeId: home.id, metadata: { count: r.count, fields: Object.keys(update) } });
    const devices = await prisma.device.findMany({ where: { id: { in: ids }, homeId: home.id }, include: deviceInclude });
    for (const d of devices) pushRealtime({ type: 'device.updated', homeId: home.id, device: toDeviceDto(d) });
    res.json({ updated: r.count });
  }),
);

async function loadDevice(homeId: string, deviceId: string) {
  const d = await prisma.device.findFirst({ where: { id: deviceId, homeId }, include: deviceInclude });
  if (!d) throw notFound('Device');
  return d;
}

devicesRouter.get(
  '/:deviceId',
  homeAccess('devices.view'),
  ah(async (req, res) => {
    const d = await loadDevice(ctx(req).home.id, req.params.deviceId!);
    res.json({ device: toDeviceDto(d), metadata: { energyRole: (d.metadata as { energyRole?: string }).energyRole ?? null, demoNote: (d.metadata as { demoNote?: string }).demoNote ?? null } });
  }),
);

devicesRouter.patch(
  '/:deviceId',
  homeAccess('devices.manage'),
  ah(async (req, res) => {
    const { home, auth } = ctx(req);
    const input = parse(deviceUpdateSchema.extend({ energyRole: z.enum(ENERGY_ROLES).optional() }), req.body);
    const d = await loadDevice(home.id, req.params.deviceId!);
    if (input.roomId) {
      const room = await prisma.room.findFirst({ where: { id: input.roomId, homeId: home.id } });
      if (!room) throw badRequest('Room not found in this home.');
    }
    const { energyRole, ...rest } = input;
    // Moving rooms or renaming never touches integrationId/externalId, so the integration identity is preserved.
    const updated = await prisma.device.update({
      where: { id: d.id },
      data: { ...rest, ...(energyRole ? { metadata: json({ ...(d.metadata as object), energyRole }) } : {}) },
      include: deviceInclude,
    });
    if (input.isHidden !== undefined) await audit({ action: input.isHidden ? 'device.hidden' : 'device.unhidden', userId: auth.userId, homeId: home.id, targetType: 'device', targetId: d.id });
    pushRealtime({ type: 'device.updated', homeId: home.id, device: toDeviceDto(updated) });
    res.json({ device: toDeviceDto(updated) });
  }),
);

/** Remove from SmartNest only. The physical device and its integration entity are untouched. */
devicesRouter.delete(
  '/:deviceId',
  homeAccess('devices.manage'),
  ah(async (req, res) => {
    const { home, auth } = ctx(req);
    const d = await loadDevice(home.id, req.params.deviceId!);
    await prisma.device.delete({ where: { id: d.id } });
    await audit({ action: 'device.removed', userId: auth.userId, homeId: home.id, targetType: 'device', targetId: d.id, metadata: { name: d.name, externalId: d.externalId } });
    await recordActivity({ homeId: home.id, type: 'device.removed', title: `${d.name} removed from SmartNest`, detail: 'It can be re-imported from its integration.', source: 'user', actorUserId: auth.userId, actorName: auth.name, isDemo: d.integration.isDemo });
    pushRealtime({ type: 'device.removed', homeId: home.id, deviceId: d.id });
    res.status(204).end();
  }),
);

// ─── Commands ─────────────────────────────────────────────────────────────

devicesRouter.post(
  '/:deviceId/commands',
  homeAccess('devices.control'),
  commandLimiter,
  ah(async (req, res) => {
    const { home, auth, role } = ctx(req);
    const body = parse(createCommandRequestSchema, req.body);
    const d = await loadDevice(home.id, req.params.deviceId!);
    const caps = parseCapabilities(d.capabilities);
    if (body.command.capability === 'ptz' || body.command.capability === 'motionDetectionToggle') assertPermission(req, 'cameras.control');
    if (role === 'guest' && !GUEST_CONTROLLABLE_CATEGORIES.has(d.category)) throw forbidden('Guests cannot control this type of device.');
    if (isSensitiveCommand(body.command, caps)) {
      assertPermission(req, 'devices.control.sensitive');
      if (!body.confirmed) throw new AppError(428, 'confirmation_required', 'This is a security-sensitive action. Confirm to continue.');
      if (body.command.action === 'unlock' || body.command.action === 'disarm') assertRecentReauth(req);
    }
    const { command } = await dispatchCommand({
      homeId: home.id,
      deviceId: d.id,
      command: body.command,
      userId: auth.userId,
      actorName: auth.name,
      source: 'user',
      idempotencyKey: body.idempotencyKey,
      ipAddress: req.ip,
    });
    res.status(202).json({ command });
  }),
);

devicesRouter.get(
  '/:deviceId/commands',
  homeAccess('devices.view'),
  ah(async (req, res) => {
    const { home } = ctx(req);
    await loadDevice(home.id, req.params.deviceId!);
    const commands = await prisma.deviceCommand.findMany({ where: { deviceId: req.params.deviceId, homeId: home.id }, include: { result: true, device: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 25 });
    res.json({ commands: commands.map(toCommandDto) });
  }),
);

devicesRouter.get(
  '/:deviceId/history',
  homeAccess('devices.view'),
  ah(async (req, res) => {
    const { home } = ctx(req);
    const hours = Math.min(24 * 7, Math.max(1, Number(req.query.hours ?? 24)));
    await loadDevice(home.id, req.params.deviceId!);
    const snapshots = await prisma.deviceStateSnapshot.findMany({
      where: { deviceId: req.params.deviceId, homeId: home.id, recordedAt: { gte: new Date(Date.now() - hours * 3600_000) } },
      orderBy: { recordedAt: 'asc' },
      take: 2000,
    });
    res.json({ history: snapshots.map((s) => ({ t: s.recordedAt.toISOString(), state: s.state, connectivity: s.connectivity })) });
  }),
);

/** Ask the integration for the device's current state (read-back). */
devicesRouter.post(
  '/:deviceId/refresh',
  homeAccess('devices.view'),
  ah(async (req, res) => {
    const { home } = ctx(req);
    const d = await loadDevice(home.id, req.params.deviceId!);
    const adapter = integrations.tryGet(d.integrationId);
    if (!adapter) throw new AppError(409, 'integration_disconnected', `${d.integration.name} is not connected.`);
    const r = await adapter.readState(d.externalId).catch((e) => {
      throw new AppError(502, 'integration_error', (e as Error).message);
    });
    if (!r) throw new AppError(404, 'device_unavailable', 'The integration no longer reports this device.');
    await ingestDeviceUpdate(d.integrationId, { externalId: d.externalId, state: r.state, connectivity: r.connectivity });
    res.json({ device: toDeviceDto(await loadDevice(home.id, d.id)) });
  }),
);

export const commandsRouter = Router({ mergeParams: true });
commandsRouter.get(
  '/:commandId',
  homeAccess('devices.view'),
  ah(async (req, res) => {
    const { home } = ctx(req);
    const c = await prisma.deviceCommand.findFirst({ where: { id: req.params.commandId, homeId: home.id }, include: { result: true, device: { select: { name: true } } } });
    if (!c) throw notFound('Command');
    res.json({ command: toCommandDto(c) });
  }),
);

