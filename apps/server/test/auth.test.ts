import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { Client, newUser } from './helpers.js';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('authentication', () => {
  it('registers, reads the session and logs out', async () => {
    const c = await newUser('Ada');
    const me = await c.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.name).toBe('Ada');
    expect(me.body.user.passwordHash).toBeUndefined();

    expect((await c.post('/api/auth/logout')).status).toBe(204);
    expect((await c.get('/api/auth/me')).status).toBe(401);
  });

  it('rejects duplicate emails and weak passwords', async () => {
    const c = await newUser();
    const dup = await new Client(c.email).post('/api/auth/register', { name: 'X', email: c.email, password: 'another-pass-123' });
    expect(dup.status).toBe(409);
    const weak = await new Client('w@example.test').post('/api/auth/register', { name: 'X', email: 'w@example.test', password: 'short' });
    expect(weak.status).toBe(400);
  });

  it('logs in with the right password only, with a generic error', async () => {
    const c = await newUser();
    const anon = new Client(c.email);
    const bad = await anon.post('/api/auth/login', { email: c.email, password: 'wrong-password-1' });
    expect(bad.status).toBe(401);
    const unknown = await anon.post('/api/auth/login', { email: 'nobody@example.test', password: 'wrong-password-1' });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.message).toBe(bad.body.error.message);
    const ok = await anon.post('/api/auth/login', { email: c.email, password: 'correct-horse-42' });
    expect(ok.status).toBe(200);
  });

  it('requires the CSRF header on state-changing requests', async () => {
    const c = await newUser();
    const r = await c.agent.post('/api/homes').send({ name: 'No header', timezone: 'UTC' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('csrf_failed');
  });

  it('resets a password with a one-time token and revokes sessions', async () => {
    const c = await newUser();
    const anon = new Client(c.email);
    const req = await anon.post('/api/auth/forgot-password', { email: c.email });
    expect(req.status).toBe(200);
    const token = req.headers['x-test-reset-token'] as string;
    expect(token).toBeTruthy();
    expect((await anon.post('/api/auth/reset-password', { token, password: 'brand-new-pass-99' })).status).toBe(200);
    expect((await anon.post('/api/auth/reset-password', { token, password: 'brand-new-pass-99' })).status).toBe(400);
    expect((await c.get('/api/auth/me')).status).toBe(401); // old session revoked
    expect((await anon.post('/api/auth/login', { email: c.email, password: 'brand-new-pass-99' })).status).toBe(200);
  });

  it('never stores raw passwords or session tokens', async () => {
    const c = await newUser();
    const user = await prisma.user.findUniqueOrThrow({ where: { email: c.email }, include: { sessions: true } });
    expect(user.passwordHash.startsWith('scrypt$')).toBe(true);
    expect(user.sessions[0]!.tokenHash).toHaveLength(64);
  });
});
