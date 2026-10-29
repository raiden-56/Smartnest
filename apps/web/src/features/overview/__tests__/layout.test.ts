import { describe, expect, it } from 'vitest';
import { defaultDashboardLayout, validateDashboardLayout, type DashboardWidget } from '@smartnest/shared';
import { addOrShowWidget, hideWidget, mainRows, moveWidget, normalizeLayout, readBoard, removeWidget, switchColumn, toggleWidth } from '../layout';

const ids = (list: { widget: DashboardWidget }[]) => list.map((p) => p.widget.id);

describe('dashboard board layout', () => {
  it('reads the default layout as summary + main + side columns', () => {
    const b = readBoard(defaultDashboardLayout());
    expect(b.summary?.id).toBe('summary');
    expect(ids(b.main)).toEqual(['favourites', 'camera', 'climate', 'energy', 'automations', 'rooms', 'activity']);
    expect(ids(b.side)).toEqual(['quickActions', 'security', 'attention', 'lowBattery', 'network']);
    expect(mainRows(b.main).map((r) => r.length)).toEqual([1, 2, 2, 2]);
  });

  it('normalising the default layout is stable and valid', () => {
    const d = defaultDashboardLayout();
    expect(normalizeLayout(d)).toEqual(d);
    expect(validateDashboardLayout(normalizeLayout(d))).toEqual([]);
  });

  it('upgrades a layout saved by the old free-form grid into a valid board', () => {
    const old: DashboardWidget[] = [
      { id: 'summary', type: 'summary', x: 0, y: 0, w: 12, h: 2, hidden: false, config: {} },
      { id: 'camera', type: 'camera', x: 0, y: 2, w: 5, h: 4, hidden: false, config: {} },
      { id: 'climate', type: 'climate', x: 5, y: 2, w: 3, h: 4, hidden: false, config: {} },
      { id: 'activity', type: 'activity', x: 8, y: 2, w: 4, h: 4, hidden: false, config: {} },
    ];
    const next = normalizeLayout(old);
    expect(validateDashboardLayout(next)).toEqual([]);
    const b = readBoard(next);
    expect(ids(b.main)).toEqual(['camera', 'climate']);
    expect(ids(b.side)).toEqual(['activity']);
  });

  it('every edit keeps the layout valid', () => {
    let w = defaultDashboardLayout();
    const steps = [
      (x: DashboardWidget[]) => moveWidget(x, 'climate', -1),
      (x: DashboardWidget[]) => switchColumn(x, 'camera'),
      (x: DashboardWidget[]) => switchColumn(x, 'security'),
      (x: DashboardWidget[]) => toggleWidth(x, 'energy'),
      (x: DashboardWidget[]) => hideWidget(x, 'network'),
      (x: DashboardWidget[]) => removeWidget(x, 'rooms'),
      (x: DashboardWidget[]) => addOrShowWidget(x, 'rooms'),
      (x: DashboardWidget[]) => addOrShowWidget(x, 'network'),
    ];
    for (const step of steps) {
      w = step(w);
      expect(validateDashboardLayout(w)).toEqual([]);
    }
    const b = readBoard(w);
    expect(ids(b.side)).toContain('camera');
    expect(ids(b.main)).toContain('security');
    expect(b.main.find((p) => p.widget.id === 'energy')?.half).toBe(false);
    expect(ids(b.main).at(-1)).toBe('rooms'); // re-added at the end of its preferred column
    expect(ids(b.side).at(-1)).toBe('network'); // hidden widget shown again
  });

  it('moves within a column and never past its ends', () => {
    const d = defaultDashboardLayout();
    expect(ids(readBoard(moveWidget(d, 'security', -1)).side).slice(0, 2)).toEqual(['security', 'quickActions']);
    expect(moveWidget(d, 'favourites', -1)).toEqual(d);
  });

  it('keeps widgets that cannot be full width (climate) at half width', () => {
    const d = toggleWidth(defaultDashboardLayout(), 'climate');
    expect(readBoard(d).main.find((p) => p.widget.id === 'climate')?.half).toBe(true);
  });
});
