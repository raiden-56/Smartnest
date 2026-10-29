import { Router, type Request, type Response } from 'express';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  reauthSchema,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema,
  userPreferencesSchema,
  type SessionDto,
  type UserDto,
} from '@smartnest/shared';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { dummyVerify, hashPassword, randomToken, sha256, verifyPassword } from '../lib/crypto.js';
import { json } from '../lib/dto.js';
import { AppError, conflict, notFound, unauthorized } from '../lib/errors.js';
import { logger } from '../logger.js';
import { requireAuth } from '../middleware/auth.js';
import { ah, authLimiter, parse } from '../middleware/http.js';
import { audit } from '../services/audit.js';

export const authRouter = Router();

const toUserDto = (u: { id: string; name: string; email: string; createdAt: Date }): UserDto => ({ id: u.id, name: u.name, email: u.email, createdAt: u.createdAt.toISOString() });

async function startSession(req: Request, res: Response, userId: string) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + config.sessionTtlMs);
  await prisma.session.create({
    data: { userId, tokenHash: sha256(token), userAgent: req.get('user-agent')?.slice(0, 300) ?? null, ipAddress: req.ip ?? null, expiresAt, reauthAt: new Date() },
  });
  res.cookie(config.sessionCookie, token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

function clearSessionCookie(res: Response) {
  res.clearCookie(config.sessionCookie, { httpOnly: true, secure: config.isProd, sameSite: 'lax', path: '/' });
}

authRouter.post(
  '/register',
  authLimiter,
  ah(async (req, res) => {
    const input = parse(registerSchema, req.body);
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw conflict('An account with this email already exists. Try signing in instead.');
    const user = await prisma.user.create({ data: { email: input.email, name: input.name, passwordHash: await hashPassword(input.password) } });
    await startSession(req, res, user.id);
    await audit({ action: 'auth.register', userId: user.id, ipAddress: req.ip });
    res.status(201).json({ user: toUserDto(user) });
  }),
);

authRouter.post(
  '/login',
  authLimiter,
  ah(async (req, res) => {
    const input = parse(loginSchema, req.body);
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (!user) {
      await dummyVerify(input.password);
      throw new AppError(401, 'invalid_credentials', 'Email or password is incorrect.');
    }
    if (!(await verifyPassword(input.password, user.passwordHash))) {
      await audit({ action: 'auth.login_failed', userId: user.id, ipAddress: req.ip });
      throw new AppError(401, 'invalid_credentials', 'Email or password is incorrect.');
    }
    await startSession(req, res, user.id);
    await audit({ action: 'auth.login', userId: user.id, ipAddress: req.ip });
    res.json({ user: toUserDto(user) });
  }),
);

authRouter.post(
  '/logout',
  ah(async (req, res) => {
    if (req.auth) {
      await prisma.session.deleteMany({ where: { id: req.auth.sessionId } });
      await audit({ action: 'auth.logout', userId: req.auth.userId, ipAddress: req.ip });
    }
    clearSessionCookie(res);
    res.status(204).end();
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  ah(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.auth!.userId } });
    if (!user) throw unauthorized();
    const pref = await prisma.userPreference.findUnique({ where: { userId: user.id } });
    res.json({ user: toUserDto(user), preferences: userPreferencesSchema.parse(pref?.data ?? {}) });
  }),
);

/**
 * Password reset. The response is identical whether or not the email exists.
 * No email channel is configured in this build, so in development the reset
 * link is written to the server log (never in production).
 */
authRouter.post(
  '/forgot-password',
  authLimiter,
  ah(async (req, res) => {
    const { email } = parse(forgotPasswordSchema, req.body);
    const user = await prisma.user.findUnique({ where: { email } });
    if (user) {
      const token = randomToken(32);
      await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 30 * 60_000) } });
      await audit({ action: 'auth.password_reset_requested', userId: user.id, ipAddress: req.ip });
      if (!config.isProd) {
        logger.warn(`[dev only] Password reset link for ${email}: ${config.publicAppUrl}/reset-password?token=${token}`);
      }
      if (config.isTest) res.setHeader('x-test-reset-token', token);
    }
    res.json({ ok: true, message: 'If an account exists for that email, a reset link has been sent.' });
  }),
);

authRouter.post(
  '/reset-password',
  authLimiter,
  ah(async (req, res) => {
    const input = parse(resetPasswordSchema, req.body);
    const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(input.token) } });
    if (!record || record.usedAt || record.expiresAt < new Date()) throw new AppError(400, 'invalid_token', 'This reset link is invalid or has expired. Request a new one.');
    await prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { passwordHash: await hashPassword(input.password), passwordChangedAt: new Date() } }),
      prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      prisma.session.deleteMany({ where: { userId: record.userId } }), // sign out everywhere
    ]);
    await audit({ action: 'auth.password_reset', userId: record.userId, ipAddress: req.ip });
    res.json({ ok: true });
  }),
);

/** Re-enter password to unlock sensitive operations for a few minutes. */
authRouter.post(
  '/reauth',
  requireAuth,
  authLimiter,
  ah(async (req, res) => {
    const { password } = parse(reauthSchema, req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
    if (!(await verifyPassword(password, user.passwordHash))) throw new AppError(401, 'invalid_credentials', 'Password is incorrect.');
    await prisma.session.update({ where: { id: req.auth!.sessionId }, data: { reauthAt: new Date() } });
    res.json({ ok: true, validForSeconds: config.reauthWindowMs / 1000 });
  }),
);

authRouter.patch(
  '/profile',
  requireAuth,
  ah(async (req, res) => {
    const input = parse(updateProfileSchema, req.body);
    const user = await prisma.user.update({ where: { id: req.auth!.userId }, data: { name: input.name } });
    res.json({ user: toUserDto(user) });
  }),
);

authRouter.post(
  '/change-password',
  requireAuth,
  authLimiter,
  ah(async (req, res) => {
    const input = parse(changePasswordSchema, req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) throw new AppError(400, 'invalid_credentials', 'Current password is incorrect.');
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(input.newPassword), passwordChangedAt: new Date() } });
    await prisma.session.deleteMany({ where: { userId: user.id, NOT: { id: req.auth!.sessionId } } });
    await audit({ action: 'auth.password_changed', userId: user.id, ipAddress: req.ip });
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/sessions',
  requireAuth,
  ah(async (req, res) => {
    const sessions = await prisma.session.findMany({ where: { userId: req.auth!.userId, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: 'desc' } });
    const out: SessionDto[] = sessions.map((s) => ({
      id: s.id,
      current: s.id === req.auth!.sessionId,
      userAgent: s.userAgent,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
    }));
    res.json({ sessions: out });
  }),
);

authRouter.delete(
  '/sessions/:id',
  requireAuth,
  ah(async (req, res) => {
    const r = await prisma.session.deleteMany({ where: { id: req.params.id, userId: req.auth!.userId } });
    if (!r.count) throw notFound('Session');
    await audit({ action: 'auth.session_revoked', userId: req.auth!.userId, targetType: 'session', targetId: req.params.id, ipAddress: req.ip });
    if (req.params.id === req.auth!.sessionId) clearSessionCookie(res);
    res.status(204).end();
  }),
);

authRouter.put(
  '/preferences',
  requireAuth,
  ah(async (req, res) => {
    const prefs = parse(userPreferencesSchema, req.body);
    await prisma.userPreference.upsert({ where: { userId: req.auth!.userId }, create: { userId: req.auth!.userId, data: json(prefs) }, update: { data: json(prefs) } });
    res.json({ preferences: prefs });
  }),
);
