import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { integrations } from '../src/integrations/manager.js';
import { automationEngine } from '../src/services/automationEngine.js';

let app: Express | null = null;

export function getApp(): Express {
  if (!app) {
    app = createApp();
    automationEngine.start();
    integrations.demoConfig = { speed: 10 };
  }
  return app;
}

/** A logged-in client that sends the CSRF header automatically. */
export class Client {
  readonly agent = request.agent(getApp());
  constructor(public email: string) {}

  get(url: string) {
    return this.agent.get(url);
  }
  post(url: string, body?: unknown) {
    return this.agent.post(url).set('X-SmartNest-CSRF', '1').send(body as object);
  }
  put(url: string, body?: unknown) {
    return this.agent.put(url).set('X-SmartNest-CSRF', '1').send(body as object);
  }
  patch(url: string, body?: unknown) {
    return this.agent.patch(url).set('X-SmartNest-CSRF', '1').send(body as object);
  }
  delete(url: string) {
    return this.agent.delete(url).set('X-SmartNest-CSRF', '1');
  }
}

let counter = 0;
export async function newUser(name = 'Test User'): Promise<Client> {
  const email = `user${Date.now()}_${counter++}@example.test`;
  const c = new Client(email);
  const r = await c.post('/api/auth/register', { name, email, password: 'correct-horse-42' });
  if (r.status !== 201) throw new Error(`register failed: ${r.status} ${JSON.stringify(r.body)}`);
  return c;
}

export async function newHome(c: Client, name = 'Test Home'): Promise<string> {
  const r = await c.post('/api/homes', { name, timezone: 'Europe/London' });
  if (r.status !== 201) throw new Error(`home failed: ${JSON.stringify(r.body)}`);
  return r.body.home.id as string;
}

/** Poll until `fn` returns a truthy value. */
export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 8000, intervalMs = 100): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export async function waitForCommand(c: Client, homeId: string, commandId: string) {
  return waitFor(async () => {
    const r = await c.get(`/api/homes/${homeId}/commands/${commandId}`);
    return ['confirmed', 'failed', 'timed_out'].includes(r.body.command?.status) ? r.body.command : null;
  });
}

export async function inviteAndJoin(owner: Client, homeId: string, role: 'admin' | 'member' | 'guest'): Promise<Client> {
  const user = await newUser(`${role} user`);
  const inv = await owner.post(`/api/homes/${homeId}/invitations`, { email: user.email, role });
  if (inv.status !== 201) throw new Error(`invite failed ${JSON.stringify(inv.body)}`);
  const token = new URL(inv.body.invitation.inviteUrl).searchParams.get('token');
  const acc = await user.post('/api/invitations/accept', { token });
  if (acc.status !== 200) throw new Error(`accept failed ${JSON.stringify(acc.body)}`);
  return user;
}
