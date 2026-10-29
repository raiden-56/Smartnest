import type { Capability, ConnectivityState, DeviceCategory, DeviceCommand, DeviceState } from '@smartnest/shared';
import { AdapterError, type AdapterDevice } from '../types.js';

/** Shape of an entity from GET /api/states or a state_changed event. */
export interface HaState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed?: string;
  last_updated?: string;
}

export interface HaRegistryInfo {
  manufacturer?: string | null;
  model?: string | null;
  area?: string | null;
  /** Entity disabled in HA's entity registry */
  disabled?: boolean;
}

export const SUPPORTED_DOMAINS = [
  'light', 'switch', 'fan', 'climate', 'cover', 'lock', 'alarm_control_panel', 'media_player', 'sensor', 'binary_sensor', 'camera', 'vacuum', 'valve', 'device_tracker', 'person',
] as const;

// Home Assistant feature bit flags (documented in the HA developer docs per entity type)
const FAN_SET_SPEED = 1;
const FAN_OSCILLATE = 2;
const FAN_PRESET_MODE = 8;
const COVER_SET_POSITION = 4;
const COVER_STOP = 8;
const ALARM_ARM_HOME = 1;
const ALARM_ARM_AWAY = 2;
const ALARM_ARM_NIGHT = 4;
const MP_PAUSE = 1;
const MP_VOLUME_SET = 4;
const MP_VOLUME_MUTE = 8;
const MP_PREVIOUS = 16;
const MP_NEXT = 32;
const MP_TURN_ON = 128;
const MP_TURN_OFF = 256;
const MP_SELECT_SOURCE = 2048;
const MP_STOP = 4096;
const MP_PLAY = 16384;
const VACUUM_LOCATE = 512;

export function domainOf(entityId: string): string {
  return entityId.split('.')[0] ?? '';
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const features = (s: HaState) => num(s.attributes.supported_features) ?? 0;
const has = (s: HaState, flag: number) => (features(s) & flag) === flag;

export function mapConnectivity(s: HaState): ConnectivityState {
  if (s.state === 'unavailable') return 'unavailable';
  return 'online';
}

const SENSOR_CLASS_MAP: Record<string, { measurement: Extract<Capability, { type: 'sensor' }>['measurement']; key: string; category: DeviceCategory }> = {
  temperature: { measurement: 'temperature', key: 'temperature', category: 'environment' },
  humidity: { measurement: 'humidity', key: 'humidity', category: 'environment' },
  carbon_dioxide: { measurement: 'co2', key: 'co2', category: 'environment' },
  pm25: { measurement: 'pm25', key: 'pm25', category: 'environment' },
  pm10: { measurement: 'pm10', key: 'pm10', category: 'environment' },
  volatile_organic_compounds: { measurement: 'voc', key: 'voc', category: 'environment' },
  aqi: { measurement: 'aqi', key: 'aqi', category: 'environment' },
  illuminance: { measurement: 'illuminance', key: 'illuminance', category: 'environment' },
  pressure: { measurement: 'pressure', key: 'pressure', category: 'environment' },
  atmospheric_pressure: { measurement: 'pressure', key: 'pressure', category: 'environment' },
  moisture: { measurement: 'soil_moisture', key: 'soil_moisture', category: 'garden' },
  signal_strength: { measurement: 'signal_strength', key: 'signal_strength', category: 'network' },
};

const BINARY_SAFETY: Record<string, Extract<Capability, { type: 'safetyAlarm' }>['hazard']> = {
  smoke: 'smoke',
  carbon_monoxide: 'carbon_monoxide',
  gas: 'gas',
  moisture: 'water_leak',
  heat: 'heat',
  safety: 'other',
};

/**
 * Map one HA entity to a SmartNest device description. Returns null for
 * entities SmartNest does not support — they are never shown as controllable.
 */
export function mapEntity(s: HaState, reg: HaRegistryInfo = {}): AdapterDevice | null {
  const domain = domainOf(s.entity_id);
  const a = s.attributes;
  const name = str(a.friendly_name) ?? s.entity_id;
  const deviceClass = str(a.device_class) ?? null;
  const base = {
    externalId: s.entity_id,
    name,
    manufacturer: reg.manufacturer ?? null,
    model: reg.model ?? null,
    suggestedRoom: reg.area ?? null,
    connectivity: mapConnectivity(s),
  };
  const caps: Capability[] = [];
  let category: DeviceCategory = 'other';
  let deviceType: string | null = deviceClass;

  switch (domain) {
    case 'light': {
      category = 'lighting';
      deviceType = 'light';
      caps.push({ type: 'onOff' });
      const modes = Array.isArray(a.supported_color_modes) ? (a.supported_color_modes as string[]) : [];
      if (modes.some((m) => m !== 'onoff')) caps.push({ type: 'brightness', min: 0, max: 100 });
      if (modes.some((m) => ['hs', 'rgb', 'rgbw', 'rgbww', 'xy'].includes(m))) caps.push({ type: 'colorRgb' });
      if (modes.includes('color_temp')) {
        caps.push({ type: 'colorTemperature', minKelvin: num(a.min_color_temp_kelvin) ?? 2000, maxKelvin: num(a.max_color_temp_kelvin) ?? 6500 });
      }
      break;
    }
    case 'switch':
      category = deviceClass === 'outlet' ? 'electrical' : 'electrical';
      deviceType = deviceClass ?? 'switch';
      caps.push({ type: 'onOff' });
      break;
    case 'fan':
      category = 'climate';
      deviceType = 'fan';
      caps.push({ type: 'onOff' });
      if (has(s, FAN_PRESET_MODE) && Array.isArray(a.preset_modes) && a.preset_modes.length) {
        caps.push({ type: 'fanSpeed', presets: a.preset_modes as string[] });
      } else if (has(s, FAN_SET_SPEED)) {
        caps.push({ type: 'fanSpeed' });
      }
      if (has(s, FAN_OSCILLATE)) caps.push({ type: 'swing', modes: ['on', 'off'] });
      break;
    case 'climate': {
      category = 'climate';
      deviceType = 'thermostat';
      const hvacModes = (Array.isArray(a.hvac_modes) ? (a.hvac_modes as string[]) : []).filter((m) =>
        ['off', 'heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only'].includes(m),
      ) as Extract<Capability, { type: 'hvacMode' }>['modes'];
      if (hvacModes.length) caps.push({ type: 'hvacMode', modes: hvacModes });
      if (a.temperature !== undefined || a.min_temp !== undefined) {
        caps.push({
          type: 'temperatureSetpoint',
          min: num(a.min_temp) ?? 7,
          max: num(a.max_temp) ?? 35,
          step: num(a.target_temp_step) ?? 0.5,
          unit: str(a.temperature_unit) === '°F' ? 'F' : 'C',
        });
      }
      if (Array.isArray(a.fan_modes) && a.fan_modes.length) caps.push({ type: 'fanSpeed', presets: a.fan_modes as string[] });
      if (Array.isArray(a.swing_modes) && a.swing_modes.length) caps.push({ type: 'swing', modes: a.swing_modes as string[] });
      if (a.current_temperature !== undefined) caps.push({ type: 'sensor', measurement: 'temperature', unit: '°C', key: 'temperature', label: 'Current temperature' });
      if (a.current_humidity !== undefined) caps.push({ type: 'sensor', measurement: 'humidity', unit: '%', key: 'humidity', label: 'Humidity' });
      break;
    }
    case 'cover': {
      category = 'access';
      const kindMap: Record<string, Extract<Capability, { type: 'position' }>['coverKind']> = {
        garage: 'garage', gate: 'gate', curtain: 'curtain', blind: 'blind', shade: 'shade', window: 'window', awning: 'awning', shutter: 'blind',
      };
      caps.push({ type: 'position', coverKind: kindMap[deviceClass ?? ''] ?? 'other', canSetPosition: has(s, COVER_SET_POSITION), canStop: has(s, COVER_STOP) });
      deviceType = deviceClass ?? 'cover';
      break;
    }
    case 'lock':
      category = 'access';
      deviceType = 'lock';
      caps.push({ type: 'lock' });
      break;
    case 'alarm_control_panel': {
      category = 'security';
      deviceType = 'alarm_panel';
      const armModes: ('armed_home' | 'armed_away' | 'armed_night')[] = [];
      if (has(s, ALARM_ARM_HOME)) armModes.push('armed_home');
      if (has(s, ALARM_ARM_AWAY)) armModes.push('armed_away');
      if (has(s, ALARM_ARM_NIGHT)) armModes.push('armed_night');
      caps.push({ type: 'alarmPanel', armModes, codeRequired: a.code_format !== null && a.code_format !== undefined && a.code_arm_required !== false });
      break;
    }
    case 'media_player': {
      category = deviceClass === 'tv' ? 'entertainment' : deviceClass === 'speaker' ? 'entertainment' : 'entertainment';
      deviceType = deviceClass ?? 'media_player';
      if (has(s, MP_TURN_ON) && has(s, MP_TURN_OFF)) caps.push({ type: 'onOff' });
      const f: Extract<Capability, { type: 'mediaPlayback' }>['features'] = [];
      if (has(s, MP_PLAY)) f.push('play');
      if (has(s, MP_PAUSE)) f.push('pause');
      if (has(s, MP_STOP)) f.push('stop');
      if (has(s, MP_NEXT)) f.push('next');
      if (has(s, MP_PREVIOUS)) f.push('previous');
      if (f.length) caps.push({ type: 'mediaPlayback', features: f });
      if (has(s, MP_VOLUME_SET)) caps.push({ type: 'volume', canMute: has(s, MP_VOLUME_MUTE) });
      if (has(s, MP_SELECT_SOURCE) && Array.isArray(a.source_list) && a.source_list.length) caps.push({ type: 'mediaSource', sources: a.source_list as string[] });
      break;
    }
    case 'sensor': {
      if (deviceClass === 'battery') {
        category = 'other';
        caps.push({ type: 'battery' });
      } else if (deviceClass === 'power') {
        category = 'energy';
        caps.push({ type: 'power' });
      } else if (deviceClass === 'energy') {
        category = 'energy';
        caps.push({ type: 'energy' });
      } else if (deviceClass && SENSOR_CLASS_MAP[deviceClass]) {
        const m = SENSOR_CLASS_MAP[deviceClass]!;
        category = m.category;
        caps.push({ type: 'sensor', measurement: m.measurement, key: m.key, unit: str(a.unit_of_measurement) ?? '' });
      } else if (num(s.state) !== undefined && str(a.unit_of_measurement)) {
        category = 'environment';
        caps.push({ type: 'sensor', measurement: 'other', key: 'value', unit: str(a.unit_of_measurement)!, label: name });
      } else {
        return null; // text/enum sensors are not mapped
      }
      break;
    }
    case 'binary_sensor': {
      if (deviceClass === 'motion') {
        category = 'security';
        caps.push({ type: 'motion' });
      } else if (deviceClass === 'occupancy' || deviceClass === 'presence') {
        category = 'security';
        caps.push({ type: 'occupancy' });
      } else if (deviceClass && ['door', 'window', 'garage_door', 'opening'].includes(deviceClass)) {
        category = 'access';
        caps.push({ type: 'contact' });
      } else if (deviceClass && BINARY_SAFETY[deviceClass]) {
        category = 'safety';
        caps.push({ type: 'safetyAlarm', hazard: BINARY_SAFETY[deviceClass]! });
      } else {
        return null;
      }
      break;
    }
    case 'camera':
      category = 'security';
      deviceType = 'camera';
      // HA proxies snapshots (camera_proxy) and MJPEG (camera_proxy_stream) for all cameras.
      caps.push({ type: 'cameraStream', live: true, snapshot: true });
      if (a.motion_detection !== undefined) caps.push({ type: 'motionDetectionToggle' });
      caps.push({ type: 'recording' });
      break;
    case 'vacuum':
      category = 'cleaning';
      deviceType = 'robot_vacuum';
      caps.push({ type: 'vacuum', canLocate: has(s, VACUUM_LOCATE) });
      if (a.battery_level !== undefined) caps.push({ type: 'battery' });
      break;
    case 'valve':
      category = 'garden';
      deviceType = 'valve';
      caps.push({ type: 'valve' });
      break;
    case 'device_tracker':
    case 'person':
      category = 'security';
      deviceType = domain === 'person' ? 'person' : 'tracker';
      caps.push({ type: 'presence' });
      break;
    default:
      return null;
  }

  if (a.battery_level !== undefined && !caps.some((c) => c.type === 'battery') && domain !== 'vacuum') caps.push({ type: 'battery' });
  return { ...base, category, deviceType, capabilities: caps, state: mapState(s) };
}

const COVER_STATES = new Set(['open', 'closed', 'opening', 'closing']);
const LOCK_STATES = new Set(['locked', 'unlocked', 'locking', 'unlocking', 'jammed']);
const ALARM_STATES = new Set(['disarmed', 'armed_home', 'armed_away', 'armed_night', 'arming', 'pending', 'triggered']);

/** Normalise an HA state object into DeviceState. Unknown/unavailable values are omitted. */
export function mapState(s: HaState): DeviceState {
  const domain = domainOf(s.entity_id);
  const a = s.attributes;
  const out: DeviceState = {};
  const known = s.state !== 'unknown' && s.state !== 'unavailable';
  const battery = num(a.battery_level);
  if (battery !== undefined) out.batteryLevel = battery;

  switch (domain) {
    case 'light': {
      if (known) out.on = s.state === 'on';
      const b = num(a.brightness);
      if (b !== undefined) out.brightness = Math.round((b / 255) * 100);
      else if (s.state === 'off') out.brightness = 0;
      if (Array.isArray(a.rgb_color) && a.rgb_color.length === 3) out.colorRgb = a.rgb_color as [number, number, number];
      const k = num(a.color_temp_kelvin);
      if (k !== undefined) out.colorTemperatureK = k;
      break;
    }
    case 'switch':
      if (known) out.on = s.state === 'on';
      {
        const p = num(a.current_power_w);
        if (p !== undefined) out.powerW = p;
      }
      break;
    case 'fan': {
      if (known) out.on = s.state === 'on';
      const pm = str(a.preset_mode);
      const pct = num(a.percentage);
      if (pm) out.fanSpeed = pm;
      else if (pct !== undefined) out.fanSpeed = pct;
      if (typeof a.oscillating === 'boolean') out.swingMode = a.oscillating ? 'on' : 'off';
      break;
    }
    case 'climate': {
      if (known) {
        out.hvacMode = s.state;
        out.on = s.state !== 'off';
      }
      const cur = num(a.current_temperature);
      const tgt = num(a.temperature);
      const hum = num(a.current_humidity);
      if (cur !== undefined) out.currentTemperature = cur;
      if (tgt !== undefined) out.targetTemperature = tgt;
      if (str(a.hvac_action)) out.hvacAction = str(a.hvac_action);
      if (str(a.fan_mode)) out.fanSpeed = str(a.fan_mode);
      if (str(a.swing_mode)) out.swingMode = str(a.swing_mode);
      const m: Record<string, number> = {};
      if (cur !== undefined) m.temperature = cur;
      if (hum !== undefined) m.humidity = hum;
      if (Object.keys(m).length) out.measurements = m;
      break;
    }
    case 'cover': {
      if (COVER_STATES.has(s.state)) out.coverState = s.state as DeviceState['coverState'];
      const pos = num(a.current_position);
      if (pos !== undefined) out.position = pos;
      break;
    }
    case 'lock':
      if (LOCK_STATES.has(s.state)) {
        out.lockState = s.state as DeviceState['lockState'];
        if (s.state === 'locked') out.locked = true;
        if (s.state === 'unlocked') out.locked = false;
      }
      break;
    case 'alarm_control_panel':
      if (ALARM_STATES.has(s.state)) out.alarmState = s.state as DeviceState['alarmState'];
      break;
    case 'media_player': {
      if (known) {
        out.on = s.state !== 'off' && s.state !== 'standby';
        const ms = s.state === 'on' ? 'idle' : s.state === 'standby' ? 'off' : s.state;
        if (['playing', 'paused', 'idle', 'off', 'buffering'].includes(ms)) out.mediaState = ms as DeviceState['mediaState'];
      }
      const vol = num(a.volume_level);
      if (vol !== undefined) out.volume = Math.round(vol * 100);
      if (typeof a.is_volume_muted === 'boolean') out.muted = a.is_volume_muted;
      if (str(a.media_title)) out.mediaTitle = str(a.media_title);
      if (str(a.source)) out.mediaSource = str(a.source);
      break;
    }
    case 'sensor': {
      const v = num(s.state);
      if (v === undefined) break;
      const dc = str(a.device_class);
      if (dc === 'battery') out.batteryLevel = v;
      else if (dc === 'power') out.powerW = str(a.unit_of_measurement) === 'kW' ? v * 1000 : v;
      else if (dc === 'energy') out.energyKWh = str(a.unit_of_measurement) === 'Wh' ? v / 1000 : v;
      else if (dc && SENSOR_CLASS_MAP[dc]) out.measurements = { [SENSOR_CLASS_MAP[dc]!.key]: v };
      else out.measurements = { value: v };
      break;
    }
    case 'binary_sensor': {
      if (!known) break;
      const on = s.state === 'on';
      const dc = str(a.device_class) ?? '';
      if (dc === 'motion') out.motion = on;
      else if (dc === 'occupancy' || dc === 'presence') out.occupied = on;
      else if (['door', 'window', 'garage_door', 'opening'].includes(dc)) out.contactOpen = on;
      else if (BINARY_SAFETY[dc]) out.hazardDetected = on;
      break;
    }
    case 'camera':
      if (known) {
        out.recording = s.state === 'recording';
        out.streaming = s.state === 'streaming';
      }
      if (typeof a.motion_detection === 'boolean') out.motionDetectionEnabled = a.motion_detection;
      break;
    case 'vacuum':
      if (['cleaning', 'docked', 'returning', 'paused', 'idle', 'error'].includes(s.state)) out.vacuumState = s.state as DeviceState['vacuumState'];
      break;
    case 'valve':
      if (s.state === 'open' || s.state === 'closed') out.valveOpen = s.state === 'open';
      break;
    case 'device_tracker':
    case 'person':
      if (known) out.present = s.state === 'home';
      break;
  }
  return out;
}

export interface HaServiceCall {
  domain: string;
  service: string;
  data: Record<string, unknown>;
}

/** Translate a validated SmartNest command into exactly one documented HA service call. */
export function commandToService(entityId: string, cmd: DeviceCommand): HaServiceCall {
  const domain = domainOf(entityId);
  const call = (d: string, service: string, data: Record<string, unknown> = {}): HaServiceCall => ({ domain: d, service, data: { entity_id: entityId, ...data } });
  switch (cmd.action) {
    case 'turnOn':
      return call(domain, 'turn_on');
    case 'turnOff':
      return call(domain, 'turn_off');
    case 'setBrightness':
      return cmd.value === 0 ? call('light', 'turn_off') : call('light', 'turn_on', { brightness_pct: cmd.value });
    case 'setColor':
      return call('light', 'turn_on', { rgb_color: cmd.rgb });
    case 'setColorTemperature':
      return call('light', 'turn_on', { color_temp_kelvin: cmd.kelvin });
    case 'setTargetTemperature':
      return call('climate', 'set_temperature', { temperature: cmd.value });
    case 'setHvacMode':
      return call('climate', 'set_hvac_mode', { hvac_mode: cmd.mode });
    case 'setFanSpeed':
      if (domain === 'climate') return call('climate', 'set_fan_mode', { fan_mode: String(cmd.speed) });
      return typeof cmd.speed === 'number' ? call('fan', 'set_percentage', { percentage: cmd.speed }) : call('fan', 'set_preset_mode', { preset_mode: cmd.speed });
    case 'setSwingMode':
      if (domain === 'fan') return call('fan', 'oscillate', { oscillating: cmd.mode === 'on' });
      return call('climate', 'set_swing_mode', { swing_mode: cmd.mode });
    case 'open':
      return call('cover', 'open_cover');
    case 'close':
      return call('cover', 'close_cover');
    case 'stop':
      return call('cover', 'stop_cover');
    case 'setPosition':
      return call('cover', 'set_cover_position', { position: cmd.value });
    case 'lock':
      return call('lock', 'lock');
    case 'unlock':
      return call('lock', 'unlock');
    case 'arm':
      return call('alarm_control_panel', `alarm_arm_${cmd.mode.replace('armed_', '')}`, cmd.code ? { code: cmd.code } : {});
    case 'disarm':
      return call('alarm_control_panel', 'alarm_disarm', cmd.code ? { code: cmd.code } : {});
    case 'mediaCommand': {
      const svc = { play: 'media_play', pause: 'media_pause', stop: 'media_stop', next: 'media_next_track', previous: 'media_previous_track' }[cmd.command];
      return call('media_player', svc);
    }
    case 'setVolume':
      return call('media_player', 'volume_set', { volume_level: cmd.value / 100 });
    case 'setMuted':
      return call('media_player', 'volume_mute', { is_volume_muted: cmd.muted });
    case 'selectSource':
      return call('media_player', 'select_source', { source: cmd.source });
    case 'setMotionDetection':
      return call('camera', cmd.enabled ? 'enable_motion_detection' : 'disable_motion_detection');
    case 'vacuumCommand': {
      const svc = { start: 'start', pause: 'pause', returnToBase: 'return_to_base', locate: 'locate' }[cmd.command];
      return call('vacuum', svc);
    }
    case 'openValve':
      return call('valve', 'open_valve');
    case 'closeValve':
      return call('valve', 'close_valve');
    case 'ptzMove':
    case 'custom':
      throw new AdapterError('unsupported_capability', 'This action is not available through the Home Assistant integration.');
  }
}

/** Map HTTP/transport failures from HA to SmartNest error codes. */
export function mapHaHttpError(status: number | null, cause?: unknown): AdapterError {
  if (status === null) {
    const name = (cause as { name?: string } | undefined)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') return new AdapterError('integration_timeout', 'Home Assistant did not respond in time.', true);
    return new AdapterError('integration_disconnected', 'Home Assistant is not reachable.', true);
  }
  if (status === 401 || status === 403) return new AdapterError('integration_auth_failed', 'Home Assistant rejected the access token. Reconnect the integration with a new token.');
  if (status === 404) return new AdapterError('device_unavailable', 'Home Assistant does not know this entity any more.');
  if (status === 400) return new AdapterError('invalid_argument', 'Home Assistant rejected the command arguments.');
  if (status >= 500) return new AdapterError('integration_error', `Home Assistant returned an error (${status}).`, true);
  return new AdapterError('integration_error', `Unexpected response from Home Assistant (${status}).`);
}
