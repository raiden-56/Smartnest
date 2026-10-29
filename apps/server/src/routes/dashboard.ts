import { Router } from 'express';
import { dashboardLayoutSchema, defaultDashboardLayout, validateDashboardLayout, type DashboardDto, type DashboardWidget } from '@smartnest/shared';
import { prisma } from '../db.js';
import { json } from '../lib/dto.js';
import { AppError } from '../lib/errors.js';
import { ctx, homeAccess } from '../middleware/auth.js';
import { ah, parse } from '../middleware/http.js';

/** Dashboard layouts are stored per user and per home. */
export const dashboardRouter = Router({ mergeParams: true });

dashboardRouter.get(
  '/',
  homeAccess(),
  ah(async (req, res) => {
    const { home, auth } = ctx(req);
    const layout = await prisma.dashboardLayout.findUnique({ where: { userId_homeId: { userId: auth.userId, homeId: home.id } }, include: { widgets: true } });
    const body: DashboardDto = layout
      ? {
          isDefault: false,
          widgets: layout.widgets.map((w) => ({ id: w.widgetKey, type: w.type as DashboardWidget['type'], x: w.x, y: w.y, w: w.w, h: w.h, hidden: w.hidden, config: w.config as DashboardWidget['config'] })),
        }
      : { isDefault: true, widgets: defaultDashboardLayout() };
    res.json(body);
  }),
);

dashboardRouter.put(
  '/',
  homeAccess(),
  ah(async (req, res) => {
    const { home, auth } = ctx(req);
    const { widgets } = parse(dashboardLayoutSchema, req.body);
    const issues = validateDashboardLayout(widgets);
    if (issues.length) throw new AppError(400, 'invalid_layout', issues[0]!.message, { issues });
    await prisma.$transaction(async (tx) => {
      const layout = await tx.dashboardLayout.upsert({
        where: { userId_homeId: { userId: auth.userId, homeId: home.id } },
        create: { userId: auth.userId, homeId: home.id },
        update: {},
      });
      await tx.dashboardWidget.deleteMany({ where: { layoutId: layout.id } });
      await tx.dashboardWidget.createMany({
        data: widgets.map((w) => ({ layoutId: layout.id, widgetKey: w.id, type: w.type, x: w.x, y: w.y, w: w.w, h: w.h, hidden: w.hidden, config: json(w.config) })),
      });
    });
    res.json({ isDefault: false, widgets } satisfies DashboardDto);
  }),
);

dashboardRouter.delete(
  '/',
  homeAccess(),
  ah(async (req, res) => {
    const { home, auth } = ctx(req);
    await prisma.dashboardLayout.deleteMany({ where: { userId: auth.userId, homeId: home.id } });
    res.json({ isDefault: true, widgets: defaultDashboardLayout() } satisfies DashboardDto);
  }),
);
