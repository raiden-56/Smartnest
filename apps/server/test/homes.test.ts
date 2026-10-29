import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { integrations } from '../src/integrations/manager.js';
import { inviteAndJoin, newHome, newUser } from './helpers.js';

afterAll(async () => {
  await integrations.stopAll();
  await prisma.$disconnect();
});

describe('homes and rooms', () => {
  it('creates a home with the creator as owner', async () => {
    const c = await newUser();
    const homeId = await newHome(c, 'Maple House');
    const r = await c.get(`/api/homes/${homeId}`);
    expect(r.body.home.role).toBe('owner');
    expect(r.body.home.permissions).toContain('home.delete');
    expect((await c.get('/api/homes')).body.homes).toHaveLength(1);
  });

  it('creates, renames, reorders and deletes rooms without deleting devices', async () => {
    const c = await newUser();
    const homeId = await newHome(c);
    const a = (await c.post(`/api/homes/${homeId}/rooms`, { name: 'Kitchen', icon: 'cooking-pot' })).body.room;
    const b = (await c.post(`/api/homes/${homeId}/rooms`, { name: 'Office', icon: 'briefcase' })).body.room;
    expect((await c.patch(`/api/homes/${homeId}/rooms/${a.id}`, { name: 'Big Kitchen' })).body.room.name).toBe('Big Kitchen');
    await c.put(`/api/homes/${homeId}/rooms/order`, { ids: [b.id, a.id] });
    const rooms = (await c.get(`/api/homes/${homeId}/rooms`)).body.rooms;
    expect(rooms.map((r: { name: string }) => r.name)).toEqual(['Office', 'Big Kitchen']);
    expect((await c.delete(`/api/homes/${homeId}/rooms/${b.id}`)).status).toBe(204);
    expect((await c.get(`/api/homes/${homeId}/rooms`)).body.rooms).toHaveLength(1);
  });

  it('hides other homes from non-members (404, not 403)', async () => {
    const owner = await newUser();
    const stranger = await newUser();
    const homeId = await newHome(owner);
    expect((await stranger.get(`/api/homes/${homeId}`)).status).toBe(404);
    expect((await stranger.get(`/api/homes/${homeId}/devices`)).status).toBe(404);
    expect((await stranger.post(`/api/homes/${homeId}/rooms`, { name: 'Sneaky' })).status).toBe(404);
  });

  it('enforces role permissions on the backend', async () => {
    const owner = await newUser();
    const homeId = await newHome(owner);
    const guest = await inviteAndJoin(owner, homeId, 'guest');
    const member = await inviteAndJoin(owner, homeId, 'member');
    const admin = await inviteAndJoin(owner, homeId, 'admin');

    expect((await guest.post(`/api/homes/${homeId}/rooms`, { name: 'Nope' })).status).toBe(403);
    expect((await guest.get(`/api/homes/${homeId}/cameras`)).status).toBe(403);
    expect((await guest.get(`/api/homes/${homeId}/activity`)).status).toBe(403);
    expect((await member.post(`/api/homes/${homeId}/integrations/demo`)).status).toBe(403);
    expect((await member.get(`/api/homes/${homeId}/cameras`)).status).toBe(200);
    expect((await admin.post(`/api/homes/${homeId}/rooms`, { name: 'Den' })).status).toBe(201);
    expect((await admin.delete(`/api/homes/${homeId}`)).status).toBe(403);

    // Admins cannot create other admins; owners can.
    expect((await admin.post(`/api/homes/${homeId}/invitations`, { email: 'x@example.test', role: 'admin' })).status).toBe(403);
    expect((await owner.post(`/api/homes/${homeId}/invitations`, { email: 'y@example.test', role: 'admin' })).status).toBe(201);
  });

  it('only accepts an invitation for the invited email', async () => {
    const owner = await newUser();
    const homeId = await newHome(owner);
    const inv = await owner.post(`/api/homes/${homeId}/invitations`, { email: 'someone-else@example.test', role: 'member' });
    const token = new URL(inv.body.invitation.inviteUrl).searchParams.get('token');
    const wrong = await newUser();
    expect((await wrong.post('/api/invitations/accept', { token })).status).toBe(403);
  });

  it('requires recent re-authentication to delete a home', async () => {
    const owner = await newUser();
    const homeId = await newHome(owner);
    await prisma.session.updateMany({ where: { user: { email: owner.email } }, data: { reauthAt: new Date(Date.now() - 3600_000) } });
    const r = await owner.delete(`/api/homes/${homeId}`);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('reauth_required');
    expect((await owner.post('/api/auth/reauth', { password: 'correct-horse-42' })).status).toBe(200);
    expect((await owner.delete(`/api/homes/${homeId}`)).status).toBe(204);
  });

  it('keeps at least one owner', async () => {
    const owner = await newUser();
    const homeId = await newHome(owner);
    const members = (await owner.get(`/api/homes/${homeId}/members`)).body.members;
    expect((await owner.delete(`/api/homes/${homeId}/members/${members[0].id}`)).status).toBe(400);
  });
});
