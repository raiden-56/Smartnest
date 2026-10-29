import { DASHBOARD_COLUMNS, WIDGET_DEFINITIONS, type DashboardWidget, type WidgetType } from '@smartnest/shared';

export const byPosition = (a: DashboardWidget, b: DashboardWidget) => a.y - b.y || a.x - b.x;

function collides(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Clamp a widget to its definition's size limits and the grid bounds. */
export function clampWidget(w: DashboardWidget): DashboardWidget {
  const def = WIDGET_DEFINITIONS[w.type];
  const width = Math.min(def.maxSize.w, DASHBOARD_COLUMNS, Math.max(def.minSize.w, w.w));
  const height = Math.min(def.maxSize.h, Math.max(def.minSize.h, w.h));
  return { ...w, w: width, h: height, x: Math.max(0, Math.min(w.x, DASHBOARD_COLUMNS - width)), y: Math.max(0, w.y) };
}

/**
 * Vertical compaction (same rule react-grid-layout uses): each visible widget,
 * in reading order, is placed at its column as high as possible without
 * overlapping anything already placed. Guarantees a valid, non-overlapping layout.
 */
export function compactLayout(widgets: DashboardWidget[]): DashboardWidget[] {
  const visible = widgets.filter((w) => !w.hidden).map(clampWidget).sort(byPosition);
  const placed: DashboardWidget[] = [];
  for (const w of visible) {
    let y = 0;
    while (placed.some((p) => collides({ ...w, y }, p))) y++;
    placed.push({ ...w, y });
  }
  const byId = new Map(placed.map((w) => [w.id, w]));
  return widgets.map((w) => byId.get(w.id) ?? w);
}

/** Move a widget one step earlier/later in reading order, then re-compact. */
export function moveWidget(widgets: DashboardWidget[], id: string, dir: -1 | 1): DashboardWidget[] {
  const order = widgets.filter((w) => !w.hidden).sort(byPosition);
  const i = order.findIndex((w) => w.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return widgets;
  const a = order[i]!;
  const b = order[j]!;
  // Swap anchor positions; compaction then resolves any overlap caused by different sizes.
  return compactLayout(widgets.map((w) => (w.id === a.id ? { ...w, x: b.x, y: b.y } : w.id === b.id ? { ...w, x: a.x, y: a.y } : w)));
}

export function addOrShowWidget(widgets: DashboardWidget[], type: WidgetType): DashboardWidget[] {
  const existing = widgets.find((w) => w.type === type);
  const bottom = widgets.filter((w) => !w.hidden).reduce((m, w) => Math.max(m, w.y + w.h), 0);
  if (existing) return compactLayout(widgets.map((w) => (w.id === existing.id ? { ...w, hidden: false, x: 0, y: bottom } : w)));
  const def = WIDGET_DEFINITIONS[type];
  return compactLayout([...widgets, { id: type, type, x: 0, y: bottom, w: def.defaultSize.w, h: def.defaultSize.h, hidden: false, config: {} }]);
}

/** 6-column layout for medium containers, derived from the 12-column one (not persisted). */
export function deriveMediumLayout(widgets: DashboardWidget[]) {
  const cols = [0, 0];
  return widgets
    .filter((w) => !w.hidden)
    .sort(byPosition)
    .map((w) => {
      const full = w.w >= 7;
      if (full) {
        const y = Math.max(cols[0]!, cols[1]!);
        cols[0] = cols[1] = y + w.h;
        return { i: w.id, x: 0, y, w: 6, h: w.h, static: true };
      }
      const slot = cols[0]! <= cols[1]! ? 0 : 1;
      const y = cols[slot]!;
      cols[slot] = y + w.h;
      return { i: w.id, x: slot * 3, y, w: 3, h: w.h, static: true };
    });
}
