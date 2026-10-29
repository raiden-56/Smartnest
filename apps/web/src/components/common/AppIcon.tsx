import {
  AirVent, AlarmSmoke, Armchair, Baby, Bath, BedDouble, Blinds, Bot, Box, Briefcase, Camera, Car, Cctv, Clapperboard, CookingPot, Cpu, DoorClosed, DoorOpen, Droplets,
  Dumbbell, Fan, Flame, Gamepad2, Gauge, Heater, Home, House, Lamp, LampCeiling, Leaf, Lightbulb, LightbulbOff, Lock, Mic, Moon, Plane, Plug, Power, Router, Shield,
  ShieldAlert, Shirt, Siren, Sofa, Speaker, Sparkles, Sprout, Sun, Sunrise, Target, Thermometer, Trees, Tv, Utensils, WashingMachine, Waves, Wifi, Wrench, Zap,
  BatteryCharging, Activity, Coffee, Refrigerator, Microwave, Warehouse, Fence, Droplet, Snowflake, Music, type LucideIcon, type LucideProps,
} from 'lucide-react';

/** Name → icon registry used for rooms, scenes, categories and devices. */
export const ICONS: Record<string, LucideIcon> = {
  sofa: Sofa, 'bed-double': BedDouble, 'cooking-pot': CookingPot, bath: Bath, utensils: Utensils, briefcase: Briefcase, car: Car, trees: Trees, sun: Sun,
  'door-open': DoorOpen, 'door-closed': DoorClosed, wrench: Wrench, baby: Baby, dumbbell: Dumbbell, 'gamepad-2': Gamepad2, shirt: Shirt, home: Home, house: House,
  lightbulb: Lightbulb, 'lightbulb-off': LightbulbOff, plug: Plug, thermometer: Thermometer, gauge: Gauge, shield: Shield, siren: Siren, tv: Tv, mic: Mic,
  'washing-machine': WashingMachine, bot: Bot, sprout: Sprout, zap: Zap, router: Router, cpu: Cpu, box: Box, sparkles: Sparkles, sunrise: Sunrise, moon: Moon,
  clapperboard: Clapperboard, plane: Plane, target: Target, leaf: Leaf, armchair: Armchair, camera: Camera, cctv: Cctv, lock: Lock, fan: Fan, heater: Heater,
  'air-vent': AirVent, blinds: Blinds, speaker: Speaker, power: Power, wifi: Wifi, droplets: Droplets, flame: Flame, 'alarm-smoke': AlarmSmoke, waves: Waves,
  'shield-alert': ShieldAlert, lamp: Lamp, 'lamp-ceiling': LampCeiling, 'battery-charging': BatteryCharging, activity: Activity, coffee: Coffee,
  refrigerator: Refrigerator, microwave: Microwave, warehouse: Warehouse, fence: Fence, droplet: Droplet, snowflake: Snowflake, music: Music,
};

export const SCENE_ICONS = ['sparkles', 'sunrise', 'moon', 'clapperboard', 'plane', 'house', 'target', 'leaf', 'lightbulb-off', 'coffee', 'music', 'snowflake', 'shield'] as const;

export function AppIcon({ name, ...props }: { name: string } & LucideProps) {
  const Icon = ICONS[name] ?? Box;
  return <Icon aria-hidden focusable={false} {...props} />;
}

/** Choose a device icon from its type first, then its category. */
export function deviceIconName(deviceType: string | null, category: string): string {
  const t = deviceType ?? '';
  const byType: [RegExp, string][] = [
    [/ceiling_light/, 'lamp-ceiling'], [/lamp/, 'lamp'], [/light|bulb|rgb/, 'lightbulb'], [/plug|outlet/, 'plug'], [/switch/, 'power'],
    [/air_conditioner|split/, 'air-vent'], [/thermostat/, 'thermometer'], [/heater/, 'heater'], [/fan/, 'fan'], [/curtain|blind|shade/, 'blinds'],
    [/garage/, 'warehouse'], [/gate/, 'fence'], [/lock/, 'lock'], [/door_sensor|window_sensor|contact|door|window/, 'door-closed'], [/camera/, 'cctv'],
    [/motion/, 'activity'], [/alarm_panel/, 'shield'], [/smoke/, 'alarm-smoke'], [/water_leak|leak/, 'droplets'], [/tv/, 'tv'], [/speaker|soundbar/, 'speaker'],
    [/dishwasher|washing|washer|dryer/, 'washing-machine'], [/coffee/, 'coffee'], [/fridge|refrigerator/, 'refrigerator'], [/vacuum/, 'bot'],
    [/valve|irrigation/, 'droplet'], [/soil/, 'sprout'], [/meter/, 'gauge'], [/solar/, 'sun'], [/battery/, 'battery-charging'], [/ev_charger/, 'zap'],
    [/humidity/, 'droplets'], [/air_quality/, 'leaf'], [/presence|person|tracker/, 'home'], [/router|access_point/, 'router'],
  ];
  for (const [re, icon] of byType) if (re.test(t)) return icon;
  const byCategory: Record<string, string> = {
    lighting: 'lightbulb', electrical: 'plug', climate: 'thermometer', environment: 'gauge', access: 'door-closed', security: 'shield', safety: 'siren',
    entertainment: 'tv', voice: 'mic', appliance: 'washing-machine', cleaning: 'bot', garden: 'sprout', energy: 'zap', network: 'router', diy: 'cpu',
  };
  return byCategory[category] ?? 'box';
}
