import { pgSchema, uuid } from 'drizzle-orm/pg-core';

// Reference-only: `auth.users` is owned and migrated by Supabase Auth (AD-02).
// Declared here solely so `user_profiles.id` can carry a typed FK to it;
// drizzle.config.ts restricts `schemaFilter` to `public` so drizzle-kit never
// tries to create, alter or drop this table.
export const authSchema = pgSchema('auth');

export const authUsers = authSchema.table('users', {
  id: uuid('id').primaryKey(),
});
