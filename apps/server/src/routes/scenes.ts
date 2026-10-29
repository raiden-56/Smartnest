import { Router } from 'express';
import { z } from 'zod';
import { roleHasPermission, sceneInputSchema, type SceneInput } from '@smartnest/shared';
import { prisma } from '../db.js';
import { toSceneExecutionDto } from '../lib/dto.js';
import { notFound } from '../lib/errors.js';
import { ctx, homeAccess } from '../middleware/auth.js';
import { ah, commandLimiter, parse } from '../middleware/http.js';
import { audit } from '../services/audit.js';
import { activateScene, saveScene, sceneInclude, toSceneDto } from '../services/scenes.js';

export const scenesRouter = Router({ mergeParams: true });

scenesRouter.get(
  '/',
  homeAccess(),
  ah(async (req, res) => {
    const { home } = ctx(req);
    const scenes = await prisma.scene.findMany({ where: { homeId: home.id }, include: sceneInclude, orderBy: [{ isFavourite: 'desc' }, { name: 'asc' }] });
    res.json({ scenes: scenes.map(toSceneDto) });
  }),
);

scenesRouter.get(
  '/:sceneId',
  homeAccess(),
  ah(async (req, res) => {
    const { home } = ctx(req);
    const s = await prisma.scene.findFirst({ where: { id: req.params.sceneId, homeId: home.id }, include: sceneInclude });
    if (!s) throw notFound('Scene');
    res.json({ scene: toSceneDto(s) });
  }),
);

scenesRouter.post(
  '/',
  homeAccess('scenes.manage'),
  ah(async (req, res) => {
    const { home, auth } = ctx(req);
    const input = parse(sceneInputSchema, req.body);
    const scene = await saveScene(home.id, input, auth.userId);
    await audit({ action: 'scene.created', userId: auth.userId, homeId: home.id, targetType: 'scene', targetId: scene.id, metadata: { sensitive: input.allowSensitiveActions } });
    res.status(201).json({ scene: toSceneDto(scene) });
  }),
);

scenesRouter.put(
  '/:sceneId',
  homeAccess('scenes.manage'),
  ah(async (req, res) => {
    const { home, auth } = ctx(req);
    const existing = await prisma.scene.findFirst({ where: { id: req.params.sceneId, homeId: home.id } });
    if (!existing) throw notFound('Scene');
    const input = parse(sceneInputSchema, req.body);
    const scene = await saveScene(home.id, input, auth.userId, existing.id);
    res.json({ scene: toSceneDto(scene) });
  }),
);

scenesRouter.patch(
  '/:sceneId',
  homeAccess('scenes.manage'),
  ah(async (req, res) => {
    const { home } = ctx(req);
    const { isFavourite } = parse(z.object({ isFavourite: z.boolean() }), req.body);
    const existing = await prisma.scene.findFirst({ where: { id: req.params.sceneId, homeId: home.id } });
    if (!existing) throw notFound('Scene');
    const s = await prisma.scene.update({ where: { id: existing.id }, data: { isFavourite }, include: sceneInclude });
    res.json({ scene: toSceneDto(s) });
  }),
);

scenesRouter.post(
  '/:sceneId/duplicate',
  homeAccess('scenes.manage'),
  ah(async (req, res) => {
    const { home, auth } = ctx(req);
    const s = await prisma.scene.findFirst({ where: { id: req.params.sceneId, homeId: home.id }, include: sceneInclude });
    if (!s) throw notFound('Scene');
    const dto = toSceneDto(s);
    const input: SceneInput = {
      name: `${s.name} (copy)`.slice(0, 60),
      icon: s.icon,
      description: s.description,
      roomId: s.roomId,
      executionMode: dto.executionMode,
      isFavourite: false,
      allowSensitiveActions: s.allowSensitiveActions,
      actions: dto.actions.map((a) => ({ deviceId: a.deviceId, command: a.command, order: a.order })),
    };
    const copy = await saveScene(home.id, input, auth.userId);
    res.status(201).json({ scene: toSceneDto(copy) });
  }),
);

scenesRouter.delete(
  '/:sceneId',
  homeAccess('scenes.manage'),
  ah(async (req, res) => {
    const { home, auth } = ctx(req);
    const r = await prisma.scene.deleteMany({ where: { id: req.params.sceneId, homeId: home.id } });
    if (!r.count) throw notFound('Scene');
    await audit({ action: 'scene.deleted', userId: auth.userId, homeId: home.id, targetType: 'scene', targetId: req.params.sceneId });
    res.status(204).end();
  }),
);

scenesRouter.post(
  '/:sceneId/activate',
  homeAccess('scenes.activate'),
  commandLimiter,
  ah(async (req, res) => {
    const { home, auth, role } = ctx(req);
    const { confirmed } = parse(z.object({ confirmed: z.boolean().optional() }), req.body ?? {});
    const { execution } = await activateScene({
      homeId: home.id,
      sceneId: req.params.sceneId!,
      userId: auth.userId,
      actorName: auth.name,
      source: 'user',
      confirmed,
      canControlSensitive: roleHasPermission(role, 'devices.control.sensitive'),
      ipAddress: req.ip,
    });
    res.status(202).json({ execution });
  }),
);

scenesRouter.get(
  '/:sceneId/executions',
  homeAccess(),
  ah(async (req, res) => {
    const { home } = ctx(req);
    const s = await prisma.scene.findFirst({ where: { id: req.params.sceneId, homeId: home.id } });
    if (!s) throw notFound('Scene');
    const ex = await prisma.sceneExecution.findMany({ where: { sceneId: s.id }, orderBy: { startedAt: 'desc' }, take: 20 });
    res.json({ executions: ex.map(toSceneExecutionDto) });
  }),
);
