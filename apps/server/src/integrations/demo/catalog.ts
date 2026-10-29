import type { AdapterDevice } from '../types.js';

/**
 * The simulated household used by demonstration mode. Every device reports
 * manufacturer "SmartNest Demo" and the integration is flagged isDemo, so the
 * UI labels all of it as demonstration data.
 */
type DemoDevice = AdapterDevice & { demoNote?: string };

const M = 'SmartNest Demo';

export const DEMO_DEVICES: DemoDevice[] = [
  // ── Living Room ─────────────────────────────────────────────
  {
    externalId: 'demo.living_ceiling', name: 'Ceiling Light', category: 'lighting', deviceType: 'ceiling_light', manufacturer: M, model: 'Simulated dimmable light',
    suggestedRoom: 'Living Room', connectivity: 'online',
    capabilities: [{ type: 'onOff' }, { type: 'brightness', min: 0, max: 100 }, { type: 'colorTemperature', minKelvin: 2200, maxKelvin: 6500 }],
    state: { on: true, brightness: 72, colorTemperatureK: 3000 },
  },
  {
    externalId: 'demo.living_lamp', name: 'Floor Lamp', category: 'lighting', deviceType: 'rgb_light', manufacturer: M, model: 'Simulated RGBW lamp',
    suggestedRoom: 'Living Room', connectivity: 'online',
    capabilities: [{ type: 'onOff' }, { type: 'brightness', min: 0, max: 100 }, { type: 'colorRgb' }],
    state: { on: false, brightness: 0, colorRgb: [242, 140, 40] },
  },
  {
    externalId: 'demo.living_ac', name: 'Living Room AC', category: 'climate', deviceType: 'air_conditioner', manufacturer: M, model: 'Simulated split AC',
    suggestedRoom: 'Living Room', connectivity: 'online',
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
    state: { on: true, hvacMode: 'cool', hvacAction: 'cooling', targetTemperature: 23, currentTemperature: 25.4, fanSpeed: 'auto', swingMode: 'vertical', measurements: { temperature: 25.4, humidity: 52 }, powerW: 860 },
  },
  {
    externalId: 'demo.living_tv', name: 'Television', category: 'entertainment', deviceType: 'tv', manufacturer: M, model: 'Simulated smart TV',
    suggestedRoom: 'Living Room', connectivity: 'online',
    capabilities: [
      { type: 'onOff' },
      { type: 'mediaPlayback', features: ['play', 'pause', 'stop', 'next', 'previous'] },
      { type: 'volume', canMute: true },
      { type: 'mediaSource', sources: ['HDMI 1', 'HDMI 2', 'Streaming app', 'Live TV'] },
      { type: 'power' },
    ],
    state: { on: false, mediaState: 'off', volume: 18, muted: false, mediaSource: 'Streaming app', powerW: 0 },
  },
  {
    externalId: 'demo.living_curtains', name: 'Curtains', category: 'access', deviceType: 'curtain', manufacturer: M, model: 'Simulated curtain motor',
    suggestedRoom: 'Living Room', connectivity: 'online',
    capabilities: [{ type: 'position', coverKind: 'curtain', canSetPosition: true, canStop: true }],
    state: { coverState: 'open', position: 100 },
  },
  {
    externalId: 'demo.living_air', name: 'Air Quality Monitor', category: 'environment', deviceType: 'air_quality', manufacturer: M, model: 'Simulated AQ sensor',
    suggestedRoom: 'Living Room', connectivity: 'online',
    capabilities: [
      { type: 'sensor', measurement: 'co2', unit: 'ppm', key: 'co2', label: 'CO₂' },
      { type: 'sensor', measurement: 'pm25', unit: 'µg/m³', key: 'pm25', label: 'PM2.5' },
      { type: 'sensor', measurement: 'temperature', unit: '°C', key: 'temperature', label: 'Temperature' },
      { type: 'sensor', measurement: 'humidity', unit: '%', key: 'humidity', label: 'Humidity' },
    ],
    state: { measurements: { co2: 640, pm25: 8, temperature: 24.8, humidity: 51 } },
  },
  {
    externalId: 'demo.living_fan', name: 'Ceiling Fan', category: 'climate', deviceType: 'ceiling_fan', manufacturer: M, model: 'Simulated ceiling fan',
    suggestedRoom: 'Living Room', connectivity: 'online',
    capabilities: [{ type: 'onOff' }, { type: 'fanSpeed', presets: ['low', 'medium', 'high'] }],
    state: { on: false, fanSpeed: 'medium' },
  },
  // ── Kitchen ─────────────────────────────────────────────────
  {
    externalId: 'demo.kitchen_lights', name: 'Kitchen Lights', category: 'lighting', deviceType: 'switch', manufacturer: M, model: 'Simulated wall switch',
    suggestedRoom: 'Kitchen', connectivity: 'online', capabilities: [{ type: 'onOff' }], state: { on: true },
  },
  {
    externalId: 'demo.kitchen_coffee', name: 'Coffee Machine', category: 'electrical', deviceType: 'smart_plug', manufacturer: M, model: 'Simulated energy plug',
    suggestedRoom: 'Kitchen', connectivity: 'online',
    capabilities: [{ type: 'onOff' }, { type: 'power' }, { type: 'energy' }],
    state: { on: false, powerW: 0, energyKWh: 41.2 },
  },
  {
    externalId: 'demo.kitchen_dishwasher', name: 'Dishwasher', category: 'appliance', deviceType: 'dishwasher', manufacturer: M, model: 'Simulated dishwasher',
    suggestedRoom: 'Kitchen', connectivity: 'online',
    capabilities: [{ type: 'onOff' }, { type: 'power' }, { type: 'customAction', actions: [{ id: 'eco_program', label: 'Start eco programme', sensitive: false }] }],
    state: { on: false, powerW: 1 },
  },
  {
    externalId: 'demo.kitchen_leak', name: 'Under-sink Leak Sensor', category: 'safety', deviceType: 'water_leak', manufacturer: M, model: 'Simulated leak sensor',
    suggestedRoom: 'Kitchen', connectivity: 'online', capabilities: [{ type: 'safetyAlarm', hazard: 'water_leak' }, { type: 'battery' }],
    state: { hazardDetected: false, batteryLevel: 64 },
  },
  {
    externalId: 'demo.kitchen_smoke', name: 'Smoke Detector', category: 'safety', deviceType: 'smoke', manufacturer: M, model: 'Simulated smoke alarm',
    suggestedRoom: 'Kitchen', connectivity: 'online', capabilities: [{ type: 'safetyAlarm', hazard: 'smoke' }, { type: 'battery' }],
    state: { hazardDetected: false, batteryLevel: 88 },
  },
  // ── Bedroom ─────────────────────────────────────────────────
  {
    externalId: 'demo.bedroom_lamp', name: 'Bedside Lamp', category: 'lighting', deviceType: 'lamp', manufacturer: M, model: 'Simulated dimmable lamp',
    suggestedRoom: 'Bedroom', connectivity: 'online',
    capabilities: [{ type: 'onOff' }, { type: 'brightness', min: 0, max: 100 }, { type: 'colorTemperature', minKelvin: 2200, maxKelvin: 4000 }],
    state: { on: false, brightness: 0, colorTemperatureK: 2700 },
  },
  {
    externalId: 'demo.bedroom_thermostat', name: 'Bedroom Thermostat', category: 'climate', deviceType: 'thermostat', manufacturer: M, model: 'Simulated thermostat',
    suggestedRoom: 'Bedroom', connectivity: 'online',
    capabilities: [
      { type: 'temperatureSetpoint', min: 10, max: 28, step: 0.5, unit: 'C' },
      { type: 'hvacMode', modes: ['off', 'heat', 'auto'] },
      { type: 'sensor', measurement: 'temperature', unit: '°C', key: 'temperature', label: 'Current temperature' },
      { type: 'battery' },
    ],
    state: { hvacMode: 'heat', hvacAction: 'idle', on: true, targetTemperature: 20.5, currentTemperature: 21.2, measurements: { temperature: 21.2 }, batteryLevel: 76 },
  },
  {
    externalId: 'demo.bedroom_blinds', name: 'Blinds', category: 'access', deviceType: 'blind', manufacturer: M, model: 'Simulated roller blind',
    suggestedRoom: 'Bedroom', connectivity: 'online',
    capabilities: [{ type: 'position', coverKind: 'blind', canSetPosition: true, canStop: true }],
    state: { coverState: 'open', position: 60 },
  },
  {
    externalId: 'demo.bedroom_window', name: 'Bedroom Window', category: 'access', deviceType: 'window_sensor', manufacturer: M, model: 'Simulated contact sensor',
    suggestedRoom: 'Bedroom', connectivity: 'online', capabilities: [{ type: 'contact' }, { type: 'battery' }],
    state: { contactOpen: true, batteryLevel: 54 },
  },
  // ── Bathroom ────────────────────────────────────────────────
  {
    externalId: 'demo.bathroom_fan', name: 'Exhaust Fan', category: 'climate', deviceType: 'exhaust_fan', manufacturer: M, model: 'Simulated exhaust fan',
    suggestedRoom: 'Bathroom', connectivity: 'online', capabilities: [{ type: 'onOff' }], state: { on: false },
  },
  {
    externalId: 'demo.bathroom_humidity', name: 'Bathroom Humidity', category: 'environment', deviceType: 'humidity_sensor', manufacturer: M, model: 'Simulated humidity sensor',
    suggestedRoom: 'Bathroom', connectivity: 'online',
    capabilities: [{ type: 'sensor', measurement: 'humidity', unit: '%', key: 'humidity', label: 'Humidity' }, { type: 'sensor', measurement: 'temperature', unit: '°C', key: 'temperature', label: 'Temperature' }, { type: 'battery' }],
    state: { measurements: { humidity: 68, temperature: 23.1 }, batteryLevel: 12 },
  },
  // ── Office ──────────────────────────────────────────────────
  {
    externalId: 'demo.office_lamp', name: 'Desk Lamp', category: 'lighting', deviceType: 'lamp', manufacturer: M, model: 'Simulated desk lamp',
    suggestedRoom: 'Office', connectivity: 'online',
    capabilities: [{ type: 'onOff' }, { type: 'brightness', min: 0, max: 100 }],
    state: { on: true, brightness: 85 },
  },
  {
    externalId: 'demo.office_plug', name: 'Workstation Plug', category: 'electrical', deviceType: 'smart_plug', manufacturer: M, model: 'Simulated energy plug',
    suggestedRoom: 'Office', connectivity: 'online', capabilities: [{ type: 'onOff' }, { type: 'power' }, { type: 'energy' }],
    state: { on: true, powerW: 142, energyKWh: 210.4 },
  },
  {
    externalId: 'demo.office_speaker', name: 'Office Speaker', category: 'voice', deviceType: 'smart_speaker', manufacturer: M, model: 'Simulated voice-assistant speaker',
    suggestedRoom: 'Office', connectivity: 'online',
    capabilities: [{ type: 'mediaPlayback', features: ['play', 'pause', 'next', 'previous'] }, { type: 'volume', canMute: true }],
    state: { mediaState: 'paused', mediaTitle: 'Focus playlist', volume: 30, muted: false },
  },
  // ── Entrance ────────────────────────────────────────────────
  {
    externalId: 'demo.front_lock', name: 'Front Door Lock', category: 'access', deviceType: 'door_lock', manufacturer: M, model: 'Simulated smart lock',
    suggestedRoom: 'Entrance', connectivity: 'online', capabilities: [{ type: 'lock' }, { type: 'battery' }],
    state: { lockState: 'locked', locked: true, batteryLevel: 81 },
  },
  {
    externalId: 'demo.front_contact', name: 'Front Door Sensor', category: 'access', deviceType: 'door_sensor', manufacturer: M, model: 'Simulated contact sensor',
    suggestedRoom: 'Entrance', connectivity: 'online', capabilities: [{ type: 'contact' }, { type: 'battery' }],
    state: { contactOpen: false, batteryLevel: 92 },
  },
  {
    externalId: 'demo.doorbell_cam', name: 'Doorbell Camera', category: 'security', deviceType: 'doorbell_camera', manufacturer: M, model: 'Simulated doorbell camera',
    suggestedRoom: 'Entrance', connectivity: 'online',
    capabilities: [{ type: 'cameraStream', live: false, snapshot: true }, { type: 'motionDetectionToggle' }, { type: 'recording' }, { type: 'motion' }],
    state: { motionDetectionEnabled: true, recording: false, motion: false },
  },
  {
    externalId: 'demo.hall_motion', name: 'Hallway Motion', category: 'security', deviceType: 'motion_sensor', manufacturer: M, model: 'Simulated PIR sensor',
    suggestedRoom: 'Entrance', connectivity: 'online', capabilities: [{ type: 'motion' }, { type: 'battery' }, { type: 'sensor', measurement: 'illuminance', unit: 'lx', key: 'illuminance', label: 'Light level' }],
    state: { motion: false, batteryLevel: 17, measurements: { illuminance: 140 } },
  },
  {
    externalId: 'demo.alarm', name: 'Alarm Panel', category: 'security', deviceType: 'alarm_panel', manufacturer: M, model: 'Simulated alarm panel',
    suggestedRoom: 'Entrance', connectivity: 'online', capabilities: [{ type: 'alarmPanel', armModes: ['armed_home', 'armed_away', 'armed_night'], codeRequired: false }],
    state: { alarmState: 'disarmed' },
  },
  {
    externalId: 'demo.presence', name: 'Household Phone', category: 'security', deviceType: 'presence', manufacturer: M, model: 'Simulated presence tracker',
    suggestedRoom: null, connectivity: 'online', capabilities: [{ type: 'presence' }], state: { present: true },
  },
  // ── Garage ──────────────────────────────────────────────────
  {
    externalId: 'demo.garage_door', name: 'Garage Door', category: 'access', deviceType: 'garage_door', manufacturer: M, model: 'Simulated garage opener',
    suggestedRoom: 'Garage', connectivity: 'online', capabilities: [{ type: 'position', coverKind: 'garage', canSetPosition: false, canStop: true }],
    state: { coverState: 'closed', position: 0 },
  },
  {
    externalId: 'demo.ev_charger', name: 'EV Charger', category: 'energy', deviceType: 'ev_charger', manufacturer: M, model: 'Simulated 7 kW charger',
    suggestedRoom: 'Garage', connectivity: 'online', capabilities: [{ type: 'onOff' }, { type: 'charging' }, { type: 'power' }, { type: 'energy' }],
    state: { on: true, charging: true, chargingState: 'Charging', powerW: 6900, energyKWh: 1288.5 },
  },
  {
    externalId: 'demo.garage_cam', name: 'Garage Camera', category: 'security', deviceType: 'indoor_camera', manufacturer: M, model: 'Simulated IP camera',
    suggestedRoom: 'Garage', connectivity: 'offline',
    capabilities: [{ type: 'cameraStream', live: false, snapshot: true }, { type: 'recording' }],
    state: {},
    demoNote: 'Simulates a camera that has gone offline.',
  },
  // ── Garden ──────────────────────────────────────────────────
  {
    externalId: 'demo.garden_lights', name: 'Garden Lights', category: 'lighting', deviceType: 'garden_light', manufacturer: M, model: 'Simulated outdoor lights',
    suggestedRoom: 'Garden', connectivity: 'offline', capabilities: [{ type: 'onOff' }], state: {},
    demoNote: 'Simulates a device that is offline, so commands fail with "device unavailable".',
  },
  {
    externalId: 'demo.garden_cam', name: 'Garden Camera', category: 'security', deviceType: 'ptz_camera', manufacturer: M, model: 'Simulated PTZ camera',
    suggestedRoom: 'Garden', connectivity: 'online',
    capabilities: [{ type: 'cameraStream', live: false, snapshot: true }, { type: 'ptz', pan: true, tilt: true, zoom: true }, { type: 'motionDetectionToggle' }, { type: 'recording' }],
    state: { motionDetectionEnabled: true, recording: true },
  },
  {
    externalId: 'demo.irrigation', name: 'Irrigation Valve', category: 'garden', deviceType: 'water_valve', manufacturer: M, model: 'Simulated irrigation valve',
    suggestedRoom: 'Garden', connectivity: 'online', capabilities: [{ type: 'valve' }, { type: 'battery' }], state: { valveOpen: false, batteryLevel: 47 },
  },
  {
    externalId: 'demo.soil', name: 'Soil Moisture', category: 'garden', deviceType: 'soil_sensor', manufacturer: M, model: 'Simulated soil probe',
    suggestedRoom: 'Garden', connectivity: 'online',
    capabilities: [{ type: 'sensor', measurement: 'soil_moisture', unit: '%', key: 'soil_moisture', label: 'Soil moisture' }, { type: 'battery' }],
    state: { measurements: { soil_moisture: 34 }, batteryLevel: 58 },
  },
  // ── Balcony ─────────────────────────────────────────────────
  {
    externalId: 'demo.balcony_heater', name: 'Balcony Heater', category: 'climate', deviceType: 'heater', manufacturer: M, model: 'Simulated unresponsive heater',
    suggestedRoom: 'Balcony', connectivity: 'online', capabilities: [{ type: 'onOff' }, { type: 'power' }], state: { on: false, powerW: 0 },
    demoNote: 'Simulates a device that acknowledges commands but never changes state, so commands time out.',
  },
  // ── Utility Room ────────────────────────────────────────────
  {
    externalId: 'demo.meter', name: 'Smart Meter', category: 'energy', deviceType: 'smart_meter', manufacturer: M, model: 'Simulated grid meter',
    suggestedRoom: 'Utility Room', connectivity: 'online', capabilities: [{ type: 'power' }, { type: 'energy' }],
    state: { powerW: 1840, energyKWh: 18452.3 },
  },
  {
    externalId: 'demo.solar', name: 'Solar Inverter', category: 'energy', deviceType: 'solar_inverter', manufacturer: M, model: 'Simulated 5 kW inverter',
    suggestedRoom: 'Utility Room', connectivity: 'online', capabilities: [{ type: 'power' }, { type: 'energy' }],
    state: { powerW: 2350, energyKWh: 9120.7 },
  },
  {
    externalId: 'demo.battery', name: 'Home Battery', category: 'energy', deviceType: 'home_battery', manufacturer: M, model: 'Simulated 10 kWh battery',
    suggestedRoom: 'Utility Room', connectivity: 'online', capabilities: [{ type: 'battery' }, { type: 'charging' }, { type: 'power' }],
    state: { batteryLevel: 68, charging: true, chargingState: 'Charging from solar', powerW: 900 },
  },
  {
    externalId: 'demo.washer', name: 'Washing Machine', category: 'appliance', deviceType: 'washing_machine', manufacturer: M, model: 'Simulated washer',
    suggestedRoom: 'Utility Room', connectivity: 'online', capabilities: [{ type: 'onOff' }, { type: 'power' }, { type: 'energy' }],
    state: { on: false, powerW: 2, energyKWh: 312.9 },
  },
  {
    externalId: 'demo.vacuum', name: 'Robot Vacuum', category: 'cleaning', deviceType: 'robot_vacuum', manufacturer: M, model: 'Simulated robot vacuum',
    suggestedRoom: 'Living Room', connectivity: 'online', capabilities: [{ type: 'vacuum', canLocate: true }, { type: 'battery' }],
    state: { vacuumState: 'docked', batteryLevel: 100 },
  },
];

export const DEMO_ROOMS = ['Living Room', 'Kitchen', 'Bedroom', 'Bathroom', 'Office', 'Entrance', 'Garage', 'Garden', 'Balcony', 'Utility Room'] as const;

/** Devices whose energy is tracked for the energy dashboard, and in which bucket. */
export const DEMO_ENERGY_KIND: Record<string, 'consumption' | 'solar' | 'battery' | 'ev'> = {
  'demo.meter': 'consumption',
  'demo.solar': 'solar',
  'demo.ev_charger': 'ev',
  'demo.battery': 'battery',
};

export const DEMO_UNRESPONSIVE = new Set(['demo.balcony_heater']);
