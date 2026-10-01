import { boolean, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { products } from './products.js';

// database.md §4.5 — the tracked/replenished sellable unit; the SKU lives
// here, not on the product. Every product has >=1 size, enforced by the API.
// Soft-deactivated like products, never hard-deleted (assortment_items'
// RESTRICT FK protects any referenced size).
export const productSizes = pgTable(
  'product_sizes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    label: text('label').notNull(),
    sku: text('sku').notNull().unique(),
    position: integer('position').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('product_sizes_product_id_label_unique').on(table.productId, table.label),
    index('product_sizes_product_id_idx').on(table.productId),
  ],
);
