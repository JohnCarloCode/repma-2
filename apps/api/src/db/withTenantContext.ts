import { sql } from 'drizzle-orm';
import { requestContext } from '../core/tenant/context.js';
import { db } from './client.js';

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ContextScope = 'tenant' | 'global';

// AD-19 / database.md §7.2 — every repository query runs inside this: one
// transaction whose first statement sets the request context as
// transaction-local GUCs (`set_config(..., true)` = SET LOCAL), which the RLS
// policies read. The values die with the transaction, so a pooled connection
// never carries someone else's context.
//
// Fails closed (architecture.md §5.2, safety net 1): no request context at
// all, or a tenant-scoped call ('tenant', the default) without a tenantId,
// throws BEFORE touching the database — it never degrades to "no filter".
// Only global repositories (tenants, users, catalog) opt into 'global', where
// app.tenant_id is set empty.
export async function withTenantContext<T>(fn: (tx: Tx) => Promise<T>, scope: ContextScope = 'tenant'): Promise<T> {
  const context = requestContext.getStore();
  if (!context) {
    throw new Error('withTenantContext: no request context (fail closed)');
  }
  if (scope === 'tenant' && !context.tenantId) {
    throw new Error('withTenantContext: tenant-scoped call without a tenantId in the request context (fail closed)');
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`
      select
        set_config('app.user_id', ${context.userId}, true),
        set_config('app.role', ${context.role}, true),
        set_config('app.tenant_id', ${context.tenantId ?? ''}, true)
    `);
    return fn(tx);
  });
}

// database.md §7.3 session bootstrap — the one transaction that runs before a
// request context exists: `authenticate` knows only the user id from the
// verified JWT and needs the profile to learn role and store. Only
// app.user_id is set, so RLS lets it read exactly its own profile (plus the
// platform admins' rows) and nothing tenant-scoped.
export async function withSessionBootstrap<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}
