import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMockHomeAssistant, type MockHa } from '../../mock-ha/src/server.js';
import { prisma } from '../src/db.js';
import { integrations } from '../src/integrations/manager.js';
import { inviteAndJoin, newHome, newUser, waitFor, waitForCommand, type Client } from './helpers.js';

let ha: MockHa;
let owner: Client;
let homeId: string;
let integrationId: string;
const ids = new Map<string, string>();

beforeAll(async () => {
  ha = await startMockHomeAssistant({ stateDelayMs: 30 });
  owner = await newUser('HA Owner');
  homeId = await newHome(owner, 'HA Home');
  await owner.post(`/api/homes/${homeId}/rooms`, { name: 'Living Room', icon: 'sofa' });
});

afterAll(async () => {
  await integrations.stopAll();
  await ha.close();
  await prisma.$disconnect();
});

const deviceState = async (ext: string) => (await owner.get(`/api/homes/${homeId}/devices/${ids.get(ext)}`)).body.device;

describe('Home Assistant connection', () => {
  it('does not save an integration when the token is rejected', async () => {
    const r = await owner.post(`/api/homes/${homeId}/integrations/home-assistant`, { name: 'HA', baseUrl: ha.url, accessToken: 'definitely-not-the-right-token-123' });
    expect(r.status).toBe(401);
    expect(await prisma.integration.count({ where: { homeId } })).toBe(0);
  });

  it('rejects cloud-metadata style URLs', async () => {
    const r = await owner.post(`/api/homes/${homeId}/integrations/home-assistant`, { name: 'HA', baseUrl: 'http://169.254.169.254', accessToken: ha.token });
    expect(r.status).toBe(400);
  });

  it('connects, encrypts the token and discovers mapped entities', async () => {
    const r = await owner.post(`/api/homes/${homeId}/integrations/home-assistant`, { name: 'Home Assistant', baseUrl: ha.url, accessToken: ha.token });
    expect(r.status).toBe(201);
    integrationId = r.body.integration.id;
    expect(JSON.stringify(r.body)).not.toContain(ha.token);

    const cred = await prisma.integrationCredentialReference.findUniqueOrThrow({ where: { integrationId } });
    expect(cred.ciphertext).not.toContain(ha.token);

    const discovered = r.body.discovered as { externalId: string; capabilities: { type: string }[]; suggestedRoom: string | null; connectivity: string }[];
    const extIds = discovered.map((d) => d.externalId);
    expect(extIds).toContain('light.living_room');
    expect(extIds).not.toContain('sensor.weather_summary'); // unmapped text sensor
    expect(extIds).not.toContain('automation.morning_routine'); // not a device
    expect(discovered.find((d) => d.externalId === 'light.living_room')!.suggestedRoom).toBe('Living Room');
    expect(discovered.find((d) => d.externalId === 'light.broken_bulb')!.connectivity).toBe('unavailable');
    const garage = discovered.find((d) => d.externalId === 'cover.garage_door')!;
    expect(garage.capabilities.find((c) => c.type === 'position')).toMatchObject({ coverKind: 'garage', canSetPosition: false });

    await waitFor(async () => (await prisma.integration.findUnique({ where: { id: integrationId } }))?.status === 'connected');
  });

  it('imports selected devices into rooms and tests each one', async () => {
    const rooms = (await owner.get(`/api/homes/${homeId}/rooms`)).body.rooms;
    const living = rooms[0].id;
    const pick = ['light.living_room', 'switch.coffee_maker', 'lock.front_door', 'cover.garage_door', 'camera.porch', 'light.broken_bulb', 'sensor.grid_energy', 'climate.hallway'];
    const r = await owner.post(`/api/homes/${homeId}/integrations/${integrationId}/import`, {
      devices: pick.map((externalId) => ({ externalId, name: externalId.split('.')[1]!.replace(/_/g, ' '), roomId: externalId.includes('living') ? living : null })),
    });
    expect(r.status).toBe(201);
    for (const res of r.body.results) {
      expect(res.status).toBe('imported');
      ids.set(res.externalId, res.deviceId);
    }
    expect(r.body.results.find((x: { externalId: string }) => x.externalId === 'light.living_room').tested).toBe(true);
    expect(r.body.results.find((x: { externalId: string }) => x.externalId === 'light.broken_bulb').connectivity).toBe('unavailable');
    const integ = (await owner.get(`/api/homes/${homeId}/integrations/${integrationId}`)).body.integration;
    expect(integ.deviceCount).toBe(pick.length);
    expect(integ.discoveredNotImported).toBeGreaterThan(0);
  });

  it('does not offer capabilities HA does not expose', async () => {
    const sw = await deviceState('switch.coffee_maker');
    expect(sw.capabilities.map((c: { type: string }) => c.type)).toEqual(['onOff']);
    const r = await owner.post(`/api/homes/${homeId}/devices/${ids.get('switch.coffee_maker')}/commands`, { command: { capability: 'brightness', action: 'setBrightness', value: 10 } });
    expect(r.status).toBe(400);
  });
});

describe('Home Assistant commands and events', () => {
  it('sends a documented service call and confirms via the state_changed event', async () => {
    const r = await owner.post(`/api/homes/${homeId}/devices/${ids.get('light.living_room')}/commands`, { command: { capability: 'brightness', action: 'setBrightness', value: 40 } });
    const final = await waitForCommand(owner, homeId, r.body.command.id);
    expect(final.status).toBe('confirmed');
    expect(final.verified).toBe(true);
    expect(ha.serviceCalls.at(-1)).toMatchObject({ domain: 'light', service: 'turn_on', data: { entity_id: 'light.living_room', brightness_pct: 40 } });
    const d = await deviceState('light.living_room');
    expect(d.state.on).toBe(true);
    expect(d.state.brightness).toBe(40);
  });

  it('times out if HA accepts the call but the entity never changes', async () => {
    ha.setUnresponsive('switch.coffee_maker', true);
    const r = await owner.post(`/api/homes/${homeId}/devices/${ids.get('switch.coffee_maker')}/commands`, { command: { capability: 'onOff', action: 'turnOn' } });
    const final = await waitForCommand(owner, homeId, r.body.command.id);
    expect(final.status).toBe('timed_out');
    ha.setUnresponsive('switch.coffee_maker', false);
  });

  it('reflects changes made outside SmartNest and records activity', async () => {
    ha.setState('lock.front_door', 'unlocked');
    await waitFor(async () => (await deviceState('lock.front_door')).state.lockState === 'unlocked');
    await waitFor(async () => prisma.activityEvent.findFirst({ where: { homeId, deviceId: ids.get('lock.front_door'), type: 'security.event' } }));
  });

  it('accumulates energy from cumulative counters', async () => {
    ha.setState('sensor.grid_energy', '1521.75');
    await waitFor(async () => (await prisma.energyReading.aggregate({ where: { deviceId: ids.get('sensor.grid_energy') }, _sum: { kWh: true } }))._sum.kWh);
    const sum = (await prisma.energyReading.aggregate({ where: { deviceId: ids.get('sensor.grid_energy') }, _sum: { kWh: true } }))._sum.kWh!;
    expect(sum).toBeCloseTo(1.5, 3);
  });

  it('reconnects and recovers state changed while the event stream was down', async () => {
    ha.dropConnections();
    await waitFor(async () => (await prisma.integration.findUnique({ where: { id: integrationId } }))?.status !== 'connected', 3000, 20);
    // Connectivity becomes unknown while disconnected — not guessed
    await waitFor(async () => (await deviceState('climate.hallway')).connectivity === 'unknown');
    ha.setState('climate.hallway', 'heat', { temperature: 22.5 });
    await waitFor(async () => (await prisma.integration.findUnique({ where: { id: integrationId } }))?.status === 'connected', 10_000);
    await waitFor(async () => {
      const d = await deviceState('climate.hallway');
      return d.connectivity === 'online' && d.state.targetTemperature === 22.5;
    });
  });

  it('syncs Home Assistant automations as externally owned', async () => {
    await owner.post(`/api/homes/${homeId}/integrations/${integrationId}/sync-automations`);
    const list = (await owner.get(`/api/homes/${homeId}/automations`)).body.automations;
    const ext = list.find((a: { executor: string }) => a.executor === 'home_assistant');
    expect(ext.name).toBe('Morning Routine');
    expect((await owner.put(`/api/homes/${homeId}/automations/${ext.id}`, { name: 'x', triggers: [{ type: 'interval', everyMinutes: 10 }], actions: [{ type: 'delay', seconds: 1 }] })).status).toBe(409);
    expect((await owner.post(`/api/homes/${homeId}/automations/${ext.id}/enabled`, { enabled: false })).status).toBe(200);
    expect(ha.serviceCalls.at(-1)).toMatchObject({ domain: 'automation', service: 'turn_off' });
  });

  it('exposes router-tracked clients on the network page', async () => {
    const n = (await owner.get(`/api/homes/${homeId}/network`)).body;
    expect(n.available).toBe(true);
    expect(n.clients[0]).toMatchObject({ name: 'Phone', ip: '192.168.1.20', online: true });
    expect(n.bandwidth).toBeNull(); // not reported by HA → not invented
  });
});

describe('camera authorization', () => {
  it('requires a signed token, a session and camera permission', async () => {
    const cam = ids.get('camera.porch')!;
    const tok = await owner.post(`/api/homes/${homeId}/cameras/${cam}/token`);
    expect(tok.status).toBe(200);
    expect(tok.body.snapshotUrl).not.toContain(ha.token);
    const snap = await owner.get(tok.body.snapshotUrl);
    expect(snap.status).toBe(200);
    expect(snap.headers['content-type']).toBe('image/png');

    expect((await owner.get(`/api/homes/${homeId}/cameras/${cam}/snapshot?token=forged.token`)).status).toBe(403);
    const stranger = await newUser();
    expect((await stranger.get(tok.body.snapshotUrl)).status).toBe(403); // token bound to the issuing user

    const guest = await inviteAndJoin(owner, homeId, 'guest');
    expect((await guest.post(`/api/homes/${homeId}/cameras/${cam}/token`)).status).toBe(403);
  });
});

describe('credential revocation and disconnection', () => {
  it('marks the integration auth_failed when the token is revoked', async () => {
    ha.revokeToken();
    await waitFor(async () => {
      const s = (await prisma.integration.findUnique({ where: { id: integrationId } }))?.status;
      return s === 'auth_failed' || s === 'error';
    }, 15_000);
    const r = await owner.post(`/api/homes/${homeId}/devices/${ids.get('light.living_room')}/commands`, { command: { capability: 'onOff', action: 'turnOff' } });
    const final = await waitForCommand(owner, homeId, r.body.command.id);
    expect(final.status).toBe('failed');
    ha.restoreToken();
  });

  it('reconnects with a new token, then disconnects gracefully keeping devices', async () => {
    const re = await owner.post(`/api/homes/${homeId}/integrations/${integrationId}/reconnect`, { accessToken: ha.token });
    expect(re.status).toBe(200);
    await waitFor(async () => (await prisma.integration.findUnique({ where: { id: integrationId } }))?.status === 'connected');

    const dc = await owner.post(`/api/homes/${homeId}/integrations/${integrationId}/disconnect`);
    expect(dc.status).toBe(200);
    expect(dc.body.integration.status).toBe('disconnected');
    expect(await prisma.integrationCredentialReference.count({ where: { integrationId } })).toBe(0);

    const d = await deviceState('light.living_room');
    expect(d.integrationDisconnected).toBe(true);
    expect(d.connectivity).toBe('unknown');
    expect(d.name).toBeTruthy(); // record intact

    const r = await owner.post(`/api/homes/${homeId}/devices/${ids.get('light.living_room')}/commands`, { command: { capability: 'onOff', action: 'turnOff' } });
    const final = await waitForCommand(owner, homeId, r.body.command.id);
    expect(final.status).toBe('failed');
    expect(final.errorCode).toBe('integration_disconnected');

    const rc = await owner.post(`/api/homes/${homeId}/integrations/${integrationId}/reconnect`, {});
    expect(rc.status).toBe(400); // credentials were deleted → new token required
  });

  it('removes the integration and its devices on delete', async () => {
    expect((await owner.delete(`/api/homes/${homeId}/integrations/${integrationId}`)).status).toBe(204);
    expect(await prisma.device.count({ where: { integrationId } })).toBe(0);
  });
});
