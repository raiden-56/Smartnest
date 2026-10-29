import type { DeviceDto } from '@smartnest/shared';
import { guestBaseQuery, resetGuestServer } from '../server';
import { HOME_ID } from '../data';

const H = `/homes/${HOME_ID}`;
const get = async <T = Record<string, unknown>>(url: string, params?: Record<string, unknown>) => {
  const r = await guestBaseQuery({ url, params });
  if ('error' in r) throw new Error(`${url}: ${JSON.stringify(r.error)}`);
  return r.data as T;
};

afterAll(() => resetGuestServer());

describe('guest mode sample API', () => {
  it('signs in as the demo user and lists one onboarded home', async () => {
    const me = await get<{ user: { name: string } }>('/auth/me');
    expect(me.user.name).toBeTruthy();
    const { homes } = await get<{ homes: { id: string }[] }>('/homes');
    expect(homes.map((h) => h.id)).toEqual([HOME_ID]);
    const { home } = await get<{ home: { onboardingCompleted: boolean; permissions: string[] } }>(H);
    expect(home.onboardingCompleted).toBe(true);
    expect(home.permissions).toContain('home.delete');
  });

  it.each([
    ['rooms', 'rooms'], ['devices', 'items'], ['scenes', 'scenes'], ['automations', 'automations'], ['activity', 'items'], ['notifications', 'items'],
    ['members', 'members'], ['invitations', 'invitations'], ['audit', 'logs'], ['integrations', 'integrations'], ['cameras', 'cameras'], ['dashboard', 'widgets'],
  ])('populates %s', async (path, key) => {
    const body = await get<Record<string, unknown[]>>(`${H}/${path}`);
    expect(body[key]!.length).toBeGreaterThan(0);
  });

  it('reports energy, network and device history', async () => {
    const energy = await get<{ series: { consumptionKWh: number }[]; totals: { todayKWh: number } }>(`${H}/energy`, { range: '7d' });
    expect(energy.series.some((s) => s.consumptionKWh > 0)).toBe(true);
    const network = await get<{ available: boolean; clients: unknown[] }>(`${H}/network`);
    expect(network.available && network.clients.length > 0).toBe(true);
    const { history } = await get<{ history: unknown[] }>(`${H}/devices/dev-living-ac/history?hours=24`);
    expect(history.length).toBeGreaterThan(10);
  });

  it('filters and paginates devices like the server', async () => {
    const locks = await get<{ items: DeviceDto[] }>(`${H}/devices`, { capability: 'lock' });
    expect(locks.items.every((d) => d.capabilities.some((c) => c.type === 'lock'))).toBe(true);
    const page = await get<{ items: DeviceDto[]; total: number }>(`${H}/devices`, { pageSize: 5, page: 2 });
    expect(page.items).toHaveLength(5);
    expect(page.total).toBeGreaterThan(30);
  });

  it('applies device commands to in-memory state', async () => {
    const sent = await guestBaseQuery({ url: `${H}/devices/dev-living-lamp/commands`, method: 'POST', body: { command: { capability: 'onOff', action: 'turnOn' } } });
    expect('data' in sent && (sent.data as { command: { status: string } }).command.status).toBe('pending');
    await new Promise((r) => setTimeout(r, 1500));
    const { device } = await get<{ device: DeviceDto }>(`${H}/devices/dev-living-lamp`);
    expect(device.state.on).toBe(true);
  });

  it('answers unknown endpoints with an empty response and unknown homes with 404', async () => {
    expect(await guestBaseQuery('/does/not/exist')).toEqual({ data: {} });
    const r = await guestBaseQuery('/homes/someone-else/rooms');
    expect('error' in r && r.error.status).toBe(404);
  });
});
