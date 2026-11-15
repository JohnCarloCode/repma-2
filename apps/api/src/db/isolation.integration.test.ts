import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../config/env.js';
import { requestContext, type RequestContext } from '../core/tenant/context.js';
import { db } from './client.js';
import { withTenantContext, type Tx } from './withTenantContext.js';

// The isolation suites (RNF-01; database.md §7.3–7.4). Requires the local
// Supabase stack. Fixtures for two stores are created through the admin
// connection; every assertion runs as `repma_api`, subject to RLS.
// - Suite A (1.7): the cross-tenant sweep (RN-03, architecture.md §5.2 nets 1–2).
// - Suite B (1.8): policy specifics — global tables, profiles, the ledger (RN-05).
const adminUrl = process.env.MIGRATIONS_DATABASE_URL;
if (!adminUrl) {
  throw new Error('MIGRATIONS_DATABASE_URL is not set — run `supabase start` and set up apps/api/.env first');
}
const admin = postgres(adminUrl);

const ALL_TABLES = [
  'tenants',
  'user_profiles',
  'categories',
  'products',
  'product_sizes',
  'assortment_items',
  'availability_events',
  'replenishment_lists',
  'replenishment_list_items',
] as const;

const TENANT_SCOPED_TABLES = [
  'assortment_items',
  'availability_events',
  'replenishment_lists',
  'replenishment_list_items',
] as const;
type TenantScopedTable = (typeof TENANT_SCOPED_TABLES)[number];

const categoryId = randomUUID();
const productId = randomUUID();
const sizeIds = [randomUUID(), randomUUID()] as const;
const adminUserId = randomUUID();

function storeFixture(name: string) {
  return {
    name,
    tenantId: randomUUID(),
    userId: randomUUID(),
    // One row per tenant-scoped table, all on sizeIds[0]; sizeIds[1] stays
    // outside both assortments so a cross-tenant INSERT is otherwise valid.
    rows: {
      assortment_items: randomUUID(),
      availability_events: randomUUID(),
      replenishment_lists: randomUUID(),
      replenishment_list_items: randomUUID(),
    } satisfies Record<TenantScopedTable, string>,
  };
}
const storeA = storeFixture('A');
const storeB = storeFixture('B');
const contextA: RequestContext = { userId: storeA.userId, role: 'manager', tenantId: storeA.tenantId };

function asA<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return requestContext.run(contextA, () => withTenantContext(fn));
}

// The reason a query was rejected, or null if it succeeded. Drizzle wraps the
// driver error ("Failed query: …"); the reason is its cause.
function rejection(query: Promise<unknown>): Promise<Error | null> {
  return query.then(
    () => null,
    (err: unknown) => {
      const cause = err instanceof Error ? err.cause : err;
      return cause instanceof Error ? cause : new Error(String(cause));
    },
  );
}

async function count(tx: Tx | typeof db, table: string) {
  const [row] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from ${sql.identifier(table)}`);
  return row?.n;
}

async function createStore(store: typeof storeA) {
  const { tenantId, userId, rows } = store;
  await admin`insert into tenants (id, name, slug) values (${tenantId}, ${`Isolation ${store.name}`}, ${`isolation-${tenantId}`})`;
  await admin`insert into auth.users (id) values (${userId})`;
  await admin`
    insert into user_profiles (id, email, full_name, role, tenant_id)
    values (${userId}, ${`manager-${userId}@isolation.test`}, ${`Manager ${store.name}`}, 'manager', ${tenantId})
  `;
  await admin`insert into assortment_items (id, tenant_id, size_id) values (${rows.assortment_items}, ${tenantId}, ${sizeIds[0]})`;
  await admin`
    insert into availability_events (id, tenant_id, assortment_item_id, type, created_by)
    values (${rows.availability_events}, ${tenantId}, ${rows.assortment_items}, 'out_of_stock', ${userId})
  `;
  await admin`
    insert into replenishment_lists (id, tenant_id, name, created_by)
    values (${rows.replenishment_lists}, ${tenantId}, 'Isolation list', ${userId})
  `;
  await admin`
    insert into replenishment_list_items (id, tenant_id, list_id, size_id, quantity_requested)
    values (${rows.replenishment_list_items}, ${tenantId}, ${rows.replenishment_lists}, ${sizeIds[0]}, 3)
  `;
}

async function removeStore({ tenantId, userId }: typeof storeA) {
  await admin`delete from replenishment_list_items where tenant_id = ${tenantId}`;
  await admin`delete from replenishment_lists where tenant_id = ${tenantId}`;
  await admin`delete from availability_events where tenant_id = ${tenantId}`;
  await admin`delete from assortment_items where tenant_id = ${tenantId}`;
  await admin`delete from user_profiles where id = ${userId}`;
  await admin`delete from auth.users where id = ${userId}`;
  await admin`delete from tenants where id = ${tenantId}`;
}

// From A's context, a row of store B that would be valid apart from its tenant.
function insertIntoB(table: TenantScopedTable) {
  const b = storeB.rows;
  switch (table) {
    case 'assortment_items':
      return sql`insert into assortment_items (tenant_id, size_id) values (${storeB.tenantId}, ${sizeIds[1]})`;
    case 'availability_events':
      // created_by = A's own uid, so only the tenant check can reject it.
      return sql`
        insert into availability_events (tenant_id, assortment_item_id, type, created_by)
        values (${storeB.tenantId}, ${b.assortment_items}, 'restock', ${storeA.userId})
      `;
    case 'replenishment_lists':
      return sql`insert into replenishment_lists (tenant_id, name) values (${storeB.tenantId}, 'Injected')`;
    case 'replenishment_list_items':
      return sql`
        insert into replenishment_list_items (tenant_id, list_id, size_id, quantity_requested)
        values (${storeB.tenantId}, ${b.replenishment_lists}, ${sizeIds[0]}, 1)
      `;
  }
}

const UPDATE_OF_B = {
  assortment_items: sql`update assortment_items set is_available = false where id = ${storeB.rows.assortment_items} returning id`,
  replenishment_lists: sql`update replenishment_lists set name = 'Hijacked' where id = ${storeB.rows.replenishment_lists} returning id`,
  replenishment_list_items: sql`update replenishment_list_items set quantity_requested = 99 where id = ${storeB.rows.replenishment_list_items} returning id`,
};

beforeAll(async () => {
  await admin`insert into categories (id, name, slug) values (${categoryId}, 'Isolation', ${`isolation-${categoryId}`})`;
  await admin`insert into products (id, name, category_id) values (${productId}, 'Isolation product', ${categoryId})`;
  for (const [i, sizeId] of sizeIds.entries()) {
    await admin`insert into product_sizes (id, product_id, label, sku) values (${sizeId}, ${productId}, ${`S${i}`}, ${`ISO-${sizeId}`})`;
  }
  // A platform admin profile: user_profiles' policy exposes admin rows to
  // every reader, so deny-by-default must be proven with one present.
  await admin`insert into auth.users (id) values (${adminUserId})`;
  await admin`
    insert into user_profiles (id, email, full_name, role)
    values (${adminUserId}, ${`admin-${adminUserId}@isolation.test`}, 'Isolation Admin', 'platform_admin')
  `;
  await createStore(storeA);
  await createStore(storeB);
});

afterAll(async () => {
  await removeStore(storeA);
  await removeStore(storeB);
  await admin`delete from user_profiles where id = ${adminUserId}`;
  await admin`delete from auth.users where id = ${adminUserId}`;
  await admin`delete from product_sizes where product_id = ${productId}`;
  await admin`delete from products where id = ${productId}`;
  await admin`delete from categories where id = ${categoryId}`;
  await admin.end();
});

describe('isolation suite A — cross-tenant sweep (RNF-01, RN-03)', () => {
  describe.each(TENANT_SCOPED_TABLES)('%s, from tenant A against tenant B', (table) => {
    it("reads its own row but never B's", async () => {
      const ids = await asA(async (tx) =>
        (await tx.execute<{ id: string }>(sql`select id from ${sql.identifier(table)}`)).map((row) => row.id),
      );
      expect(ids).toContain(storeA.rows[table]);
      expect(ids).not.toContain(storeB.rows[table]);
      const byId = await asA((tx) => tx.execute(sql`select id from ${sql.identifier(table)} where id = ${storeB.rows[table]}`));
      expect(byId).toHaveLength(0);
    });

    it('cannot insert a row into B (WITH CHECK)', async () => {
      const error = await rejection(asA((tx) => tx.execute(insertIntoB(table))));
      expect(error?.message).toMatch(/row-level security/);
    });

    if (table !== 'availability_events') {
      // The ledger has no UPDATE/DELETE at all — covered by suite B.
      it("cannot update or delete B's row (0 rows affected)", async () => {
        expect(await asA((tx) => tx.execute(UPDATE_OF_B[table]))).toHaveLength(0);
        const deleted = await asA((tx) =>
          tx.execute(sql`delete from ${sql.identifier(table)} where id = ${storeB.rows[table]} returning id`),
        );
        expect(deleted).toHaveLength(0);
      });
    }
  });

  it("leaves tenant B's data untouched", async () => {
    const [b] = await admin<{ available: boolean; name: string; quantity: number; rows: number }[]>`
      select
        (select is_available from assortment_items where id = ${storeB.rows.assortment_items}) as available,
        (select name from replenishment_lists where id = ${storeB.rows.replenishment_lists}) as name,
        (select quantity_requested from replenishment_list_items where id = ${storeB.rows.replenishment_list_items}) as quantity,
        (select count(*)::int from availability_events where tenant_id = ${storeB.tenantId})
          + (select count(*)::int from assortment_items where tenant_id = ${storeB.tenantId})
          + (select count(*)::int from replenishment_lists where tenant_id = ${storeB.tenantId})
          + (select count(*)::int from replenishment_list_items where tenant_id = ${storeB.tenantId}) as rows
    `;
    expect(b).toEqual({ available: true, name: 'Isolation list', quantity: 3, rows: 4 });
  });

  describe('deny-by-default: no context → 0 rows on all 9 tables (§7.3)', () => {
    // A dedicated single-connection client, so "fresh" and "reused after a
    // context transaction" are the same physical connection, deterministically.
    const client = postgres(env.DATABASE_URL, { max: 1 });
    const counts = async () =>
      Object.fromEntries(
        await Promise.all(
          ALL_TABLES.map(async (table) => {
            const [row] = await client<{ n: number }[]>`select count(*)::int as n from ${client(table)}`;
            return [table, row?.n] as const;
          }),
        ),
      );
    const zeroes = Object.fromEntries(ALL_TABLES.map((table) => [table, 0]));

    afterAll(async () => {
      await client.end();
    });

    it('on a connection that never carried a context', async () => {
      expect(await counts()).toEqual(zeroes);
    });

    it('on a connection reused after a context transaction (GUCs reset to empty, not NULL)', async () => {
      const inside = await client.begin(async (tx) => {
        await tx`
          select
            set_config('app.user_id', ${storeA.userId}, true),
            set_config('app.role', 'manager', true),
            set_config('app.tenant_id', ${storeA.tenantId}, true)
        `;
        const [row] = await tx<{ n: number }[]>`select count(*)::int as n from assortment_items`;
        return row?.n;
      });
      expect(inside).toBe(1); // the context really applied inside the transaction
      expect(await counts()).toEqual(zeroes);
    });
  });

  describe('safety nets (architecture.md §5.2)', () => {
    it('net 1: a tenant-scoped repository call without context fails closed before the DB', async () => {
      let ran = false;
      const repository = () =>
        withTenantContext(async (tx) => {
          ran = true;
          return tx.execute(sql`select id from assortment_items`);
        });
      await expect(repository()).rejects.toThrow(/fail closed/);
      const noTenant: RequestContext = { userId: adminUserId, role: 'platform_admin', tenantId: null };
      await expect(requestContext.run(noTenant, repository)).rejects.toThrow(/fail closed/);
      expect(ran).toBe(false);
    });

    it("net 2: a raw query on the app's pool without context returns 0 rows", async () => {
      // Run context transactions over the whole pool first, so the raw
      // queries land on connections that previously carried a context.
      await Promise.all(Array.from({ length: 10 }, () => asA((tx) => count(tx, 'assortment_items'))));
      for (const table of TENANT_SCOPED_TABLES) {
        expect(await count(db, table)).toBe(0);
      }
    });
  });
});

describe('isolation suite B — policy specifics (RNF-01, RN-05)', () => {
  // A second member of store A, so "same store" and "attributed to someone
  // else" have a real, FK-valid subject.
  const employeeA = randomUUID();
  const asAdminWithoutTenant = <T>(fn: (tx: Tx) => Promise<T>) =>
    requestContext.run({ userId: adminUserId, role: 'platform_admin', tenantId: null }, () =>
      withTenantContext(fn, 'global'),
    );
  const ids = async (tx: Tx, table: string) =>
    (await tx.execute<{ id: string }>(sql`select id from ${sql.identifier(table)}`)).map((row) => row.id);

  beforeAll(async () => {
    await admin`insert into auth.users (id) values (${employeeA})`;
    await admin`
      insert into user_profiles (id, email, full_name, role, tenant_id)
      values (${employeeA}, ${`employee-${employeeA}@isolation.test`}, 'Employee A', 'employee', ${storeA.tenantId})
    `;
  });

  afterAll(async () => {
    await admin`delete from user_profiles where id = ${employeeA}`;
    await admin`delete from auth.users where id = ${employeeA}`;
  });

  it('tenants: a store user sees exactly its own store', async () => {
    expect(await asA((tx) => ids(tx, 'tenants'))).toEqual([storeA.tenantId]);
  });

  describe('user_profiles visibility (§7.3)', () => {
    it('full store context: own row, same-store members, platform admins — never another store', async () => {
      const visible = await asA(async (tx) =>
        tx.execute<{ id: string; role: string; tenant_id: string | null }>(sql`select id, role, tenant_id from user_profiles`),
      );
      const visibleIds = visible.map((row) => row.id);
      expect(visibleIds).toEqual(expect.arrayContaining([storeA.userId, employeeA, adminUserId]));
      expect(visibleIds).not.toContain(storeB.userId);
      // Nothing beyond the three branches leaks in (other stores of the DB included).
      for (const row of visible) {
        expect(row.tenant_id === storeA.tenantId || row.role === 'platform_admin').toBe(true);
      }
    });

    it('session bootstrap (only app.user_id set): own row and platform admins, no other user', async () => {
      // What the authenticate middleware (1.11) does before the profile is loaded.
      const visible = await db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.user_id', ${employeeA}, true)`);
        return tx.execute<{ id: string; role: string }>(sql`select id, role from user_profiles`);
      });
      const visibleIds = visible.map((row) => row.id);
      expect(visibleIds).toEqual(expect.arrayContaining([employeeA, adminUserId]));
      expect(visibleIds).not.toContain(storeA.userId); // same store, but no tenant set yet
      expect(visibleIds).not.toContain(storeB.userId);
      for (const row of visible) {
        expect(row.id === employeeA || row.role === 'platform_admin').toBe(true);
      }
    });
  });

  describe('availability_events INSERT WITH CHECK created_by = uid()', () => {
    it('accepts an event attributed to the current user (control)', async () => {
      const inserted = await asA((tx) =>
        tx.execute(sql`
          insert into availability_events (tenant_id, assortment_item_id, type, created_by)
          values (${storeA.tenantId}, ${storeA.rows.assortment_items}, 'restock', ${storeA.userId})
          returning id
        `),
      );
      expect(inserted).toHaveLength(1);
    });

    it.each([
      ['another member of the same store', employeeA],
      ['no one (NULL)', null],
    ])('rejects a same-tenant event attributed to %s', async (_, createdBy) => {
      const error = await rejection(
        asA((tx) =>
          tx.execute(sql`
            insert into availability_events (tenant_id, assortment_item_id, type, created_by)
            values (${storeA.tenantId}, ${storeA.rows.assortment_items}, 'restock', ${createdBy})
          `),
        ),
      );
      expect(error?.message).toMatch(/row-level security/);
    });
  });

  it('platform_admin with app.role but no app.tenant_id: 0 rows on tenant-scoped tables', async () => {
    const result = await asAdminWithoutTenant(async (tx) => ({
      tenants: await ids(tx, 'tenants'),
      counts: Object.fromEntries(
        await Promise.all(TENANT_SCOPED_TABLES.map(async (table) => [table, await count(tx, table)] as const)),
      ),
    }));
    // The context really applied: the admin branch of tenants sees every store.
    expect(result.tenants).toEqual(expect.arrayContaining([storeA.tenantId, storeB.tenantId]));
    expect(result.counts).toEqual(Object.fromEntries(TENANT_SCOPED_TABLES.map((table) => [table, 0])));
  });

  describe('global tables: a store user cannot write (policy layer, not grants)', () => {
    const GLOBAL_WRITES = {
      tenants: {
        insert: sql`insert into tenants (name, slug) values ('Rogue', ${`rogue-${randomUUID()}`})`,
        update: sql`update tenants set name = 'Hijacked' where id = ${storeA.tenantId} returning id`,
      },
      categories: {
        insert: sql`insert into categories (name, slug) values ('Rogue', ${`rogue-${randomUUID()}`})`,
        update: sql`update categories set name = 'Hijacked' where id = ${categoryId} returning id`,
      },
      products: {
        insert: sql`insert into products (name, category_id) values ('Rogue', ${categoryId})`,
        update: sql`update products set name = 'Hijacked' where id = ${productId} returning id`,
      },
      product_sizes: {
        insert: sql`insert into product_sizes (product_id, label, sku) values (${productId}, 'XL', ${`ROGUE-${randomUUID()}`})`,
        update: sql`update product_sizes set label = 'Hijacked' where id = ${sizeIds[0]} returning id`,
      },
    };

    describe.each(Object.entries(GLOBAL_WRITES))('%s', (table, writes) => {
      it('INSERT is rejected by RLS', async () => {
        const error = await rejection(asA((tx) => tx.execute(writes.insert)));
        expect(error?.message).toMatch(/row-level security/);
      });

      it('UPDATE of a row the store can read affects 0 rows', async () => {
        // The row is visible (SELECT policy), so 0 rows proves the UPDATE policy.
        expect(await asA((tx) => count(tx, table))).toBeGreaterThan(0);
        expect(await asA((tx) => tx.execute(writes.update))).toHaveLength(0);
      });
    });

    it('leaves the global rows untouched', async () => {
      const [row] = await admin<{ tenant: string; category: string; product: string; size: string }[]>`
        select
          (select name from tenants where id = ${storeA.tenantId}) as tenant,
          (select name from categories where id = ${categoryId}) as category,
          (select name from products where id = ${productId}) as product,
          (select label from product_sizes where id = ${sizeIds[0]}) as size
      `;
      expect(row).toEqual({ tenant: 'Isolation A', category: 'Isolation', product: 'Isolation product', size: 'S0' });
    });
  });

  describe('ledger immutability: availability_events UPDATE and DELETE fail (RN-05)', () => {
    // Asserts failure, not its class: grants (§7.1) and RLS (§7.3) both block it.
    const ownEvent = storeA.rows.availability_events;

    it.each([
      ['UPDATE', sql`update availability_events set type = 'restock' where id = ${ownEvent}`],
      ['DELETE', sql`delete from availability_events where id = ${ownEvent}`],
    ])('%s of an own-store event fails', async (_, statement) => {
      expect(await rejection(asA((tx) => tx.execute(statement)))).toBeInstanceOf(Error);
    });

    it('fails for the Platform Admin operating in the store too', async () => {
      const asAdminInA = <T>(fn: (tx: Tx) => Promise<T>) =>
        requestContext.run({ userId: adminUserId, role: 'platform_admin', tenantId: storeA.tenantId }, () =>
          withTenantContext(fn),
        );
      expect(
        await rejection(asAdminInA((tx) => tx.execute(sql`update availability_events set type = 'restock' where id = ${ownEvent}`))),
      ).toBeInstanceOf(Error);
      expect(
        await rejection(asAdminInA((tx) => tx.execute(sql`delete from availability_events where id = ${ownEvent}`))),
      ).toBeInstanceOf(Error);
    });

    it('leaves the event as recorded', async () => {
      const [event] = await admin<{ type: string }[]>`select type from availability_events where id = ${ownEvent}`;
      expect(event).toEqual({ type: 'out_of_stock' });
    });
  });
});
