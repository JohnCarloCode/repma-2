import { hasPermission, type Permission, type Role } from 'shared';

export interface NavItem {
  label: string;
  to: string;
  /** Material Symbols glyph (DESIGN.md §Iconography · Navigation). */
  icon: string;
  permission: Permission;
  /** Interim: the route has not shipped yet, so the item is not rendered. Each route's sub-task drops the flag. */
  pending?: true;
}

export interface NavSection {
  /** Section header; the first section has none. */
  title?: string;
  items: readonly NavItem[];
}

/** layout.md §Navigation — the table's order, icons and gating permissions (RF-32). */
export const NAV: readonly NavSection[] = [
  {
    items: [
      { label: 'Home', to: '/home', icon: 'home', permission: 'availability:read' },
      { label: 'Replenishment', to: '/replenishment', icon: 'list_alt', permission: 'replenishment:read' },
      { label: 'Availability', to: '/availability', icon: 'inventory_2', permission: 'availability:read' },
      { label: 'Activity', to: '/activity', icon: 'history', permission: 'activity:read' },
      { label: 'Catalog', to: '/catalog', icon: 'menu_book', permission: 'assortment:manage' },
    ],
  },
  {
    title: 'Platform',
    items: [
      { label: 'Stores', to: '/platform/tenants', icon: 'storefront', permission: 'tenant:manage' },
      { label: 'Users', to: '/platform/users', icon: 'group', permission: 'user:manage' },
      { label: 'Global catalog', to: '/platform/catalog', icon: 'category', permission: 'catalog:manage' },
    ],
  },
];

/** Shipped items only (drops the interim `pending` ones). */
export const SHIPPED_NAV: readonly NavSection[] = NAV.map((section) => ({
  ...section,
  items: section.items.filter((item) => !item.pending),
}));

/**
 * The sections `subject` sees: items filtered by permission — never by role —
 * and a section rendered only if at least one of its items is visible.
 */
export function navSections(subject: { role: Role }, sections: readonly NavSection[]): NavSection[] {
  return sections
    .map((section) => ({ ...section, items: section.items.filter((item) => hasPermission(subject, item.permission)) }))
    .filter((section) => section.items.length > 0);
}
