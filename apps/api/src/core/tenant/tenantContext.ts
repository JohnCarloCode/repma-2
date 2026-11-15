import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import { tenants } from '../../db/schema/tenants.js';
import { withTenantContext } from '../../db/withTenantContext.js';
import { forbidden } from '../authz/authorize.js';
import { AppError } from '../errors.js';
import { requestContext, type RequestContext } from './context.js';

const TENANT_HEADER = 'X-Tenant-Id';
const tenantIdHeader = z.uuid();

// Whether the store exists and is active. A global-scope read under the Platform
// Admin's identity context: RLS shows the admin every `tenants` row (§7.3).
async function isActiveTenant(tenantId: string): Promise<boolean> {
  const rows = await withTenantContext(
    (tx) =>
      tx
        .select({ id: tenants.id })
        .from(tenants)
        .where(and(eq(tenants.id, tenantId), eq(tenants.isActive, true))),
    'global',
  );
  return rows.length > 0;
}

// architecture.md §5.2 step 2 — resolves the ACTIVE tenant. Mounted explicitly
// on each tenant-scoped router (availability, replenishment, home), after
// `authenticate`; global routers never mount it. The rest of the request runs
// inside `requestContext` with that tenant, which is what `withTenantContext`
// (AD-19) sets for RLS.
//   - manager/employee → always their own store; any other X-Tenant-Id → 403.
//   - platform_admin → X-Tenant-Id required (400 TENANT_REQUIRED) and it must
//     name an existing, active store (malformed, unknown or inactive → one
//     400 INVALID_TENANT).
export const tenantContext: RequestHandler = async (req, _res, next) => {
  const identity = req.identity;
  if (!identity) throw new Error('tenantContext mounted before authenticate');
  const header = req.get(TENANT_HEADER);

  let tenantId: string;
  if (identity.tenantId !== null) {
    // Store user (the identity carries its own store; only the Platform Admin has none).
    if (header !== undefined && header.toLowerCase() !== identity.tenantId.toLowerCase()) throw forbidden();
    tenantId = identity.tenantId;
  } else {
    if (header === undefined || header === '') {
      throw new AppError(400, 'TENANT_REQUIRED', `${TENANT_HEADER} header is required`);
    }
    const parsed = tenantIdHeader.safeParse(header.toLowerCase());
    // Runs under the identity context `authenticate` established.
    if (!parsed.success || !(await isActiveTenant(parsed.data))) {
      throw new AppError(400, 'INVALID_TENANT', `${TENANT_HEADER} does not name an active store`);
    }
    tenantId = parsed.data;
  }

  const context: RequestContext = {
    userId: identity.userId,
    role: identity.role,
    tenantId,
  };
  requestContext.run(context, next);
};
