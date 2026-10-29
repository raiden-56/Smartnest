import type { CapabilityType } from './capabilities.js';

export const DEVICE_CATEGORIES = [
  'lighting',
  'electrical',
  'climate',
  'environment',
  'access',
  'security',
  'safety',
  'entertainment',
  'voice',
  'appliance',
  'cleaning',
  'garden',
  'energy',
  'network',
  'diy',
  'other',
] as const;
export type DeviceCategory = (typeof DEVICE_CATEGORIES)[number];

export interface CategoryInfo {
  id: DeviceCategory;
  label: string;
  /** lucide icon name, resolved by the frontend icon map */
  icon: string;
  types: string[];
  typicalCapabilities: CapabilityType[];
}

export const CATEGORY_INFO: Record<DeviceCategory, CategoryInfo> = {
  lighting: {
    id: 'lighting',
    label: 'Lighting',
    icon: 'lightbulb',
    types: ['Smart bulbs', 'Dimmable bulbs', 'RGB and RGBW lights', 'LED strips', 'Smart lamps', 'Ceiling lights', 'Garden lights', 'Lighting controllers'],
    typicalCapabilities: ['onOff', 'brightness', 'colorRgb', 'colorTemperature'],
  },
  electrical: {
    id: 'electrical',
    label: 'Electrical controls',
    icon: 'plug',
    types: ['Smart switches', 'Smart plugs', 'Wall outlets', 'Power strips', 'Relay modules', 'Energy-monitoring plugs', 'Circuit monitors'],
    typicalCapabilities: ['onOff', 'power', 'energy'],
  },
  climate: {
    id: 'climate',
    label: 'Climate & ventilation',
    icon: 'thermometer',
    types: ['Air conditioners', 'Thermostats', 'Air coolers', 'Heaters', 'Heat pumps', 'Ceiling fans', 'Exhaust fans', 'Ventilation systems'],
    typicalCapabilities: ['onOff', 'temperatureSetpoint', 'hvacMode', 'fanSpeed', 'swing', 'sensor'],
  },
  environment: {
    id: 'environment',
    label: 'Environmental monitoring',
    icon: 'gauge',
    types: ['Temperature sensors', 'Humidity sensors', 'Air-quality sensors', 'CO2 sensors', 'PM2.5 sensors', 'Light sensors', 'Pressure sensors'],
    typicalCapabilities: ['sensor', 'battery'],
  },
  access: {
    id: 'access',
    label: 'Doors & windows',
    icon: 'door-closed',
    types: ['Smart door locks', 'Digital locks', 'Garage doors', 'Gate controllers', 'Motorised curtains', 'Blinds', 'Window actuators', 'Contact sensors'],
    typicalCapabilities: ['lock', 'position', 'contact', 'battery'],
  },
  security: {
    id: 'security',
    label: 'Security & surveillance',
    icon: 'shield',
    types: ['Indoor cameras', 'Outdoor cameras', 'IP cameras', 'Doorbell cameras', 'PTZ cameras', 'NVR-connected cameras', 'Motion detectors', 'Door sensors', 'Window sensors', 'Alarm panels', 'Sirens'],
    typicalCapabilities: ['cameraStream', 'ptz', 'motion', 'contact', 'alarmPanel', 'motionDetectionToggle'],
  },
  safety: {
    id: 'safety',
    label: 'Safety',
    icon: 'siren',
    types: ['Smoke detectors', 'Carbon monoxide detectors', 'Water-leak sensors', 'Gas sensors', 'Safety alarm devices'],
    typicalCapabilities: ['safetyAlarm', 'battery'],
  },
  entertainment: {
    id: 'entertainment',
    label: 'Entertainment',
    icon: 'tv',
    types: ['Smart televisions', 'Streaming devices', 'AV receivers', 'Soundbars', 'Speakers', 'Media players'],
    typicalCapabilities: ['onOff', 'mediaPlayback', 'volume', 'mediaSource'],
  },
  voice: {
    id: 'voice',
    label: 'Voice assistants',
    icon: 'mic',
    types: ['Compatible Amazon Echo devices', 'Alexa-enabled devices', 'Compatible Google Nest devices', 'Other voice-assistant integrations'],
    typicalCapabilities: ['mediaPlayback', 'volume'],
  },
  appliance: {
    id: 'appliance',
    label: 'Appliances',
    icon: 'washing-machine',
    types: ['Washing machines', 'Dryers', 'Dishwashers', 'Refrigerators', 'Ovens', 'Kitchen appliances'],
    typicalCapabilities: ['onOff', 'power', 'sensor', 'customAction'],
  },
  cleaning: {
    id: 'cleaning',
    label: 'Cleaning',
    icon: 'bot',
    types: ['Robot vacuums', 'Robot mops', 'Cleaning appliances'],
    typicalCapabilities: ['vacuum', 'battery'],
  },
  garden: {
    id: 'garden',
    label: 'Garden',
    icon: 'sprout',
    types: ['Irrigation controllers', 'Sprinklers', 'Soil sensors', 'Pool controllers', 'Water valves'],
    typicalCapabilities: ['valve', 'onOff', 'sensor'],
  },
  energy: {
    id: 'energy',
    label: 'Energy',
    icon: 'zap',
    types: ['Smart meters', 'Power monitors', 'Solar inverters', 'Batteries', 'EV chargers', 'Energy-management systems'],
    typicalCapabilities: ['power', 'energy', 'battery', 'charging'],
  },
  network: {
    id: 'network',
    label: 'Network',
    icon: 'router',
    types: ['Routers', 'Mesh access points', 'Wi-Fi access points', 'Network switches', 'Connected network clients'],
    typicalCapabilities: ['sensor'],
  },
  diy: {
    id: 'diy',
    label: 'DIY',
    icon: 'cpu',
    types: ['ESPHome devices', 'MQTT-connected devices', 'Microcontrollers', 'Custom sensors', 'Custom relays', 'Custom integrations'],
    typicalCapabilities: ['onOff', 'sensor', 'customAction'],
  },
  other: {
    id: 'other',
    label: 'Other',
    icon: 'box',
    types: ['Devices that do not fit another category'],
    typicalCapabilities: [],
  },
};

export const INTEGRATION_TYPES = ['demo', 'home_assistant', 'mqtt', 'matter', 'onvif', 'zigbee_zwave', 'manufacturer'] as const;
export type IntegrationType = (typeof INTEGRATION_TYPES)[number];

/** How fully this build of SmartNest implements an integration. */
export type SupportLevel = 'supported' | 'via_home_assistant' | 'planned';

export interface IntegrationDefinition {
  type: IntegrationType;
  name: string;
  summary: string;
  supportLevel: SupportLevel;
  /** What the user needs before they start. */
  requirements: string[];
  /** Step-by-step setup guidance shown in the wizard. */
  setupSteps: string[];
  authMethod: 'none' | 'long_lived_token' | 'username_password' | 'oauth' | 'pairing_code';
  supportedCategories: DeviceCategory[];
  supportedCapabilities: CapabilityType[];
  limitations: string[];
  docsUrl?: string;
}

export const INTEGRATIONS: Record<IntegrationType, IntegrationDefinition> = {
  demo: {
    type: 'demo',
    name: 'Demonstration home',
    summary: 'A simulated home for exploring SmartNest without hardware. Every device and reading is clearly labelled as demo data.',
    supportLevel: 'supported',
    requirements: ['Nothing — no hardware or accounts needed.'],
    setupSteps: ['Choose "Explore demo mode".', 'SmartNest creates simulated devices in your selected rooms.'],
    authMethod: 'none',
    supportedCategories: ['lighting', 'electrical', 'climate', 'environment', 'access', 'security', 'safety', 'entertainment', 'cleaning', 'garden', 'energy', 'network'],
    supportedCapabilities: [
      'onOff', 'brightness', 'colorRgb', 'colorTemperature', 'temperatureSetpoint', 'hvacMode', 'fanSpeed', 'swing', 'position', 'lock',
      'alarmPanel', 'mediaPlayback', 'volume', 'mediaSource', 'battery', 'power', 'energy', 'motion', 'contact', 'safetyAlarm', 'sensor',
      'cameraStream', 'ptz', 'motionDetectionToggle', 'recording', 'charging', 'vacuum', 'valve', 'presence',
    ],
    limitations: [
      'Devices are simulated. Nothing physical is controlled.',
      'Camera images are generated placeholders labelled "Demonstration image" — there is no live video.',
      'Notifications are shown in-app only; no email or push is ever sent in demo mode.',
    ],
  },
  home_assistant: {
    type: 'home_assistant',
    name: 'Home Assistant',
    summary:
      'Connect an existing Home Assistant instance. SmartNest uses the REST API for commands and the WebSocket API for real-time state.',
    supportLevel: 'supported',
    requirements: [
      'Home Assistant 2023.1 or later, reachable from the SmartNest server.',
      'A long-lived access token created in your Home Assistant profile (Profile → Security → Long-lived access tokens).',
      'HTTPS is strongly recommended when Home Assistant is reachable over the internet.',
    ],
    setupSteps: [
      'Open Home Assistant and go to your user profile.',
      'Under "Long-lived access tokens", create a token named "SmartNest".',
      'Enter your Home Assistant URL and paste the token below. The token is encrypted at rest and never sent to the browser again.',
      'SmartNest verifies the connection, then lists the entities it can map.',
      'Choose which entities to import and assign them to rooms.',
    ],
    authMethod: 'long_lived_token',
    supportedCategories: ['lighting', 'electrical', 'climate', 'environment', 'access', 'security', 'safety', 'entertainment', 'voice', 'appliance', 'cleaning', 'garden', 'energy', 'network', 'diy'],
    supportedCapabilities: [
      'onOff', 'brightness', 'colorRgb', 'colorTemperature', 'temperatureSetpoint', 'hvacMode', 'fanSpeed', 'swing', 'position', 'lock',
      'alarmPanel', 'mediaPlayback', 'volume', 'mediaSource', 'battery', 'power', 'energy', 'motion', 'contact', 'occupancy', 'presence',
      'safetyAlarm', 'sensor', 'cameraStream', 'vacuum', 'valve',
    ],
    limitations: [
      'Only entity domains SmartNest maps are imported: light, switch, fan, climate, cover, lock, alarm_control_panel, media_player, sensor, binary_sensor, camera, vacuum, valve, device_tracker, automation.',
      'Camera live view uses Home Assistant\'s MJPEG proxy; streams that HA cannot proxy show as "Snapshot only".',
      'PTZ is not mapped because Home Assistant exposes it through integration-specific services.',
      'Home Assistant automations are shown and can be enabled, disabled or triggered, but are edited in Home Assistant.',
    ],
    docsUrl: 'https://developers.home-assistant.io/docs/api/rest/',
  },
  mqtt: {
    type: 'mqtt',
    name: 'MQTT',
    summary: 'MQTT devices (including Zigbee2MQTT, Tasmota and ESPHome) are supported through Home Assistant\'s MQTT integration.',
    supportLevel: 'via_home_assistant',
    requirements: [
      'An MQTT broker such as Mosquitto with authentication enabled (a development broker is included in docker-compose).',
      'Home Assistant\'s MQTT integration configured against that broker, with MQTT discovery enabled.',
    ],
    setupSteps: [
      'Configure the MQTT integration in Home Assistant.',
      'Connect Home Assistant to SmartNest.',
      'MQTT entities appear in the Home Assistant discovery list.',
    ],
    authMethod: 'username_password',
    supportedCategories: ['lighting', 'electrical', 'environment', 'diy'],
    supportedCapabilities: ['onOff', 'brightness', 'sensor', 'power', 'energy'],
    limitations: ['A direct MQTT adapter is not included in this build. SmartNest does not guess topic layouts.'],
    docsUrl: 'https://www.home-assistant.io/integrations/mqtt/',
  },
  matter: {
    type: 'matter',
    name: 'Matter',
    summary: 'Matter devices are commissioned through a Matter controller. SmartNest reads them through Home Assistant\'s Matter integration.',
    supportLevel: 'via_home_assistant',
    requirements: [
      'A Matter controller — e.g. Home Assistant with the Matter Server add-on.',
      'A Thread border router for Thread-based Matter devices.',
      'The device\'s Matter pairing code (QR or 11-digit code).',
    ],
    setupSteps: ['Commission the device in Home Assistant\'s Matter integration.', 'Sync your Home Assistant integration in SmartNest.'],
    authMethod: 'pairing_code',
    supportedCategories: ['lighting', 'electrical', 'climate', 'access', 'environment'],
    supportedCapabilities: ['onOff', 'brightness', 'colorTemperature', 'temperatureSetpoint', 'lock', 'position', 'sensor'],
    limitations: ['Browsers cannot pair Matter devices directly. Commissioning needs a controller with network access.'],
    docsUrl: 'https://www.home-assistant.io/integrations/matter/',
  },
  zigbee_zwave: {
    type: 'zigbee_zwave',
    name: 'Zigbee & Z-Wave hubs',
    summary: 'Zigbee and Z-Wave require a radio coordinator. Use Home Assistant ZHA, Zigbee2MQTT or Z-Wave JS, then sync via Home Assistant.',
    supportLevel: 'via_home_assistant',
    requirements: ['A Zigbee coordinator or Z-Wave controller USB stick attached to your Home Assistant host.'],
    setupSteps: ['Pair the device with ZHA / Zigbee2MQTT / Z-Wave JS in Home Assistant.', 'Sync your Home Assistant integration in SmartNest.'],
    authMethod: 'none',
    supportedCategories: ['lighting', 'electrical', 'environment', 'access', 'security', 'safety'],
    supportedCapabilities: ['onOff', 'brightness', 'colorRgb', 'sensor', 'contact', 'motion', 'battery', 'lock'],
    limitations: ['SmartNest does not talk to Zigbee or Z-Wave radios directly.'],
  },
  onvif: {
    type: 'onvif',
    name: 'ONVIF / RTSP cameras',
    summary: 'ONVIF cameras are added through Home Assistant\'s ONVIF integration; SmartNest proxies snapshots and MJPEG streams securely.',
    supportLevel: 'via_home_assistant',
    requirements: ['An ONVIF Profile S camera on your network.', 'Home Assistant\'s ONVIF (or Generic Camera) integration configured.'],
    setupSteps: ['Add the camera in Home Assistant.', 'Sync your Home Assistant integration in SmartNest.', 'Grant camera access to household members in Settings → Members.'],
    authMethod: 'username_password',
    supportedCategories: ['security'],
    supportedCapabilities: ['cameraStream'],
    limitations: [
      'Camera credentials stay in Home Assistant; SmartNest never stores or exposes RTSP URLs.',
      'A native ONVIF adapter (with PTZ) is planned but not included in this build.',
    ],
    docsUrl: 'https://www.home-assistant.io/integrations/onvif/',
  },
  manufacturer: {
    type: 'manufacturer',
    name: 'Manufacturer cloud accounts',
    summary: 'Philips Hue, Ecobee, Tuya and other vendor clouds are connected through their official Home Assistant integrations.',
    supportLevel: 'via_home_assistant',
    requirements: ['An account with the manufacturer\'s official integration configured in Home Assistant.'],
    setupSteps: ['Add the manufacturer integration in Home Assistant.', 'Sync your Home Assistant integration in SmartNest.'],
    authMethod: 'oauth',
    supportedCategories: ['lighting', 'electrical', 'climate', 'appliance', 'cleaning', 'energy'],
    supportedCapabilities: ['onOff', 'brightness', 'temperatureSetpoint', 'hvacMode', 'vacuum', 'power'],
    limitations: ['Direct manufacturer adapters are not included in this build; SmartNest does not reverse-engineer private APIs.'],
  },
};

export const SUPPORT_LEVEL_LABELS: Record<SupportLevel, string> = {
  supported: 'Supported',
  via_home_assistant: 'Via Home Assistant',
  planned: 'Planned',
};

export const DEFAULT_ROOM_SUGGESTIONS: { name: string; icon: string }[] = [
  { name: 'Living Room', icon: 'sofa' },
  { name: 'Bedroom', icon: 'bed-double' },
  { name: 'Kitchen', icon: 'cooking-pot' },
  { name: 'Bathroom', icon: 'bath' },
  { name: 'Dining Room', icon: 'utensils' },
  { name: 'Office', icon: 'briefcase' },
  { name: 'Garage', icon: 'car' },
  { name: 'Garden', icon: 'trees' },
  { name: 'Balcony', icon: 'sun' },
  { name: 'Entrance', icon: 'door-open' },
  { name: 'Utility Room', icon: 'wrench' },
];

export const ROOM_ICONS = [
  'sofa', 'bed-double', 'cooking-pot', 'bath', 'utensils', 'briefcase', 'car', 'trees', 'sun', 'door-open', 'wrench', 'baby', 'dumbbell', 'gamepad-2', 'shirt', 'home',
] as const;
