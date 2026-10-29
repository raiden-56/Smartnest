import { Router } from 'express';
import { z } from 'zod';
import {
  canManageRole,
  homeInputSchema,
  homeUpdateSchema,
  inviteSchema,
  updateMemberSchema,
  type AuditLogDto,
  type HomeRole,
  type HomeSummaryDto,
  type InvitationDto,
  type MemberDto,
} from '@smartnest/shared';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { toHomeDto } from '../lib/dto.js';
import { AppError, badRequest, forbidden, notFound } from '../lib/errors.js';
import { integrations } from '../integrations/manager.js';
import { assertPermission, assertRecentReauth, ctx, homeAccess, requireAuth } from '../middleware/auth.js';
import { ah, parse } from '../middleware/http.js';
import { recordActivity } from '../services/activity.js';
import { audit } from '../services/audit.js';
import { pushRealtime } from '../services/bus.js';
import { setupDemoHome } from '../services/demoSetup.js';
import { isValidTimezone } from '../services/time.js';

export const homesRouter = Router();
homesRouter.use(requireAuth);

homesRouter.get(
  '/',
  ah(async (req, res) => {
    const memberships = await prisma.homeMembership.findMany({ where: { userId: req.auth!.userId }, include: { home: true }, orderBy: { createdAt: 'asc' } });
    const homes: HomeSummaryDto[] = memberships.map((m) => ({ id: m.home.id, name: m.home.name, role: m.role as HomeRole, isDemo: m.home.isDemo, timezone: m.home.timezone }));
    res.json({ homes });
  }),
);

homesRouter.post(
  '/',
  ah(async (req, res) => {
    const input = parse(homeInputSchema, req.body);
    if (!isValidTimezone(input.timezone)) throw badRequest('Unknown timezone.');
    const home = await prisma.home.create({
      data: { ...input, memberships: { create: { userId: req.auth!.userId, role: 'owner' } } },
    });
    await audit({ action: 'home.created', userId: req.auth!.userId, homeId: home.id, ipAddress: req.ip });
    res.status(201).json({ home: toHomeDto(home, 'owner') });
  }),
);

/** Create a separate, clearly labelled demonstration home populated with simulated devices. */
homesRouter.post(
  '/demo',
  ah(async (req, res) => {
    const timezone = typeof req.body?.timezone === 'string' && isValidTimezone(req.body.timezone) ? req.body.timezone : 'Europe/London';
    const home = await prisma.home.create({
      data: { name: 'Demo Home', timezone, isDemo: true, latitude: 51.5074, longitude: -0.1278, currency: 'GBP', tariffPerKWh: 0.245, memberships: { create: { userId: req.auth!.userId, role: 'owner' } } },
    });
    await setupDemoHome(home.id, req.auth!.userId);
    await prisma.home.update({ where: { id: home.id }, data: { onboardingCompleted: true } });
    await audit({ action: 'home.demo_created', userId: req.auth!.userId, homeId: home.id, ipAddress: req.ip });
    res.status(201).json({ home: toHomeDto({ ...home, onboardingCompleted: true }, 'owner') });
  }),
);

homesRouter.get(
  '/:homeId',
  homeAccess(),
  ah(async (req, res) => {
    const { home, role } = ctx(req);
    res.json({ home: toHomeDto(home, role) });
  }),
);

homesRouter.patch(
  '/:homeId',
  homeAccess('home.manage'),
  ah(async (req, res) => {
    const { home, role, auth } = ctx(req);
    const input = parse(homeUpdateSchema, req.body);
    if (input.timezone && !isValidTimezone(input.timezone)) throw badRequest('Unknown timezone.');
    const { retentionDays, ...rest } = input;
    const updated = await prisma.home.update({
      where: { id: home.id },
      data: {
        ...rest,
        ...(retentionDays?.activity ? { retentionActivityDays: retentionDays.activity } : {}),
        ...(retentionDays?.stateSnapshots ? { retentionSnapshotDays: retentionDays.stateSnapshots } : {}),
        ...(retentionDays?.cameraEvents ? { retentionCameraDays: retentionDays.cameraEvents } : {}),
      },
    });
    await audit({ action: 'home.updated', userId: auth.userId, homeId: home.id, metadata: { fields: Object.keys(input) }, ipAddress: req.ip });
    pushRealtime({ type: 'home.changed', homeId: home.id });
    res.json({ home: toHomeDto(updated, role) });
  }),
);

homesRouter.post(
  '/:homeId/onboarding-complete',
  homeAccess('home.manage'),
  ah(async (req, res) => {
    const { home, role } = ctx(req);
    const updated = await prisma.home.update({ where: { id: home.id }, data: { onboardingCompleted: true } });
    res.json({ home: toHomeDto(updated, role) });
  }),
);

/** Add the demonstration integration to an existing home (devices are labelled demo). */
homesRouter.post(
  '/:homeId/demo-integration',
  homeAccess('integrations.manage'),
  ah(async (req, res) => {
    const { home, auth } = ctx(req);
    await setupDemoHome(home.id, auth.userId);
    pushRealtime({ type: 'home.changed', homeId: home.id });
    res.status(201).json({ ok: true });
  }),
);

homesRouter.delete(
  '/:homeId',
  homeAccess('home.delete'),
  ah(async (req, res) => {
    const { home, auth } = ctx(req);
    assertRecentReauth(req);
    const integ = await prisma.integration.findMany({ where: { homeId: home.id }, select: { id: true } });
    for (const i of integ) await integrations.stop(i.id);
    await prisma.home.delete({ where: { id: home.id } });
    await audit({ action: 'home.deleted', userId: auth.userId, metadata: { homeId: home.id, name: home.name }, ipAddress: req.ip });
    res.status(204).end();
  }),
);

/** Delete stored history (activity, state snapshots, energy, commands, notifications) while keeping configuration. */
homesRouter.post(
  '/:homeId/delete-data',
  homeAccess('data.delete'),
  ah(async (req, res) => {
    const { home, auth } = ctx(req);
    assertRecentReauth(req);
    const scope = parse(z.object({ activity: z.boolean(), history: z.boolean(), energy: z.boolean(), commands: z.boolean(), notifications: z.boolean() }).partial(), req.body);
    const homeId = home.id;
    const deleted: Record<string, number> = {};
    if (scope.activity) deleted.activity = (await prisma.activityEvent.deleteMany({ where: { homeId } })).count;
    if (scope.history) deleted.history = (await prisma.deviceStateSnapshot.deleteMany({ where: { homeId } })).count;
    if (scope.energy) deleted.energy = (await prisma.energyReading.deleteMany({ where: { homeId } })).count;
    if (scope.commands) {
      deleted.commands = (await prisma.deviceCommand.deleteMany({ where: { homeId } })).count;
      deleted.automationRuns = (await prisma.automationExecution.deleteMany({ where: { homeId } })).count;
      deleted.sceneRuns = (await prisma.sceneExecution.deleteMany({ where: { homeId } })).count;
    }
    if (scope.notifications) deleted.notifications = (await prisma.notification.deleteMany({ where: { homeId } })).count;
    await audit({ action: 'home.data_deleted', userId: auth.userId, homeId, metadata: deleted, ipAddress: req.ip });
    pushRealtime({ type: 'home.changed', homeId });
    res.json({ deleted });
  }),
);

// ─── Members ──────────────────────────────────────────────────────────────

homesRouter.get(
  '/:homeId/members',
  homeAccess('members.view'),
  ah(async (req, res) => {
    const { home } = ctx(req);
    const members = await prisma.homeMembership.findMany({ where: { homeId: home.id }, include: { user: true }, orderBy: { createdAt: 'asc' } });
    const out: MemberDto[] = members.map((m) => ({ id: m.id, userId: m.userId, name: m.user.name, email: m.user.email, role: m.role as HomeRole, joinedAt: m.createdAt.toISOString() }));
    res.json({ members: out });
  }),
);

homesRouter.patch(
  '/:homeId/members/:memberId',
  homeAccess('members.manage'),
  ah(async (req, res) => {
    const { home, role, auth } = ctx(req);
    const { role: newRole } = parse(updateMemberSchema, req.body);
    const member = await prisma.homeMembership.findFirst({ where: { id: req.params.memberId, homeId: home.id } });
    if (!member) throw notFound('Member');
    if (member.userId === auth.userId) throw badRequest('You cannot change your own role.');
    if (!canManageRole(role, newRole, member.role as HomeRole)) throw forbidden('Your role cannot assign that role.');
    if (member.role === 'owner' && newRole !== 'owner') {
      const owners = await prisma.homeMembership.count({ where: { homeId: home.id, role: 'owner' } });
      if (owners <= 1) throw badRequest('A home must keep at least one owner.');
    }
    await prisma.homeMembership.update({ where: { id: member.id }, data: { role: newRole } });
    await audit({ action: 'member.role_changed', userId: auth.userId, homeId: home.id, targetType: 'user', targetId: member.userId, metadata: { from: member.role, to: newRole }, ipAddress: req.ip });
    pushRealtime({ type: 'home.changed', homeId: home.id });
    res.json({ ok: true });
  }),
);

homesRouter.delete(
  '/:homeId/members/:memberId',
  homeAccess(),
  ah(async (req, res) => {
    const { home, role, auth } = ctx(req);
    const member = await prisma.homeMembership.findFirst({ where: { id: req.params.memberId, homeId: home.id }, include: { user: true } });
    if (!member) throw notFound('Member');
    const leaving = member.userId === auth.userId;
    if (!leaving) {
      assertPermission(req, 'members.manage');
      if (!canManageRole(role, member.role as HomeRole, member.role as HomeRole)) throw forbidden('Your role cannot remove this member.');
    }
    if (member.role === 'owner') {
      const owners = await prisma.homeMembership.count({ where: { homeId: home.id, role: 'owner' } });
      if (owners <= 1) throw badRequest('Transfer ownership before the last owner leaves.');
    }
    await prisma.homeMembership.delete({ where: { id: member.id } });
    await prisma.dashboardLayout.deleteMany({ where: { homeId: home.id, userId: member.userId } });
    await audit({ action: leaving ? 'member.left' : 'member.removed', userId: auth.userId, homeId: home.id, targetType: 'user', targetId: member.userId, ipAddress: req.ip });
    await recordActivity({ homeId: home.id, type: 'home.member', title: leaving ? `${member.user.name} left the home` : `${member.user.name} was removed`, source: 'user', actorUserId: auth.userId, actorName: auth.name });
    pushRealtime({ type: 'home.changed', homeId: home.id });
    res.status(204).end();
  }),
);

// ─── Invitations ──────────────────────────────────────────────────────────

homesRouter.get(
  '/:homeId/invitations',
  homeAccess('members.manage'),
  ah(async (req, res) => {
    const { home } = ctx(req);
    const invites = await prisma.invitation.findMany({ where: { homeId: home.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
    const out: InvitationDto[] = invites.map((i) => ({ id: i.id, email: i.email, role: i.role as HomeRole, expiresAt: i.expiresAt.toISOString(), createdAt: i.createdAt.toISOString() }));
    res.json({ invitations: out });
  }),
);

homesRouter.post(
  '/:homeId/invitations',
  homeAccess('members.manage'),
  ah(async (req, res) => {
    const { home, role, auth } = ctx(req);
    const input = parse(inviteSchema, req.body);
    if (!canManageRole(role, input.role)) throw forbidden('Your role cannot invite members with that role.');
    const existingMember = await prisma.homeMembership.findFirst({ where: { homeId: home.id, user: { email: input.email } } });
    if (existingMember) throw badRequest('That person is already a member of this home.');
    const token = randomToken(24);
    const invite = await prisma.invitation.create({
      data: { homeId: home.id, email: input.email, role: input.role, tokenHash: sha256(token), invitedById: auth.userId, expiresAt: new Date(Date.now() + 7 * 86400_000) },
    });
    await audit({ action: 'member.invited', userId: auth.userId, homeId: home.id, metadata: { email: input.email, role: input.role }, ipAddress: req.ip });
    // No email channel is configured: return the link once so the inviter can share it securely.
    const out: InvitationDto = {
      id: invite.id,
      email: invite.email,
      role: invite.role as HomeRole,
      expiresAt: invite.expiresAt.toISOString(),
      createdAt: invite.createdAt.toISOString(),
      inviteUrl: `${config.publicAppUrl}/invite?token=${token}`,
    };
    res.status(201).json({ invitation: out });
  }),
);

homesRouter.delete(
  '/:homeId/invitations/:inviteId',
  homeAccess('members.manage'),
  ah(async (req, res) => {
    const { home, auth } = ctx(req);
    const r = await prisma.invitation.updateMany({ where: { id: req.params.inviteId, homeId: home.id, acceptedAt: null }, data: { revokedAt: new Date() } });
    if (!r.count) throw notFound('Invitation');
    await audit({ action: 'member.invite_revoked', userId: auth.userId, homeId: home.id, targetId: req.params.inviteId, ipAddress: req.ip });
    res.status(204).end();
  }),
);

// ─── Audit log ────────────────────────────────────────────────────────────

homesRouter.get(
  '/:homeId/audit',
  homeAccess('audit.view'),
  ah(async (req, res) => {
    const { home } = ctx(req);
    const logs = await prisma.auditLog.findMany({ where: { homeId: home.id }, include: { user: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
    const out: AuditLogDto[] = logs.map((l) => ({
      id: l.id,
      action: l.action,
      actorName: l.user?.name ?? null,
      targetType: l.targetType,
      targetId: l.targetId,
      metadata: l.metadata as Record<string, unknown>,
      ipAddress: l.ipAddress,
      createdAt: l.createdAt.toISOString(),
    }));
    res.json({ logs: out });
  }),
);

// ─── Invitation acceptance (not home-scoped: the user is not a member yet) ──

export const invitationsRouter = Router();
invitationsRouter.use(requireAuth);

invitationsRouter.get(
  '/preview',
  ah(async (req, res) => {
    const token = String(req.query.token ?? '');
    const invite = token ? await prisma.invitation.findUnique({ where: { tokenHash: sha256(token) }, include: { home: true, invitedBy: true } }) : null;
    if (!invite || invite.revokedAt || invite.acceptedAt || invite.expiresAt < new Date()) throw new AppError(404, 'invalid_invitation', 'This invitation is invalid, has expired or was already used.');
    res.json({ homeName: invite.home.name, role: invite.role, invitedBy: invite.invitedBy.name, email: invite.email });
  }),
);

invitationsRouter.post(
  '/accept',
  ah(async (req, res) => {
    const { token } = parse(z.object({ token: z.string().min(10).max(200) }), req.body);
    const invite = await prisma.invitation.findUnique({ where: { tokenHash: sha256(token) }, include: { home: true } });
    if (!invite || invite.revokedAt || invite.acceptedAt || invite.expiresAt < new Date()) throw new AppError(404, 'invalid_invitation', 'This invitation is invalid, has expired or was already used.');
    if (invite.email !== req.auth!.email) throw forbidden(`This invitation was sent to ${invite.email}. Sign in with that account to accept it.`);
    const existing = await prisma.homeMembership.findUnique({ where: { homeId_userId: { homeId: invite.homeId, userId: req.auth!.userId } } });
    if (!existing) await prisma.homeMembership.create({ data: { homeId: invite.homeId, userId: req.auth!.userId, role: invite.role } });
    await prisma.invitation.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
    await audit({ action: 'member.joined', userId: req.auth!.userId, homeId: invite.homeId, metadata: { role: invite.role }, ipAddress: req.ip });
    await recordActivity({ homeId: invite.homeId, type: 'home.member', title: `${req.auth!.name} joined the home`, source: 'user', actorUserId: req.auth!.userId, actorName: req.auth!.name });
    res.json({ homeId: invite.homeId });
  }),
);
