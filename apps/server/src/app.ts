import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { config } from './config.js';
import { prisma } from './db.js';
import { logger } from './logger.js';
import { loadSession } from './middleware/auth.js';
import { apiLimiter, errorHandler, notFoundHandler, requireCsrfHeader } from './middleware/http.js';
import { activityRouter, notificationsRouter } from './routes/activity.js';
import { authRouter } from './routes/auth.js';
import { automationsRouter } from './routes/automations.js';
import { camerasRouter } from './routes/cameras.js';
import { dashboardRouter } from './routes/dashboard.js';
import { commandsRouter, devicesRouter } from './routes/devices.js';
import { homesRouter, invitationsRouter } from './routes/homes.js';
import { catalogueRouter, integrationsRouter } from './routes/integrations.js';
import { energyRouter, networkRouter, searchRouter } from './routes/monitoring.js';
import { roomsRouter } from './routes/rooms.js';
import { scenesRouter } from './routes/scenes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.isProd ? 1 : false);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          styleSrc: ["'self'", "'unsafe-inline'"], // MUI/emotion injects style tags
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-origin' },
    }),
  );
  app.use(cors({ origin: config.webOrigins, credentials: true, allowedHeaders: ['Content-Type', 'X-SmartNest-CSRF'] }));
  if (!config.isTest) {
    app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' }, serializers: { req: (r) => ({ method: r.method, url: (r.url as string).replace(/token=[^&]+/, 'token=[redacted]') }), res: (r) => ({ statusCode: r.statusCode }) } }));
  }
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  const api = Router();
  api.get('/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', db: 'ok', time: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'degraded', db: 'unreachable' });
    }
  });
  api.use(apiLimiter, loadSession, requireCsrfHeader);
  api.use('/auth', authRouter);
  api.use('/catalogue', catalogueRouter);
  api.use('/invitations', invitationsRouter);
  api.use('/homes', homesRouter);
  const home = '/homes/:homeId';
  api.use(`${home}/rooms`, roomsRouter);
  api.use(`${home}/devices`, devicesRouter);
  api.use(`${home}/commands`, commandsRouter);
  api.use(`${home}/integrations`, integrationsRouter);
  api.use(`${home}/cameras`, camerasRouter);
  api.use(`${home}/scenes`, scenesRouter);
  api.use(`${home}/automations`, automationsRouter);
  api.use(`${home}/activity`, activityRouter);
  api.use(`${home}/notifications`, notificationsRouter);
  api.use(`${home}/dashboard`, dashboardRouter);
  api.use(`${home}/energy`, energyRouter);
  api.use(`${home}/network`, networkRouter);
  api.use(`${home}/search`, searchRouter);
  api.use(notFoundHandler);
  app.use('/api', api);

  // Production: serve the built web app with SPA fallback
  const staticDir = process.env.STATIC_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (config.isProd && existsSync(staticDir)) {
    app.use(express.static(staticDir, { index: false, maxAge: '7d', immutable: true }));
    app.get('*', (_req, res) => res.sendFile(path.join(staticDir, 'index.html'), { headers: { 'Cache-Control': 'no-cache' } }));
  }

  app.use(errorHandler);
  return app;
}
