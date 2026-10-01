import { desc } from 'drizzle-orm';
import { index, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { assortmentItems } from './assortmentItems.js';
import { availabilityEventType } from './enums.js';
import { tenants } from './tenants.js';
import { userProfiles } from './userProfiles.js';

// database.md §4.7 — immutable event log (AD-04): INSERT and SELECT only, no
// `updated_at`. `tenant_id` is denormalized for RLS without a join (§7.3).
// The latest-event invariant and strict alternation (RN-14) are enforced by
// the availability service's transaction, not by this schema.
export const availabilityEvents = pgTable(
  'availability_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    assortmentItemId: uuid('assortment_item_id')
      .notNull()
      .references(() => assortmentItems.id, { onDelete: 'restrict' }),
    type: availabilityEventType('type').notNull(),
    createdBy: uuid('created_by').references(() => userProfiles.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('availability_events_item_created_at_idx').on(table.assortmentItemId, desc(table.createdAt)),
    index('availability_events_tenant_created_at_idx').on(table.tenantId, desc(table.createdAt)),
  ],
);
