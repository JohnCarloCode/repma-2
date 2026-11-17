import { boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { categories } from './categories.js';

// database.md §4.4 — the grouping unit; the sellable unit is the size
// (product_sizes.ts). Deletion is soft (`is_active = false`): sizes may be
// referenced by any store's assortment, history and lists. `position` is the
// Platform Admin's display order within the category (RF-46), ascending.
export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    description: text('description'),
    imageUrl: text('image_url'),
    isActive: boolean('is_active').notNull().default(true),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('products_category_id_idx').on(table.categoryId)],
);
