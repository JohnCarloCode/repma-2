import { asc, count, ilike } from 'drizzle-orm';
import type { Tenant, TenantListQuery } from 'shared';
import { pageToLimitOffset } from '../../core/http/pagination.js';
import { containsPattern } from '../../db/like.js';
import { tenants } from '../../db/schema/tenants.js';
import { withTenantContext } from '../../db/withTenantContext.js';

// RF-06 — global repository: no active tenant (architecture.md §5.2); RLS
// shows the Platform Admin every store (database.md §7.3). Ordered by name,
// id as the tiebreaker so pages are stable.
export function listTenants(query: TenantListQuery): Promise<{ items: Tenant[]; total: number }> {
  const where = query.search ? ilike(tenants.name, containsPattern(query.search)) : undefined;
  const { limit, offset } = pageToLimitOffset(query);

  return withTenantContext(async (tx) => {
    const rows = await tx
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        isActive: tenants.isActive,
        createdAt: tenants.createdAt,
      })
      .from(tenants)
      .where(where)
      .orderBy(asc(tenants.name), asc(tenants.id))
      .limit(limit)
      .offset(offset);
    const [totalRow] = await tx.select({ total: count() }).from(tenants).where(where);
    return {
      items: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
      total: totalRow?.total ?? 0,
    };
  }, 'global');
}
