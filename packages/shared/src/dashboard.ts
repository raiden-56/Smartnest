import { z } from 'zod';

export const DASHBOARD_COLUMNS = 12;

export interface WidgetDefinition {
  type: WidgetType;
  title: string;
  description: string;
  defaultSize: { w: number; h: number };
  minSize: { w: number; h: number };
  maxSize: { w: number; h: number };
}

export const WIDGET_TYPES = [
  'summary',
  'favourites',
  'rooms',
  'quickActions',
  'camera',
  'climate',
  'activity',
  'automations',
  'energy',
  'network',
  'security',
  'lowBattery',
  'attention',
] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

export const WIDGET_DEFINITIONS: Record<WidgetType, WidgetDefinition> = {
  summary: { type: 'summary', title: 'Home summary', description: 'Device counts, connectivity, alerts and current power.', defaultSize: { w: 12, h: 2 }, minSize: { w: 6, h: 2 }, maxSize: { w: 12, h: 3 } },
  favourites: { type: 'favourites', title: 'Favourite devices', description: 'Quick controls for devices you starred.', defaultSize: { w: 8, h: 4 }, minSize: { w: 4, h: 3 }, maxSize: { w: 12, h: 8 } },
  rooms: { type: 'rooms', title: 'Rooms', description: 'Rooms with device and online counts.', defaultSize: { w: 4, h: 4 }, minSize: { w: 3, h: 3 }, maxSize: { w: 12, h: 8 } },
  quickActions: { type: 'quickActions', title: 'Quick actions', description: 'Activate favourite scenes.', defaultSize: { w: 4, h: 2 }, minSize: { w: 3, h: 2 }, maxSize: { w: 12, h: 4 } },
  camera: { type: 'camera', title: 'Camera', description: 'Preview of a selected camera.', defaultSize: { w: 5, h: 4 }, minSize: { w: 3, h: 3 }, maxSize: { w: 12, h: 8 } },
  climate: { type: 'climate', title: 'Climate', description: 'Control a thermostat or air conditioner.', defaultSize: { w: 3, h: 4 }, minSize: { w: 3, h: 4 }, maxSize: { w: 6, h: 6 } },
  activity: { type: 'activity', title: 'Recent activity', description: 'Latest events across the home.', defaultSize: { w: 4, h: 4 }, minSize: { w: 3, h: 3 }, maxSize: { w: 12, h: 8 } },
  automations: { type: 'automations', title: 'Active automations', description: 'Enabled automations and their last run.', defaultSize: { w: 4, h: 3 }, minSize: { w: 3, h: 2 }, maxSize: { w: 12, h: 6 } },
  energy: { type: 'energy', title: 'Energy', description: 'Today\'s consumption from energy-reporting devices.', defaultSize: { w: 4, h: 3 }, minSize: { w: 3, h: 3 }, maxSize: { w: 12, h: 6 } },
  network: { type: 'network', title: 'Network', description: 'Router status and connected clients.', defaultSize: { w: 4, h: 3 }, minSize: { w: 3, h: 2 }, maxSize: { w: 12, h: 6 } },
  security: { type: 'security', title: 'Security', description: 'Locks, alarm panels and open doors or windows.', defaultSize: { w: 4, h: 3 }, minSize: { w: 3, h: 2 }, maxSize: { w: 12, h: 6 } },
  lowBattery: { type: 'lowBattery', title: 'Low battery', description: 'Devices reporting battery at or below 20%.', defaultSize: { w: 4, h: 3 }, minSize: { w: 3, h: 2 }, maxSize: { w: 12, h: 6 } },
  attention: { type: 'attention', title: 'Needs attention', description: 'Offline, unavailable or erroring devices.', defaultSize: { w: 4, h: 3 }, minSize: { w: 3, h: 2 }, maxSize: { w: 12, h: 6 } },
};

export const widgetSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(WIDGET_TYPES),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
  hidden: z.boolean().default(false),
  /** Widget-specific display options, e.g. { deviceId } for camera/climate */
  config: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
});
export type DashboardWidget = z.infer<typeof widgetSchema>;

export const dashboardLayoutSchema = z.object({ widgets: z.array(widgetSchema).max(40) });

export type LayoutIssue = { widgetId: string; message: string };

/** Enforce size constraints, grid bounds and no overlap between visible widgets. */
export function validateDashboardLayout(widgets: DashboardWidget[]): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const ids = new Set<string>();
  for (const w of widgets) {
    if (ids.has(w.id)) issues.push({ widgetId: w.id, message: 'Duplicate widget id.' });
    ids.add(w.id);
    const def = WIDGET_DEFINITIONS[w.type];
    if (w.w < def.minSize.w || w.h < def.minSize.h) issues.push({ widgetId: w.id, message: `${def.title} is smaller than its minimum size.` });
    if (w.w > def.maxSize.w || w.h > def.maxSize.h) issues.push({ widgetId: w.id, message: `${def.title} is larger than its maximum size.` });
    if (w.x + w.w > DASHBOARD_COLUMNS) issues.push({ widgetId: w.id, message: `${def.title} extends beyond the grid.` });
  }
  const visible = widgets.filter((w) => !w.hidden);
  for (let i = 0; i < visible.length; i++) {
    for (let j = i + 1; j < visible.length; j++) {
      const a = visible[i]!;
      const b = visible[j]!;
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
        issues.push({ widgetId: b.id, message: `${WIDGET_DEFINITIONS[b.type].title} overlaps ${WIDGET_DEFINITIONS[a.type].title}.` });
      }
    }
  }
  return issues;
}

export function defaultDashboardLayout(): DashboardWidget[] {
  const w = (id: string, type: WidgetType, x: number, y: number, ww: number, h: number): DashboardWidget => ({ id, type, x, y, w: ww, h, hidden: false, config: {} });
  return [
    w('summary', 'summary', 0, 0, 12, 2),
    w('favourites', 'favourites', 0, 2, 8, 4),
    w('quickActions', 'quickActions', 8, 2, 4, 2),
    w('security', 'security', 8, 4, 4, 2),
    w('camera', 'camera', 0, 6, 5, 4),
    w('climate', 'climate', 5, 6, 3, 4),
    w('activity', 'activity', 8, 6, 4, 4),
    w('rooms', 'rooms', 0, 10, 4, 4),
    w('energy', 'energy', 4, 10, 4, 4),
    w('automations', 'automations', 8, 10, 4, 4),
    w('attention', 'attention', 0, 14, 4, 3),
    w('lowBattery', 'lowBattery', 4, 14, 4, 3),
    w('network', 'network', 8, 14, 4, 3),
  ];
}
