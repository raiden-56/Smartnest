import { Activity, Bot, Camera, Cpu, LayoutDashboard, Network, Plug, Settings, Sofa, Sparkles, Zap, type LucideIcon } from 'lucide-react';
import type { Permission } from '@smartnest/shared';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  permission?: Permission;
  /** Shown in the mobile bottom bar (others go into the drawer) */
  primaryMobile?: boolean;
  /** What the area is for — used by the product tour and the feature guide */
  description: string;
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, primaryMobile: true, description: 'Your dashboard: home summary, favourite devices, scenes, camera, climate and anything that needs attention, at a glance.' },
  { to: '/rooms', label: 'Rooms', icon: Sofa, primaryMobile: true, description: 'Group devices by room, see each room’s temperature and humidity, and switch a whole room’s lights on or off.' },
  { to: '/devices', label: 'Devices', icon: Cpu, permission: 'devices.view', primaryMobile: true, description: 'The full device inventory. Filter, search and bulk-edit, or open a device for every control, its history and recent commands.' },
  { to: '/cameras', label: 'Cameras', icon: Camera, permission: 'cameras.view', description: 'Camera snapshots and streams through a secure proxy. A privacy indicator shows whenever a camera is being viewed.' },
  { to: '/automations', label: 'Automations', icon: Bot, permission: 'automations.view', description: '“When this happens, if these conditions hold, do that.” Test an automation before enabling it; loops are blocked automatically.' },
  { to: '/scenes', label: 'Scenes', icon: Sparkles, primaryMobile: true, description: 'Run several device actions with one tap, such as “Good night”. Each run reports exactly which actions succeeded.' },
  { to: '/energy', label: 'Energy', icon: Zap, permission: 'energy.view', description: 'Consumption, solar and battery from devices that report energy. Values come from your devices and are never estimated.' },
  { to: '/network', label: 'Network', icon: Network, permission: 'network.view', description: 'Router health, bandwidth and connected clients, when an integration provides them.' },
  { to: '/activity', label: 'Activity', icon: Activity, permission: 'activity.view', description: 'A searchable log of what happened: commands, scenes, automations, connectivity changes and alerts.' },
  { to: '/integrations', label: 'Integrations', icon: Plug, permission: 'integrations.view', description: 'Connect Home Assistant (or the demo integration), then discover and import devices into rooms.' },
  { to: '/settings', label: 'Settings', icon: Settings, description: 'Your profile and sessions, home members and roles, notification preferences, privacy and data retention.' },
];
