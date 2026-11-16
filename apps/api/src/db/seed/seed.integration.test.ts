import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CATEGORIES, DEMO_PASSWORD, PRODUCTS, RETIRED_CATEGORY_SLUGS, RETIRED_PRODUCT_CODES, USERS, skuOf } from './data.js';
import { PRODUCT_IMAGES_BUCKET } from '../../lib/supabase.js';
import { SEED_IMAGES_BUCKET, seedImageKey, seedImages } from './images.js';
import { parseSeedEnv, seed, seedId, storeId } from './seed.js';

// The demo seed (database.md §9; plan.md 1.9, 8.8) against the local stack.
// Runs the seed and its images twice, as `db:seed` does, to prove both are
// re-runnable, then checks the result. Other
// suites use their own fixtures, so this one only looks at the seed's rows.
const env = parseSeedEnv(process.env);
const admin = postgres(env.MIGRATIONS_DATABASE_URL);
const tenantIds = [storeId('downtown'), storeId('north')];
const demoEmails = USERS.map((u) => u.email);

// A product that isn't the seed's, with its own image: the seed must leave it alone.
const foreign = { categoryId: randomUUID(), productId: randomUUID(), imageUrl: 'https://example.test/foreign.png' };

// Two products of the retired demo catalog, as an older seed left them: one nobody stocks,
// one another store still carries.
const retiredCategoryId = seedId(`category:${RETIRED_CATEGORY_SLUGS[0]}`);
const unused = { productId: seedId(`product:${RETIRED_PRODUCT_CODES[0]}`), sizeId: randomUUID() };
const stocked = { productId: seedId(`product:${RETIRED_PRODUCT_CODES[1]}`), sizeId: randomUUID() };
const otherStore = randomUUID();

beforeAll(async () => {
  await admin`insert into categories (id, name, slug) values (${foreign.categoryId}, ${`Seed foreign ${foreign.categoryId}`}, ${`seed-foreign-${foreign.categoryId}`})`;
  await admin`
    insert into products (id, name, category_id, image_url)
    values (${foreign.productId}, ${`Seed foreign ${foreign.productId}`}, ${foreign.categoryId}, ${foreign.imageUrl})
  `;
  await admin`
    insert into categories (id, name, slug) values (${retiredCategoryId}, 'Retired seed category', 'retired-seed-category')
    on conflict (id) do nothing
  `;
  for (const { productId, sizeId } of [unused, stocked]) {
    await admin`
      insert into products (id, name, category_id, image_url)
      values (${productId}, ${`Retired ${productId}`}, ${retiredCategoryId}, 'https://example.test/retired.png')
      on conflict (id) do nothing
    `;
    await admin`insert into product_sizes (id, product_id, label, sku) values (${sizeId}, ${productId}, 'M', ${`RET-${sizeId}`})`;
  }
  await admin`insert into tenants (id, name, slug) values (${otherStore}, ${`Seed other ${otherStore}`}, ${`seed-other-${otherStore}`})`;
  await admin`insert into assortment_items (tenant_id, size_id) values (${otherStore}, ${stocked.sizeId})`;
  for (let run = 0; run < 2; run++) {
    await seed(env);
    await seedImages(env);
  }
}, 60_000);

afterAll(async () => {
  await admin`delete from assortment_items where tenant_id = ${otherStore}`;
  await admin`delete from tenants where id = ${otherStore}`;
  await admin`delete from product_sizes where product_id in ${admin([unused.productId, stocked.productId])}`;
  await admin`delete from products where id in ${admin([unused.productId, stocked.productId])}`;
  await admin`delete from categories where id = ${retiredCategoryId}`;
  await admin`delete from products where id = ${foreign.productId}`;
  await admin`delete from categories where id = ${foreign.categoryId}`;
  await admin.end();
});

describe('demo seed', () => {
  it('creates 1 platform admin and a manager + employee per store, all able to sign in', async () => {
    const profiles = await admin<{ email: string; role: string; tenant_id: string | null }[]>`
      select email, role, tenant_id from user_profiles where email in ${admin(demoEmails)} order by email
    `;
    expect(profiles).toHaveLength(5);
    expect(profiles.filter((p) => p.role === 'platform_admin' && p.tenant_id === null)).toHaveLength(1);
    for (const tenantId of tenantIds) {
      expect(profiles.filter((p) => p.tenant_id === tenantId).map((p) => p.role).sort()).toEqual(['employee', 'manager']);
    }

    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (!anonKey) throw new Error('SUPABASE_ANON_KEY is not set');
    const client = createClient(env.SUPABASE_URL, anonKey, { auth: { persistSession: false } });
    const { error } = await client.auth.signInWithPassword({ email: 'employee.north@repma.demo', password: DEMO_PASSWORD });
    expect(error).toBeNull();
  });

  it('loads the catalog: 2 categories, 24 clothing products, SKUs on sizes', async () => {
    const productIds = await admin<{ id: string; category: string; image_url: string | null }[]>`
      select p.id, c.slug as category, p.image_url
      from products p join categories c on c.id = p.category_id
      join product_sizes s on s.product_id = p.id
      where s.sku in ${admin(PRODUCTS.map((p) => skuOf(p.code, p.sizes[0]!)))}
    `;
    expect(productIds).toHaveLength(PRODUCTS.length);
    expect(PRODUCTS.length).toBe(24);
    expect(new Set(productIds.map((p) => p.category))).toEqual(new Set(CATEGORIES.map((c) => c.slug)));

    const sizes = await admin<{ category: string; labels: string[] }[]>`
      select c.slug as category, array_agg(s.label order by s.position) as labels
      from product_sizes s join products p on p.id = s.product_id join categories c on c.id = p.category_id
      where p.id in ${admin(productIds.map((p) => p.id))}
      group by p.id, c.slug
    `;
    expect(sizes).toHaveLength(PRODUCTS.length);
    for (const { labels } of sizes) expect(labels).toEqual(['XS', 'S', 'M', 'L', 'XL', '2XL']);
  });

  it('gives the two stores overlapping assortments with exclusives on both sides', async () => {
    const [counts] = await admin<{ shared: number; downtown_only: number; north_only: number }[]>`
      select
        count(*) filter (where d.size_id is not null and n.size_id is not null)::int as shared,
        count(*) filter (where n.size_id is null)::int as downtown_only,
        count(*) filter (where d.size_id is null)::int as north_only
      from (select size_id from assortment_items where tenant_id = ${tenantIds[0]!}) d
      full join (select size_id from assortment_items where tenant_id = ${tenantIds[1]!}) n using (size_id)
    `;
    expect(counts!.shared).toBeGreaterThan(0);
    expect(counts!.downtown_only).toBeGreaterThan(0);
    expect(counts!.north_only).toBeGreaterThan(0);
  });

  it("points every seed product at its own image under the bucket's public seed/ path", async () => {
    const products = await admin<{ id: string; image_url: string | null }[]>`
      select id, image_url from products where id in ${admin(PRODUCTS.map((p) => seedId(`product:${p.code}`)))}
    `;
    expect(products).toHaveLength(PRODUCTS.length);
    const publicSeedPath = `${env.SUPABASE_URL}/storage/v1/object/public/${SEED_IMAGES_BUCKET}/seed/`;
    for (const product of PRODUCTS) {
      const row = products.find((p) => p.id === seedId(`product:${product.code}`))!;
      expect(row.image_url).toBe(`${publicSeedPath}${product.code}.webp`);
    }
  });

  it('serves every seed image publicly as a WebP, one object per product', async () => {
    expect(SEED_IMAGES_BUCKET).toBe(PRODUCT_IMAGES_BUCKET); // the API's bucket
    for (const { code } of PRODUCTS) {
      const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/public/${SEED_IMAGES_BUCKET}/${seedImageKey(code)}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/webp');
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe('WEBP'); // RIFF....WEBP
    }

    const service = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data, error } = await service.storage.from(SEED_IMAGES_BUCKET).list('seed');
    expect(error).toBeNull();
    expect(data!.map((o) => o.name).sort()).toEqual(PRODUCTS.map((p) => `${p.code}.webp`).sort()); // re-runs add nothing, retired images go
  });

  it('removes the retired demo catalog where nothing references it and deactivates the rest', async () => {
    const rows = await admin<{ id: string; is_active: boolean; image_url: string | null }[]>`
      select id, is_active, image_url from products where id in ${admin([unused.productId, stocked.productId])}
    `;
    expect(rows).toEqual([{ id: stocked.productId, is_active: false, image_url: null }]);
    const [size] = await admin<{ is_active: boolean }[]>`select is_active from product_sizes where id = ${stocked.sizeId}`;
    expect(size!.is_active).toBe(false);
    // Still holds the stocked product, so it stays.
    expect(await admin`select 1 from categories where id = ${retiredCategoryId}`).toHaveLength(1);
  });

  it("leaves products that aren't the seed's untouched", async () => {
    const [row] = await admin<{ image_url: string | null }[]>`select image_url from products where id = ${foreign.productId}`;
    expect(row!.image_url).toBe(foreign.imageUrl);
  });

  it('flags several sizes out of stock in each store', async () => {
    const rows = await admin<{ tenant_id: string; n: number }[]>`
      select tenant_id, count(*)::int as n from assortment_items
      where tenant_id in ${admin(tenantIds)} and not is_available group by tenant_id
    `;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.n >= 3)).toBe(true);
  });

  it('keeps every flag equal to its latest event, with strictly alternating histories (RN-14)', async () => {
    const items = await admin<{ is_available: boolean; types: string[] | null }[]>`
      select a.is_available, array_agg(e.type order by e.created_at) filter (where e.id is not null) as types
      from assortment_items a left join availability_events e on e.assortment_item_id = a.id
      where a.tenant_id in ${admin(tenantIds)}
      group by a.id
    `;
    expect(items.some((i) => i.types && i.types.length > 1)).toBe(true);
    for (const { is_available, types } of items) {
      if (!types) {
        expect(is_available).toBe(true); // no events → available
        continue;
      }
      types.forEach((type, i) => expect(type).toBe(i % 2 === 0 ? 'out_of_stock' : 'restock'));
      expect(is_available).toBe(types.at(-1) === 'restock');
    }
  });

  it('creates lists in all three statuses per store: processing with done lines, an empty draft, a done one', async () => {
    const lists = await admin<{ tenant_id: string; status: string; lines: number; done: number }[]>`
      select l.tenant_id, l.status, count(i.id)::int as lines, count(i.id) filter (where i.is_done)::int as done
      from replenishment_lists l left join replenishment_list_items i on i.list_id = l.id
      where l.tenant_id in ${admin(tenantIds)}
      group by l.id
    `;
    for (const tenantId of tenantIds) {
      const own = lists.filter((l) => l.tenant_id === tenantId);
      expect(own.some((l) => l.status === 'processing' && l.done > 0 && l.done < l.lines)).toBe(true);
      expect(own.filter((l) => l.status === 'draft').length).toBeGreaterThanOrEqual(2);
      expect(own.some((l) => l.status === 'draft' && l.lines === 0)).toBe(true);
      expect(own.some((l) => l.status === 'done')).toBe(true);
    }
  });
});
