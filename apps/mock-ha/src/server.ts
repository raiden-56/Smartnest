import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

/**
 * A small, deterministic stand-in for the Home Assistant REST and WebSocket
 * APIs, implementing only the endpoints SmartNest uses. It exists so the test
 * suite runs without hardware or a real Home Assistant installation.
 */

export interface MockEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
}

export interface MockHaOptions {
  port?: number;
  token?: string;
  /** Delay before a service call's resulting state change is broadcast */
  stateDelayMs?: number;
}

export interface MockHa {
  url: string;
  port: number;
  token: string;
  entities: Map<string, MockEntity>;
  serviceCalls: { domain: string; service: string; data: Record<string, unknown> }[];
  setState(entityId: string, state: string, attributes?: Record<string, unknown>): void;
  revokeToken(): void;
  restoreToken(): void;
  dropConnections(): void;
  setUnresponsive(entityId: string, value: boolean): void;
  setOffline(value: boolean): void;
  close(): Promise<void>;
}

const now = () => new Date().toISOString();

export function initialEntities(): MockEntity[] {
  const e = (entity_id: string, state: string, attributes: Record<string, unknown>): MockEntity => ({ entity_id, state, attributes, last_changed: now(), last_updated: now() });
  return [
    e('light.living_room', 'off', { friendly_name: 'Living Room Light', supported_color_modes: ['color_temp', 'hs'], min_color_temp_kelvin: 2000, max_color_temp_kelvin: 6500, brightness: null }),
    e('light.broken_bulb', 'unavailable', { friendly_name: 'Porch Bulb', supported_color_modes: ['onoff'] }),
    e('switch.coffee_maker', 'off', { friendly_name: 'Coffee Maker', device_class: 'outlet' }),
    e('climate.hallway', 'heat', { friendly_name: 'Hallway Thermostat', hvac_modes: ['off', 'heat', 'auto'], min_temp: 7, max_temp: 30, target_temp_step: 0.5, temperature: 20, current_temperature: 19.4, current_humidity: 48 }),
    e('cover.garage_door', 'closed', { friendly_name: 'Garage Door', device_class: 'garage', supported_features: 3, current_position: 0 }),
    e('lock.front_door', 'locked', { friendly_name: 'Front Door', battery_level: 76 }),
    e('sensor.living_room_temperature', '21.6', { friendly_name: 'Living Room Temperature', device_class: 'temperature', unit_of_measurement: '°C', state_class: 'measurement' }),
    e('sensor.grid_energy', '1520.25', { friendly_name: 'Grid Energy', device_class: 'energy', unit_of_measurement: 'kWh', state_class: 'total_increasing' }),
    e('sensor.weather_summary', 'Cloudy', { friendly_name: 'Weather Summary' }),
    e('binary_sensor.front_door_contact', 'off', { friendly_name: 'Front Door Contact', device_class: 'door' }),
    e('binary_sensor.hall_motion', 'off', { friendly_name: 'Hall Motion', device_class: 'motion' }),
    e('camera.porch', 'idle', { friendly_name: 'Porch Camera', motion_detection: true }),
    e('media_player.living_room_tv', 'off', { friendly_name: 'Living Room TV', device_class: 'tv', supported_features: 1 | 4 | 8 | 16 | 32 | 128 | 256 | 2048 | 4096 | 16384, source_list: ['HDMI 1', 'Netflix'], volume_level: 0.2, is_volume_muted: false }),
    e('automation.morning_routine', 'on', { friendly_name: 'Morning Routine', last_triggered: null }),
    e('device_tracker.phone', 'home', { friendly_name: 'Phone', source_type: 'router', ip: '192.168.1.20', mac: 'AA:BB:CC:DD:EE:FF', host_name: 'phone' }),
  ];
}

// 1×1 transparent PNG used as the camera snapshot
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

export async function startMockHomeAssistant(opts: MockHaOptions = {}): Promise<MockHa> {
  const token = opts.token ?? 'mock-long-lived-access-token-for-tests-0000';
  const delay = opts.stateDelayMs ?? 50;
  let tokenValid = true;
  let offline = false;
  const unresponsive = new Set<string>();
  const entities = new Map(initialEntities().map((x) => [x.entity_id, x]));
  const serviceCalls: MockHa['serviceCalls'] = [];
  const sockets = new Set<WebSocket>();
  const subscribers = new Map<WebSocket, number[]>();

  const broadcast = (entityId: string, oldState: MockEntity | null, newState: MockEntity | null) => {
    for (const [ws, subIds] of subscribers) {
      for (const id of subIds) {
        ws.send(JSON.stringify({ id, type: 'event', event: { event_type: 'state_changed', data: { entity_id: entityId, old_state: oldState, new_state: newState }, time_fired: now() } }));
      }
    }
  };

  const setState = (entityId: string, state: string, attributes: Record<string, unknown> = {}) => {
    const old = entities.get(entityId) ?? null;
    const ts = now();
    const next: MockEntity = { entity_id: entityId, state, attributes: { ...(old?.attributes ?? {}), ...attributes }, last_changed: old?.state !== state ? ts : (old?.last_changed ?? ts), last_updated: ts };
    entities.set(entityId, next);
    broadcast(entityId, old, next);
  };

  const applyService = (domain: string, service: string, data: Record<string, unknown>) => {
    const ids = ([] as string[]).concat((data.entity_id as string | string[]) ?? []);
    for (const id of ids) {
      const ent = entities.get(id);
      if (!ent || ent.state === 'unavailable' || unresponsive.has(id)) continue;
      const a = ent.attributes;
      const apply = (state: string, attrs: Record<string, unknown> = {}) => setTimeout(() => setState(id, state, attrs), delay);
      switch (`${domain}.${service}`) {
        case 'light.turn_on':
          apply('on', {
            brightness: data.brightness_pct !== undefined ? Math.round((Number(data.brightness_pct) / 100) * 255) : ((a.brightness as number) ?? 255),
            ...(data.color_temp_kelvin ? { color_temp_kelvin: data.color_temp_kelvin } : {}),
            ...(data.rgb_color ? { rgb_color: data.rgb_color } : {}),
          });
          break;
        case 'light.turn_off':
          apply('off', { brightness: null });
          break;
        case 'switch.turn_on':
        case 'media_player.turn_on':
          apply('on');
          break;
        case 'switch.turn_off':
        case 'media_player.turn_off':
          apply('off');
          break;
        case 'climate.set_temperature':
          apply(ent.state, { temperature: data.temperature });
          break;
        case 'climate.set_hvac_mode':
          apply(String(data.hvac_mode));
          break;
        case 'cover.open_cover':
          apply('opening', { current_position: 50 });
          setTimeout(() => setState(id, 'open', { current_position: 100 }), delay * 3);
          break;
        case 'cover.close_cover':
          apply('closing', { current_position: 50 });
          setTimeout(() => setState(id, 'closed', { current_position: 0 }), delay * 3);
          break;
        case 'lock.lock':
          apply('locked');
          break;
        case 'lock.unlock':
          apply('unlocked');
          break;
        case 'media_player.media_play':
          apply('playing');
          break;
        case 'media_player.media_pause':
          apply('paused');
          break;
        case 'media_player.volume_set':
          apply(ent.state, { volume_level: data.volume_level });
          break;
        case 'media_player.select_source':
          apply(ent.state, { source: data.source });
          break;
        case 'camera.enable_motion_detection':
          apply(ent.state, { motion_detection: true });
          break;
        case 'camera.disable_motion_detection':
          apply(ent.state, { motion_detection: false });
          break;
        case 'automation.turn_on':
          apply('on');
          break;
        case 'automation.turn_off':
          apply('off');
          break;
        case 'automation.trigger':
          apply(ent.state, { last_triggered: now() });
          break;
      }
    }
  };

  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const readBody = (req: IncomingMessage) =>
    new Promise<Record<string, unknown>>((resolve) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch {
          resolve({});
        }
      });
    });

  const server = createServer(async (req, res) => {
    if (offline) {
      req.socket.destroy();
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.headers.authorization !== `Bearer ${token}` || !tokenValid) return send(res, 401, { message: 'Unauthorized' });
    const p = url.pathname;
    if (req.method === 'GET' && p === '/api/') return send(res, 200, { message: 'API running.' });
    if (req.method === 'GET' && p === '/api/states') return send(res, 200, [...entities.values()]);
    if (req.method === 'GET' && p.startsWith('/api/states/')) {
      const ent = entities.get(decodeURIComponent(p.slice('/api/states/'.length)));
      return ent ? send(res, 200, ent) : send(res, 404, { message: 'Entity not found.' });
    }
    const svc = p.match(/^\/api\/services\/([a-z_]+)\/([a-z_]+)$/);
    if (req.method === 'POST' && svc) {
      const data = await readBody(req);
      serviceCalls.push({ domain: svc[1]!, service: svc[2]!, data });
      applyService(svc[1]!, svc[2]!, data);
      return send(res, 200, []);
    }
    const cam = p.match(/^\/api\/camera_proxy(_stream)?\/(.+)$/);
    if (req.method === 'GET' && cam) {
      const ent = entities.get(decodeURIComponent(cam[2]!));
      if (!ent) return send(res, 404, { message: 'Entity not found.' });
      if (!cam[1]) {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        return res.end(PNG);
      }
      res.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace;boundary=frame' });
      const write = () => res.write(Buffer.concat([Buffer.from('--frame\r\nContent-Type: image/png\r\n\r\n'), PNG, Buffer.from('\r\n')]));
      write();
      const t = setInterval(write, 200);
      req.on('close', () => clearInterval(t));
      return;
    }
    send(res, 404, { message: 'Not found' });
  });

  const wss = new WebSocketServer({ server, path: '/api/websocket' });
  wss.on('connection', (ws) => {
    sockets.add(ws);
    let authed = false;
    ws.send(JSON.stringify({ type: 'auth_required', ha_version: '2025.1.0-mock' }));
    ws.on('close', () => {
      sockets.delete(ws);
      subscribers.delete(ws);
    });
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as { id?: number; type: string; access_token?: string };
      if (!authed) {
        if (msg.type === 'auth' && msg.access_token === token && tokenValid) {
          authed = true;
          ws.send(JSON.stringify({ type: 'auth_ok', ha_version: '2025.1.0-mock' }));
        } else {
          ws.send(JSON.stringify({ type: 'auth_invalid', message: 'Invalid access token or password' }));
          ws.close();
        }
        return;
      }
      const result = (r: unknown) => ws.send(JSON.stringify({ id: msg.id, type: 'result', success: true, result: r }));
      switch (msg.type) {
        case 'ping':
          ws.send(JSON.stringify({ id: msg.id, type: 'pong' }));
          break;
        case 'subscribe_events':
          subscribers.set(ws, [...(subscribers.get(ws) ?? []), msg.id!]);
          result(null);
          break;
        case 'config/entity_registry/list':
          result([...entities.keys()].map((id) => ({ entity_id: id, device_id: `dev_${id.split('.')[1]}`, area_id: id.includes('living') ? 'living_room' : id.includes('garage') ? 'garage' : null, disabled_by: null })));
          break;
        case 'config/device_registry/list':
          result([...entities.keys()].map((id) => ({ id: `dev_${id.split('.')[1]}`, manufacturer: 'MockCo', model: `Model ${id.split('.')[0]}`, area_id: null })));
          break;
        case 'config/area_registry/list':
          result([
            { area_id: 'living_room', name: 'Living Room' },
            { area_id: 'garage', name: 'Garage' },
          ]);
          break;
        default:
          ws.send(JSON.stringify({ id: msg.id, type: 'result', success: false, error: { code: 'unknown_command', message: 'Unknown command.' } }));
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    token,
    entities,
    serviceCalls,
    setState,
    revokeToken: () => {
      tokenValid = false;
      for (const s of sockets) s.close();
    },
    restoreToken: () => {
      tokenValid = true;
    },
    dropConnections: () => {
      for (const s of sockets) s.terminate();
    },
    setUnresponsive: (id, v) => (v ? unresponsive.add(id) : unresponsive.delete(id)),
    setOffline: (v) => {
      offline = v;
      if (v) for (const s of sockets) s.terminate();
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.terminate();
        wss.close();
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}
