import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requestContext, type RequestContext } from '../core/tenant/context.js';
import { db } from './client.js';
import { withSessionBootstrap, withTenantContext, type Tx } from './withTenantContext.js';

// Sub-task 1.6 — AD-19 and architecture.md §5.2 safety net 1. Requires the
// local Supabase stack. `withTenantContext` runs as `repma_api` (subject to
// RLS); the admin connection only creates and removes the fixture tenant.
const adminUrl = process.env.MIGRATIONS_DATABASE_URL;
if (!adminUrl) {
  throw new Error('MIGRATIONS_DATABASE_URL is not set — run `supabase start` and set up apps/api/.env first');
}
const admin = postgres(adminUrl);

const tenantId = randomUUID();
const userId = randomUUID();
const storeUser: RequestContext = { userId, role: 'manager', tenantId };

function readContext(tx: Tx) {
  return tx.execute<{ user_id: string | null; role: string | null; tenant_id: string | null }>(sql`
    select
      current_setting('app.user_id', true) as user_id,
      current_setting('app.role', true) as role,
      current_setting('app.tenant_id', true) as tenant_id
  `);
}

describe('withTenantContext (AD-19)', () => {
  beforeAll(async () => {
    await admin`insert into tenants (id, name, slug) values (${tenantId}, 'Context Store', ${`context-store-${tenantId}`})`;
  });

  afterAll(async () => {
    await admin`delete from tenants where id = ${tenantId}`;
    await admin.end();
  });

  it('sets user, role and tenant as GUCs the RLS policies see', async () => {
    const [ctx, tenants] = await requestContext.run(storeUser, () =>
      withTenantContext(async (tx) => [(await readContext(tx))[0], await tx.execute(sql`select id from tenants`)]),
    );
    expect(ctx).toEqual({ user_id: userId, role: 'manager', tenant_id: tenantId });
    // tenants SELECT policy: a store sees exactly its own row.
    expect(tenants.map((row) => row.id)).toEqual([tenantId]);
  });

  it("sets an empty tenant on a 'global' call without a tenantId", async () => {
    const platformAdmin: RequestContext = { userId, role: 'platform_admin', tenantId: null };
    const [ctx] = await requestContext.run(platformAdmin, () => withTenantContext(readContext, 'global'));
    expect(ctx).toEqual({ user_id: userId, role: 'platform_admin', tenant_id: '' });
  });

  describe('fails closed (§5.2 net 1)', () => {
    it('throws on a tenant-scoped call without a tenantId', async () => {
      const noTenant: RequestContext = { userId, role: 'platform_admin', tenantId: null };
      let ran = false;
      await expect(
        requestContext.run(noTenant, () =>
          withTenantContext(async () => {
            ran = true;
          }),
        ),
      ).rejects.toThrow(/fail closed/);
      expect(ran).toBe(false);
    });

    it('throws with no request context at all, whatever the scope', async () => {
      await expect(withTenantContext(async () => undefined)).rejects.toThrow(/fail closed/);
      await expect(withTenantContext(async () => undefined, 'global')).rejects.toThrow(/fail closed/);
    });
  });

  it('session bootstrap sets only the user id: no role, no tenant, so no tenant rows (database.md §7.3)', async () => {
    const [ctx, tenants] = await withSessionBootstrap(userId, async (tx) => [
      (await readContext(tx))[0],
      await tx.execute(sql`select id from tenants`),
    ]);
    expect(ctx?.user_id).toBe(userId);
    expect([null, '']).toContain(ctx?.role);
    expect([null, '']).toContain(ctx?.tenant_id);
    expect(tenants).toHaveLength(0);
  });

  describe('transaction scoping', () => {
    // Fan out over the whole pool so every connection — including the one the
    // context transaction used — is checked.
    async function contextOnEveryConnection() {
      const rows = await Promise.all(
        Array.from({ length: 10 }, () =>
          db.execute<{ user_id: string | null; tenant_id: string | null }>(sql`
            select current_setting('app.user_id', true) as user_id, current_setting('app.tenant_id', true) as tenant_id
          `),
        ),
      );
      return rows.map((result) => result[0]);
    }

    function expectNoContext(rows: Awaited<ReturnType<typeof contextOnEveryConnection>>) {
      // Postgres resets a custom GUC to '' (not NULL) once it has been set on a
      // connection; either way, the request's values must be gone.
      for (const row of rows) {
        expect([null, '']).toContain(row?.user_id);
        expect([null, '']).toContain(row?.tenant_id);
      }
    }

    it('does not leak the context to the pooled connection after commit', async () => {
      await requestContext.run(storeUser, () => withTenantContext(readContext));
      expectNoContext(await contextOnEveryConnection());
    });

    it('rolls back and drops the context when fn throws', async () => {
      await expect(
        requestContext.run(storeUser, () =>
          withTenantContext(async () => {
            throw new Error('boom');
          }),
        ),
      ).rejects.toThrow('boom');
      expectNoContext(await contextOnEveryConnection());
      // No context outside the transaction → RLS deny-by-default (net 2).
      expect(await db.execute(sql`select id from tenants`)).toHaveLength(0);
    });
  });
});
