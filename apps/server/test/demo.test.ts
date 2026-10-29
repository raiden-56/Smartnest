import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultDashboardLayout } from '@smartnest/shared';
import { prisma } from '../src/db.js';
import { integrations } from '../src/integrations/manager.js';
import { inviteAndJoin, newUser, waitFor, waitForCommand, type Client } from './helpers.js';

let owner: Client;
let homeId: string;
const deviceByExt = new Map<string, string>();

beforeAll(async () => {
  owner = await newUser('Demo Owner');
  const r = await owner.post('/api/homes/demo', { timezone: 'Europe/London' });
  expect(r.status).toBe(201);
  homeId = r.body.home.id;
  const devices = await prisma.device.findMany({ where: { homeId } });
  for (const d of devices) deviceByExt.set(d.externalId, d.id);
});

afterAll(async () => {
  await integrations.stopAll();
  await prisma.$disconnect();
});

const dev = (ext: string) => deviceByExt.get(ext)!;
const send = (c: Client, ext: string, command: unknown, extra: Record<string, unknown> = {}) => c.post(`/api/homes/${homeId}/devices/${dev(ext)}/commands`, { command, ...extra });

describe('demo home and inventory', () => {
  it('is clearly flagged as demo data', async () => {
    const home = (await owner.get(`/api/homes/${homeId}`)).body.home;
    expect(home.isDemo).toBe(true);
    const list = (await owner.get(`/api/homes/${homeId}/devices?pageSize=100`)).body;
    expect(list.total).toBeGreaterThan(30);
    expect(list.items.every((d: { isDemo: boolean }) => d.isDemo)).toBe(true);
  });

  it('calculates connectivity counts that add up', async () => {
    const counts = (await owner.get(`/api/homes/${homeId}/devices/counts`)).body;
    expect(counts.online + counts.offline + counts.unavailable + counts.unknown).toBe(counts.total);
    expect(counts.offline).toBe(2); // garden lights + garage camera
  });

  it('filters, sorts and paginates on the server', async () => {
    const page = (await owner.get(`/api/homes/${homeId}/devices?category=lighting&pageSize=2&page=1&sort=name`)).body;
    expect(page.items).toHaveLength(2);
    expect(page.total).toBeGreaterThanOrEqual(5);
    expect(page.items.every((d: { category: string }) => d.category === 'lighting')).toBe(true);
    const offline = (await owner.get(`/api/homes/${homeId}/devices?connectivity=offline`)).body;
    expect(offline.items.map((d: { name: string }) => d.name).sort()).toEqual(['Garage Camera', 'Garden Lights']);
    const lowBattery = (await owner.get(`/api/homes/${homeId}/devices?battery=low`)).body;
    expect(lowBattery.items.map((d: { name: string }) => d.name)).toContain('Bathroom Humidity');
  });

  it('moves a device between rooms without changing its integration identity', async () => {
    const id = dev('demo.office_lamp');
    const rooms = (await owner.get(`/api/homes/${homeId}/rooms`)).body.rooms;
    const bedroom = rooms.find((r: { name: string }) => r.name === 'Bedroom');
    const before = (await owner.get(`/api/homes/${homeId}/devices/${id}`)).body.device;
    const after = (await owner.patch(`/api/homes/${homeId}/devices/${id}`, { roomId: bedroom.id })).body.device;
    expect(after.roomName).toBe('Bedroom');
    expect(after.externalId).toBe(before.externalId);
    expect(after.integrationId).toBe(before.integrationId);
  });
});

describe('command lifecycle', () => {
  it('confirms a command only after the device reports the requested state', async () => {
    const r = await send(owner, 'demo.living_lamp', { capability: 'onOff', action: 'turnOn' });
    expect(r.status).toBe(202);
    expect(r.body.command.status).toBe('pending');
    const final = await waitForCommand(owner, homeId, r.body.command.id);
    expect(final.status).toBe('confirmed');
    expect(final.verified).toBe(true);
    const device = (await owner.get(`/api/homes/${homeId}/devices/${dev('demo.living_lamp')}`)).body.device;
    expect(device.state.on).toBe(true);
  });

  it('fails cleanly when the device is offline', async () => {
    const r = await send(owner, 'demo.garden_lights', { capability: 'onOff', action: 'turnOn' });
    const final = await waitForCommand(owner, homeId, r.body.command.id);
    expect(final.status).toBe('failed');
    expect(final.errorCode).toBe('device_unavailable');
  });

  it('times out when the integration acknowledges but the device never changes', async () => {
    const r = await send(owner, 'demo.balcony_heater', { capability: 'onOff', action: 'turnOn' });
    const final = await waitForCommand(owner, homeId, r.body.command.id);
    expect(final.status).toBe('timed_out');
    expect(final.errorCode).toBe('not_confirmed');
  });

  it('rejects capabilities the device does not declare', async () => {
    const r = await send(owner, 'demo.kitchen_lights', { capability: 'brightness', action: 'setBrightness', value: 50 });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('unsupported_capability');
  });

  it('is idempotent for repeated submissions with the same key', async () => {
    const key = `test-key-${Date.now()}`;
    const a = await send(owner, 'demo.bedroom_lamp', { capability: 'onOff', action: 'turnOn' }, { idempotencyKey: key });
    const b = await send(owner, 'demo.bedroom_lamp', { capability: 'onOff', action: 'turnOn' }, { idempotencyKey: key });
    expect(b.body.command.id).toBe(a.body.command.id);
    expect(await prisma.deviceCommand.count({ where: { homeId, idempotencyKey: key } })).toBe(1);
  });

  it('requires confirmation and permission for sensitive commands', async () => {
    const unconfirmed = await send(owner, 'demo.front_lock', { capability: 'lock', action: 'unlock' });
    expect(unconfirmed.status).toBe(428);
    const ok = await send(owner, 'demo.front_lock', { capability: 'lock', action: 'unlock' }, { confirmed: true });
    expect(ok.status).toBe(202);
    expect((await waitForCommand(owner, homeId, ok.body.command.id)).status).toBe('confirmed');
    const audit = await prisma.auditLog.findFirst({ where: { homeId, action: 'device.command.sensitive' } });
    expect(audit).toBeTruthy();

    const guest = await inviteAndJoin(owner, homeId, 'guest');
    expect((await send(guest, 'demo.front_lock', { capability: 'lock', action: 'lock' }, { confirmed: true })).status).toBe(403);
    expect((await send(guest, 'demo.garage_door', { capability: 'position', action: 'open' }, { confirmed: true })).status).toBe(403);
    const guestLight = await send(guest, 'demo.kitchen_lights', { capability: 'onOff', action: 'turnOff' });
    expect(guestLight.status).toBe(202);
  });

  it('records activity for commands', async () => {
    await waitFor(async () => (await prisma.activityEvent.count({ where: { homeId, type: 'device.command' } })) >= 3);
    const act = (await owner.get(`/api/homes/${homeId}/activity?type=device.command`)).body.items;
    expect(act.some((a: { result: string }) => a.result === 'failure')).toBe(true);
    expect(act.some((a: { result: string }) => a.result === 'success')).toBe(true);
  });
});

describe('scenes', () => {
  it('reports partial failure honestly', async () => {
    const scenes = (await owner.get(`/api/homes/${homeId}/scenes`)).body.scenes;
    const allOff = scenes.find((s: { name: string }) => s.name === 'All Supported Lights Off');
    const r = await owner.post(`/api/homes/${homeId}/scenes/${allOff.id}/activate`, {});
    expect(r.status).toBe(202);
    const exec = await waitFor(async () => {
      const e = (await owner.get(`/api/homes/${homeId}/scenes/${allOff.id}/executions`)).body.executions[0];
      return e?.status !== 'running' ? e : null;
    });
    expect(exec.status).toBe('partial');
    expect(exec.results.find((x: { deviceName: string }) => x.deviceName === 'Garden Lights').status).toBe('failed');
  });

  it('requires confirmation for scenes with sensitive actions', async () => {
    const scenes = (await owner.get(`/api/homes/${homeId}/scenes`)).body.scenes;
    const away = scenes.find((s: { name: string }) => s.name === 'Away Mode');
    expect(away.requiresConfirmation).toBe(true);
    expect((await owner.post(`/api/homes/${homeId}/scenes/${away.id}/activate`, {})).status).toBe(428);
  });

  it('refuses sensitive actions in a scene unless explicitly allowed', async () => {
    const r = await owner.post(`/api/homes/${homeId}/scenes`, {
      name: 'Bad scene',
      actions: [{ deviceId: dev('demo.front_lock'), command: { capability: 'lock', action: 'unlock' } }],
    });
    expect(r.status).toBe(400);
  });
});

describe('automations', () => {
  it('validates and rejects loops', async () => {
    const loop = {
      name: 'Loop',
      enabled: true,
      triggers: [{ type: 'deviceState', deviceId: dev('demo.kitchen_lights'), attribute: 'on', to: false }],
      actions: [{ type: 'deviceCommand', deviceId: dev('demo.kitchen_lights'), command: { capability: 'onOff', action: 'turnOff' } }],
    };
    const r = await owner.post(`/api/homes/${homeId}/automations`, loop);
    expect(r.status).toBe(400);
    // …but can be saved as a draft for later editing
    const draft = await owner.post(`/api/homes/${homeId}/automations`, { ...loop, isDraft: true });
    expect(draft.status).toBe(201);
    expect(draft.body.automation.enabled).toBe(false);
  });

  it('runs a device-triggered automation once and records its execution', async () => {
    const created = await owner.post(`/api/homes/${homeId}/automations`, {
      name: 'Door opens → lights on',
      enabled: true,
      cooldownSeconds: 60,
      triggers: [{ type: 'deviceState', deviceId: dev('demo.front_lock'), attribute: 'lockState', to: 'locked' }],
      actions: [{ type: 'deviceCommand', deviceId: dev('demo.office_lamp'), command: { capability: 'onOff', action: 'turnOn' } }],
    });
    expect(created.status).toBe(201);
    const id = created.body.automation.id;
    await send(owner, 'demo.front_lock', { capability: 'lock', action: 'lock' }, { confirmed: true });
    const exec = await waitFor(async () => {
      const e = (await owner.get(`/api/homes/${homeId}/automations/${id}/executions`)).body.executions[0];
      return e && e.status !== 'running' ? e : null;
    });
    expect(exec.status).toBe('succeeded');
    expect((await owner.get(`/api/homes/${homeId}/automations/${id}/executions`)).body.executions).toHaveLength(1);
  });

  it('simulates without executing', async () => {
    const list = (await owner.get(`/api/homes/${homeId}/automations`)).body.automations;
    const auto = list.find((a: { name: string }) => a.name === 'Evening lights');
    const before = await prisma.deviceCommand.count({ where: { homeId } });
    const sim = (await owner.post(`/api/homes/${homeId}/automations/${auto.id}/simulate`)).body.execution;
    expect(sim.status).toBe('simulated');
    expect(await prisma.deviceCommand.count({ where: { homeId } })).toBe(before);
  });

  it('exports and re-imports automations disabled', async () => {
    const exp = (await owner.get(`/api/homes/${homeId}/automations/export`)).body;
    expect(exp.format).toBe('smartnest.automations.v1');
    const imp = await owner.post(`/api/homes/${homeId}/automations/import`, { format: exp.format, automations: exp.automations.slice(0, 1) });
    expect(imp.status).toBe(201);
    const saved = await prisma.automation.findUniqueOrThrow({ where: { id: imp.body.results[0].id } });
    expect(saved.enabled).toBe(false);
  });
});

describe('dashboard', () => {
  it('returns the default layout and persists per user and home', async () => {
    const d = (await owner.get(`/api/homes/${homeId}/dashboard`)).body;
    expect(d.isDefault).toBe(true);
    const widgets = defaultDashboardLayout().map((w) => (w.id === 'network' ? { ...w, hidden: true } : w));
    expect((await owner.put(`/api/homes/${homeId}/dashboard`, { widgets })).status).toBe(200);
    const after = (await owner.get(`/api/homes/${homeId}/dashboard`)).body;
    expect(after.isDefault).toBe(false);
    expect(after.widgets.find((w: { id: string }) => w.id === 'network').hidden).toBe(true);
  });

  it('rejects overlapping layouts', async () => {
    const widgets = defaultDashboardLayout();
    widgets[1] = { ...widgets[1]!, x: 0, y: 0 };
    expect((await owner.put(`/api/homes/${homeId}/dashboard`, { widgets })).status).toBe(400);
  });
});

describe('energy and network', () => {
  it('reports demo energy with its sources', async () => {
    const e = (await owner.get(`/api/homes/${homeId}/energy?range=7d`)).body;
    expect(e.available).toBe(true);
    expect(e.sources.every((s: { isDemo: boolean }) => s.isDemo)).toBe(true);
    expect(e.totals.weekKWh).toBeGreaterThan(0);
    expect(e.tariff).toEqual({ perKWh: 0.245, currency: 'GBP' });
  });

  it('shows "not available" energy for a home without energy devices', async () => {
    const c = await newUser();
    const h = (await c.post('/api/homes', { name: 'Empty', timezone: 'UTC' })).body.home.id;
    const e = (await c.get(`/api/homes/${h}/energy?range=today`)).body;
    expect(e.available).toBe(false);
    expect(e.currentPowerW).toBeNull();
    expect(e.totals.todayKWh).toBeNull();
  });

  it('links network clients to smart-home devices', async () => {
    const n = (await owner.get(`/api/homes/${homeId}/network`)).body;
    expect(n.available).toBe(true);
    expect(n.clients.some((c: { smartHomeDeviceId: string | null }) => c.smartHomeDeviceId === dev('demo.living_tv'))).toBe(true);
    expect(n.clients.some((c: { smartHomeDeviceId: string | null }) => c.smartHomeDeviceId === null)).toBe(true);
  });
});

describe('search', () => {
  it('groups results by type', async () => {
    const s = (await owner.get(`/api/homes/${homeId}/search?q=living`)).body;
    expect(s.rooms.some((r: { name: string }) => r.name === 'Living Room')).toBe(true);
    expect(s.devices.length).toBeGreaterThan(0);
  });
});
