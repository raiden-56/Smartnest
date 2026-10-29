import { DEFAULT_ROOM_SUGGESTIONS, type AutomationInput, type DeviceCommand, type SceneInput } from '@smartnest/shared';
import { prisma } from '../db.js';
import { DEMO_DEVICES, DEMO_ENERGY_KIND, DEMO_ROOMS } from '../integrations/demo/catalog.js';
import { integrations } from '../integrations/manager.js';
import { json } from '../lib/dto.js';
import { automationEngine } from './automationEngine.js';
import { saveAutomation } from './automations.js';
import { saveScene } from './scenes.js';
import { startOfHour } from './time.js';

const ROOM_ICON = new Map(DEFAULT_ROOM_SUGGESTIONS.map((r) => [r.name, r.icon]));
const FAVOURITES = new Set(['demo.living_ceiling', 'demo.living_lamp', 'demo.living_ac', 'demo.front_lock', 'demo.kitchen_coffee', 'demo.living_curtains', 'demo.bedroom_lamp', 'demo.garage_door']);

/**
 * Populate a home with the demonstration integration: rooms, simulated
 * devices (imported through the normal import path), example scenes and
 * automations, and 30 days of hourly energy history flagged isDemo.
 */
export async function setupDemoHome(homeId: string, userId: string): Promise<void> {
  const existingRooms = await prisma.room.findMany({ where: { homeId } });
  const roomByName = new Map(existingRooms.map((r) => [r.name.toLowerCase(), r.id]));
  let order = existingRooms.length;
  for (const name of DEMO_ROOMS) {
    if (!roomByName.has(name.toLowerCase())) {
      const r = await prisma.room.create({ data: { homeId, name, icon: ROOM_ICON.get(name) ?? 'home', sortOrder: order++, isFavourite: name === 'Living Room' } });
      roomByName.set(name.toLowerCase(), r.id);
    }
  }

  const integ = await integrations.createDemo(homeId);
  await integrations.discover(integ.id);
  await integrations.importDevices(
    integ.id,
    DEMO_DEVICES.map((d) => ({ externalId: d.externalId, name: d.name, roomId: d.suggestedRoom ? (roomByName.get(d.suggestedRoom.toLowerCase()) ?? null) : null })),
    (ext) => ({ ...(DEMO_ENERGY_KIND[ext] ? { energyRole: DEMO_ENERGY_KIND[ext] } : {}), ...(DEMO_DEVICES.find((d) => d.externalId === ext)?.demoNote ? { demoNote: DEMO_DEVICES.find((d) => d.externalId === ext)!.demoNote } : {}) }),
  );
  await prisma.device.updateMany({ where: { integrationId: integ.id, externalId: { in: [...FAVOURITES] } }, data: { isFavourite: true } });

  const devices = await prisma.device.findMany({ where: { integrationId: integ.id } });
  const id = (ext: string) => devices.find((d) => d.externalId === ext)?.id;
  const act = (ext: string, command: DeviceCommand, orderNo = 0) => {
    const deviceId = id(ext);
    return deviceId ? [{ deviceId, command, order: orderNo }] : [];
  };

  const existingScenes = await prisma.scene.count({ where: { homeId } });
  if (!existingScenes) {
    const scenes: SceneInput[] = [
      {
        name: 'Good Morning', icon: 'sunrise', description: 'Open blinds, warm light and coffee.', executionMode: 'parallel', isFavourite: true, allowSensitiveActions: false,
        actions: [...act('demo.bedroom_blinds', { capability: 'position', action: 'open' }), ...act('demo.bedroom_lamp', { capability: 'brightness', action: 'setBrightness', value: 60 }), ...act('demo.kitchen_coffee', { capability: 'onOff', action: 'turnOn' })],
      },
      {
        name: 'Good Night', icon: 'moon', description: 'Lights off, blinds closed, front door locked.', executionMode: 'sequential', isFavourite: true, allowSensitiveActions: true,
        actions: [
          ...act('demo.living_ceiling', { capability: 'onOff', action: 'turnOff' }, 0),
          ...act('demo.living_lamp', { capability: 'onOff', action: 'turnOff' }, 1),
          ...act('demo.kitchen_lights', { capability: 'onOff', action: 'turnOff' }, 2),
          ...act('demo.bedroom_blinds', { capability: 'position', action: 'close' }, 3),
          ...act('demo.front_lock', { capability: 'lock', action: 'lock' }, 4),
        ],
      },
      {
        name: 'Movie Time', icon: 'clapperboard', description: 'Dim lights, close curtains, TV on.', executionMode: 'parallel', isFavourite: true, allowSensitiveActions: false,
        actions: [
          ...act('demo.living_ceiling', { capability: 'brightness', action: 'setBrightness', value: 15 }),
          ...act('demo.living_lamp', { capability: 'colorRgb', action: 'setColor', rgb: [242, 140, 40] }),
          ...act('demo.living_curtains', { capability: 'position', action: 'close' }),
          ...act('demo.living_tv', { capability: 'onOff', action: 'turnOn' }),
        ],
      },
      {
        name: 'Away Mode', icon: 'plane', description: 'Everything off and the alarm armed. Requires confirmation.', executionMode: 'sequential', isFavourite: false, allowSensitiveActions: true,
        actions: [
          ...act('demo.living_ceiling', { capability: 'onOff', action: 'turnOff' }, 0),
          ...act('demo.office_lamp', { capability: 'onOff', action: 'turnOff' }, 1),
          ...act('demo.living_ac', { capability: 'hvacMode', action: 'setHvacMode', mode: 'off' }, 2),
          ...act('demo.front_lock', { capability: 'lock', action: 'lock' }, 3),
          ...act('demo.alarm', { capability: 'alarmPanel', action: 'arm', mode: 'armed_away' }, 4),
        ],
      },
      {
        name: 'Welcome Home', icon: 'house', description: 'Lights on and comfortable temperature.', executionMode: 'parallel', isFavourite: false, allowSensitiveActions: false,
        actions: [...act('demo.living_ceiling', { capability: 'brightness', action: 'setBrightness', value: 80 }), ...act('demo.living_ac', { capability: 'temperatureSetpoint', action: 'setTargetTemperature', value: 23 }), ...act('demo.kitchen_lights', { capability: 'onOff', action: 'turnOn' })],
      },
      {
        name: 'Focus Mode', icon: 'target', description: 'Bright desk light and focus music.', executionMode: 'parallel', isFavourite: false, allowSensitiveActions: false,
        actions: [...act('demo.office_lamp', { capability: 'brightness', action: 'setBrightness', value: 100 }), ...act('demo.office_speaker', { capability: 'mediaPlayback', action: 'mediaCommand', command: 'play' })],
      },
      {
        name: 'Relax', icon: 'leaf', description: 'Warm, dim lighting in the living room.', executionMode: 'parallel', isFavourite: false, allowSensitiveActions: false,
        actions: [...act('demo.living_ceiling', { capability: 'colorTemperature', action: 'setColorTemperature', kelvin: 2400 }), ...act('demo.living_lamp', { capability: 'brightness', action: 'setBrightness', value: 35 })],
      },
      {
        name: 'All Supported Lights Off', icon: 'lightbulb-off', description: 'Includes the offline garden lights, so it reports a partial result.', executionMode: 'parallel', isFavourite: true, allowSensitiveActions: false,
        actions: ['demo.living_ceiling', 'demo.living_lamp', 'demo.kitchen_lights', 'demo.bedroom_lamp', 'demo.office_lamp', 'demo.garden_lights'].flatMap((e) => act(e, { capability: 'onOff', action: 'turnOff' })),
      },
    ];
    for (const s of scenes) if (s.actions.length) await saveScene(homeId, s, userId);
  }

  const existingAutomations = await prisma.automation.count({ where: { homeId, executor: 'smartnest' } });
  if (!existingAutomations && id('demo.hall_motion') && id('demo.living_lamp')) {
    const autos: AutomationInput[] = [
      {
        name: 'Hallway motion at night', description: 'Turn on the floor lamp at 20% when motion is detected after dark.', enabled: true, isDraft: false,
        triggers: [{ type: 'deviceState', deviceId: id('demo.hall_motion')!, attribute: 'motion', to: true }],
        conditions: [{ type: 'timeWindow', after: '20:00', before: '06:00' }], conditionOperator: 'and',
        actions: [{ type: 'deviceCommand', deviceId: id('demo.living_lamp')!, command: { capability: 'brightness', action: 'setBrightness', value: 20 } }],
        cooldownSeconds: 300, allowSensitiveActions: false,
      },
      {
        name: 'High CO₂ alert', description: 'Notify the household and turn on the ceiling fan when CO₂ exceeds 1000 ppm.', enabled: true, isDraft: false,
        triggers: [{ type: 'numericThreshold', deviceId: id('demo.living_air')!, attribute: 'measurement', measurementKey: 'co2', above: 1000 }],
        conditions: [], conditionOperator: 'and',
        actions: [{ type: 'notify', title: 'Ventilate the living room', message: 'CO₂ is above 1000 ppm.', severity: 'warning' }, { type: 'deviceCommand', deviceId: id('demo.living_fan')!, command: { capability: 'onOff', action: 'turnOn' } }],
        cooldownSeconds: 1800, allowSensitiveActions: false,
      },
      {
        name: 'Evening lights', description: 'Turn on the kitchen lights at 19:00 on weekdays.', enabled: false, isDraft: false,
        triggers: [{ type: 'time', at: '19:00', days: [1, 2, 3, 4, 5] }], conditions: [], conditionOperator: 'and',
        actions: [{ type: 'deviceCommand', deviceId: id('demo.kitchen_lights')!, command: { capability: 'onOff', action: 'turnOn' } }],
        cooldownSeconds: 60, allowSensitiveActions: false,
      },
    ];
    for (const a of autos) await saveAutomation(homeId, a, userId);
    automationEngine.invalidate(homeId);
  }

  await seedDemoEnergyHistory(homeId, integ.id);
}

/** 30 days of hourly demo energy, flagged isDemo so it is labelled in the UI. */
async function seedDemoEnergyHistory(homeId: string, integrationId: string): Promise<void> {
  const already = await prisma.energyReading.count({ where: { homeId, isDemo: true } });
  if (already) return;
  const devices = await prisma.device.findMany({ where: { integrationId } });
  const byExt = new Map(devices.map((d) => [d.externalId, d]));
  const now = startOfHour(new Date());
  const rows: { homeId: string; deviceId: string; kind: string; periodStart: Date; kWh: number; isDemo: boolean }[] = [];
  const rnd = mulberry32(42);
  for (let h = 30 * 24; h >= 1; h--) {
    const t = new Date(now.getTime() - h * 3600_000);
    const hour = t.getHours();
    const base = 0.35 + (hour >= 7 && hour <= 9 ? 0.6 : 0) + (hour >= 17 && hour <= 22 ? 1.1 : 0) + rnd() * 0.3;
    const add = (ext: string, kind: string, kWh: number) => {
      const d = byExt.get(ext);
      if (d && kWh > 0) rows.push({ homeId, deviceId: d.id, kind, periodStart: t, kWh: Math.round(kWh * 1000) / 1000, isDemo: true });
    };
    const ev = hour >= 0 && hour < 5 && t.getDay() % 2 === 0 ? 6.9 : 0;
    add('demo.meter', 'consumption', base + ev);
    add('demo.solar', 'solar', Math.max(0, Math.sin(((hour - 6) / 13) * Math.PI)) * (3.2 + rnd() * 1.2));
    add('demo.ev_charger', 'ev', ev);
    add('demo.kitchen_coffee', 'device', hour === 7 || hour === 8 ? 0.12 : 0);
    add('demo.office_plug', 'device', hour >= 9 && hour <= 18 && t.getDay() % 6 !== 0 ? 0.14 : 0.01);
    add('demo.washer', 'device', hour === 10 && t.getDay() === 6 ? 1.2 : 0);
  }
  await prisma.energyReading.createMany({ data: rows, skipDuplicates: true });
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export { json };
