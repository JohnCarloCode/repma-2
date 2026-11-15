import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, integer, pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { assortmentItems } from './assortmentItems.js';
import { replenishmentLists } from './replenishmentLists.js';
import { tenants } from './tenants.js';

// database.md §4.9 — lines of a replenishment list. `size_id` has no
// standalone FK: the composite (tenant_id, size_id) -> assortment_items'
// UNIQUE is what restricts a list to sizes the store actually carries
// (RN-12) and blocks removing an assortment item any list still references
// (RF-44/RN-13).
export const replenishmentListItems = pgTable(
  'replenishment_list_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'restrict' }),
    listId: uuid('list_id')
      .notNull()
      .references(() => replenishmentLists.id, { onDelete: 'cascade' }),
    sizeId: uuid('size_id').notNull(),
    quantityRequested: integer('quantity_requested').notNull(),
    isDone: boolean('is_done').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('replenishment_list_items_list_id_size_id_unique').on(table.listId, table.sizeId),
    foreignKey({
      columns: [table.tenantId, table.sizeId],
      foreignColumns: [assortmentItems.tenantId, assortmentItems.sizeId],
      name: 'replenishment_list_items_tenant_size_fk',
    }).onDelete('restrict'),
    check('replenishment_list_items_quantity_requested_check', sql`${table.quantityRequested} > 0`),
  ],
);
