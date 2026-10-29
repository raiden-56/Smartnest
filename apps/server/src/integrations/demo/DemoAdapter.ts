import { Readable } from 'node:stream';
import type { Capability, ConnectivityState, DeviceCommand, DeviceState } from '@smartnest/shared';
import { AdapterError, type AdapterContext, type AdapterDevice, type AdapterFactoryInput, type CameraMedia, type IntegrationAdapter, type NetworkSnapshot } from '../types.js';
import { DEMO_DEVICES, DEMO_UNRESPONSIVE } from './catalog.js';
import { renderDemoCameraSvg } from './cameraSvg.js';

interface SimDevice {
  state: DeviceState;
  connectivity: ConnectivityState;
}

const TICK_MS = 15_000;

/**
 * Simulated integration for demonstration mode. It behaves like a real
 * integration — asynchronous acknowledgements, delayed state changes,
 * offline devices, an unresponsive device — so the full command lifecycle
 * (pending → confirmed / failed / timed out) can be explored honestly.
 */
export class DemoAdapter implements IntegrationAdapter {
  readonly type = 'demo' as const;
  private readonly ctx: AdapterContext;
  private devices = new Map<string, SimDevice>();
  private timers = new Set<NodeJS.Timeout>();
  private ticker: NodeJS.Timeout | null = null;
  /** Speeds up simulated delays in tests */
  private readonly speed: number;

  constructor(input: AdapterFactoryInput) {
    this.ctx = input.context;
    this.speed = typeof input.config.speed === 'number' ? input.config.speed : 1;
  }

  async connect(): Promise<void> {
    for (const d of DEMO_DEVICES) this.devices.set(d.externalId, { state: structuredClone(d.state), connectivity: d.connectivity });
    // Restore state persisted from a previous run so restarts don't reset the demo home.
    for (const saved of await this.ctx.loadImportedDevices()) {
      const sim = this.devices.get(saved.externalId);
      if (sim && Object.keys(saved.state).length) sim.state = { ...sim.state, ...saved.state };
    }
    this.ticker = setInterval(() => this.tick(), TICK_MS / this.speed);
    this.ticker.unref?.();
    this.ctx.onStatusChange('connected', null);
  }

  async disconnect(): Promise<void> {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  async healthCheck() {
    return { ok: true };
  }

  async discover(): Promise<AdapterDevice[]> {
    return DEMO_DEVICES.map((d) => {
      const sim = this.devices.get(d.externalId);
      const { demoNote: _note, ...rest } = d;
      return { ...rest, state: structuredClone(sim?.state ?? d.state), connectivity: sim?.connectivity ?? d.connectivity };
    });
  }

  async readState(externalId: string) {
    const sim = this.devices.get(externalId);
    if (!sim) return null;
    return { state: structuredClone(sim.state), connectivity: sim.connectivity };
  }

  async executeCommand(externalId: string, cmd: DeviceCommand, caps: Capability[]): Promise<void> {
    const sim = this.devices.get(externalId);
    if (!sim) throw new AdapterError('device_unavailable', 'Device not found in the demo home.');
    await this.wait(120);
    if (sim.connectivity !== 'online') throw new AdapterError('device_unavailable', 'The device is offline and did not receive the command.');
    if (DEMO_UNRESPONSIVE.has(externalId)) return; // acknowledged, but nothing happens → command times out

    const settle = 350 + Math.random() * 650;
    switch (cmd.action) {
      case 'open':
      case 'close':
      case 'setPosition':
        this.animateCover(externalId, cmd.action === 'open' ? 100 : cmd.action === 'close' ? 0 : cmd.value, caps);
        return;
      case 'stop':
        this.clearCoverAnimation(externalId);
        this.later(200, () => this.apply(externalId, { coverState: 'stopped' }));
        return;
      case 'lock':
      case 'unlock': {
        const target = cmd.action === 'lock';
        this.apply(externalId, { lockState: target ? 'locking' : 'unlocking' });
        this.later(1400, () => this.apply(externalId, { lockState: target ? 'locked' : 'unlocked', locked: target }));
        return;
      }
      case 'arm':
        this.apply(externalId, { alarmState: 'arming' });
        this.later(2000, () => this.apply(externalId, { alarmState: cmd.mode }));
        return;
      case 'vacuumCommand':
        if (cmd.command === 'locate') return;
        if (cmd.command === 'returnToBase') {
          this.apply(externalId, { vacuumState: 'returning' });
          this.later(4000, () => this.apply(externalId, { vacuumState: 'docked' }));
          return;
        }
        this.later(settle, () => this.apply(externalId, { vacuumState: cmd.command === 'start' ? 'cleaning' : 'paused' }));
        return;
      case 'ptzMove':
      case 'custom':
        return; // momentary; acknowledged only
      default:
        this.later(settle, () => this.apply(externalId, this.nextState(sim.state, cmd)));
    }
  }

  async getCameraSnapshot(externalId: string): Promise<CameraMedia> {
    const sim = this.devices.get(externalId);
    const def = DEMO_DEVICES.find((d) => d.externalId === externalId);
    if (!sim || !def) throw new AdapterError('device_unavailable', 'Camera not found.');
    if (sim.connectivity !== 'online') throw new AdapterError('device_unavailable', 'Camera is offline.');
    const svg = renderDemoCameraSvg(def.name, externalId, new Date());
    return { contentType: 'image/svg+xml; charset=utf-8', stream: Readable.from([Buffer.from(svg)]) };
  }

  async getNetworkSnapshot(): Promise<NetworkSnapshot> {
    const now = Date.now();
    const ago = (s: number) => new Date(now - s * 1000).toISOString();
    // smartHomeDeviceId carries the device's externalId; the API maps it to a SmartNest device id.
    const client = (id: string, name: string, ip: string, connection: 'wifi' | 'ethernet', signal: number | null, seenAgo: number, ext: string | null = null) => ({
      id, name, ip, mac: null, connection, signalDbm: signal, lastSeenAt: ago(seenAgo), online: seenAgo < 600, smartHomeDeviceId: ext,
    });
    return {
      routers: [
        { id: 'router', name: 'Main Router', kind: 'router', status: 'online', clients: 14, uptimeSeconds: 864_000 + Math.floor(now / 1000) % 86400, firmware: 'demo-1.4.2', deviceId: null },
        { id: 'ap-upstairs', name: 'Mesh Point – Upstairs', kind: 'access_point', status: 'online', clients: 6, uptimeSeconds: 432_000, firmware: 'demo-1.4.2', deviceId: null },
        { id: 'ap-garden', name: 'Mesh Point – Garden', kind: 'access_point', status: 'offline', clients: null, uptimeSeconds: null, firmware: 'demo-1.4.0', deviceId: null },
      ],
      clients: [
        client('c1', 'Laptop', '192.168.1.21', 'wifi', -48, 12),
        client('c2', 'Phone', '192.168.1.22', 'wifi', -55, 30),
        client('c3', 'Tablet', '192.168.1.23', 'wifi', -67, 3600),
        client('c4', 'Workstation', '192.168.1.10', 'ethernet', null, 5),
        client('c5', 'Television', '192.168.1.40', 'ethernet', null, 20, 'demo.living_tv'),
        client('c6', 'Doorbell Camera', '192.168.1.51', 'wifi', -62, 8, 'demo.doorbell_cam'),
        client('c7', 'Garden Camera', '192.168.1.52', 'wifi', -74, 15, 'demo.garden_cam'),
        client('c8', 'Garage Camera', '192.168.1.53', 'wifi', -81, 5400, 'demo.garage_cam'),
        client('c9', 'EV Charger', '192.168.1.60', 'wifi', -70, 40, 'demo.ev_charger'),
        client('c10', 'Solar Inverter', '192.168.1.61', 'ethernet', null, 10, 'demo.solar'),
        client('c11', 'Office Speaker', '192.168.1.70', 'wifi', -51, 25, 'demo.office_speaker'),
        client('c12', 'Robot Vacuum', '192.168.1.71', 'wifi', -64, 90, 'demo.vacuum'),
        client('c13', 'Unknown device', '192.168.1.99', 'wifi', -77, 200),
        client('c14', 'Games Console', '192.168.1.30', 'ethernet', null, 7200),
      ],
      bandwidth: { downMbps: 182 + Math.round(Math.random() * 40), upMbps: 38 + Math.round(Math.random() * 8), measuredAt: new Date().toISOString() },
      guestNetwork: { enabled: false, supported: false },
      health: 'degraded',
    };
  }

  // ─── Simulation internals ───────────────────────────────────────────────

  private nextState(s: DeviceState, cmd: DeviceCommand): DeviceState {
    switch (cmd.action) {
      case 'turnOn':
        return { on: true, ...(s.brightness === 0 ? { brightness: 80 } : {}), ...(s.mediaState === 'off' ? { mediaState: 'idle' } : {}), ...(s.hvacMode === 'off' ? { hvacMode: 'auto' } : {}) };
      case 'turnOff':
        return { on: false, ...(s.brightness !== undefined ? { brightness: 0 } : {}), ...(s.mediaState ? { mediaState: 'off' } : {}), ...(s.hvacMode ? { hvacMode: 'off', hvacAction: 'off' } : {}) };
      case 'setBrightness':
        return { brightness: cmd.value, on: cmd.value > 0 };
      case 'setColor':
        return { colorRgb: cmd.rgb, on: true };
      case 'setColorTemperature':
        return { colorTemperatureK: cmd.kelvin, on: true };
      case 'setTargetTemperature':
        return { targetTemperature: cmd.value };
      case 'setHvacMode':
        return { hvacMode: cmd.mode, on: cmd.mode !== 'off', hvacAction: cmd.mode === 'off' ? 'off' : cmd.mode === 'cool' ? 'cooling' : cmd.mode === 'heat' ? 'heating' : 'idle' };
      case 'setFanSpeed':
        return { fanSpeed: cmd.speed };
      case 'setSwingMode':
        return { swingMode: cmd.mode };
      case 'disarm':
        return { alarmState: 'disarmed' };
      case 'mediaCommand':
        if (cmd.command === 'play') return { mediaState: 'playing', on: true };
        if (cmd.command === 'pause') return { mediaState: 'paused' };
        if (cmd.command === 'stop') return { mediaState: 'idle' };
        return { mediaTitle: cmd.command === 'next' ? 'Next track' : 'Previous track' };
      case 'setVolume':
        return { volume: cmd.value };
      case 'setMuted':
        return { muted: cmd.muted };
      case 'selectSource':
        return { mediaSource: cmd.source };
      case 'setMotionDetection':
        return { motionDetectionEnabled: cmd.enabled };
      case 'openValve':
        return { valveOpen: true };
      case 'closeValve':
        return { valveOpen: false };
      default:
        return {};
    }
  }

  private coverTimers = new Map<string, NodeJS.Timeout>();

  private clearCoverAnimation(id: string) {
    const t = this.coverTimers.get(id);
    if (t) {
      clearInterval(t);
      this.timers.delete(t);
      this.coverTimers.delete(id);
    }
  }

  private animateCover(id: string, target: number, caps: Capability[]) {
    this.clearCoverAnimation(id);
    const sim = this.devices.get(id)!;
    const start = sim.state.position ?? (sim.state.coverState === 'open' ? 100 : 0);
    if (start === target) {
      this.later(200, () => this.apply(id, { position: target, coverState: target === 0 ? 'closed' : 'open' }));
      return;
    }
    const garage = caps.some((c) => c.type === 'position' && c.coverKind === 'garage');
    const stepSize = garage ? 20 : 25;
    this.apply(id, { coverState: target > start ? 'opening' : 'closing' });
    const t = setInterval(() => {
      const cur = this.devices.get(id)!.state.position ?? start;
      const next = target > cur ? Math.min(target, cur + stepSize) : Math.max(target, cur - stepSize);
      if (next === target) {
        this.clearCoverAnimation(id);
        this.apply(id, { position: target, coverState: target === 0 ? 'closed' : 'open' });
      } else {
        this.apply(id, { position: next });
      }
    }, 600 / this.speed);
    this.timers.add(t);
    this.coverTimers.set(id, t);
  }

  private apply(externalId: string, patch: DeviceState) {
    const sim = this.devices.get(externalId);
    if (!sim) return;
    sim.state = { ...sim.state, ...patch };
    // Derived power for simulated loads
    if (patch.on !== undefined) {
      const powerOn: Record<string, number> = { 'demo.kitchen_coffee': 1150, 'demo.living_tv': 95, 'demo.office_plug': 142, 'demo.washer': 1900, 'demo.kitchen_dishwasher': 1750, 'demo.living_ac': 860, 'demo.ev_charger': 6900 };
      if (powerOn[externalId] !== undefined) sim.state.powerW = patch.on ? powerOn[externalId] : externalId === 'demo.washer' ? 2 : 0;
      if (externalId === 'demo.ev_charger') {
        sim.state.charging = patch.on;
        sim.state.chargingState = patch.on ? 'Charging' : 'Idle';
      }
    }
    this.ctx.onDeviceUpdate({ externalId, state: structuredClone(sim.state), connectivity: sim.connectivity });
  }

  private tick() {
    const jitter = (v: number, amount: number, min: number, max: number, decimals = 1) =>
      Math.round(Math.min(max, Math.max(min, v + (Math.random() - 0.5) * 2 * amount)) * 10 ** decimals) / 10 ** decimals;
    const hourFraction = TICK_MS / 3_600_000;

    for (const [id, sim] of this.devices) {
      if (sim.connectivity !== 'online') continue;
      const s = sim.state;
      let changed = false;
      if (s.measurements) {
        const m = { ...s.measurements };
        if (m.temperature !== undefined) m.temperature = jitter(m.temperature, 0.15, 15, 32);
        if (m.humidity !== undefined) m.humidity = jitter(m.humidity, 0.8, 25, 85, 0);
        if (m.co2 !== undefined) m.co2 = jitter(m.co2, 25, 420, 1600, 0);
        if (m.pm25 !== undefined) m.pm25 = jitter(m.pm25, 1, 1, 60, 0);
        if (m.soil_moisture !== undefined) m.soil_moisture = jitter(m.soil_moisture, 0.5, 10, 70, 0);
        if (m.illuminance !== undefined) m.illuminance = jitter(m.illuminance, 15, 0, 800, 0);
        s.measurements = m;
        if (m.temperature !== undefined && s.currentTemperature !== undefined) s.currentTemperature = m.temperature;
        changed = true;
      }
      if (id === 'demo.meter' || id === 'demo.solar') {
        const hour = new Date().getHours();
        if (id === 'demo.solar') {
          const daylight = Math.max(0, Math.sin(((hour - 6) / 13) * Math.PI));
          s.powerW = Math.round(daylight * (3800 + Math.random() * 600));
        } else {
          const loads = ['demo.kitchen_coffee', 'demo.living_tv', 'demo.office_plug', 'demo.washer', 'demo.kitchen_dishwasher', 'demo.living_ac', 'demo.ev_charger']
            .map((x) => this.devices.get(x)?.state.powerW ?? 0)
            .reduce((a, b) => a + b, 0);
          s.powerW = Math.round(320 + loads + Math.random() * 120);
        }
        changed = true;
      }
      if (s.energyKWh !== undefined && s.powerW !== undefined && s.powerW > 0) {
        s.energyKWh = Math.round((s.energyKWh + (s.powerW / 1000) * hourFraction) * 10000) / 10000;
        changed = true;
      }
      if (changed) this.ctx.onDeviceUpdate({ externalId: id, state: structuredClone(s), connectivity: sim.connectivity });
    }

    // Occasional motion in the hallway, cleared after ~30 s
    if (Math.random() < 0.15) {
      this.apply('demo.hall_motion', { motion: true });
      this.later(30_000, () => this.apply('demo.hall_motion', { motion: false }));
    }
  }

  private later(ms: number, fn: () => void) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms / this.speed);
    this.timers.add(t);
  }

  private wait(ms: number) {
    return new Promise<void>((r) => this.later(ms, r));
  }
}
