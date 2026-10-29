import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { roleHasPermission, type HomeRole, type Permission } from '@smartnest/shared';
import type { Home } from '@prisma/client';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { sha256 } from '../lib/crypto.js';
import { forbidden, notFound, reauthRequired, unauthorized } from '../lib/errors.js';

export interface AuthContext {
  userId: string;
  sessionId: string;
  name: string;
  email: string;
  reauthAt: Date | null;
}

export interface HomeContext {
  home: Home;
  role: HomeRole;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
      homeCtx?: HomeContext;
    }
  }
}

/** Resolve a session token (cookie value) to an active session. Shared with the WebSocket hub. */
export async function resolveSession(token: string | undefined) {
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!session || session.expiresAt < new Date()) return null;
  return session;
}

/** Populate req.auth when a valid session cookie is present. */
export const loadSession: RequestHandler = async (req, _res, next) => {
  try {
    const session = await resolveSession(req.cookies?.[config.sessionCookie]);
    if (session) {
      req.auth = { userId: session.userId, sessionId: session.id, name: session.user.name, email: session.user.email, reauthAt: session.reauthAt };
      if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
        void prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
      }
    }
    next();
  } catch (e) {
    next(e);
  }
};

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(unauthorized());
  next();
};

/**
 * Load the caller's membership for `:homeId`. Non-members get 404 (not 403) so
 * the existence of other people's homes is not revealed.
 */
export function homeAccess(permission: Permission = 'home.view'): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.auth) return next(unauthorized());
      const homeId = req.params.homeId;
      if (!homeId) return next(notFound('Home'));
      const membership = await prisma.homeMembership.findUnique({
        where: { homeId_userId: { homeId, userId: req.auth.userId } },
        include: { home: true },
      });
      if (!membership) return next(notFound('Home'));
      const role = membership.role as HomeRole;
      if (!roleHasPermission(role, permission)) return next(forbidden());
      req.homeCtx = { home: membership.home, role };
      next();
    } catch (e) {
      next(e);
    }
  };
}

export function assertPermission(req: Request, permission: Permission): void {
  if (!req.homeCtx || !roleHasPermission(req.homeCtx.role, permission)) throw forbidden();
}

export function can(req: Request, permission: Permission): boolean {
  return !!req.homeCtx && roleHasPermission(req.homeCtx.role, permission);
}

/** Destructive account/home operations require password re-entry within the last few minutes. */
export function assertRecentReauth(req: Request): void {
  const at = req.auth?.reauthAt;
  if (!at || Date.now() - at.getTime() > config.reauthWindowMs) throw reauthRequired();
}

export function ctx(req: Request): { auth: AuthContext; home: Home; role: HomeRole } {
  if (!req.auth || !req.homeCtx) throw unauthorized();
  return { auth: req.auth, home: req.homeCtx.home, role: req.homeCtx.role };
}
