import { Router } from 'express';
import { z } from 'zod';
import type { NetworkDto, SearchResultDto, DeviceCategory, IntegrationType } from '@smartnest/shared';
import { prisma } from '../db.js';
import { badRequest } from '../lib/errors.js';
import { integrations } from '../integrations/manager.js';
import { can, ctx, homeAccess } from '../middleware/auth.js';
import { ah, parse } from '../middleware/http.js';
import { getEnergy } from '../services/energy.js';
import { startOfLocalDay } from '../services/time.js';
import { getNotificationPreferences } from '../services/notifications.js';
import { logger } from '../logger.js';

export const energyRouter = Router({ mergeParams: true });

energyRouter.get(
  '/',
  homeAccess('energy.view'),
  ah(async (req, res) => {
    const { home, auth } = ctx(req);
    const q = parse(z.object({ range: z.enum(['live', 'today', '7d', '30d', 'custom']).default('today'), from: z.string().datetime().optional(), to: z.string().datetime().optional() }), req.query);
    const now = new Date();
    let from: Date;
    let to = now;
    let bucket: 'hour' | 'day' = 'hour';
    switch (q.range) {
      case 'live':
        from = new Date(now.getTime() - 6 * 3600_000);
        break;
      case 'today':
        from = startOfLocalDay(home.timezone, now);
        to = new Date(from.getTime() + 86400_000);
        break;
      case '7d':
        from = new Date(now.getTime() - 7 * 86400_000);
        bucket = 'day';
        break;
      case '30d':
        from = new Date(now.getTime() - 30 * 86400_000);
        bucket = 'day';
        break;
      case 'custom':
        if (!q.from || !q.to) throw badRequest('Custom range needs "from" and "to".');
        from = new Date(q.from);
        to = new Date(q.to);
        if (to <= from) throw badRequest('"to" must be after "from".');
        if (to.getTime() - from.getTime() > 366 * 86400_000) throw badRequest('Custom ranges are limited to one year.');
        bucket = to.getTime() - from.getTime() > 3 * 86400_000 ? 'day' : 'hour';
        break;
    }
    const prefs = await getNotificationPreferences(auth.userId);
    res.json(await getEnergy(home.id, { from, to, bucket }, prefs.energyThresholdW));
  }),
);

export const networkRouter = Router({ mergeParams: true });

/** Network data only comes from integrations that report it; nothing is scanned or inferred. */
networkRouter.get(
  '/',
  homeAccess('network.view'),
  ah(async (req, res) => {
    const { home } = ctx(req);
    const list = await prisma.integration.findMany({ where: { homeId: home.id, NOT: { status: 'disconnected' } } });
    const out: NetworkDto = { available: false, sources: [], routers: [], clients: [], bandwidth: null, guestNetwork: null, health: 'unknown' };
    for (const integ of list) {
      const adapter = integrations.tryGet(integ.id);
      if (!adapter?.getNetworkSnapshot) continue;
      try {
        const snap = await adapter.getNetworkSnapshot();
        if (!snap) continue;
        const devices = await prisma.device.findMany({ where: { integrationId: integ.id }, select: { id: true, externalId: true } });
        const byExt = new Map(devices.map((d) => [d.externalId, d.id]));
        out.available = true;
        out.sources.push({ integrationId: integ.id, integrationName: integ.name, isDemo: integ.isDemo });
        out.routers.push(...snap.routers);
        out.clients.push(...snap.clients.map((c) => ({ ...c, smartHomeDeviceId: c.smartHomeDeviceId ? (byExt.get(c.smartHomeDeviceId) ?? null) : null })));
        out.bandwidth ??= snap.bandwidth;
        out.guestNetwork ??= snap.guestNetwork;
        if (snap.health !== 'unknown') out.health = snap.health;
      } catch (e) {
        logger.warn({ err: (e as Error).message, integration: integ.id }, 'Network snapshot failed');
      }
    }
    res.json(out);
  }),
);

export const searchRouter = Router({ mergeParams: true });

searchRouter.get(
  '/',
  homeAccess(),
  ah(async (req, res) => {
    const { home } = ctx(req);
    const { q } = parse(z.object({ q: z.string().trim().min(1).max(80) }), req.query);
    const contains = { contains: q, mode: 'insensitive' as const };
    const [devices, rooms, scenes, automations, integ, activity] = await Promise.all([
      can(req, 'devices.view') ? prisma.device.findMany({ where: { homeId: home.id, isHidden: false, OR: [{ name: contains }, { manufacturer: contains }] }, include: { room: { select: { name: true } } }, take: 8 }) : [],
      prisma.room.findMany({ where: { homeId: home.id, name: contains }, take: 5 }),
      prisma.scene.findMany({ where: { homeId: home.id, name: contains }, take: 5 }),
      can(req, 'automations.view') ? prisma.automation.findMany({ where: { homeId: home.id, name: contains }, take: 5 }) : [],
      can(req, 'integrations.view') ? prisma.integration.findMany({ where: { homeId: home.id, name: contains }, take: 5 }) : [],
      can(req, 'activity.view') ? prisma.activityEvent.findMany({ where: { homeId: home.id, title: contains }, orderBy: { createdAt: 'desc' }, take: 5 }) : [],
    ]);
    const body: SearchResultDto = {
      devices: devices.map((d) => ({ id: d.id, name: d.name, roomName: d.room?.name ?? null, category: d.category as DeviceCategory })),
      rooms: rooms.map((r) => ({ id: r.id, name: r.name, icon: r.icon })),
      scenes: scenes.map((s) => ({ id: s.id, name: s.name, icon: s.icon })),
      automations: automations.map((a) => ({ id: a.id, name: a.name, enabled: a.enabled })),
      integrations: integ.map((i) => ({ id: i.id, name: i.name, type: i.type as IntegrationType })),
      activity: activity.map((a) => ({ id: a.id, title: a.title, createdAt: a.createdAt.toISOString() })),
    };
    res.json(body);
  }),
);
