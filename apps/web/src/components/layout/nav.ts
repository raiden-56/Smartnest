import { Activity, Bot, Camera, Cpu, LayoutDashboard, Network, Plug, Settings, Sofa, Sparkles, Zap, type LucideIcon } from 'lucide-react';
import type { Permission } from '@smartnest/shared';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  permission?: Permission;
  /** Shown in the mobile bottom bar (others go into the drawer) */
  primaryMobile?: boolean;
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, primaryMobile: true },
  { to: '/rooms', label: 'Rooms', icon: Sofa, primaryMobile: true },
  { to: '/devices', label: 'Devices', icon: Cpu, permission: 'devices.view', primaryMobile: true },
  { to: '/cameras', label: 'Cameras', icon: Camera, permission: 'cameras.view' },
  { to: '/automations', label: 'Automations', icon: Bot, permission: 'automations.view' },
  { to: '/scenes', label: 'Scenes', icon: Sparkles, primaryMobile: true },
  { to: '/energy', label: 'Energy', icon: Zap, permission: 'energy.view' },
  { to: '/network', label: 'Network', icon: Network, permission: 'network.view' },
  { to: '/activity', label: 'Activity', icon: Activity, permission: 'activity.view' },
  { to: '/integrations', label: 'Integrations', icon: Plug, permission: 'integrations.view' },
  { to: '/settings', label: 'Settings', icon: Settings },
];
