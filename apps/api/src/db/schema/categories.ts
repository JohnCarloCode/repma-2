import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// database.md §4.3 — global catalog. A category with products cannot be
// deleted: the RESTRICT FK from `products` (see products.ts) enforces it.
// `position` is the Platform Admin's display order (RF-45), ascending.
export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
