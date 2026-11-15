import { z } from 'zod';
import { paginationQuery } from './pagination.js';

// RF-06 — `GET /tenants` query: pagination plus an optional `search` on the
// store name. Blank after trimming = no filter.
export const tenantListQuery = paginationQuery.extend({
  search: z.string().trim().max(100).optional(),
});

export type TenantListQuery = z.output<typeof tenantListQuery>;

// One store as the tenants endpoints return it (inactive ones included —
// design/pages/platform-tenants.md; the shell's selector filters to active).
// `createdAt` is an ISO 8601 timestamp.
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  createdAt: string;
}

// A store name: trimmed, required, at most 120 characters. The slug is derived
// from it by the API (RN-10) and is never part of a request body.
const storeName = z.string().trim().min(1, 'Name is required').max(120);

// RF-07 — `POST /tenants` body: the name only. The slug is generated, the
// store starts active; strict validation makes any other key a 400.
export const createTenantBody = z.object({
  name: storeName,
});

export type CreateTenantBody = z.output<typeof createTenantBody>;

// RF-08 — `PATCH /tenants/:id` body: rename and/or (de)activate. The slug is
// read-only (a stable identifier — it is not regenerated on rename). An empty
// body is a 400.
export const updateTenantBody = z
  .object({
    name: storeName.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'At least one field is required');

export type UpdateTenantBody = z.output<typeof updateTenantBody>;
