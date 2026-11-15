import { AsyncLocalStorage } from 'node:async_hooks';
import type { Role } from 'shared';

// architecture.md §5.2 step 3 / AD-19 — the per-request context, readable at
// any layer without passing it down. `tenantId` is the ACTIVE tenant: always
// the own store for manager/employee; the X-Tenant-Id store or null for the
// Platform Admin. `authenticate` runs the request under the identity context;
// `tenantContext` replaces it with the active tenant on tenant-scoped routers.
export interface RequestContext {
  userId: string;
  role: Role;
  tenantId: string | null;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();
