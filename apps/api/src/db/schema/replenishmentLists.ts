import { desc } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { replenishmentStatus } from './enums.js';
import { tenants } from './tenants.js';
import { userProfiles } from './userProfiles.js';

// database.md §4.8 — per-store manual replenishment lists. Lines are added by
// hand; nothing here is derived from assortment_items.is_available (DP-06).
export const replenishmentLists = pgTable(
  'replenishment_lists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    status: replenishmentStatus('status').notNull().default('draft'),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => userProfiles.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('replenishment_lists_tenant_created_at_idx').on(table.tenantId, desc(table.createdAt))],
);
