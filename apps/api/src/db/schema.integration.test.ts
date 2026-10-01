import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Integration suite for sub-task 1.3: proves the migration applies cleanly
// and that the structural invariants (enums, FKs, UNIQUEs, CHECKs, the
// set_updated_at trigger) hold — ahead of RLS/grants, which ship in 1.4.
// Requires the local Supabase stack (`supabase start`) and runs against the
// admin connection, since the `repma_api` role does not exist yet.
const connectionString = process.env.MIGRATIONS_DATABASE_URL;
if (!connectionString) {
  throw new Error('MIGRATIONS_DATABASE_URL is not set — run `supabase start` and set up apps/api/.env first');
}

const sql = postgres(connectionString);

describe('schema migration (1.3)', () => {
  afterAll(async () => {
    await sql.end();
  });

  it('creates the three enums with their exact, ordered values', async () => {
    const rows = await sql<{ typname: string; values: string[] }[]>`
      select t.typname, array_agg(e.enumlabel order by e.enumsortorder) as values
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
      where t.typname in ('user_role', 'availability_event_type', 'replenishment_status')
      group by t.typname
    `;
    const byName = Object.fromEntries(rows.map((r) => [r.typname, r.values]));
    expect(byName.user_role).toEqual(['platform_admin', 'manager', 'employee']);
    expect(byName.availability_event_type).toEqual(['out_of_stock', 'restock']);
    expect(byName.replenishment_status).toEqual(['draft', 'processing', 'done']);
  });

  it('creates all 9 tables in the public schema', async () => {
    const rows = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name
    `;
    expect(rows.map((r) => r.table_name)).toEqual([
      'assortment_items',
      'availability_events',
      'categories',
      'product_sizes',
      'products',
      'replenishment_list_items',
      'replenishment_lists',
      'tenants',
      'user_profiles',
    ]);
  });

  describe('constraint smoke tests', () => {
    const tenantId = randomUUID();
    const categoryId = randomUUID();
    const productId = randomUUID();
    const sizeId = randomUUID();
    const userId = randomUUID();

    beforeAll(async () => {
      await sql`insert into auth.users (id) values (${userId})`;
      await sql`insert into tenants (id, name, slug) values (${tenantId}, 'Test Store', ${`test-store-${tenantId}`})`;
      await sql`insert into categories (id, name, slug) values (${categoryId}, 'Test Category', ${`test-category-${categoryId}`})`;
      await sql`insert into products (id, name, category_id) values (${productId}, 'Test Product', ${categoryId})`;
      await sql`insert into product_sizes (id, product_id, label, sku) values (${sizeId}, ${productId}, 'One size', ${`SKU-${sizeId}`})`;
    });

    afterAll(async () => {
      await sql`delete from product_sizes where id = ${sizeId}`;
      await sql`delete from products where id = ${productId}`;
      await sql`delete from categories where id = ${categoryId}`;
      await sql`delete from tenants where id = ${tenantId}`;
      await sql`delete from auth.users where id = ${userId}`;
    });

    it('rejects a duplicate tenant slug (UNIQUE)', async () => {
      const rows = await sql<{ slug: string }[]>`select slug from tenants where id = ${tenantId}`;
      const existing = rows[0];
      expect(existing).toBeDefined();
      await expect(
        sql`insert into tenants (id, name, slug) values (${randomUUID()}, 'Dup', ${existing!.slug})`,
      ).rejects.toThrow(/duplicate key value violates unique constraint/);
    });

    it('rejects a platform_admin profile carrying a tenant_id (CHECK: role/tenant coherence)', async () => {
      await expect(
        sql`insert into user_profiles (id, email, full_name, role, tenant_id)
            values (${userId}, 'admin@test.dev', 'Admin', 'platform_admin', ${tenantId})`,
      ).rejects.toThrow(/user_profiles_role_tenant_coherence/);
    });

    it('rejects a manager profile with no tenant_id (CHECK: role/tenant coherence)', async () => {
      await expect(
        sql`insert into user_profiles (id, email, full_name, role, tenant_id)
            values (${userId}, 'manager@test.dev', 'Manager', 'manager', null)`,
      ).rejects.toThrow(/user_profiles_role_tenant_coherence/);
    });

    it('rejects a product referencing a non-existent category (FK)', async () => {
      await expect(
        sql`insert into products (id, name, category_id) values (${randomUUID()}, 'Orphan', ${randomUUID()})`,
      ).rejects.toThrow(/violates foreign key constraint/);
    });

    it('rejects a second assortment item for the same (tenant, size) pair (UNIQUE)', async () => {
      const itemId = randomUUID();
      await sql`insert into assortment_items (id, tenant_id, size_id) values (${itemId}, ${tenantId}, ${sizeId})`;
      await expect(
        sql`insert into assortment_items (id, tenant_id, size_id) values (${randomUUID()}, ${tenantId}, ${sizeId})`,
      ).rejects.toThrow(/assortment_items_tenant_id_size_id_unique/);
      await sql`delete from assortment_items where id = ${itemId}`;
    });

    it('rejects a replenishment list item with quantity_requested <= 0 (CHECK)', async () => {
      const itemId = randomUUID();
      const listId = randomUUID();
      await sql`insert into assortment_items (id, tenant_id, size_id) values (${itemId}, ${tenantId}, ${sizeId})`;
      await sql`insert into replenishment_lists (id, tenant_id, name) values (${listId}, ${tenantId}, 'Test list')`;
      await expect(
        sql`insert into replenishment_list_items (id, tenant_id, list_id, size_id, quantity_requested)
            values (${randomUUID()}, ${tenantId}, ${listId}, ${sizeId}, 0)`,
      ).rejects.toThrow(/replenishment_list_items_quantity_requested_check/);
      await sql`delete from replenishment_lists where id = ${listId}`;
      await sql`delete from assortment_items where id = ${itemId}`;
    });

    it('maintains updated_at via the set_updated_at trigger', async () => {
      const beforeRows = await sql<{ updated_at: Date }[]>`select updated_at from tenants where id = ${tenantId}`;
      const before = beforeRows[0];
      expect(before).toBeDefined();
      await new Promise((resolve) => setTimeout(resolve, 10));
      await sql`update tenants set name = 'Test Store Updated' where id = ${tenantId}`;
      const afterRows = await sql<{ updated_at: Date }[]>`select updated_at from tenants where id = ${tenantId}`;
      const after = afterRows[0];
      expect(after).toBeDefined();
      expect(new Date(after!.updated_at).getTime()).toBeGreaterThan(new Date(before!.updated_at).getTime());
    });
  });
});
