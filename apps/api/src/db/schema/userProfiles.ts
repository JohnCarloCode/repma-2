import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { authUsers } from './authUsers.js';
import { userRole } from './enums.js';
import { tenants } from './tenants.js';

// database.md §4.2 — 1:1 application profile over Supabase `auth.users`.
// Denormalized `email` (written once at creation, never edited — RF-11) gives
// plain-SQL listing/search without granting repma_api anything on `auth`.
// Store assignment is immutable after creation (RN-01/AD-09); the CHECK below
// guards role/tenant coherence, not that immutability (enforced by the API).
export const userProfiles = pgTable(
  'user_profiles',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    email: text('email').notNull().unique(),
    fullName: text('full_name').notNull(),
    role: userRole('role').notNull(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'restrict' }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('user_profiles_tenant_id_idx')
      .on(table.tenantId)
      .where(sql`${table.tenantId} IS NOT NULL`),
    check(
      'user_profiles_role_tenant_coherence',
      sql`(${table.role} = 'platform_admin' AND ${table.tenantId} IS NULL) OR (${table.role} IN ('manager', 'employee') AND ${table.tenantId} IS NOT NULL)`,
    ),
  ],
);
