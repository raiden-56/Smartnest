import { Router, type Request, type Response } from 'express';
import type { CameraDto } from '@smartnest/shared';
import { prisma } from '../db.js';
import { signStreamToken, verifyStreamToken } from '../lib/crypto.js';
import { deviceInclude, parseCapabilities, toDeviceDto } from '../lib/dto.js';
import { AppError, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { integrations } from '../integrations/manager.js';
import { ctx, homeAccess } from '../middleware/auth.js';
import { ah } from '../middleware/http.js';
import { audit } from '../services/audit.js';
import { pushRealtime } from '../services/bus.js';
import { roleHasPermission, type HomeRole } from '@smartnest/shared';

export const camerasRouter = Router({ mergeParams: true });

/** Active stream/snapshot viewers per camera device, for the privacy indicator. */
const viewers = new Map<string, Map<string, number>>();
const VIEW_TTL_MS = 20_000;
/** Audit camera viewing once per user+camera per window, not on every token renewal. */
const AUDIT_WINDOW_MS = 10 * 60_000;
const lastAudited = new Map<string, number>();

function touchViewer(homeId: string, deviceId: string, userId: string) {
  const m = viewers.get(deviceId) ?? new Map<string, number>();
  const before = activeCount(deviceId);
  m.set(userId, Date.now());
  viewers.set(deviceId, m);
  const after = activeCount(deviceId);
  if (before !== after) pushRealtime({ type: 'camera.viewers', homeId, deviceId, activeViewers: after });
}
function activeCount(deviceId: string): number {
  const m = viewers.get(deviceId);
  if (!m) return 0;
  for (const [u, t] of m) if (Date.now() - t > VIEW_TTL_MS) m.delete(u);
  return m.size;
}

async function loadCamera(homeId: string, deviceId: string) {
  const d = await prisma.device.findFirst({ where: { id: deviceId, homeId, capabilities: { some: { type: 'cameraStream' } } }, include: deviceInclude });
  if (!d) throw notFound('Camera');
  return d;
}

camerasRouter.get(
  '/',
  homeAccess('cameras.view'),
  ah(async (req, res) => {
    const { home } = ctx(req);
    const devices = await prisma.device.findMany({ where: { homeId: home.id, capabilities: { some: { type: 'cameraStream' } } }, include: deviceInclude, orderBy: { name: 'asc' } });
    const events = await prisma.activityEvent.findMany({
      where: { homeId: home.id, deviceId: { in: devices.map((d) => d.id) }, type: { in: ['camera.event', 'security.event', 'device.connectivity'] } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const cameras: CameraDto[] = devices.map((d) => {
      const cap = parseCapabilities(d.capabilities).find((c) => c.type === 'cameraStream') as { live: boolean; snapshot: boolean };
      return {
        device: toDeviceDto(d),
        live: cap.live,
        snapshot: cap.snapshot,
        isDemo: d.integration.isDemo,
        activeViewers: activeCount(d.id),
        lastFrameAt: d.lastSeenAt?.toISOString() ?? null,
        events: events.filter((e) => e.deviceId === d.id).slice(0, 10).map((e) => ({ id: e.id, title: e.title, createdAt: e.createdAt.toISOString() })),
      };
    });
    res.json({ cameras });
  }),
);

/** Issue a 60-second signed token for one camera. Media URLs never contain integration credentials. */
camerasRouter.post(
  '/:deviceId/token',
  homeAccess('cameras.view'),
  ah(async (req, res) => {
    const { home, auth } = ctx(req);
    const d = await loadCamera(home.id, req.params.deviceId!);
    const token = signStreamToken({ userId: auth.userId, deviceId: d.id, homeId: home.id }, 60);
    const auditKey = `${auth.userId}:${d.id}`;
    if (Date.now() - (lastAudited.get(auditKey) ?? 0) > AUDIT_WINDOW_MS) {
      lastAudited.set(auditKey, Date.now());
      await audit({ action: 'camera.view', userId: auth.userId, homeId: home.id, targetType: 'device', targetId: d.id, ipAddress: req.ip });
    }
    const base = `/api/homes/${home.id}/cameras/${d.id}`;
    res.json({ snapshotUrl: `${base}/snapshot?token=${encodeURIComponent(token)}`, streamUrl: `${base}/stream?token=${encodeURIComponent(token)}`, expiresIn: 60 });
  }),
);

/**
 * Media endpoints require BOTH a valid session cookie and a matching signed
 * token, and re-check camera permission on every request.
 */
async function authorizeMedia(req: Request): Promise<{ homeId: string; deviceId: string; userId: string }> {
  if (!req.auth) throw unauthorized();
  const claims = verifyStreamToken(String(req.query.token ?? ''));
  if (!claims || claims.userId !== req.auth.userId || claims.deviceId !== req.params.deviceId || claims.homeId !== req.params.homeId) {
    throw new AppError(403, 'invalid_stream_token', 'Camera link expired. Reload the camera view.');
  }
  const m = await prisma.homeMembership.findUnique({ where: { homeId_userId: { homeId: claims.homeId, userId: claims.userId } } });
  if (!m || !roleHasPermission(m.role as HomeRole, 'cameras.view')) throw forbidden();
  return claims;
}

camerasRouter.get(
  '/:deviceId/snapshot',
  ah(async (req: Request, res: Response) => {
    const claims = await authorizeMedia(req);
    const d = await loadCamera(claims.homeId, claims.deviceId);
    const adapter = integrations.tryGet(d.integrationId);
    if (!adapter?.getCameraSnapshot) throw new AppError(503, 'stream_unavailable', 'This camera\'s integration is not connected.');
    try {
      const media = await adapter.getCameraSnapshot(d.externalId);
      touchViewer(claims.homeId, d.id, claims.userId);
      res.setHeader('Content-Type', media.contentType);
      res.setHeader('Cache-Control', 'no-store, private');
      res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (d.integration.isDemo) res.setHeader('X-SmartNest-Demo', 'true');
      media.stream.pipe(res);
    } catch (e) {
      throw new AppError(503, 'stream_unavailable', (e as Error).message || 'Camera image could not be loaded.');
    }
  }),
);

camerasRouter.get(
  '/:deviceId/stream',
  ah(async (req: Request, res: Response) => {
    const claims = await authorizeMedia(req);
    const d = await loadCamera(claims.homeId, claims.deviceId);
    const cap = parseCapabilities(d.capabilities).find((c) => c.type === 'cameraStream') as { live: boolean } | undefined;
    const adapter = integrations.tryGet(d.integrationId);
    if (!cap?.live || !adapter?.openCameraStream) throw new AppError(501, 'stream_unsupported', 'This camera does not provide a live stream through its integration.');
    const abort = new AbortController();
    req.on('close', () => abort.abort());
    try {
      const media = await adapter.openCameraStream(d.externalId, abort.signal);
      res.setHeader('Content-Type', media.contentType);
      res.setHeader('Cache-Control', 'no-store, private');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const heartbeat = setInterval(() => touchViewer(claims.homeId, d.id, claims.userId), 10_000);
      touchViewer(claims.homeId, d.id, claims.userId);
      media.stream.on('error', () => res.end());
      media.stream.pipe(res);
      res.on('close', () => {
        clearInterval(heartbeat);
        media.stream.destroy();
      });
    } catch (e) {
      throw new AppError(503, 'stream_unavailable', (e as Error).message || 'Live stream could not be opened.');
    }
  }),
);
