import { describe, expect, it } from 'vitest';
import { defaultDashboardLayout, validateDashboardLayout, type DashboardWidget } from '../index.js';

describe('dashboard layout validation', () => {
  it('default layout is valid', () => {
    expect(validateDashboardLayout(defaultDashboardLayout())).toEqual([]);
  });
  it('detects overlap', () => {
    const w: DashboardWidget[] = [
      { id: 'a', type: 'activity', x: 0, y: 0, w: 4, h: 4, hidden: false, config: {} },
      { id: 'b', type: 'rooms', x: 2, y: 2, w: 4, h: 4, hidden: false, config: {} },
    ];
    expect(validateDashboardLayout(w).some((i) => i.message.includes('overlaps'))).toBe(true);
  });
  it('ignores overlap with hidden widgets', () => {
    const w: DashboardWidget[] = [
      { id: 'a', type: 'activity', x: 0, y: 0, w: 4, h: 4, hidden: false, config: {} },
      { id: 'b', type: 'rooms', x: 2, y: 2, w: 4, h: 4, hidden: true, config: {} },
    ];
    expect(validateDashboardLayout(w)).toEqual([]);
  });
  it('enforces size constraints and grid bounds', () => {
    const w: DashboardWidget[] = [{ id: 'a', type: 'climate', x: 10, y: 0, w: 2, h: 2, hidden: false, config: {} }];
    expect(validateDashboardLayout(w).some((i) => i.message.includes('minimum'))).toBe(true);
  });
});
