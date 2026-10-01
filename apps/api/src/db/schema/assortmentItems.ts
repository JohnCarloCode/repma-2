import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { productSizes } from './productSizes.js';
import { tenants } from './tenants.js';

// database.md §4.6 — per-store assortment and cached availability. A size
// appears at most once per store (UNIQUE tenant_id+size_id — also the target
// of replenishment_list_items' composite FK). `is_available` is a cache of
// the event log (§4.7): no endpoint accepts it as an editable field.
export const assortmentItems = pgTable(
  'assortment_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    sizeId: uuid('size_id')
      .notNull()
      .references(() => productSizes.id, { onDelete: 'restrict' }),
    isAvailable: boolean('is_available').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('assortment_items_tenant_id_size_id_unique').on(table.tenantId, table.sizeId),
    index('assortment_items_out_of_stock_idx')
      .on(table.tenantId)
      .where(sql`NOT ${table.isAvailable}`),
  ],
);
