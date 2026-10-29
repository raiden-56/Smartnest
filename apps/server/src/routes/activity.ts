import { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ACTIVITY_TYPES, DEVICE_CATEGORIES } from '@smartnest/shared';
import { prisma } from '../db.js';
import { toActivityDto, toNotificationDto } from '../lib/dto.js';
import { ctx, homeAccess } from '../middleware/auth.js';
import { ah, parse } from '../middleware/http.js';

export const activityRouter = Router({ mergeParams: true });

const activityQuery = z.object({
  deviceId: z.string().optional(),
  roomId: z.string().optional(),
  category: z.enum(DEVICE_CATEGORIES).optional(),
  severity: z.enum(['info', 'success', 'warning', 'critical']).optional(),
  type: z.enum(ACTIVITY_TYPES).optional(),
  source: z.enum(['user', 'automation', 'scene', 'integration', 'system']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  q: z.string().max(100).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

activityRouter.get(
  '/',
  homeAccess('activity.view'),
  ah(async (req, res) => {
    const { home } = ctx(req);
    const q = parse(activityQuery, req.query);
    const where: Prisma.ActivityEventWhereInput = {
      homeId: home.id,
      ...(q.deviceId ? { deviceId: q.deviceId } : {}),
      ...(q.roomId ? { roomId: q.roomId } : {}),
      ...(q.category ? { category: q.category } : {}),
      ...(q.severity ? { severity: q.severity } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.source ? { source: q.source } : {}),
      ...(q.q ? { OR: [{ title: { contains: q.q, mode: 'insensitive' } }, { detail: { contains: q.q, mode: 'insensitive' } }] } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
    };
    const items = await prisma.activityEvent.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > q.limit;
    const page = items.slice(0, q.limit);
    res.json({ items: page.map(toActivityDto), nextCursor: hasMore ? page[page.length - 1]!.id : null });
  }),
);

export const notificationsRouter = Router({ mergeParams: true });

notificationsRouter.get(
  '/',
  homeAccess(),
  ah(async (req, res) => {
    const { home, auth } = ctx(req);
    const [items, unread] = await Promise.all([
      prisma.notification.findMany({ where: { homeId: home.id, userId: auth.userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.notification.count({ where: { homeId: home.id, userId: auth.userId, readAt: null } }),
    ]);
    res.json({ items: items.map(toNotificationDto), unread });
  }),
);

notificationsRouter.post(
  '/read',
  homeAccess(),
  ah(async (req, res) => {
    const { home, auth } = ctx(req);
    const { ids } = parse(z.object({ ids: z.array(z.string()).max(200).optional() }), req.body ?? {});
    await prisma.notification.updateMany({ where: { homeId: home.id, userId: auth.userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) }, data: { readAt: new Date() } });
    res.json({ ok: true });
  }),
);
