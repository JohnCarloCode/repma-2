import { z } from 'zod';
import { ROLES, type Role } from './enums.js';
import { paginationQuery } from './pagination.js';

// RF-09 — `GET /users` query: pagination, an optional `search` (substring of
// the full name or the email; blank after trimming = no filter) and an
// optional store filter `tenantId` (store users of that store only).
export const userListQuery = paginationQuery.extend({
  search: z.string().trim().max(100).optional(),
  tenantId: z.uuid().optional(),
});

export type UserListQuery = z.output<typeof userListQuery>;

// The store a user belongs to, as the users endpoints embed it (RN-01: null
// for a Platform Admin). `isActive` lets the UI flag a deactivated store.
export interface UserStore {
  id: string;
  name: string;
  isActive: boolean;
}

// One user as the users endpoints return it (design/pages/platform-users.md).
// `email` is the profile's denormalized copy (database.md §4.2); `createdAt`
// is an ISO 8601 timestamp.
export interface User {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  isActive: boolean;
  tenant: UserStore | null;
  createdAt: string;
}

// Field rules shared by the create and edit bodies.
const password = z
  .string({ error: 'Password is required' })
  .min(8, { error: 'Password must be at least 8 characters' })
  .max(72, { error: 'Password must be at most 72 characters' });
const fullName = z
  .string({ error: 'Full name is required' })
  .trim()
  .min(1, { error: 'Full name is required' })
  .max(120, { error: 'Full name must be at most 120 characters' });
const role = z.enum(ROLES, { error: 'Select a role' });

// RF-10 — `POST /users` body, shared by the api (validate, strict) and the
// create modal (platform-users.md). The email is trimmed and lowercased (the
// profile's denormalized copy must match what Supabase Auth stores); the
// password is never trimmed, 8–72 characters (72 = bcrypt's input limit).
// Role↔store coherence (RN-01, mirrors the DB CHECK) is checked here so it is
// a 400 on `tenantId` before anything is written: a store user needs a store,
// a Platform Admin has none. Whether the store exists and is active is the
// API's check (it needs the database).
export const createUserBody = z
  .object({
    email: z
      .string({ error: 'Enter a valid email address' })
      .trim()
      .toLowerCase()
      .pipe(z.email({ error: 'Enter a valid email address' }).max(254, { error: 'Enter a valid email address' })),
    password,
    fullName,
    role,
    tenantId: z.uuid({ error: 'Select a store' }).optional(),
  })
  .superRefine((body, ctx) => {
    if (body.role === 'platform_admin' && body.tenantId !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['tenantId'], message: 'A Platform Admin does not belong to a store' });
    }
    if (body.role !== 'platform_admin' && body.tenantId === undefined) {
      ctx.addIssue({ code: 'custom', path: ['tenantId'], message: 'Select a store' });
    }
  });

export type CreateUserBody = z.output<typeof createUserBody>;

// RF-11 — `PATCH /users/:id` body, shared by the api (validate, strict) and
// the edit modal (platform-users.md): any of `fullName`, `role`, `isActive`
// and an optional `password` — a write-only reset (same rules as on create;
// omit it to keep the current one). Email and store are immutable, so
// `email`/`tenantId` are unknown keys (400). Which role changes are allowed
// (manager ↔ employee only, RN-01) depends on the user's current role, so it
// is the API's check. An empty body is a 400.
export const updateUserBody = z
  .object({
    fullName: fullName.optional(),
    role: role.optional(),
    isActive: z.boolean().optional(),
    password: password.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'At least one field is required');

export type UpdateUserBody = z.output<typeof updateUserBody>;
