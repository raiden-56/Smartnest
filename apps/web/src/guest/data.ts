import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  DEFAULT_ROOM_SUGGESTIONS,
  PERMISSIONS,
  defaultDashboardLayout,
  describeCommand,
  type ActivityDto,
  type AuditLogDto,
  type AutomationDto,
  type AutomationExecutionDto,
  type Capability,
  type CommandDto,
  type ConnectivityState,
  type DashboardDto,
  type DeviceCategory,
  type DeviceCommand,
  type DeviceState,
  type DiscoveredDeviceDto,
  type HomeDto,
  type IntegrationDto,
  type InvitationDto,
  type MemberDto,
  type NotificationDto,
  type SceneExecutionDto,
  type SessionDto,
  type UserDto,
  type UserPreferences,
} from '@smartnest/shared';

/**
 * Sample household for guest mode. It mirrors the server's demonstration home
 * (apps/server/src/integrations/demo/catalog.ts and services/demoSetup.ts) and
 * adds a Home Assistant integration, members, history and activity, so every
 * screen has realistic, coherent content without a backend.
 */

export const HOME_ID = 'guest-home';
export const DEMO_INTEGRATION_ID = 'guest-int-demo';
export const HA_INTEGRATION_ID = 'guest-int-ha';
export const GUEST_USER_ID = 'guest-user';
export const GUEST_NAME = 'Alex Morgan';

export type EnergyRole = 'consumption' | 'solar' | 'battery' | 'ev' | 'device';

export interface RoomRecord {
  id: string;
  name: string;
  icon: string;
  coverImageUrl: string | null;
  isFavourite: boolean;
  sortOrder: number;
}

export interface IntegrationRecord {
  id: string;
  type: IntegrationDto['type'];
  name: string;
  status: IntegrationDto['status'];
  statusMessage: string | null;
  baseUrl: string | null;
  isDemo: boolean;
  lastSyncAt: string | null;
  lastConnectedAt: string | null;
  createdAt: string;
}

export interface DeviceRecord {
  id: string;
  integrationId: string;
  externalId: string;
  name: string;
  category: DeviceCategory;
  deviceType: string | null;
  manufacturer: string | null;
  model: string | null;
  roomId: string | null;
  isFavourite: boolean;
  isHidden: boolean;
  capabilities: Capability[];
  state: DeviceState;
  connectivity: ConnectivityState;
  stateUpdatedAt: string | null;
  lastSeenAt: string | null;
  lastCommandAt: string | null;
  lastError: string | null;
  createdAt: string;
  energyRole: EnergyRole | null;
  demoNote: string | null;
  /** Acknowledges commands but never changes state (commands time out). */
  unresponsive?: boolean;
}

export interface SceneRecord {
  id: string;
  name: string;
  icon: string;
  description: string;
  roomId: string | null;
  executionMode: 'parallel' | 'sequential';
  isFavourite: boolean;
  allowSensitiveActions: boolean;
  actions: { id: string; deviceId: string; command: DeviceCommand; order: number }[];
  createdAt: string;
  updatedAt: string;
}

export interface EnergyReading {
  deviceId: string;
  kind: EnergyRole;
  /** Start of the hour, epoch ms */
  t: number;
  kWh: number;
}

export interface GuestDb {
  user: UserDto;
  preferences: UserPreferences;
  home: Omit<HomeDto, 'role' | 'permissions'>;
  rooms: RoomRecord[];
  integrations: IntegrationRecord[];
  devices: DeviceRecord[];
  /** Devices an integration reports that have not been imported yet */
  notImported: Record<string, DiscoveredDeviceDto[]>;
  scenes: SceneRecord[];
  sceneExecutions: SceneExecutionDto[];
  automations: AutomationDto[];
  automationExecutions: AutomationExecutionDto[];
  commands: CommandDto[];
  activity: ActivityDto[];
  notifications: NotificationDto[];
  members: MemberDto[];
  invitations: InvitationDto[];
  sessions: SessionDto[];
  audit: AuditLogDto[];
  dashboard: DashboardDto;
  energy: EnergyReading[];
}

export const ALL_PERMISSIONS = [...PERMISSIONS];

// ─── Device catalogue ─────────────────────────────────────────────────────

interface Def {
  key: string;
  name: string;
  category: DeviceCategory;
  deviceType: string;
  model: string;
  manufacturer?: string;
  room: string | null;
  connectivity?: ConnectivityState;
  capabilities: Capability[];
  state: DeviceState;
  /** Imported from Home Assistant rather than the demo integration */
  ha?: string;
  favourite?: boolean;
  energyRole?: EnergyRole;
  demoNote?: string;
  lastError?: string;
  unresponsive?: boolean;
}

const M = 'SmartNest Demo';

const DEFS: Def[] = [
  // ── Living Room
  { key: 'living_ceiling', name: 'Ceiling Light', category: 'lighting', deviceType: 'ceiling_light', model: 'Simulated dimmable light', room: 'Living Room', favourite: true,
    capabilities: [{ type: 'onOff' }, { type: 'brightness', min: 0, max: 100 }, { type: 'colorTemperature', minKelvin: 2200, maxKelvin: 6500 }],
    state: { on: true, brightness: 72, colorTemperatureK: 3000 } },
  { key: 'living_lamp', name: 'Floor Lamp', category: 'lighting', deviceType: 'rgb_light', model: 'Simulated RGBW lamp', room: 'Living Room', favourite: true,
    capabilities: [{ type: 'onOff' }, { type: 'brightness', min: 0, max: 100 }, { type: 'colorRgb' }],
    state: { on: false, brightness: 0, colorRgb: [242, 140, 40] } },
  { key: 'living_ac', name: 'Living Room AC', category: 'climate', deviceType: 'air_conditioner', model: 'Simulated split AC', room: 'Living Room', favourite: true, energyRole: 'device',
    capabilities: [
      { type: 'onOff' },
      { type: 'temperatureSetpoint', min: 16, max: 30, step: 0.5, unit: 'C' },
      { type: 'hvacMode', modes: ['off', 'cool', 'heat', 'auto', 'dry', 'fan_only'] },
      { type: 'fanSpeed', presets: ['auto', 'low', 'medium', 'high'] },
      { type: 'swing', modes: ['off', 'vertical', 'horizontal', 'both'] },
      { type: 'sensor', measurement: 'temperature', unit: '°C', key: 'temperature', label: 'Current temperature' },
      { type: 'sensor', measurement: 'humidity', unit: '%', key: 'humidity', label: 'Humidity' },
      { type: 'power' },
    ],
    state: { on: true, hvacMode: 'cool', hvacAction: 'cooling', targetTemperature: 23, currentTemperature: 25.4, fanSpeed: 'auto', swingMode: 'vertical', measurements: { temperature: 25.4, humidity: 52 }, powerW: 860 } },
  { key: 'living_tv', name: 'Television', category: 'entertainment', deviceType: 'tv', model: 'Simulated smart TV', room: 'Living Room',
    capabilities: [
      { type: 'onOff' },
      { type: 'mediaPlayback', features: ['play', 'pause', 'stop', 'next', 'previous'] },
      { type: 'volume', canMute: true },
      { type: 'mediaSource', sources: ['HDMI 1', 'HDMI 2', 'Streaming app', 'Live TV'] },
      { type: 'power' },
    ],
    state: { on: false, mediaState: 'off', volume: 18, muted: false, mediaSource: 'Streaming app', powerW: 0 } },
  { key: 'living_curtains', name: 'Curtains', category: 'access', deviceType: 'curtain', model: 'Simulated curtain motor', room: 'Living Room', favourite: true,
    capabilities: [{ type: 'position', coverKind: 'curtain', canSetPosition: true, canStop: true }], state: { coverState: 'open', position: 100 } },
  { key: 'living_air', name: 'Air Quality Monitor', category: 'environment', deviceType: 'air_quality', model: 'Simulated AQ sensor', room: 'Living Room',
    capabilities: [
      { type: 'sensor', measurement: 'co2', unit: 'ppm', key: 'co2', label: 'CO₂' },
      { type: 'sensor', measurement: 'pm25', unit: 'µg/m³', key: 'pm25', label: 'PM2.5' },
      { type: 'sensor', measurement: 'temperature', unit: '°C', key: 'temperature', label: 'Temperature' },
      { type: 'sensor', measurement: 'humidity', unit: '%', key: 'humidity', label: 'Humidity' },
    ],
    state: { measurements: { co2: 640, pm25: 8, temperature: 24.8, humidity: 51 } } },
  { key: 'living_fan', name: 'Ceiling Fan', category: 'climate', deviceType: 'ceiling_fan', model: 'Simulated ceiling fan', room: 'Living Room',
    capabilities: [{ type: 'onOff' }, { type: 'fanSpeed', presets: ['low', 'medium', 'high'] }], state: { on: false, fanSpeed: 'medium' } },
  { key: 'vacuum', name: 'Robot Vacuum', category: 'cleaning', deviceType: 'robot_vacuum', model: 'Simulated robot vacuum', room: 'Living Room',
    capabilities: [{ type: 'vacuum', canLocate: true }, { type: 'battery' }], state: { vacuumState: 'docked', batteryLevel: 100 } },
  // ── Kitchen
  { key: 'kitchen_lights', name: 'Kitchen Lights', category: 'lighting', deviceType: 'switch', model: 'Simulated wall switch', room: 'Kitchen', capabilities: [{ type: 'onOff' }], state: { on: true } },
  { key: 'kitchen_coffee', name: 'Coffee Machine', category: 'electrical', deviceType: 'smart_plug', model: 'Simulated energy plug', room: 'Kitchen', favourite: true, energyRole: 'device',
    capabilities: [{ type: 'onOff' }, { type: 'power' }, { type: 'energy' }], state: { on: false, powerW: 0, energyKWh: 41.2 } },
  { key: 'kitchen_dishwasher', name: 'Dishwasher', category: 'appliance', deviceType: 'dishwasher', model: 'Simulated dishwasher', room: 'Kitchen', energyRole: 'device',
    capabilities: [{ type: 'onOff' }, { type: 'power' }, { type: 'customAction', actions: [{ id: 'eco_program', label: 'Start eco programme', sensitive: false }] }], state: { on: false, powerW: 1 } },
  { key: 'kitchen_leak', name: 'Under-sink Leak Sensor', category: 'safety', deviceType: 'water_leak', model: 'Simulated leak sensor', room: 'Kitchen',
    capabilities: [{ type: 'safetyAlarm', hazard: 'water_leak' }, { type: 'battery' }], state: { hazardDetected: false, batteryLevel: 64 } },
  { key: 'kitchen_smoke', name: 'Smoke Detector', category: 'safety', deviceType: 'smoke', model: 'Simulated smoke alarm', room: 'Kitchen',
    capabilities: [{ type: 'safetyAlarm', hazard: 'smoke' }, { type: 'battery' }], state: { hazardDetected: false, batteryLevel: 88 } },
  // ── Dining Room (Home Assistant)
  { key: 'dining_pendant', ha: 'light.dining_pendant', name: 'Dining Pendant', category: 'lighting', deviceType: 'ceiling_light', manufacturer: 'Signify', model: 'Hue White Ambiance', room: 'Dining Room',
    capabilities: [{ type: 'onOff' }, { type: 'brightness', min: 0, max: 100 }, { type: 'colorTemperature', minKelvin: 2200, maxKelvin: 6500 }],
    state: { on: true, brightness: 55, colorTemperatureK: 2700 } },
  { key: 'dining_climate', ha: 'sensor.dining_climate', name: 'Dining Climate Sensor', category: 'environment', deviceType: 'temperature_sensor', manufacturer: 'Aqara', model: 'Temperature & Humidity Sensor T1', room: 'Dining Room',
    capabilities: [
      { type: 'sensor', measurement: 'temperature', unit: '°C', key: 'temperature', label: 'Temperature' },
      { type: 'sensor', measurement: 'humidity', unit: '%', key: 'humidity', label: 'Humidity' },
      { type: 'sensor', measurement: 'pressure', unit: 'hPa', key: 'pressure', label: 'Pressure' },
      { type: 'battery' },
    ],
    state: { measurements: { temperature: 22.6, humidity: 47, pressure: 1014 }, batteryLevel: 91 } },
  // ── Bedroom
  { key: 'bedroom_lamp', name: 'Bedside Lamp', category: 'lighting', deviceType: 'lamp', model: 'Simulated dimmable lamp', room: 'Bedroom', favourite: true,
    capabilities: [{ type: 'onOff' }, { type: 'brightness', min: 0, max: 100 }, { type: 'colorTemperature', minKelvin: 2200, maxKelvin: 4000 }],
    state: { on: false, brightness: 0, colorTemperatureK: 2700 } },
  { key: 'bedroom_thermostat', name: 'Bedroom Thermostat', category: 'climate', deviceType: 'thermostat', model: 'Simulated thermostat', room: 'Bedroom',
    capabilities: [
      { type: 'temperatureSetpoint', min: 10, max: 28, step: 0.5, unit: 'C' },
      { type: 'hvacMode', modes: ['off', 'heat', 'auto'] },
      { type: 'sensor', measurement: 'temperature', unit: '°C', key: 'temperature', label: 'Current temperature' },
      { type: 'battery' },
    ],
    state: { hvacMode: 'heat', hvacAction: 'idle', on: true, targetTemperature: 20.5, currentTemperature: 21.2, measurements: { temperature: 21.2 }, batteryLevel: 76 } },
  { key: 'bedroom_blinds', name: 'Blinds', category: 'access', deviceType: 'blind', model: 'Simulated roller blind', room: 'Bedroom',
    capabilities: [{ type: 'position', coverKind: 'blind', canSetPosition: true, canStop: true }], state: { coverState: 'open', position: 60 } },
  { key: 'bedroom_window', name: 'Bedroom Window', category: 'access', deviceType: 'window_sensor', model: 'Simulated contact sensor', room: 'Bedroom',
    capabilities: [{ type: 'contact' }, { type: 'battery' }], state: { contactOpen: true, batteryLevel: 54 } },
  { key: 'bedroom_purifier', ha: 'fan.bedroom_purifier', name: 'Air Purifier', category: 'climate', deviceType: 'air_purifier', manufacturer: 'Xiaomi', model: 'Smart Air Purifier 4', room: 'Bedroom',
    capabilities: [{ type: 'onOff' }, { type: 'fanSpeed', presets: ['auto', 'sleep', 'favourite'] }, { type: 'sensor', measurement: 'pm25', unit: 'µg/m³', key: 'pm25', label: 'PM2.5' }],
    state: { on: true, fanSpeed: 'sleep', measurements: { pm25: 5 } } },
  // ── Bathroom
  { key: 'bathroom_fan', name: 'Exhaust Fan', category: 'climate', deviceType: 'exhaust_fan', model: 'Simulated exhaust fan', room: 'Bathroom', capabilities: [{ type: 'onOff' }], state: { on: false } },
  { key: 'bathroom_humidity', name: 'Bathroom Humidity', category: 'environment', deviceType: 'humidity_sensor', model: 'Simulated humidity sensor', room: 'Bathroom',
    capabilities: [{ type: 'sensor', measurement: 'humidity', unit: '%', key: 'humidity', label: 'Humidity' }, { type: 'sensor', measurement: 'temperature', unit: '°C', key: 'temperature', label: 'Temperature' }, { type: 'battery' }],
    state: { measurements: { humidity: 68, temperature: 23.1 }, batteryLevel: 12 } },
  // ── Office
  { key: 'office_lamp', name: 'Desk Lamp', category: 'lighting', deviceType: 'lamp', model: 'Simulated desk lamp', room: 'Office',
    capabilities: [{ type: 'onOff' }, { type: 'brightness', min: 0, max: 100 }], state: { on: true, brightness: 85 } },
  { key: 'office_plug', name: 'Workstation Plug', category: 'electrical', deviceType: 'smart_plug', model: 'Simulated energy plug', room: 'Office', energyRole: 'device',
    capabilities: [{ type: 'onOff' }, { type: 'power' }, { type: 'energy' }], state: { on: true, powerW: 142, energyKWh: 210.4 } },
  { key: 'office_speaker', name: 'Office Speaker', category: 'voice', deviceType: 'smart_speaker', model: 'Simulated voice-assistant speaker', room: 'Office',
    capabilities: [{ type: 'mediaPlayback', features: ['play', 'pause', 'next', 'previous'] }, { type: 'volume', canMute: true }],
    state: { mediaState: 'paused', mediaTitle: 'Focus playlist', volume: 30, muted: false } },
  { key: 'office_blinds', ha: 'cover.office_blinds', name: 'Office Blinds', category: 'access', deviceType: 'blind', manufacturer: 'IKEA', model: 'FYRTUR block-out roller blind', room: 'Office',
    capabilities: [{ type: 'position', coverKind: 'blind', canSetPosition: true, canStop: true }, { type: 'battery' }], state: { coverState: 'open', position: 40, batteryLevel: 72 } },
  // ── Entrance
  { key: 'front_lock', name: 'Front Door Lock', category: 'access', deviceType: 'door_lock', model: 'Simulated smart lock', room: 'Entrance', favourite: true,
    capabilities: [{ type: 'lock' }, { type: 'battery' }], state: { lockState: 'locked', locked: true, batteryLevel: 81 } },
  { key: 'front_contact', name: 'Front Door Sensor', category: 'access', deviceType: 'door_sensor', model: 'Simulated contact sensor', room: 'Entrance',
    capabilities: [{ type: 'contact' }, { type: 'battery' }], state: { contactOpen: false, batteryLevel: 92 } },
  { key: 'doorbell_cam', name: 'Doorbell Camera', category: 'security', deviceType: 'doorbell_camera', model: 'Simulated doorbell camera', room: 'Entrance',
    capabilities: [{ type: 'cameraStream', live: false, snapshot: true }, { type: 'motionDetectionToggle' }, { type: 'recording' }, { type: 'motion' }],
    state: { motionDetectionEnabled: true, recording: false, motion: false } },
  { key: 'hall_motion', name: 'Hallway Motion', category: 'security', deviceType: 'motion_sensor', model: 'Simulated PIR sensor', room: 'Entrance',
    capabilities: [{ type: 'motion' }, { type: 'battery' }, { type: 'sensor', measurement: 'illuminance', unit: 'lx', key: 'illuminance', label: 'Light level' }],
    state: { motion: false, batteryLevel: 17, measurements: { illuminance: 140 } } },
  { key: 'alarm', name: 'Alarm Panel', category: 'security', deviceType: 'alarm_panel', model: 'Simulated alarm panel', room: 'Entrance',
    capabilities: [{ type: 'alarmPanel', armModes: ['armed_home', 'armed_away', 'armed_night'], codeRequired: false }], state: { alarmState: 'disarmed' } },
  { key: 'porch_light', ha: 'light.porch', name: 'Porch Light', category: 'lighting', deviceType: 'outdoor_light', manufacturer: 'Shelly', model: 'Shelly 1 Mini', room: 'Entrance', connectivity: 'unavailable',
    capabilities: [{ type: 'onOff' }], state: {}, lastError: 'Home Assistant reports this entity as unavailable.' },
  { key: 'presence', name: 'Household Phone', category: 'security', deviceType: 'presence', model: 'Simulated presence tracker', room: null,
    capabilities: [{ type: 'presence' }], state: { present: true } },
  // ── Garage
  { key: 'garage_door', name: 'Garage Door', category: 'access', deviceType: 'garage_door', model: 'Simulated garage opener', room: 'Garage', favourite: true,
    capabilities: [{ type: 'position', coverKind: 'garage', canSetPosition: false, canStop: true }], state: { coverState: 'closed', position: 0 } },
  { key: 'ev_charger', name: 'EV Charger', category: 'energy', deviceType: 'ev_charger', model: 'Simulated 7 kW charger', room: 'Garage', energyRole: 'ev',
    capabilities: [{ type: 'onOff' }, { type: 'charging' }, { type: 'power' }, { type: 'energy' }], state: { on: true, charging: true, chargingState: 'Charging from solar surplus', powerW: 2200, energyKWh: 1288.5 } },
  { key: 'garage_cam', name: 'Garage Camera', category: 'security', deviceType: 'indoor_camera', model: 'Simulated IP camera', room: 'Garage', connectivity: 'offline',
    capabilities: [{ type: 'cameraStream', live: false, snapshot: true }, { type: 'recording' }], state: {}, demoNote: 'Simulates a camera that has gone offline.' },
  { key: 'garage_freezer', ha: 'switch.garage_freezer', name: 'Chest Freezer Plug', category: 'electrical', deviceType: 'smart_plug', manufacturer: 'Shelly', model: 'Plug S', room: 'Garage', energyRole: 'device',
    capabilities: [{ type: 'onOff' }, { type: 'power' }, { type: 'energy' }], state: { on: true, powerW: 86, energyKWh: 402.7 } },
  // ── Garden
  { key: 'garden_lights', name: 'Garden Lights', category: 'lighting', deviceType: 'garden_light', model: 'Simulated outdoor lights', room: 'Garden', connectivity: 'offline',
    capabilities: [{ type: 'onOff' }], state: {}, demoNote: 'Simulates a device that is offline, so commands fail with "device unavailable".' },
  { key: 'garden_cam', name: 'Garden Camera', category: 'security', deviceType: 'ptz_camera', model: 'Simulated PTZ camera', room: 'Garden',
    capabilities: [{ type: 'cameraStream', live: false, snapshot: true }, { type: 'ptz', pan: true, tilt: true, zoom: true }, { type: 'motionDetectionToggle' }, { type: 'recording' }],
    state: { motionDetectionEnabled: true, recording: true } },
  { key: 'irrigation', name: 'Irrigation Valve', category: 'garden', deviceType: 'water_valve', model: 'Simulated irrigation valve', room: 'Garden',
    capabilities: [{ type: 'valve' }, { type: 'battery' }], state: { valveOpen: false, batteryLevel: 47 } },
  { key: 'soil', name: 'Soil Moisture', category: 'garden', deviceType: 'soil_sensor', model: 'Simulated soil probe', room: 'Garden',
    capabilities: [{ type: 'sensor', measurement: 'soil_moisture', unit: '%', key: 'soil_moisture', label: 'Soil moisture' }, { type: 'battery' }],
    state: { measurements: { soil_moisture: 34 }, batteryLevel: 58 } },
  // ── Balcony
  { key: 'balcony_heater', name: 'Balcony Heater', category: 'climate', deviceType: 'heater', model: 'Simulated unresponsive heater', room: 'Balcony', unresponsive: true,
    capabilities: [{ type: 'onOff' }, { type: 'power' }], state: { on: false, powerW: 0 },
    demoNote: 'Simulates a device that acknowledges commands but never changes state, so commands time out.' },
  // ── Utility Room
  { key: 'meter', name: 'Smart Meter', category: 'energy', deviceType: 'smart_meter', model: 'Simulated grid meter', room: 'Utility Room', energyRole: 'consumption',
    capabilities: [{ type: 'power' }, { type: 'energy' }], state: { powerW: 1840, energyKWh: 18452.3 } },
  { key: 'solar', name: 'Solar Inverter', category: 'energy', deviceType: 'solar_inverter', model: 'Simulated 5 kW inverter', room: 'Utility Room', energyRole: 'solar',
    capabilities: [{ type: 'power' }, { type: 'energy' }], state: { powerW: 2350, energyKWh: 9120.7 } },
  { key: 'battery', name: 'Home Battery', category: 'energy', deviceType: 'home_battery', model: 'Simulated 10 kWh battery', room: 'Utility Room', energyRole: 'battery',
    capabilities: [{ type: 'battery' }, { type: 'charging' }, { type: 'power' }], state: { batteryLevel: 68, charging: true, chargingState: 'Charging from solar', powerW: 900 } },
  { key: 'washer', name: 'Washing Machine', category: 'appliance', deviceType: 'washing_machine', model: 'Simulated washer', room: 'Utility Room', energyRole: 'device',
    capabilities: [{ type: 'onOff' }, { type: 'power' }, { type: 'energy' }], state: { on: false, powerW: 2, energyKWh: 312.9 } },
  { key: 'router', name: 'Mesh Router', category: 'network', deviceType: 'router', manufacturer: 'SmartNest Demo', model: 'Simulated mesh router', room: 'Utility Room',
    capabilities: [{ type: 'sensor', measurement: 'signal_strength', unit: 'dBm', key: 'signal', label: 'Backhaul signal' }], state: { measurements: { signal: -42 } } },
];

const ROOMS = ['Living Room', 'Kitchen', 'Dining Room', 'Bedroom', 'Bathroom', 'Office', 'Entrance', 'Garage', 'Garden', 'Balcony', 'Utility Room'];
const ROOM_ICON = new Map(DEFAULT_ROOM_SUGGESTIONS.map((r) => [r.name, r.icon]));

/** Power drawn by simulated loads when switched on (and when off). */
export const POWER_ON: Record<string, [number, number]> = {
  kitchen_coffee: [1150, 0], living_tv: [95, 0], office_plug: [142, 0], washer: [1900, 2], kitchen_dishwasher: [1750, 1], living_ac: [860, 0], ev_charger: [6900, 0], garage_freezer: [86, 0],
};

export const roomId = (name: string) => `room-${name.toLowerCase().replace(/[^a-z]+/g, '-')}`;
export const deviceId = (key: string) => `dev-${key.replace(/_/g, '-')}`;

/** Deterministic pseudo-random numbers so the sample data is stable across reloads. */
export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Seed ─────────────────────────────────────────────────────────────────

export function createGuestDb(now = Date.now()): GuestDb {
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;
  const created = iso(92 * DAY);

  const user: UserDto = { id: GUEST_USER_ID, name: GUEST_NAME, email: 'guest@example.com', createdAt: created };

  const rooms: RoomRecord[] = ROOMS.map((name, i) => ({ id: roomId(name), name, icon: ROOM_ICON.get(name) ?? 'home', coverImageUrl: null, isFavourite: name === 'Living Room' || name === 'Bedroom', sortOrder: i }));

  const integrations: IntegrationRecord[] = [
    { id: DEMO_INTEGRATION_ID, type: 'demo', name: 'Demo Home', status: 'connected', statusMessage: null, baseUrl: null, isDemo: true, lastSyncAt: iso(2 * MIN), lastConnectedAt: iso(3 * HOUR), createdAt: created },
    { id: HA_INTEGRATION_ID, type: 'home_assistant', name: 'Home Assistant', status: 'connected', statusMessage: null, baseUrl: 'http://homeassistant.local:8123', isDemo: false, lastSyncAt: iso(4 * MIN), lastConnectedAt: iso(26 * HOUR), createdAt: iso(40 * DAY) },
  ];

  const devices: DeviceRecord[] = DEFS.map((d, i) => {
    const connectivity = d.connectivity ?? 'online';
    return {
      id: deviceId(d.key),
      integrationId: d.ha ? HA_INTEGRATION_ID : DEMO_INTEGRATION_ID,
      externalId: d.ha ?? `demo.${d.key}`,
      name: d.name,
      category: d.category,
      deviceType: d.deviceType,
      manufacturer: d.manufacturer ?? M,
      model: d.model,
      roomId: d.room ? roomId(d.room) : null,
      isFavourite: !!d.favourite,
      isHidden: false,
      capabilities: d.capabilities,
      state: structuredClone(d.state),
      connectivity,
      stateUpdatedAt: connectivity === 'online' ? iso((i % 9) * 7 * MIN + 40_000) : iso(5 * HOUR + i * MIN),
      lastSeenAt: connectivity === 'online' ? iso(20_000 + i * 1000) : iso(5 * HOUR + i * MIN),
      lastCommandAt: d.favourite ? iso((i + 1) * 23 * MIN) : null,
      lastError: d.lastError ?? (connectivity === 'offline' ? 'Device stopped responding.' : null),
      createdAt: d.ha ? iso(40 * DAY) : created,
      energyRole: d.energyRole ?? null,
      demoNote: d.demoNote ?? null,
      unresponsive: d.unresponsive,
    };
  });
  const dev = (key: string) => devices.find((d) => d.id === deviceId(key))!;

  const notImported: GuestDb['notImported'] = {
    [HA_INTEGRATION_ID]: [
      { externalId: 'sensor.hallway_thermometer', name: 'Hallway Thermometer', category: 'environment', deviceType: 'temperature_sensor', manufacturer: 'Aqara', model: 'Temperature Sensor', capabilities: [{ type: 'sensor', measurement: 'temperature', unit: '°C', key: 'temperature', label: 'Temperature' }, { type: 'battery' }], connectivity: 'online', suggestedRoom: 'Entrance', alreadyImported: false, importedDeviceId: null },
      { externalId: 'light.guest_room_lamp', name: 'Guest Room Lamp', category: 'lighting', deviceType: 'lamp', manufacturer: 'IKEA', model: 'TRÅDFRI bulb E27', capabilities: [{ type: 'onOff' }, { type: 'brightness', min: 0, max: 100 }], connectivity: 'online', suggestedRoom: null, alreadyImported: false, importedDeviceId: null },
      { externalId: 'media_player.kitchen_radio', name: 'Kitchen Radio', category: 'entertainment', deviceType: 'speaker', manufacturer: 'Sonos', model: 'Era 100', capabilities: [{ type: 'mediaPlayback', features: ['play', 'pause', 'next', 'previous'] }, { type: 'volume', canMute: true }], connectivity: 'online', suggestedRoom: 'Kitchen', alreadyImported: false, importedDeviceId: null },
    ],
  };

  // ── Scenes
  let actionSeq = 0;
  const act = (key: string, command: DeviceCommand, order = 0) => ({ id: `sa-${++actionSeq}`, deviceId: dev(key).id, command, order });
  const scene = (id: string, name: string, icon: string, description: string, executionMode: 'parallel' | 'sequential', isFavourite: boolean, allowSensitiveActions: boolean, actions: SceneRecord['actions'], roomName: string | null = null): SceneRecord => ({
    id, name, icon, description, executionMode, isFavourite, allowSensitiveActions, actions, roomId: roomName ? roomId(roomName) : null, createdAt: iso(60 * DAY), updatedAt: iso(9 * DAY),
  });
  const scenes: SceneRecord[] = [
    scene('scene-morning', 'Good Morning', 'sunrise', 'Open blinds, warm light and coffee.', 'parallel', true, false, [
      act('bedroom_blinds', { capability: 'position', action: 'open' }), act('bedroom_lamp', { capability: 'brightness', action: 'setBrightness', value: 60 }), act('kitchen_coffee', { capability: 'onOff', action: 'turnOn' }),
    ]),
    scene('scene-night', 'Good Night', 'moon', 'Lights off, blinds closed, front door locked.', 'sequential', true, true, [
      act('living_ceiling', { capability: 'onOff', action: 'turnOff' }, 0), act('living_lamp', { capability: 'onOff', action: 'turnOff' }, 1), act('kitchen_lights', { capability: 'onOff', action: 'turnOff' }, 2),
      act('bedroom_blinds', { capability: 'position', action: 'close' }, 3), act('front_lock', { capability: 'lock', action: 'lock' }, 4),
    ]),
    scene('scene-movie', 'Movie Time', 'clapperboard', 'Dim lights, close curtains, TV on.', 'parallel', true, false, [
      act('living_ceiling', { capability: 'brightness', action: 'setBrightness', value: 15 }), act('living_lamp', { capability: 'colorRgb', action: 'setColor', rgb: [242, 140, 40] }),
      act('living_curtains', { capability: 'position', action: 'close' }), act('living_tv', { capability: 'onOff', action: 'turnOn' }),
    ], 'Living Room'),
    scene('scene-away', 'Away Mode', 'plane', 'Everything off and the alarm armed. Requires confirmation.', 'sequential', false, true, [
      act('living_ceiling', { capability: 'onOff', action: 'turnOff' }, 0), act('office_lamp', { capability: 'onOff', action: 'turnOff' }, 1), act('living_ac', { capability: 'hvacMode', action: 'setHvacMode', mode: 'off' }, 2),
      act('front_lock', { capability: 'lock', action: 'lock' }, 3), act('alarm', { capability: 'alarmPanel', action: 'arm', mode: 'armed_away' }, 4),
    ]),
    scene('scene-welcome', 'Welcome Home', 'house', 'Lights on and comfortable temperature.', 'parallel', false, false, [
      act('living_ceiling', { capability: 'brightness', action: 'setBrightness', value: 80 }), act('living_ac', { capability: 'temperatureSetpoint', action: 'setTargetTemperature', value: 23 }), act('kitchen_lights', { capability: 'onOff', action: 'turnOn' }),
    ]),
    scene('scene-focus', 'Focus Mode', 'target', 'Bright desk light and focus music.', 'parallel', false, false, [
      act('office_lamp', { capability: 'brightness', action: 'setBrightness', value: 100 }), act('office_speaker', { capability: 'mediaPlayback', action: 'mediaCommand', command: 'play' }), act('office_blinds', { capability: 'position', action: 'setPosition', value: 70 }),
    ], 'Office'),
    scene('scene-relax', 'Relax', 'leaf', 'Warm, dim lighting in the living room.', 'parallel', false, false, [
      act('living_ceiling', { capability: 'colorTemperature', action: 'setColorTemperature', kelvin: 2400 }), act('living_lamp', { capability: 'brightness', action: 'setBrightness', value: 35 }),
    ], 'Living Room'),
    scene('scene-dinner', 'Dinner', 'utensils', 'Soft pendant light over the dining table.', 'parallel', false, false, [
      act('dining_pendant', { capability: 'brightness', action: 'setBrightness', value: 45 }), act('dining_pendant', { capability: 'colorTemperature', action: 'setColorTemperature', kelvin: 2400 }), act('kitchen_lights', { capability: 'onOff', action: 'turnOff' }),
    ], 'Dining Room'),
    scene('scene-lights-off', 'All Supported Lights Off', 'lightbulb-off', 'Includes the offline garden lights, so it reports a partial result.', 'parallel', true, false,
      ['living_ceiling', 'living_lamp', 'kitchen_lights', 'bedroom_lamp', 'office_lamp', 'garden_lights'].map((k) => act(k, { capability: 'onOff', action: 'turnOff' }))),
  ];

  const result = (s: SceneRecord, a: SceneRecord['actions'][number], status: SceneExecutionDto['results'][number]['status'], message: string | null = null) => ({
    actionId: a.id, deviceId: a.deviceId, deviceName: devices.find((d) => d.id === a.deviceId)!.name, description: describeCommand(a.command), status, message, commandId: null,
  });
  const sceneExecutions: SceneExecutionDto[] = [];
  const runScene = (s: SceneRecord, msAgo: number, source: 'user' | 'automation' = 'user') => {
    const offline = (deviceId: string) => devices.find((d) => d.id === deviceId)!.connectivity !== 'online';
    const results = s.actions.map((a) => (offline(a.deviceId) ? result(s, a, 'failed', 'The device is offline and did not receive the command.') : result(s, a, 'confirmed')));
    const ok = results.filter((r) => r.status === 'confirmed').length;
    sceneExecutions.push({
      id: `sx-${sceneExecutions.length + 1}`, sceneId: s.id, status: ok === results.length ? 'succeeded' : ok ? 'partial' : 'failed',
      startedAt: iso(msAgo), completedAt: iso(msAgo - 2400), source, results,
    });
  };
  for (let d = 6; d >= 0; d--) {
    runScene(scenes[0]!, d * DAY + 14 * HOUR);
    runScene(scenes[1]!, d * DAY + 1 * HOUR + 20 * MIN);
  }
  runScene(scenes[2]!, 2 * DAY + 4 * HOUR);
  runScene(scenes[2]!, 5 * DAY + 3 * HOUR);
  runScene(scenes[8]!, 1 * DAY + 2 * HOUR);
  runScene(scenes[5]!, 3 * HOUR, 'automation');
  runScene(scenes[7]!, 1 * DAY + 5 * HOUR);
  sceneExecutions.sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  // ── Automations
  const automations: AutomationDto[] = [
    {
      id: 'auto-hall-night', name: 'Hallway motion at night', description: 'Turn on the floor lamp at 20% when motion is detected after dark.', enabled: true, isDraft: false, executor: 'smartnest', externalId: null,
      triggers: [{ type: 'deviceState', deviceId: dev('hall_motion').id, attribute: 'motion', to: true }],
      conditions: [{ type: 'timeWindow', after: '20:00', before: '06:00' }], conditionOperator: 'and',
      actions: [{ type: 'deviceCommand', deviceId: dev('living_lamp').id, command: { capability: 'brightness', action: 'setBrightness', value: 20 } }],
      cooldownSeconds: 300, allowSensitiveActions: false, lastRunAt: iso(9 * HOUR), lastRunStatus: 'succeeded', createdAt: iso(60 * DAY), updatedAt: iso(12 * DAY),
    },
    {
      id: 'auto-co2', name: 'High CO₂ alert', description: 'Notify the household and turn on the ceiling fan when CO₂ exceeds 1000 ppm.', enabled: true, isDraft: false, executor: 'smartnest', externalId: null,
      triggers: [{ type: 'numericThreshold', deviceId: dev('living_air').id, attribute: 'measurement', measurementKey: 'co2', above: 1000 }],
      conditions: [], conditionOperator: 'and',
      actions: [{ type: 'notify', title: 'Ventilate the living room', message: 'CO₂ is above 1000 ppm.', severity: 'warning' }, { type: 'deviceCommand', deviceId: dev('living_fan').id, command: { capability: 'onOff', action: 'turnOn' } }],
      cooldownSeconds: 1800, allowSensitiveActions: false, lastRunAt: iso(2 * DAY + 3 * HOUR), lastRunStatus: 'succeeded', createdAt: iso(60 * DAY), updatedAt: iso(30 * DAY),
    },
    {
      id: 'auto-evening', name: 'Evening lights', description: 'Turn on the kitchen lights at 19:00 on weekdays.', enabled: false, isDraft: false, executor: 'smartnest', externalId: null,
      triggers: [{ type: 'time', at: '19:00', days: [1, 2, 3, 4, 5] }], conditions: [], conditionOperator: 'and',
      actions: [{ type: 'deviceCommand', deviceId: dev('kitchen_lights').id, command: { capability: 'onOff', action: 'turnOn' } }],
      cooldownSeconds: 60, allowSensitiveActions: false, lastRunAt: iso(8 * DAY), lastRunStatus: 'succeeded', createdAt: iso(60 * DAY), updatedAt: iso(8 * DAY),
    },
    {
      id: 'auto-focus', name: 'Weekday focus', description: 'Run the Focus Mode scene at 09:00 on weekdays when someone is home.', enabled: true, isDraft: false, executor: 'smartnest', externalId: null,
      triggers: [{ type: 'time', at: '09:00', days: [1, 2, 3, 4, 5] }], conditions: [{ type: 'presence', anyoneHome: true }], conditionOperator: 'and',
      actions: [{ type: 'activateScene', sceneId: 'scene-focus' }],
      cooldownSeconds: 60, allowSensitiveActions: false, lastRunAt: iso(3 * HOUR), lastRunStatus: 'succeeded', createdAt: iso(20 * DAY), updatedAt: iso(20 * DAY),
    },
    {
      id: 'auto-garden', name: 'Water the garden', description: 'Open the irrigation valve at sunrise when the soil is dry, then close it after 15 minutes.', enabled: true, isDraft: false, executor: 'smartnest', externalId: null,
      triggers: [{ type: 'sun', event: 'sunrise', offsetMinutes: 30 }],
      conditions: [{ type: 'numericState', deviceId: dev('soil').id, attribute: 'measurement', measurementKey: 'soil_moisture', below: 30 }], conditionOperator: 'and',
      actions: [{ type: 'deviceCommand', deviceId: dev('irrigation').id, command: { capability: 'valve', action: 'openValve' } }, { type: 'delay', seconds: 900 }, { type: 'deviceCommand', deviceId: dev('irrigation').id, command: { capability: 'valve', action: 'closeValve' } }],
      cooldownSeconds: 3600, allowSensitiveActions: false, lastRunAt: iso(1 * DAY + 18 * HOUR), lastRunStatus: 'skipped', createdAt: iso(15 * DAY), updatedAt: iso(15 * DAY),
    },
    {
      id: 'auto-leak', name: 'Leak alarm', description: 'Critical notification when the under-sink sensor detects water.', enabled: true, isDraft: false, executor: 'smartnest', externalId: null,
      triggers: [{ type: 'deviceState', deviceId: dev('kitchen_leak').id, attribute: 'hazardDetected', to: true }], conditions: [], conditionOperator: 'and',
      actions: [{ type: 'notify', title: 'Water leak detected', message: 'The under-sink sensor in the kitchen detected water.', severity: 'critical' }],
      cooldownSeconds: 600, allowSensitiveActions: false, lastRunAt: null, lastRunStatus: null, createdAt: iso(45 * DAY), updatedAt: iso(45 * DAY),
    },
    {
      id: 'auto-draft', name: 'Bathroom fan on humidity', description: 'Draft: run the exhaust fan while humidity is above 70%.', enabled: false, isDraft: true, executor: 'smartnest', externalId: null,
      triggers: [{ type: 'numericThreshold', deviceId: dev('bathroom_humidity').id, attribute: 'measurement', measurementKey: 'humidity', above: 70 }], conditions: [], conditionOperator: 'and',
      actions: [{ type: 'deviceCommand', deviceId: dev('bathroom_fan').id, command: { capability: 'onOff', action: 'turnOn' } }],
      cooldownSeconds: 300, allowSensitiveActions: false, lastRunAt: null, lastRunStatus: null, createdAt: iso(2 * DAY), updatedAt: iso(2 * DAY),
    },
    {
      id: 'auto-ha-porch', name: 'Porch light at sunset', description: 'Runs inside Home Assistant.', enabled: true, isDraft: false, executor: 'home_assistant', externalId: 'automation.porch_light_at_sunset',
      triggers: [{ type: 'sun', event: 'sunset', offsetMinutes: 0 }], conditions: [], conditionOperator: 'and',
      actions: [{ type: 'deviceCommand', deviceId: dev('porch_light').id, command: { capability: 'onOff', action: 'turnOn' } }],
      cooldownSeconds: 0, allowSensitiveActions: false, lastRunAt: iso(15 * HOUR), lastRunStatus: 'succeeded', createdAt: iso(40 * DAY), updatedAt: iso(4 * MIN),
    },
    {
      id: 'auto-ha-purifier', name: 'Purifier night mode', description: 'Runs inside Home Assistant.', enabled: true, isDraft: false, executor: 'home_assistant', externalId: 'automation.purifier_night_mode',
      triggers: [{ type: 'time', at: '22:30', days: [0, 1, 2, 3, 4, 5, 6] }], conditions: [], conditionOperator: 'and',
      actions: [{ type: 'deviceCommand', deviceId: dev('bedroom_purifier').id, command: { capability: 'fanSpeed', action: 'setFanSpeed', speed: 'sleep' } }],
      cooldownSeconds: 0, allowSensitiveActions: false, lastRunAt: iso(11 * HOUR), lastRunStatus: 'succeeded', createdAt: iso(40 * DAY), updatedAt: iso(4 * MIN),
    },
  ];

  const automationExecutions: AutomationExecutionDto[] = [];
  const execFor = (a: AutomationDto, msAgo: number, status: AutomationExecutionDto['status'], triggeredBy: string) => {
    automationExecutions.push({
      id: `ax-${automationExecutions.length + 1}`, automationId: a.id, status, triggeredBy, startedAt: iso(msAgo), completedAt: iso(msAgo - 1500),
      error: null,
      steps: status === 'skipped'
        ? [{ index: 0, type: 'condition', description: 'Conditions', status: 'skipped', message: 'Conditions were not met.' }]
        : a.actions.map((x, i) => ({ index: i, type: x.type, description: x.type === 'deviceCommand' ? `${devices.find((d) => d.id === x.deviceId)?.name ?? 'Device'}: ${describeCommand(x.command)}` : x.type === 'notify' ? `Notify “${x.title}”` : x.type === 'delay' ? `Wait ${x.seconds} s` : x.type === 'activateScene' ? `Run scene ${scenes.find((s) => s.id === x.sceneId)?.name ?? ''}` : 'Run automation', status: 'ok', message: null })),
    });
  };
  for (let d = 0; d < 5; d++) execFor(automations[0]!, d * DAY + 9 * HOUR, 'succeeded', 'Hallway Motion motion became true');
  execFor(automations[1]!, 2 * DAY + 3 * HOUR, 'succeeded', 'Air Quality Monitor co2 above 1000');
  execFor(automations[2]!, 8 * DAY, 'succeeded', 'Time 19:00');
  for (let d = 0; d < 4; d++) execFor(automations[3]!, d * DAY + 3 * HOUR, 'succeeded', 'Time 09:00');
  execFor(automations[4]!, 1 * DAY + 18 * HOUR, 'skipped', 'Sunrise +30 min');
  execFor(automations[4]!, 3 * DAY + 18 * HOUR, 'succeeded', 'Sunrise +30 min');
  automationExecutions.sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  // ── Commands (recent history per device)
  const commands: CommandDto[] = [];
  const addCommand = (key: string, command: DeviceCommand, msAgo: number, status: CommandDto['status'] = 'confirmed', source: CommandDto['source'] = 'user') => {
    const d = dev(key);
    commands.push({
      id: `cmd-seed-${commands.length + 1}`, deviceId: d.id, deviceName: d.name, command, description: describeCommand(command), status, verified: status === 'confirmed',
      errorCode: status === 'failed' ? 'device_unavailable' : status === 'timed_out' ? 'not_confirmed' : null,
      errorMessage: status === 'failed' ? 'The device is offline and did not receive the command.' : status === 'timed_out' ? 'The device did not report the requested state in time.' : null,
      source, createdAt: iso(msAgo), completedAt: iso(msAgo - 900),
    });
  };
  addCommand('living_ceiling', { capability: 'onOff', action: 'turnOn' }, 25 * MIN);
  addCommand('living_ceiling', { capability: 'brightness', action: 'setBrightness', value: 72 }, 24 * MIN);
  addCommand('living_ceiling', { capability: 'onOff', action: 'turnOff' }, 14 * HOUR, 'confirmed', 'scene');
  addCommand('living_lamp', { capability: 'onOff', action: 'turnOff' }, 14 * HOUR, 'confirmed', 'scene');
  addCommand('living_lamp', { capability: 'brightness', action: 'setBrightness', value: 20 }, 9 * HOUR, 'confirmed', 'automation');
  addCommand('living_ac', { capability: 'hvacMode', action: 'setHvacMode', mode: 'cool' }, 2 * HOUR);
  addCommand('living_ac', { capability: 'temperatureSetpoint', action: 'setTargetTemperature', value: 23 }, 2 * HOUR - MIN);
  addCommand('front_lock', { capability: 'lock', action: 'lock' }, 14 * HOUR, 'confirmed', 'scene');
  addCommand('front_lock', { capability: 'lock', action: 'unlock' }, 7 * HOUR);
  addCommand('front_lock', { capability: 'lock', action: 'lock' }, 7 * HOUR - 4 * MIN);
  addCommand('garden_lights', { capability: 'onOff', action: 'turnOff' }, 1 * DAY + 2 * HOUR, 'failed', 'scene');
  addCommand('balcony_heater', { capability: 'onOff', action: 'turnOn' }, 3 * DAY, 'timed_out');
  addCommand('kitchen_coffee', { capability: 'onOff', action: 'turnOn' }, 3 * HOUR, 'confirmed', 'scene');
  addCommand('kitchen_coffee', { capability: 'onOff', action: 'turnOff' }, 2 * HOUR + 30 * MIN);
  addCommand('garage_door', { capability: 'position', action: 'close' }, 10 * HOUR);
  addCommand('bedroom_lamp', { capability: 'brightness', action: 'setBrightness', value: 60 }, 3 * HOUR, 'confirmed', 'scene');
  addCommand('bedroom_lamp', { capability: 'onOff', action: 'turnOff' }, 2 * HOUR);
  commands.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // ── Activity
  type Seed = Omit<ActivityDto, 'id' | 'createdAt' | 'isDemo' | 'roomId' | 'category' | 'deviceId' | 'deviceName'> & { key?: string };
  const pattern: Seed[] = [
    { type: 'device.command', title: 'Ceiling Light turned on', detail: 'Brightness 72%', severity: 'success', result: 'success', source: 'user', actorName: GUEST_NAME, key: 'living_ceiling' },
    { type: 'device.state', title: 'Front Door Sensor opened', detail: null, severity: 'info', result: null, source: 'integration', actorName: null, key: 'front_contact' },
    { type: 'device.state', title: 'Front Door Sensor closed', detail: null, severity: 'info', result: null, source: 'integration', actorName: null, key: 'front_contact' },
    { type: 'camera.event', title: 'Motion at Doorbell Camera', detail: 'Someone approached the front door.', severity: 'info', result: null, source: 'integration', actorName: null, key: 'doorbell_cam' },
    { type: 'automation.executed', title: 'Hallway motion at night ran', detail: 'Floor Lamp: Set brightness to 20%', severity: 'success', result: 'success', source: 'automation', actorName: null, key: 'living_lamp' },
    { type: 'scene.executed', title: 'Good Morning activated', detail: 'All 3 actions confirmed.', severity: 'success', result: 'success', source: 'scene', actorName: GUEST_NAME },
    { type: 'device.command', title: 'Coffee Machine turned off', detail: null, severity: 'success', result: 'success', source: 'user', actorName: 'Priya Shah', key: 'kitchen_coffee' },
    { type: 'security.event', title: 'Front Door Lock unlocked', detail: 'Sensitive action confirmed by the user.', severity: 'warning', result: 'success', source: 'user', actorName: 'Sam Morgan', key: 'front_lock' },
    { type: 'security.event', title: 'Front Door Lock locked', detail: null, severity: 'info', result: 'success', source: 'user', actorName: 'Sam Morgan', key: 'front_lock' },
    { type: 'device.command', title: 'Living Room AC set to Cool', detail: 'Target 23.0°C', severity: 'success', result: 'success', source: 'user', actorName: GUEST_NAME, key: 'living_ac' },
    { type: 'scene.executed', title: 'Good Night activated', detail: 'All 5 actions confirmed.', severity: 'success', result: 'success', source: 'scene', actorName: 'Priya Shah' },
    { type: 'device.state', title: 'Hallway Motion detected motion', detail: null, severity: 'info', result: null, source: 'integration', actorName: null, key: 'hall_motion' },
    { type: 'device.state', title: 'EV Charger started charging', detail: '6.9 kW', severity: 'info', result: null, source: 'integration', actorName: null, key: 'ev_charger' },
    { type: 'device.command', title: 'Garage Door closed', detail: null, severity: 'success', result: 'success', source: 'user', actorName: GUEST_NAME, key: 'garage_door' },
    { type: 'automation.executed', title: 'Weekday focus ran', detail: 'Ran scene Focus Mode', severity: 'success', result: 'success', source: 'automation', actorName: null },
    { type: 'device.state', title: 'Washing Machine finished', detail: 'Cycle used 1.2 kWh', severity: 'info', result: null, source: 'integration', actorName: null, key: 'washer' },
  ];
  const singles: (Seed & { at: number })[] = [
    { type: 'device.battery_low', title: 'Bathroom Humidity battery low (12%)', detail: 'Replace the battery soon.', severity: 'warning', result: null, source: 'system', actorName: null, key: 'bathroom_humidity', at: 5 * HOUR + 10 * MIN },
    { type: 'device.battery_low', title: 'Hallway Motion battery low (17%)', detail: 'Replace the battery soon.', severity: 'warning', result: null, source: 'system', actorName: null, key: 'hall_motion', at: 1 * DAY + 6 * HOUR },
    { type: 'device.connectivity', title: 'Garden Lights went offline', detail: 'The device stopped responding.', severity: 'warning', result: null, source: 'integration', actorName: null, key: 'garden_lights', at: 5 * HOUR + 2 * MIN },
    { type: 'device.connectivity', title: 'Garage Camera went offline', detail: 'The device stopped responding.', severity: 'warning', result: null, source: 'integration', actorName: null, key: 'garage_cam', at: 5 * HOUR + 8 * MIN },
    { type: 'device.connectivity', title: 'Porch Light is unavailable', detail: 'Home Assistant reports this entity as unavailable.', severity: 'warning', result: null, source: 'integration', actorName: null, key: 'porch_light', at: 7 * HOUR + 30 * MIN },
    { type: 'scene.executed', title: 'All Supported Lights Off partly completed', detail: '5 of 6 actions confirmed. Garden Lights is offline.', severity: 'warning', result: 'failure', source: 'scene', actorName: GUEST_NAME, at: 1 * DAY + 2 * HOUR },
    { type: 'device.command', title: 'Balcony Heater did not confirm Turn on', detail: 'The device did not report the requested state in time.', severity: 'warning', result: 'failure', source: 'user', actorName: GUEST_NAME, key: 'balcony_heater', at: 3 * DAY },
    { type: 'automation.failed', title: 'Water the garden skipped', detail: 'Soil moisture was above 30%.', severity: 'info', result: null, source: 'automation', actorName: null, at: 1 * DAY + 18 * HOUR },
    { type: 'energy.threshold', title: 'Power use above 6 kW', detail: 'EV charging and the dishwasher ran at the same time.', severity: 'warning', result: null, source: 'system', actorName: null, at: 2 * DAY + 1 * HOUR },
    { type: 'integration.connected', title: 'Home Assistant reconnected', detail: 'Synced 6 devices and 2 automations.', severity: 'success', result: 'success', source: 'integration', actorName: null, at: 26 * HOUR },
    { type: 'integration.error', title: 'Home Assistant connection lost', detail: 'The server did not respond for 2 minutes.', severity: 'warning', result: 'failure', source: 'integration', actorName: null, at: 26 * HOUR + 3 * MIN },
    { type: 'home.member', title: 'Jordan Lee joined as a guest', detail: null, severity: 'info', result: null, source: 'user', actorName: 'Jordan Lee', at: 6 * DAY },
    { type: 'device.added', title: '3 devices imported from Home Assistant', detail: null, severity: 'success', result: 'success', source: 'user', actorName: 'Priya Shah', at: 9 * DAY },
    { type: 'device.state', title: 'Bedroom Window opened', detail: null, severity: 'info', result: null, source: 'integration', actorName: null, key: 'bedroom_window', at: 40 * MIN },
    { type: 'camera.event', title: 'Motion at Garden Camera', detail: 'Movement near the shed.', severity: 'info', result: null, source: 'integration', actorName: null, key: 'garden_cam', at: 2 * HOUR + 12 * MIN },
    { type: 'camera.event', title: 'Motion at Garden Camera', detail: 'A cat crossed the lawn.', severity: 'info', result: null, source: 'integration', actorName: null, key: 'garden_cam', at: 1 * DAY + 9 * HOUR },
    { type: 'camera.event', title: 'Person detected at Garden Camera', detail: 'Recorded a 30-second clip.', severity: 'warning', result: null, source: 'integration', actorName: null, key: 'garden_cam', at: 2 * DAY + 13 * HOUR },
  ];
  const toActivity = (s: Seed, at: number, n: number): ActivityDto => {
    const d = s.key ? dev(s.key) : null;
    const { key: _key, ...rest } = s;
    return { ...rest, id: `act-${n}`, deviceId: d?.id ?? null, deviceName: d?.name ?? null, roomId: d?.roomId ?? null, category: d?.category ?? null, createdAt: iso(at), isDemo: !d || d.integrationId === DEMO_INTEGRATION_ID };
  };
  const rnd = mulberry32(7);
  const activity: ActivityDto[] = [];
  let at = 3 * MIN;
  for (let i = 0; i < 110; i++) {
    activity.push(toActivity(pattern[i % pattern.length]!, at, activity.length + 1));
    at += Math.round((25 + rnd() * 70) * MIN);
  }
  for (const s of singles) activity.push(toActivity(s, s.at, activity.length + 1));
  activity.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // ── Notifications
  const notifications: NotificationDto[] = [
    { id: 'n-1', title: 'Bathroom Humidity battery low', body: 'Battery is at 12%. Replace it soon to keep readings coming.', severity: 'warning', category: 'lowBattery', link: `/devices/${dev('bathroom_humidity').id}`, readAt: null, createdAt: iso(5 * HOUR + 10 * MIN) },
    { id: 'n-2', title: 'Garden Lights went offline', body: 'The device stopped responding.', severity: 'warning', category: 'deviceOffline', link: `/devices/${dev('garden_lights').id}`, readAt: null, createdAt: iso(5 * HOUR + 2 * MIN) },
    { id: 'n-3', title: 'Porch Light is unavailable', body: 'Home Assistant reports this entity as unavailable.', severity: 'warning', category: 'deviceOffline', link: `/devices/${dev('porch_light').id}`, readAt: null, createdAt: iso(7 * HOUR + 30 * MIN) },
    { id: 'n-4', title: 'Power use above 6 kW', body: 'EV charging and the dishwasher ran at the same time.', severity: 'warning', category: 'energyThresholds', link: '/energy', readAt: iso(1 * DAY), createdAt: iso(2 * DAY + 1 * HOUR) },
    { id: 'n-5', title: 'Ventilate the living room', body: 'CO₂ is above 1000 ppm.', severity: 'warning', category: 'automation', link: '/automations/auto-co2', readAt: iso(2 * DAY), createdAt: iso(2 * DAY + 3 * HOUR) },
    { id: 'n-6', title: 'Home Assistant reconnected', body: 'Synced 6 devices and 2 automations.', severity: 'success', category: 'integrationFailures', link: `/integrations/${HA_INTEGRATION_ID}`, readAt: iso(20 * HOUR), createdAt: iso(26 * HOUR) },
  ];
  notifications.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const members: MemberDto[] = [
    { id: 'm-1', userId: GUEST_USER_ID, name: GUEST_NAME, email: user.email, role: 'owner', joinedAt: created },
    { id: 'm-2', userId: 'u-priya', name: 'Priya Shah', email: 'priya@example.com', role: 'admin', joinedAt: iso(80 * DAY) },
    { id: 'm-3', userId: 'u-sam', name: 'Sam Morgan', email: 'sam@example.com', role: 'member', joinedAt: iso(75 * DAY) },
    { id: 'm-4', userId: 'u-jordan', name: 'Jordan Lee', email: 'jordan@example.com', role: 'guest', joinedAt: iso(6 * DAY) },
  ];
  const invitations: InvitationDto[] = [
    { id: 'inv-1', email: 'grandma@example.com', role: 'member', expiresAt: new Date(now + 5 * DAY).toISOString(), createdAt: iso(2 * DAY) },
  ];
  const sessions: SessionDto[] = [
    { id: 'sess-current', current: true, userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'This browser', ipAddress: '192.168.1.21', createdAt: iso(2 * MIN), lastSeenAt: iso(0), expiresAt: new Date(now + 30 * DAY).toISOString() },
    { id: 'sess-phone', current: false, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1', ipAddress: '192.168.1.22', createdAt: iso(12 * DAY), lastSeenAt: iso(3 * HOUR), expiresAt: new Date(now + 18 * DAY).toISOString() },
  ];
  const audit: AuditLogDto[] = [
    { id: 'au-1', action: 'auth.login', actorName: GUEST_NAME, targetType: null, targetId: null, metadata: {}, ipAddress: '192.168.1.21', createdAt: iso(2 * MIN) },
    { id: 'au-2', action: 'device.command.sensitive', actorName: 'Sam Morgan', targetType: 'device', targetId: dev('front_lock').id, metadata: { action: 'unlock' }, ipAddress: '192.168.1.22', createdAt: iso(7 * HOUR) },
    { id: 'au-3', action: 'camera.view', actorName: GUEST_NAME, targetType: 'device', targetId: dev('doorbell_cam').id, metadata: {}, ipAddress: '192.168.1.21', createdAt: iso(20 * HOUR) },
    { id: 'au-4', action: 'integration.connected', actorName: 'Priya Shah', targetType: 'integration', targetId: HA_INTEGRATION_ID, metadata: { type: 'home_assistant' }, ipAddress: '192.168.1.30', createdAt: iso(40 * DAY) },
    { id: 'au-5', action: 'devices.imported', actorName: 'Priya Shah', targetType: 'integration', targetId: HA_INTEGRATION_ID, metadata: { count: 6 }, ipAddress: '192.168.1.30', createdAt: iso(40 * DAY - 5 * MIN) },
    { id: 'au-6', action: 'member.invited', actorName: GUEST_NAME, targetType: 'invitation', targetId: 'inv-1', metadata: { role: 'member' }, ipAddress: '192.168.1.21', createdAt: iso(2 * DAY) },
    { id: 'au-7', action: 'member.joined', actorName: 'Jordan Lee', targetType: 'member', targetId: 'm-4', metadata: { role: 'guest' }, ipAddress: '10.0.0.8', createdAt: iso(6 * DAY) },
    { id: 'au-8', action: 'member.role_changed', actorName: GUEST_NAME, targetType: 'member', targetId: 'm-2', metadata: { from: 'member', to: 'admin' }, ipAddress: '192.168.1.21', createdAt: iso(50 * DAY) },
    { id: 'au-9', action: 'scene.created', actorName: GUEST_NAME, targetType: 'scene', targetId: 'scene-dinner', metadata: { name: 'Dinner' }, ipAddress: '192.168.1.21', createdAt: iso(9 * DAY) },
    { id: 'au-10', action: 'automation.created', actorName: GUEST_NAME, targetType: 'automation', targetId: 'auto-draft', metadata: { name: 'Bathroom fan on humidity' }, ipAddress: '192.168.1.21', createdAt: iso(2 * DAY) },
    { id: 'au-11', action: 'home.updated', actorName: GUEST_NAME, targetType: 'home', targetId: HOME_ID, metadata: { fields: ['tariffPerKWh'] }, ipAddress: '192.168.1.21', createdAt: iso(30 * DAY) },
    { id: 'au-12', action: 'auth.login_failed', actorName: null, targetType: null, targetId: null, metadata: { email: 'sam@example.com' }, ipAddress: '203.0.113.42', createdAt: iso(4 * DAY) },
    { id: 'au-13', action: 'home.demo_created', actorName: GUEST_NAME, targetType: 'home', targetId: HOME_ID, metadata: {}, ipAddress: '192.168.1.21', createdAt: created },
  ];
  audit.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return {
    user,
    preferences: { temperatureUnit: 'home', reducedMotion: 'system', defaultHomeId: HOME_ID, deviceView: 'grid', notifications: { ...DEFAULT_NOTIFICATION_PREFERENCES, energyThresholds: true, energyThresholdW: 6000 } },
    home: {
      id: HOME_ID, name: 'Maple House', isDemo: true, timezone: 'Europe/London', locale: 'en-GB', temperatureUnit: 'C',
      latitude: 51.5072, longitude: -0.1276, currency: 'GBP', tariffPerKWh: 0.245, retentionDays: { activity: 90, stateSnapshots: 14, cameraEvents: 30 }, onboardingCompleted: true, createdAt: created,
    },
    rooms,
    integrations,
    devices,
    notImported,
    scenes,
    sceneExecutions,
    automations,
    automationExecutions,
    commands,
    activity,
    notifications,
    members,
    invitations,
    sessions,
    audit,
    dashboard: { widgets: defaultDashboardLayout(), isDefault: true },
    energy: seedEnergy(now),
  };
}

/** 30 days of hourly energy readings, following the server's demo history. */
function seedEnergy(now: number): EnergyReading[] {
  const rows: EnergyReading[] = [];
  const rnd = mulberry32(42);
  const hourStart = Math.floor(now / 3_600_000) * 3_600_000;
  for (let h = 30 * 24; h >= 0; h--) {
    const t = hourStart - h * 3_600_000;
    const date = new Date(t);
    const hour = date.getHours();
    const base = 0.35 + (hour >= 7 && hour <= 9 ? 0.6 : 0) + (hour >= 17 && hour <= 22 ? 1.1 : 0) + rnd() * 0.3;
    const ev = hour >= 0 && hour < 5 && date.getDay() % 2 === 0 ? 6.9 : 0;
    const ac = hour >= 13 && hour <= 19 ? 0.6 + rnd() * 0.3 : 0;
    const add = (key: string, kind: EnergyRole, kWh: number) => {
      if (kWh > 0) rows.push({ deviceId: deviceId(key), kind, t, kWh: Math.round(kWh * 1000) / 1000 });
    };
    add('meter', 'consumption', base + ev + ac);
    add('solar', 'solar', Math.max(0, Math.sin(((hour - 6) / 13) * Math.PI)) * (3.2 + rnd() * 1.2));
    add('ev_charger', 'ev', ev);
    add('living_ac', 'device', ac);
    add('kitchen_coffee', 'device', hour === 7 || hour === 8 ? 0.12 : 0);
    add('office_plug', 'device', hour >= 9 && hour <= 18 && date.getDay() % 6 !== 0 ? 0.14 : 0.01);
    add('washer', 'device', hour === 10 && date.getDay() === 6 ? 1.2 : 0);
    add('kitchen_dishwasher', 'device', hour === 21 && date.getDay() % 2 === 1 ? 1.05 : 0);
    add('garage_freezer', 'device', 0.05 + rnd() * 0.04);
  }
  return rows;
}
