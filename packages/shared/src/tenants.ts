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
