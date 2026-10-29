import { describe, expect, it } from 'vitest';
import { canManageRole, roleHasPermission } from '../index.js';

describe('role permissions', () => {
  it('owner can do everything', () => {
    expect(roleHasPermission('owner', 'home.delete')).toBe(true);
    expect(roleHasPermission('owner', 'integrations.manage')).toBe(true);
  });
  it('admin cannot delete the home', () => {
    expect(roleHasPermission('admin', 'home.delete')).toBe(false);
    expect(roleHasPermission('admin', 'integrations.manage')).toBe(true);
  });
  it('members control devices but cannot manage integrations', () => {
    expect(roleHasPermission('member', 'devices.control')).toBe(true);
    expect(roleHasPermission('member', 'devices.control.sensitive')).toBe(true);
    expect(roleHasPermission('member', 'integrations.manage')).toBe(false);
  });
  it('guests cannot view cameras or perform sensitive actions', () => {
    expect(roleHasPermission('guest', 'cameras.view')).toBe(false);
    expect(roleHasPermission('guest', 'devices.control.sensitive')).toBe(false);
    expect(roleHasPermission('guest', 'activity.view')).toBe(false);
  });
  it('admins cannot promote to admin or change owners', () => {
    expect(canManageRole('admin', 'member', 'guest')).toBe(true);
    expect(canManageRole('admin', 'admin', 'member')).toBe(false);
    expect(canManageRole('admin', 'member', 'owner')).toBe(false);
    expect(canManageRole('member', 'guest', 'guest')).toBe(false);
    expect(canManageRole('owner', 'admin', 'member')).toBe(true);
  });
});
