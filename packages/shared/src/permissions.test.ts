import { describe, expect, it } from 'vitest';
import { ROLES } from './enums.js';
import { hasPermission, PERMISSIONS, rolePermissions } from './permissions.js';

describe('permission matrix (architecture.md §6)', () => {
  // Any change to the matrix must update this snapshot too: a reviewed,
  // two-file edit. Rendered as permission → roles, like the doc's table.
  it('matches the reviewed snapshot', () => {
    const table = Object.fromEntries(
      PERMISSIONS.map((p) => [p, ROLES.filter((role) => rolePermissions[role].includes(p))]),
    );
    expect(table).toMatchSnapshot();
  });

  it('grants platform_admin every permission', () => {
    expect([...rolePermissions.platform_admin]).toEqual([...PERMISSIONS]);
  });

  it('only references declared permissions, without duplicates', () => {
    for (const role of ROLES) {
      const granted = rolePermissions[role];
      expect(new Set(granted).size).toBe(granted.length);
      for (const p of granted) expect(PERMISSIONS).toContain(p);
    }
  });

  it('hasPermission reads the matrix for the subject role', () => {
    expect(hasPermission({ role: 'manager' }, 'assortment:manage')).toBe(true);
    expect(hasPermission({ role: 'employee' }, 'assortment:manage')).toBe(false);
    expect(hasPermission({ role: 'employee' }, 'availability:flag')).toBe(true);
    expect(hasPermission({ role: 'manager' }, 'catalog:manage')).toBe(false);
    expect(hasPermission({ role: 'platform_admin' }, 'tenant:manage')).toBe(true);
  });
});
