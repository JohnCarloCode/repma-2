import { eq } from 'drizzle-orm';
import type { Identity } from '../../core/auth/authenticate.js';
import { tenants } from '../../db/schema/tenants.js';
import { userProfiles } from '../../db/schema/userProfiles.js';
import { withTenantContext } from '../../db/withTenantContext.js';

export interface SessionRow {
  email: string;
  fullName: string;
  storeId: string | null;
  storeName: string | null;
}

// The caller's own profile and store. Runs under the caller's identity context
// (set by `authenticate`, or by login once it knows the identity): a store
// user's own store as tenant (RLS shows a store its own `tenants` row, §7.3),
// none for the Platform Admin, who has no store.
export function findSession(identity: Identity): Promise<SessionRow | undefined> {
  return withTenantContext(
    async (tx) => {
      const [row] = await tx
        .select({
          email: userProfiles.email,
          fullName: userProfiles.fullName,
          storeId: tenants.id,
          storeName: tenants.name,
        })
        .from(userProfiles)
        .leftJoin(tenants, eq(tenants.id, userProfiles.tenantId))
        .where(eq(userProfiles.id, identity.userId));
      return row;
    },
    identity.tenantId ? 'tenant' : 'global',
  );
}
