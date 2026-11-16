import { asc, count, eq, ilike } from 'drizzle-orm';
import type { Tenant, TenantListQuery, UpdateTenantBody } from 'shared';
import { pageToLimitOffset } from '../../core/http/pagination.js';
import { containsPattern } from '../../db/like.js';
import { tenants } from '../../db/schema/tenants.js';
import { withTenantContext } from '../../db/withTenantContext.js';

// The `Tenant` shape every tenants endpoint returns.
const tenantColumns = {
  id: tenants.id,
  name: tenants.name,
  slug: tenants.slug,
  isActive: tenants.isActive,
  createdAt: tenants.createdAt,
};

function toTenant(row: { createdAt: Date } & Omit<Tenant, 'createdAt'>): Tenant {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

// RF-06 — global repository: no active tenant (architecture.md §5.2); RLS
// shows the Platform Admin every store (database.md §7.3). Ordered by name,
// id as the tiebreaker so pages are stable.
export function listTenants(query: TenantListQuery): Promise<{ items: Tenant[]; total: number }> {
  const where = query.search ? ilike(tenants.name, containsPattern(query.search)) : undefined;
  const { limit, offset } = pageToLimitOffset(query);

  return withTenantContext(async (tx) => {
    const rows = await tx
      .select(tenantColumns)
      .from(tenants)
      .where(where)
      .orderBy(asc(tenants.name), asc(tenants.id))
      .limit(limit)
      .offset(offset);
    const [totalRow] = await tx.select({ total: count() }).from(tenants).where(where);
    return {
      items: rows.map(toTenant),
      total: totalRow?.total ?? 0,
    };
  }, 'global');
}

// RF-07 — insert a store (active by default). A taken slug is detected through
// the UNIQUE via ON CONFLICT DO NOTHING, so a concurrent create of an
// equivalent name lands on the same answer.
export function insertTenant(name: string, slug: string): Promise<Tenant | 'duplicate'> {
  return withTenantContext(async (tx) => {
    const [row] = await tx
      .insert(tenants)
      .values({ name, slug })
      .onConflictDoNothing({ target: tenants.slug })
      .returning(tenantColumns);
    return row ? toTenant(row) : 'duplicate';
  }, 'global');
}

export function findTenant(id: string): Promise<Tenant | null> {
  return withTenantContext(async (tx) => {
    const [row] = await tx.select(tenantColumns).from(tenants).where(eq(tenants.id, id));
    return row ? toTenant(row) : null;
  }, 'global');
}

// RF-08 — rename and/or (de)activate; the slug is never touched and
// `updated_at` is set by the trigger.
export function updateTenant(id: string, body: UpdateTenantBody): Promise<Tenant | null> {
  return withTenantContext(async (tx) => {
    const [row] = await tx.update(tenants).set(body).where(eq(tenants.id, id)).returning(tenantColumns);
    return row ? toTenant(row) : null;
  }, 'global');
}
