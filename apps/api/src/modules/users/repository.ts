import { and, asc, count, eq, ilike, or, type SQL } from 'drizzle-orm';
import type { Role, User, UserListQuery } from 'shared';
import { pageToLimitOffset } from '../../core/http/pagination.js';
import { containsPattern } from '../../db/like.js';
import { tenants } from '../../db/schema/tenants.js';
import { userProfiles } from '../../db/schema/userProfiles.js';
import { withTenantContext } from '../../db/withTenantContext.js';

// The `User` shape every users endpoint returns: the profile plus its store
// (LEFT JOIN — a Platform Admin has none, RN-01).
const userColumns = {
  id: userProfiles.id,
  email: userProfiles.email,
  fullName: userProfiles.fullName,
  role: userProfiles.role,
  isActive: userProfiles.isActive,
  createdAt: userProfiles.createdAt,
  tenantId: tenants.id,
  tenantName: tenants.name,
  tenantIsActive: tenants.isActive,
};

type UserRow = Omit<User, 'tenant' | 'createdAt'> & {
  createdAt: Date;
  tenantId: string | null;
  tenantName: string | null;
  tenantIsActive: boolean | null;
};

function toUser({ tenantId, tenantName, tenantIsActive, createdAt, ...user }: UserRow): User {
  return {
    ...user,
    tenant: tenantId ? { id: tenantId, name: tenantName!, isActive: tenantIsActive! } : null,
    createdAt: createdAt.toISOString(),
  };
}

// RF-09 — global repository: no active tenant (architecture.md §5.2); RLS
// shows the Platform Admin every profile and store (database.md §7.3).
// `search` is a literal substring of the full name or the denormalized email
// (database.md §4.2); `tenantId` keeps that store's users. Ordered by full
// name, id as the tiebreaker so pages are stable.
export function listUsers(query: UserListQuery): Promise<{ items: User[]; total: number }> {
  const pattern = query.search ? containsPattern(query.search) : undefined;
  const where: SQL | undefined = and(
    pattern ? or(ilike(userProfiles.fullName, pattern), ilike(userProfiles.email, pattern)) : undefined,
    query.tenantId ? eq(userProfiles.tenantId, query.tenantId) : undefined,
  );
  const { limit, offset } = pageToLimitOffset(query);

  return withTenantContext(async (tx) => {
    const rows = await tx
      .select(userColumns)
      .from(userProfiles)
      .leftJoin(tenants, eq(tenants.id, userProfiles.tenantId))
      .where(where)
      .orderBy(asc(userProfiles.fullName), asc(userProfiles.id))
      .limit(limit)
      .offset(offset);
    const [totalRow] = await tx.select({ total: count() }).from(userProfiles).where(where);
    return { items: rows.map(toUser), total: totalRow?.total ?? 0 };
  }, 'global');
}

export function findUser(id: string): Promise<User | null> {
  return withTenantContext(async (tx) => {
    const [row] = await tx
      .select(userColumns)
      .from(userProfiles)
      .leftJoin(tenants, eq(tenants.id, userProfiles.tenantId))
      .where(eq(userProfiles.id, id));
    return row ? toUser(row) : null;
  }, 'global');
}

// RF-10 — the store a new store user is assigned to: whether it exists and is
// active (null = unknown).
export function findStore(id: string): Promise<{ isActive: boolean } | null> {
  return withTenantContext(async (tx) => {
    const [row] = await tx.select({ isActive: tenants.isActive }).from(tenants).where(eq(tenants.id, id));
    return row ?? null;
  }, 'global');
}

export interface NewUserProfile {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  tenantId: string | null;
}

// RF-10 — the profile of a just-created Auth identity. An email another
// profile already holds is detected through the UNIQUE (ON CONFLICT DO
// NOTHING) and answered as 'duplicate'; any other failure throws.
export function insertUserProfile(profile: NewUserProfile): Promise<'created' | 'duplicate'> {
  return withTenantContext(async (tx) => {
    const rows = await tx
      .insert(userProfiles)
      .values(profile)
      .onConflictDoNothing({ target: userProfiles.email })
      .returning({ id: userProfiles.id });
    return rows.length > 0 ? 'created' : 'duplicate';
  }, 'global');
}

// RF-11 — the editable profile fields (the email and the store never change).
// false when no profile has that id.
export function updateUserProfile(id: string, fields: { fullName?: string; role?: Role; isActive?: boolean }): Promise<boolean> {
  return withTenantContext(async (tx) => {
    const rows = await tx.update(userProfiles).set(fields).where(eq(userProfiles.id, id)).returning({ id: userProfiles.id });
    return rows.length > 0;
  }, 'global');
}
