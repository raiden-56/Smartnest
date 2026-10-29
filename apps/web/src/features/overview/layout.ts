import { DASHBOARD_COLUMNS, WIDGET_DEFINITIONS, type DashboardWidget, type WidgetType } from '@smartnest/shared';

/**
 * The dashboard is a summary strip plus two columns: a wide "main" column (where a widget is
 * full or half width) and a narrow "side" column. Widgets size to their content.
 *
 * It is persisted in the shared 12-column grid format so the server can keep validating bounds,
 * sizes and overlaps: main = columns 0–7 (half = 4 wide), side = columns 8–11, summary = row 0.
 */
export type Zone = 'main' | 'side';
export interface Placed {
  widget: DashboardWidget;
  half: boolean;
}
export interface Board {
  summary: DashboardWidget | null;
  main: Placed[];
  side: Placed[];
}

const MAIN_COLS = 8;
const SIDE_X = 8;
const SIDE_W = DASHBOARD_COLUMNS - SIDE_X;

/** Where a newly added widget goes: lists fit the side column, visual widgets the main one. */
const PREFERS_SIDE = new Set<WidgetType>(['quickActions', 'security', 'attention', 'lowBattery', 'network', 'automations']);

export const byPosition = (a: DashboardWidget, b: DashboardWidget) => a.y - b.y || a.x - b.x;

const clampH = (w: DashboardWidget) => {
  const def = WIDGET_DEFINITIONS[w.type];
  return Math.min(def.maxSize.h, Math.max(def.minSize.h, w.h));
};

/** Widgets that cannot span the whole main column (e.g. climate, max 6 columns) are always half. */
export const canBeFull = (type: WidgetType) => WIDGET_DEFINITIONS[type].maxSize.w >= MAIN_COLS;

export function readBoard(widgets: DashboardWidget[]): Board {
  const board: Board = { summary: null, main: [], side: [] };
  for (const w of widgets.filter((x) => !x.hidden).sort(byPosition)) {
    if (w.type === 'summary') board.summary = w;
    else if (w.x >= SIDE_X) board.side.push({ widget: w, half: false });
    else board.main.push({ widget: w, half: w.w <= 6 || !canBeFull(w.type) });
  }
  return board;
}

/** Group the main column into rows: two consecutive half-width widgets share a row. */
export function mainRows(main: Placed[]): Placed[][] {
  const rows: Placed[][] = [];
  for (let i = 0; i < main.length; i++) {
    const a = main[i]!;
    const b = main[i + 1];
    if (a.half && b?.half) {
      rows.push([a, b]);
      i++;
    } else rows.push([a]);
  }
  return rows;
}

/** Convert a board back to grid coordinates. Hidden widgets keep their stored position. */
export function writeBoard(board: Board, widgets: DashboardWidget[]): DashboardWidget[] {
  const out = new Map<string, DashboardWidget>();
  let top = 0;
  if (board.summary) {
    const h = clampH(board.summary);
    out.set(board.summary.id, { ...board.summary, x: 0, y: 0, w: DASHBOARD_COLUMNS, h });
    top = h;
  }
  let y = top;
  for (const row of mainRows(board.main)) {
    row.forEach((p, i) => {
      const w = p.half ? MAIN_COLS / 2 : Math.min(MAIN_COLS, WIDGET_DEFINITIONS[p.widget.type].maxSize.w);
      out.set(p.widget.id, { ...p.widget, x: i * (MAIN_COLS / 2), y, w, h: clampH(p.widget) });
    });
    y += Math.max(...row.map((p) => clampH(p.widget)));
  }
  y = top;
  for (const p of board.side) {
    out.set(p.widget.id, { ...p.widget, x: SIDE_X, y, w: SIDE_W, h: clampH(p.widget) });
    y += clampH(p.widget);
  }
  return widgets.map((w) => out.get(w.id) ?? w);
}

/** Re-derive coordinates for any stored layout (also upgrades layouts saved by the old free-form grid). */
export const normalizeLayout = (widgets: DashboardWidget[]) => writeBoard(readBoard(widgets), widgets);

const edit = (widgets: DashboardWidget[], fn: (b: Board) => void) => {
  const board = readBoard(widgets);
  fn(board);
  return writeBoard(board, widgets);
};

const zoneOf = (b: Board, id: string): Zone | null => (b.main.some((p) => p.widget.id === id) ? 'main' : b.side.some((p) => p.widget.id === id) ? 'side' : null);

/** Move a widget one step earlier/later within its column. */
export function moveWidget(widgets: DashboardWidget[], id: string, dir: -1 | 1): DashboardWidget[] {
  return edit(widgets, (b) => {
    const zone = zoneOf(b, id);
    if (!zone) return;
    const list = b[zone];
    const i = list.findIndex((p) => p.widget.id === id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
  });
}

/** Move a widget to the end of the other column. */
export function switchColumn(widgets: DashboardWidget[], id: string): DashboardWidget[] {
  return edit(widgets, (b) => {
    const zone = zoneOf(b, id);
    if (!zone) return;
    const i = b[zone].findIndex((p) => p.widget.id === id);
    const [p] = b[zone].splice(i, 1);
    if (zone === 'main') b.side.push({ widget: p!.widget, half: false });
    else b.main.push({ widget: p!.widget, half: true });
  });
}

export function toggleWidth(widgets: DashboardWidget[], id: string): DashboardWidget[] {
  return edit(widgets, (b) => {
    const p = b.main.find((x) => x.widget.id === id);
    if (p && canBeFull(p.widget.type)) p.half = !p.half;
  });
}

export function hideWidget(widgets: DashboardWidget[], id: string): DashboardWidget[] {
  return normalizeLayout(widgets.map((w) => (w.id === id ? { ...w, hidden: true } : w)));
}

export function removeWidget(widgets: DashboardWidget[], id: string): DashboardWidget[] {
  return normalizeLayout(widgets.filter((w) => w.id !== id));
}

/** Show a hidden widget, or add a new one, at the end of its preferred column. */
export function addOrShowWidget(widgets: DashboardWidget[], type: WidgetType): DashboardWidget[] {
  const def = WIDGET_DEFINITIONS[type];
  const side = PREFERS_SIDE.has(type);
  const placement = { x: side ? SIDE_X : 0, y: 10_000, w: side ? SIDE_W : MAIN_COLS / 2 };
  const existing = widgets.find((w) => w.type === type);
  if (existing) return normalizeLayout(widgets.map((w) => (w.id === existing.id ? { ...w, ...placement, hidden: false } : w)));
  return normalizeLayout([...widgets, { id: type, type, ...placement, h: def.defaultSize.h, hidden: false, config: {} }]);
}
