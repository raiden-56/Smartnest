import { z } from 'zod';

/**
 * Capabilities describe what a physical device can actually do or report.
 * Integration adapters declare capabilities per device; the UI renders
 * controls strictly from this list, so unsupported controls never appear.
 */

export const SENSOR_MEASUREMENTS = [
  'temperature',
  'humidity',
  'co2',
  'pm25',
  'pm10',
  'voc',
  'aqi',
  'illuminance',
  'pressure',
  'soil_moisture',
  'signal_strength',
  'other',
] as const;
export type SensorMeasurement = (typeof SENSOR_MEASUREMENTS)[number];

export const HVAC_MODES = ['off', 'heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only'] as const;
export type HvacMode = (typeof HVAC_MODES)[number];

export const ALARM_STATES = [
  'disarmed',
  'armed_home',
  'armed_away',
  'armed_night',
  'arming',
  'pending',
  'triggered',
] as const;
export type AlarmState = (typeof ALARM_STATES)[number];

export const capabilitySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('onOff') }),
  z.object({ type: z.literal('brightness'), min: z.number().default(0), max: z.number().default(100) }),
  z.object({ type: z.literal('colorRgb') }),
  z.object({ type: z.literal('colorTemperature'), minKelvin: z.number(), maxKelvin: z.number() }),
  z.object({
    type: z.literal('temperatureSetpoint'),
    min: z.number(),
    max: z.number(),
    step: z.number().positive().default(0.5),
    unit: z.enum(['C', 'F']).default('C'),
  }),
  z.object({ type: z.literal('hvacMode'), modes: z.array(z.enum(HVAC_MODES)).min(1) }),
  z.object({
    type: z.literal('fanSpeed'),
    /** Named presets (e.g. low/medium/high) — when absent, a 0-100 percentage is used. */
    presets: z.array(z.string()).optional(),
  }),
  z.object({ type: z.literal('swing'), modes: z.array(z.string()).min(1) }),
  z.object({
    type: z.literal('position'),
    /** What kind of cover this is — affects labels and confirmation rules. */
    coverKind: z.enum(['curtain', 'blind', 'shade', 'garage', 'gate', 'window', 'awning', 'other']).default('other'),
    canSetPosition: z.boolean().default(true),
    canStop: z.boolean().default(false),
  }),
  z.object({ type: z.literal('lock') }),
  z.object({ type: z.literal('alarmPanel'), armModes: z.array(z.enum(['armed_home', 'armed_away', 'armed_night'])), codeRequired: z.boolean().default(false) }),
  z.object({
    type: z.literal('mediaPlayback'),
    features: z.array(z.enum(['play', 'pause', 'stop', 'next', 'previous'])).min(1),
  }),
  z.object({ type: z.literal('volume'), canMute: z.boolean().default(true) }),
  z.object({ type: z.literal('mediaSource'), sources: z.array(z.string()).min(1) }),
  z.object({ type: z.literal('battery') }),
  z.object({ type: z.literal('power') }),
  z.object({ type: z.literal('energy') }),
  z.object({ type: z.literal('motion') }),
  z.object({ type: z.literal('contact') }),
  z.object({ type: z.literal('occupancy') }),
  z.object({ type: z.literal('presence') }),
  z.object({
    type: z.literal('safetyAlarm'),
    hazard: z.enum(['smoke', 'carbon_monoxide', 'gas', 'water_leak', 'heat', 'other']),
  }),
  z.object({
    type: z.literal('sensor'),
    measurement: z.enum(SENSOR_MEASUREMENTS),
    unit: z.string(),
    /** Attribute key in DeviceState.measurements */
    key: z.string(),
    label: z.string().optional(),
  }),
  z.object({ type: z.literal('cameraStream'), live: z.boolean(), snapshot: z.boolean() }),
  z.object({ type: z.literal('ptz'), pan: z.boolean(), tilt: z.boolean(), zoom: z.boolean() }),
  z.object({ type: z.literal('motionDetectionToggle') }),
  z.object({ type: z.literal('recording') }),
  z.object({ type: z.literal('charging') }),
  z.object({ type: z.literal('vacuum'), canLocate: z.boolean().default(false) }),
  z.object({ type: z.literal('valve') }),
  z.object({
    type: z.literal('customAction'),
    actions: z
      .array(z.object({ id: z.string().min(1), label: z.string().min(1), sensitive: z.boolean().default(false) }))
      .min(1),
  }),
]);

export type Capability = z.infer<typeof capabilitySchema>;
export type CapabilityType = Capability['type'];
export type CapabilityOf<T extends CapabilityType> = Extract<Capability, { type: T }>;

/** Capabilities that only report data and never accept commands. */
export const READ_ONLY_CAPABILITIES: ReadonlySet<CapabilityType> = new Set([
  'battery',
  'power',
  'energy',
  'motion',
  'contact',
  'occupancy',
  'presence',
  'safetyAlarm',
  'sensor',
  'recording',
  'charging',
]);

/**
 * Capabilities whose commands affect physical security or safety. They require
 * the `devices.control.sensitive` permission, explicit confirmation in the UI,
 * and are excluded from general-purpose scenes unless explicitly allowed.
 */
export const SENSITIVE_CAPABILITIES: ReadonlySet<CapabilityType> = new Set(['lock', 'alarmPanel']);

export function isCapabilityControllable(cap: Capability): boolean {
  return !READ_ONLY_CAPABILITIES.has(cap.type);
}

/**
 * Normalised, last known device state. Every field is optional: absence means
 * "not reported", which the UI renders as "Not available" — never a guess.
 */
export const deviceStateSchema = z
  .object({
    on: z.boolean(),
    brightness: z.number().min(0).max(100),
    colorRgb: z.tuple([z.number(), z.number(), z.number()]),
    colorTemperatureK: z.number(),
    currentTemperature: z.number(),
    targetTemperature: z.number(),
    hvacMode: z.string(),
    hvacAction: z.string(),
    fanSpeed: z.union([z.string(), z.number()]),
    swingMode: z.string(),
    position: z.number().min(0).max(100),
    coverState: z.enum(['open', 'closed', 'opening', 'closing', 'stopped']),
    locked: z.boolean(),
    lockState: z.enum(['locked', 'unlocked', 'locking', 'unlocking', 'jammed']),
    alarmState: z.enum(ALARM_STATES),
    mediaState: z.enum(['playing', 'paused', 'idle', 'off', 'buffering']),
    mediaTitle: z.string(),
    mediaSource: z.string(),
    volume: z.number().min(0).max(100),
    muted: z.boolean(),
    batteryLevel: z.number().min(0).max(100),
    powerW: z.number(),
    energyKWh: z.number(),
    motion: z.boolean(),
    contactOpen: z.boolean(),
    occupied: z.boolean(),
    present: z.boolean(),
    hazardDetected: z.boolean(),
    measurements: z.record(z.string(), z.number()),
    streaming: z.boolean(),
    motionDetectionEnabled: z.boolean(),
    recording: z.boolean(),
    charging: z.boolean(),
    chargingState: z.string(),
    vacuumState: z.enum(['cleaning', 'docked', 'returning', 'paused', 'idle', 'error']),
    valveOpen: z.boolean(),
  })
  .partial();

export type DeviceState = z.infer<typeof deviceStateSchema>;

/** Connectivity is tracked independently from operating state. */
export const CONNECTIVITY_STATES = ['online', 'offline', 'unavailable', 'unknown'] as const;
export type ConnectivityState = (typeof CONNECTIVITY_STATES)[number];

export const CONNECTIVITY_LABELS: Record<ConnectivityState, string> = {
  online: 'Online',
  offline: 'Offline',
  unavailable: 'Unavailable',
  unknown: 'Unknown',
};

export function hasCapability<T extends CapabilityType>(caps: readonly Capability[], type: T): CapabilityOf<T> | undefined {
  return caps.find((c): c is CapabilityOf<T> => c.type === type);
}

/** A device-level summary of what the operating state means, used in cards. */
export function describeOperatingState(state: DeviceState, caps: readonly Capability[]): string | null {
  if (hasCapability(caps, 'lock') && state.lockState) return capitalise(state.lockState);
  if (hasCapability(caps, 'alarmPanel') && state.alarmState) return capitalise(state.alarmState.replace('_', ' '));
  if (hasCapability(caps, 'position') && state.coverState) {
    return state.position !== undefined && state.coverState !== 'closed' && state.coverState !== 'open'
      ? `${capitalise(state.coverState)} · ${state.position}%`
      : capitalise(state.coverState) + (state.position !== undefined && state.coverState === 'open' ? ` · ${state.position}%` : '');
  }
  if (hasCapability(caps, 'vacuum') && state.vacuumState) return capitalise(state.vacuumState);
  if (hasCapability(caps, 'mediaPlayback') && state.mediaState) return capitalise(state.mediaState);
  if (hasCapability(caps, 'hvacMode') && state.hvacMode) {
    return state.hvacMode === 'off' ? 'Off' : capitalise(state.hvacMode.replace('_', ' '));
  }
  if (hasCapability(caps, 'onOff') && state.on !== undefined) {
    if (state.on && state.brightness !== undefined && hasCapability(caps, 'brightness')) return `On · ${Math.round(state.brightness)}%`;
    return state.on ? 'On' : 'Off';
  }
  if (hasCapability(caps, 'safetyAlarm') && state.hazardDetected !== undefined) return state.hazardDetected ? 'Hazard detected' : 'Clear';
  if (hasCapability(caps, 'contact') && state.contactOpen !== undefined) return state.contactOpen ? 'Open' : 'Closed';
  if (hasCapability(caps, 'motion') && state.motion !== undefined) return state.motion ? 'Motion detected' : 'No motion';
  if (hasCapability(caps, 'presence') && state.present !== undefined) return state.present ? 'Home' : 'Away';
  if (hasCapability(caps, 'valve') && state.valveOpen !== undefined) return state.valveOpen ? 'Open' : 'Closed';
  return null;
}

export function capitalise(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}
