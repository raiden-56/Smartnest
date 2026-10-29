import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import WebSocket from 'ws';
import type { Capability, ConnectivityState, DeviceCommand, DeviceState } from '@smartnest/shared';
import {
  AdapterError,
  type AdapterContext,
  type AdapterDevice,
  type AdapterFactoryInput,
  type CameraMedia,
  type ExternalAutomation,
  type IntegrationAdapter,
  type NetworkSnapshot,
} from '../types.js';
import { commandToService, domainOf, mapConnectivity, mapEntity, mapHaHttpError, mapState, SUPPORTED_DOMAINS, type HaRegistryInfo, type HaState } from './mapping.js';

const REST_TIMEOUT_MS = 8000;
const WS_COMMAND_TIMEOUT_MS = 10000;
const HEARTBEAT_MS = 30000;
const MAX_BACKOFF_MS = 60000;

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Home Assistant integration.
 * - REST API (`/api/...`) for request/response: states, service calls, camera proxy.
 * - WebSocket API (`/api/websocket`) for `state_changed` subscriptions and registry metadata.
 * Reconnects with exponential backoff and re-reads all states after reconnecting,
 * so events missed during an outage are recovered.
 */
export class HomeAssistantAdapter implements IntegrationAdapter {
  readonly type = 'home_assistant' as const;
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly ctx: AdapterContext;
  private ws: WebSocket | null = null;
  private msgId = 0;
  private pending = new Map<number, Pending>();
  private stopped = false;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private lastUpdated = new Map<string, string>();

  constructor(input: AdapterFactoryInput) {
    if (!input.baseUrl) throw new AdapterError('integration_error', 'Home Assistant URL is missing.');
    if (!input.secret) throw new AdapterError('integration_auth_failed', 'Home Assistant access token is missing. Reconnect the integration.');
    this.baseUrl = input.baseUrl.replace(/\/+$/, '');
    this.token = input.secret;
    this.ctx = input.context;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    this.stopped = false;
    this.ctx.onStatusChange('connecting', 'Connecting to Home Assistant…');
    await this.rest('GET', '/api/'); // verifies URL + token (401 → auth_failed)
    await this.openSocket();
    await this.refreshAllStates();
    this.reconnectAttempt = 0;
    this.ctx.onStatusChange('connected', null);
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.reconnectTimer = null;
    this.heartbeat = null;
    this.rejectAllPending(new AdapterError('integration_disconnected', 'Integration disconnected.'));
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      ws.removeAllListeners();
      ws.on('error', () => undefined);
      ws.terminate();
    }
  }

  async healthCheck(): Promise<{ ok: boolean; message?: string }> {
    try {
      await this.rest('GET', '/api/');
      const wsOk = this.ws?.readyState === WebSocket.OPEN;
      return wsOk ? { ok: true } : { ok: false, message: 'REST API reachable but event stream is reconnecting.' };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  // ─── Discovery & state ──────────────────────────────────────────────────

  async discover(): Promise<AdapterDevice[]> {
    const states = (await this.rest('GET', '/api/states')) as HaState[];
    const registry = await this.loadRegistry().catch((e) => {
      this.ctx.logger.warn({ err: (e as Error).message }, 'HA registry metadata unavailable; continuing without areas/manufacturers');
      return new Map<string, HaRegistryInfo>();
    });
    const devices: AdapterDevice[] = [];
    for (const s of states) {
      if (!(SUPPORTED_DOMAINS as readonly string[]).includes(domainOf(s.entity_id))) continue;
      const reg = registry.get(s.entity_id);
      if (reg?.disabled) continue;
      const mapped = mapEntity(s, reg);
      if (mapped) devices.push(mapped);
    }
    return devices.sort((a, b) => a.name.localeCompare(b.name));
  }

  async readState(externalId: string): Promise<{ state: DeviceState; connectivity: ConnectivityState } | null> {
    try {
      const s = (await this.rest('GET', `/api/states/${encodeURIComponent(externalId)}`)) as HaState;
      return { state: mapState(s), connectivity: mapConnectivity(s) };
    } catch (e) {
      if (e instanceof AdapterError && e.code === 'device_unavailable') return null;
      throw e;
    }
  }

  async executeCommand(externalId: string, command: DeviceCommand, _capabilities: Capability[]): Promise<void> {
    const svc = commandToService(externalId, command);
    await this.rest('POST', `/api/services/${svc.domain}/${svc.service}`, svc.data);
  }

  // ─── Cameras ────────────────────────────────────────────────────────────

  async getCameraSnapshot(externalId: string): Promise<CameraMedia> {
    return this.binary(`/api/camera_proxy/${encodeURIComponent(externalId)}`, AbortSignal.timeout(REST_TIMEOUT_MS));
  }

  async openCameraStream(externalId: string, signal: AbortSignal): Promise<CameraMedia> {
    return this.binary(`/api/camera_proxy_stream/${encodeURIComponent(externalId)}`, signal);
  }

  // ─── Network (router-based device trackers) ─────────────────────────────

  async getNetworkSnapshot(): Promise<NetworkSnapshot | null> {
    const states = (await this.rest('GET', '/api/states')) as HaState[];
    const trackers = states.filter((s) => domainOf(s.entity_id) === 'device_tracker' && s.attributes.source_type === 'router');
    if (!trackers.length) return null;
    return {
      routers: [],
      clients: trackers.map((s) => ({
        id: s.entity_id,
        name: (s.attributes.friendly_name as string) ?? (s.attributes.host_name as string) ?? s.entity_id,
        ip: (s.attributes.ip as string) ?? null,
        mac: (s.attributes.mac as string) ?? null,
        connection: 'unknown' as const,
        signalDbm: null,
        lastSeenAt: s.last_updated ?? null,
        online: s.state === 'home',
        smartHomeDeviceId: null,
      })),
      bandwidth: null,
      guestNetwork: null,
      health: 'unknown',
    };
  }

  // ─── HA-owned automations ───────────────────────────────────────────────

  async listAutomations(): Promise<ExternalAutomation[]> {
    const states = (await this.rest('GET', '/api/states')) as HaState[];
    return states
      .filter((s) => domainOf(s.entity_id) === 'automation')
      .map((s) => ({
        externalId: s.entity_id,
        name: (s.attributes.friendly_name as string) ?? s.entity_id,
        enabled: s.state === 'on',
        lastTriggeredAt: (s.attributes.last_triggered as string) ?? null,
      }));
  }

  async setAutomationEnabled(externalId: string, enabled: boolean): Promise<void> {
    await this.rest('POST', `/api/services/automation/${enabled ? 'turn_on' : 'turn_off'}`, { entity_id: externalId });
  }

  async triggerAutomation(externalId: string): Promise<void> {
    await this.rest('POST', '/api/services/automation/trigger', { entity_id: externalId });
  }

  // ─── Internals: REST ────────────────────────────────────────────────────

  private async rest(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(this.baseUrl + path, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REST_TIMEOUT_MS),
        redirect: 'error',
      });
    } catch (e) {
      throw mapHaHttpError(null, e);
    }
    if (!res.ok) {
      const err = mapHaHttpError(res.status);
      if (err.code === 'integration_auth_failed') this.ctx.onStatusChange('auth_failed', err.message);
      throw err;
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  private async binary(path: string, signal: AbortSignal): Promise<CameraMedia> {
    let res: Response;
    try {
      res = await fetch(this.baseUrl + path, { headers: { Authorization: `Bearer ${this.token}` }, signal, redirect: 'error' });
    } catch (e) {
      throw mapHaHttpError(null, e);
    }
    if (!res.ok || !res.body) throw mapHaHttpError(res.status);
    return {
      contentType: res.headers.get('content-type') ?? 'application/octet-stream',
      stream: Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>),
    };
  }

  // ─── Internals: WebSocket ───────────────────────────────────────────────

  private wsUrl(): string {
    return this.baseUrl.replace(/^http/, 'ws') + '/api/websocket';
  }

  private openSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl(), { handshakeTimeout: REST_TIMEOUT_MS });
      this.ws = ws;
      let authed = false;
      const fail = (err: AdapterError) => {
        if (!authed) reject(err);
      };

      ws.on('message', (raw) => {
        let msg: { type: string; id?: number; success?: boolean; result?: unknown; error?: { message: string }; event?: { event_type: string; data: Record<string, unknown> }; message?: string };
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        switch (msg.type) {
          case 'auth_required':
            ws.send(JSON.stringify({ type: 'auth', access_token: this.token }));
            return;
          case 'auth_invalid':
            this.stopped = true; // do not retry with a bad token
            this.ctx.onStatusChange('auth_failed', 'Home Assistant rejected the access token.');
            fail(new AdapterError('integration_auth_failed', 'Home Assistant rejected the access token.'));
            ws.close();
            return;
          case 'auth_ok':
            authed = true;
            this.startHeartbeat();
            this.command({ type: 'subscribe_events', event_type: 'state_changed' })
              .then(() => resolve())
              .catch((e) => reject(e));
            return;
          case 'result':
          case 'pong': {
            const p = msg.id !== undefined ? this.pending.get(msg.id) : undefined;
            if (!p) return;
            clearTimeout(p.timer);
            this.pending.delete(msg.id!);
            if (msg.type === 'pong' || msg.success) p.resolve(msg.result);
            else p.reject(new AdapterError('integration_error', msg.error?.message ?? 'Home Assistant command failed.'));
            return;
          }
          case 'event':
            if (msg.event) this.handleEvent(msg.event);
            return;
        }
      });

      ws.on('error', (err) => {
        this.ctx.logger.debug({ err: err.message }, 'HA websocket error');
        fail(new AdapterError('integration_disconnected', 'Could not open the Home Assistant event stream.', true));
      });

      ws.on('close', () => {
        if (this.heartbeat) clearInterval(this.heartbeat);
        this.heartbeat = null;
        this.rejectAllPending(new AdapterError('integration_disconnected', 'Connection to Home Assistant was lost.', true));
        if (this.ws !== ws) return;
        this.ws = null;
        if (!authed) {
          fail(new AdapterError('integration_disconnected', 'Home Assistant closed the connection.', true));
          return;
        }
        if (!this.stopped) {
          this.ctx.onStatusChange('connecting', 'Connection lost — reconnecting…');
          this.scheduleReconnect();
        }
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.reconnectAttempt);
    const delay = base / 2 + Math.random() * (base / 2);
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.stopped) return;
      try {
        await this.openSocket();
        await this.refreshAllStates(); // recover anything missed while offline
        this.reconnectAttempt = 0;
        this.ctx.onStatusChange('connected', null);
        this.ctx.logger.info('Reconnected to Home Assistant');
      } catch (e) {
        const err = e as AdapterError;
        if (err.code === 'integration_auth_failed') return;
        this.ctx.onStatusChange('error', `Reconnect failed: ${err.message} Retrying…`);
        this.scheduleReconnect();
      }
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private startHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => {
      this.command({ type: 'ping' }).catch(() => this.ws?.terminate());
    }, HEARTBEAT_MS);
    this.heartbeat.unref?.();
  }

  private command(payload: Record<string, unknown>): Promise<unknown> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new AdapterError('integration_disconnected', 'Event stream is not connected.', true));
    const id = ++this.msgId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AdapterError('integration_timeout', 'Home Assistant did not answer in time.', true));
      }, WS_COMMAND_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, ...payload }));
    });
  }

  private rejectAllPending(err: Error): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(err);
      this.pending.delete(id);
    }
  }

  private handleEvent(event: { event_type: string; data: Record<string, unknown> }): void {
    if (event.event_type !== 'state_changed') {
      this.ctx.onIntegrationEvent(event.event_type, event.data);
      return;
    }
    const newState = event.data.new_state as HaState | null;
    const entityId = event.data.entity_id as string;
    if (!newState) {
      // Entity removed from HA
      this.ctx.onDeviceUpdate({ externalId: entityId, connectivity: 'unavailable' });
      return;
    }
    this.ingest(newState);
  }

  private ingest(s: HaState): void {
    // Drop duplicate deliveries of the same state revision
    if (s.last_updated && this.lastUpdated.get(s.entity_id) === s.last_updated) return;
    if (s.last_updated) this.lastUpdated.set(s.entity_id, s.last_updated);
    this.ctx.onDeviceUpdate({
      externalId: s.entity_id,
      state: mapState(s),
      connectivity: mapConnectivity(s),
      observedAt: s.last_updated ? new Date(s.last_updated) : undefined,
      dedupeKey: s.last_updated,
    });
  }

  private async refreshAllStates(): Promise<void> {
    const states = (await this.rest('GET', '/api/states')) as HaState[];
    for (const s of states) this.ingest(s);
  }

  private async loadRegistry(): Promise<Map<string, HaRegistryInfo>> {
    const [entities, devices, areas] = (await Promise.all([
      this.command({ type: 'config/entity_registry/list' }),
      this.command({ type: 'config/device_registry/list' }),
      this.command({ type: 'config/area_registry/list' }),
    ])) as [
      { entity_id: string; device_id: string | null; area_id: string | null; disabled_by: string | null }[],
      { id: string; manufacturer: string | null; model: string | null; area_id: string | null }[],
      { area_id: string; name: string }[],
    ];
    const areaName = new Map(areas.map((a) => [a.area_id, a.name]));
    const deviceById = new Map(devices.map((d) => [d.id, d]));
    const out = new Map<string, HaRegistryInfo>();
    for (const e of entities) {
      const dev = e.device_id ? deviceById.get(e.device_id) : undefined;
      const areaId = e.area_id ?? dev?.area_id ?? null;
      out.set(e.entity_id, {
        manufacturer: dev?.manufacturer ?? null,
        model: dev?.model ?? null,
        area: areaId ? (areaName.get(areaId) ?? null) : null,
        disabled: !!e.disabled_by,
      });
    }
    return out;
  }
}
