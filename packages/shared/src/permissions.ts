import type { Role } from './enums.js';

// architecture.md §6 — the single RBAC module, consumed by the api's
// `authorize(permission)` and by the UI's guards. Nobody writes
// `role === 'x'` outside this file. Adding a permission = one entry here +
// cells in the matrix; any matrix change also updates the snapshot in
// permissions.test.ts (a deliberate two-file edit).
export const PERMISSIONS = [
  'tenant:manage',
  'user:manage',
  'catalog:read',
  'catalog:manage',
  'assortment:manage', // adding a size to the store's assortment
  'availability:read',
  'availability:flag',
  'activity:read', // store-wide availability-events feed (RF-23/RF-42)
  'replenishment:read',
  'replenishment:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const rolePermissions: Readonly<Record<Role, readonly Permission[]>> = {
  platform_admin: PERMISSIONS,
  manager: [
    'catalog:read',
    'assortment:manage',
    'availability:read',
    'availability:flag',
    'activity:read',
    'replenishment:read',
    'replenishment:manage',
  ],
  employee: [
    'catalog:read',
    'availability:read',
    'availability:flag',
    'activity:read',
    'replenishment:read',
    'replenishment:manage',
  ],
};

// Takes anything carrying a role — the api's identity context or the web's
// session — so both sides call it the same way.
export function hasPermission(subject: { role: Role }, permission: Permission): boolean {
  return rolePermissions[subject.role].includes(permission);
}
