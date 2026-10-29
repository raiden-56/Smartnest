import { Router } from 'express';
import { z } from 'zod';
import { GUEST_CONTROLLABLE_CATEGORIES, reorderSchema, roomInputSchema, type DeviceCommand, type DeviceState, type RoomDto } from '@smartnest/shared';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { parseCapabilities } from '../lib/dto.js';
import { badRequest, notFound } from '../lib/errors.js';
import { ctx, homeAccess } from '../middleware/auth.js';
import { ah, commandLimiter, parse } from '../middleware/http.js';
import { audit } from '../services/audit.js';
import { pushRealtime } from '../services/bus.js';
import { dispatchCommand } from '../services/commands.js';

export const roomsRouter = Router({ mergeParams: true });

type RoomWithDevices = Prisma.RoomGetPayload<{ include: { devices: { select: { connectivity: true; state: true; isHidden: true; capabilities: { select: { type: true; config: true } } } } } }>;

export function toRoomDto(r: RoomWithDevices): RoomDto {
  const visible = r.devices.filter((d) => !d.isHidden);
  const avg = (key: string) => {
    const values = visible
      .filter((d) => d.connectivity === 'online')
      .map((d) => (d.state as DeviceState).measurements?.[key])
      .filter((v): v is number => typeof v === 'number');
    return values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : undefined;
  };
  const environment: RoomDto['environment'] = {};
  const t = avg('temperature');
  const h = avg('humidity');
  const c = avg('co2');
  if (t !== undefined) environment.temperature = t;
  if (h !== undefined) environment.humidity = h;
  if (c !== undefined) environment.co2 = c;
  return {
    id: r.id,
    name: r.name,
    icon: r.icon,
    coverImageUrl: r.coverImageUrl,
    isFavourite: r.isFavourite,
    sortOrder: r.sortOrder,
    deviceCount: visible.length,
    onlineCount: visible.filter((d) => d.connectivity === 'online').length,
    activeCount: visible.filter((d) => (d.state as DeviceState).on === true).length,
    environment,
  };
}

const roomInclude = { devices: { select: { connectivity: true, state: true, isHidden: true, capabilities: { select: { type: true, config: true } } } } } as const;

roomsRouter.get(
  '/',
  homeAccess(),
  ah(async (req, res) => {
    const { home } = ctx(req);
    const rooms = await prisma.room.findMany({ where: { homeId: home.id }, include: roomInclude, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    res.json({ rooms: rooms.map(toRoomDto) });
  }),
);

roomsRouter.post(
  '/',
  homeAccess('rooms.manage'),
  ah(async (req, res) => {
    const { home, auth } = ctx(req);
    const input = parse(roomInputSchema, req.body);
    const count = await prisma.room.count({ where: { homeId: home.id } });
    if (count >= 100) throw badRequest('A home can have at most 100 rooms.');
    const room = await prisma.room.create({ data: { homeId: home.id, name: input.name, icon: input.icon, coverImageUrl: input.coverImageUrl ?? null, isFavourite: input.isFavourite ?? false, sortOrder: count }, include: roomInclude });
    await audit({ action: 'room.created', userId: auth.userId, homeId: home.id, targetType: 'room', targetId: room.id });
    pushRealtime({ type: 'home.changed', homeId: home.id });
    res.status(201).json({ room: toRoomDto(room) });
  }),
);

roomsRouter.put(
  '/order',
  homeAccess('rooms.manage'),
  ah(async (req, res) => {
    const { home } = ctx(req);
    const { ids } = parse(reorderSchema, req.body);
    const rooms = await prisma.room.findMany({ where: { homeId: home.id }, select: { id: true } });
    const valid = new Set(rooms.map((r) => r.id));
    if (ids.some((id) => !valid.has(id))) throw badRequest('Unknown room in order list.');
    await prisma.$transaction(ids.map((id, i) => prisma.room.update({ where: { id }, data: { sortOrder: i } })));
    pushRealtime({ type: 'home.changed', homeId: home.id });
    res.json({ ok: true });
  }),
);

roomsRouter.get(
  '/:roomId',
  homeAccess(),
  ah(async (req, res) => {
    const { home } = ctx(req);
    const room = await prisma.room.findFirst({ where: { id: req.params.roomId, homeId: home.id }, include: roomInclude });
    if (!room) throw notFound('Room');
    res.json({ room: toRoomDto(room) });
  }),
);

roomsRouter.patch(
  '/:roomId',
  homeAccess('rooms.manage'),
  ah(async (req, res) => {
    const { home } = ctx(req);
    const input = parse(roomInputSchema.partial(), req.body);
    const exists = await prisma.room.findFirst({ where: { id: req.params.roomId, homeId: home.id } });
    if (!exists) throw notFound('Room');
    const room = await prisma.room.update({ where: { id: exists.id }, data: input, include: roomInclude });
    pushRealtime({ type: 'home.changed', homeId: home.id });
    res.json({ room: toRoomDto(room) });
  }),
);

/** Deleting a room unassigns its devices; it never deletes devices. */
roomsRouter.delete(
  '/:roomId',
  homeAccess('rooms.manage'),
  ah(async (req, res) => {
    const { home, auth } = ctx(req);
    const room = await prisma.room.findFirst({ where: { id: req.params.roomId, homeId: home.id } });
    if (!room) throw notFound('Room');
    await prisma.room.delete({ where: { id: room.id } });
    await audit({ action: 'room.deleted', userId: auth.userId, homeId: home.id, targetType: 'room', targetId: room.id, metadata: { name: room.name } });
    pushRealtime({ type: 'home.changed', homeId: home.id });
    res.status(204).end();
  }),
);

/** Room-level quick actions. Only targets devices that declare on/off and are not security devices. */
roomsRouter.post(
  '/:roomId/actions',
  homeAccess('devices.control'),
  commandLimiter,
  ah(async (req, res) => {
    const { home, auth, role } = ctx(req);
    const { action } = parse(z.object({ action: z.enum(['lightsOn', 'lightsOff', 'allOff']) }), req.body);
    const room = await prisma.room.findFirst({ where: { id: req.params.roomId, homeId: home.id } });
    if (!room) throw notFound('Room');
    const devices = await prisma.device.findMany({ where: { homeId: home.id, roomId: room.id, isHidden: false }, include: { capabilities: true } });
    const targets = devices.filter((d) => {
      if (!parseCapabilities(d.capabilities).some((c) => c.type === 'onOff')) return false;
      if (role === 'guest' && !GUEST_CONTROLLABLE_CATEGORIES.has(d.category)) return false;
      if (action === 'allOff') return ['lighting', 'electrical', 'entertainment', 'climate'].includes(d.category);
      return d.category === 'lighting';
    });
    const command: DeviceCommand = action === 'lightsOn' ? { capability: 'onOff', action: 'turnOn' } : { capability: 'onOff', action: 'turnOff' };
    const commands = [];
    for (const d of targets) {
      const { command: c } = await dispatchCommand({ homeId: home.id, deviceId: d.id, command, userId: auth.userId, actorName: auth.name, source: 'user', ipAddress: req.ip });
      commands.push(c);
    }
    res.status(202).json({ commands, targeted: targets.length });
  }),
);
