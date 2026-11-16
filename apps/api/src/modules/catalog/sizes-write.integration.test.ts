import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../app.js';
import { env } from '../../config/env.js';

// Sub-task 8.3 — RF-37 `POST /products/:id/sizes`, `PATCH
// /products/:id/sizes/:sizeId`: `catalog:manage`, global router (no
// tenantContext), write limiter, no delete. A new size goes after the last one
// unless a position is given; labels are unique per product and SKUs across
// the catalog (409 on the field); both answer the whole `Product`.
// Deactivation is soft (RN-08): the store keeps its assortment and history but
// cannot add the size. Requires the local Supabase stack. The catalog is
// global, so every name/SKU is token-prefixed; products are seeded by SQL to
// spare the write limiter.
const adminUrl = process.env.MIGRATIONS_DATABASE_URL;
if (!adminUrl) {
  throw new Error('MIGRATIONS_DATABASE_URL is not set — run `supabase start` and set up apps/api/.env first');
}
const admin = postgres(adminUrl);
const authAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const PASSWORD = `sizes-write-${randomUUID()}`;
const token = `sw${randomUUID().slice(0, 8)}`;
const store = { id: randomUUID(), name: `${token} Store`, slug: `${token}-store` };
const category = { id: randomUUID(), name: `${token} Shoes`, slug: `${token}-shoes` };

interface Fixture {
  role: 'platform_admin' | 'manager' | 'employee';
  tenantId: string | null;
  id: string;
  token: string;
}
const users: Record<'admin' | 'editor' | 'manager' | 'employee', Fixture> = {
  admin: { role: 'platform_admin', tenantId: null, id: '', token: '' },
  // The write limiter is real (30/min per user): PATCH calls go out as a
  // second Platform Admin so POST and PATCH suites never share a bucket.
  editor: { role: 'platform_admin', tenantId: null, id: '', token: '' },
  manager: { role: 'manager', tenantId: store.id, id: '', token: '' },
  employee: { role: 'employee', tenantId: store.id, id: '', token: '' },
};

const FORBIDDEN = { error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action' } };

let skuCounter = 0;
const sku = () => `${token}-SKU-${++skuCounter}`;

function auth(req: request.Test, user: Fixture): request.Test {
  return req.set('Authorization', `Bearer ${user.token}`);
}

function add(productId: string, body: object, user: Fixture = users.admin) {
  return auth(request(app).post(`/api/v1/products/${productId}/sizes`), user).send(body);
}

function patch(productId: string, sizeId: string, body: object, user: Fixture = users.editor) {
  return auth(request(app).patch(`/api/v1/products/${productId}/sizes/${sizeId}`), user).send(body);
}

interface SeededSize {
  id: string;
  label: string;
  sku: string;
  position: number;
}

// A product with sizes at the given positions (labels S, M, L…), by SQL.
async function seedProduct(name: string, positions: number[] = [0]) {
  const id = randomUUID();
  await admin`insert into products (id, name, category_id) values (${id}, ${`${token} ${name}`}, ${category.id})`;
  const labels = ['S', 'M', 'L', 'XL'];
  const sizes: SeededSize[] = positions.map((position, index) => ({
    id: randomUUID(),
    label: labels[index]!,
    sku: sku(),
    position,
  }));
  for (const size of sizes) {
    await admin`
      insert into product_sizes (id, product_id, label, sku, position)
      values (${size.id}, ${id}, ${size.label}, ${size.sku}, ${size.position})
    `;
  }
  return { id, sizes };
}

async function sizeRow(id: string) {
  const [row] = await admin`select label, sku, position, is_active from product_sizes where id = ${id}`;
  return row;
}

describe('product sizes writes (RF-37)', () => {
  beforeAll(async () => {
    await admin`insert into tenants (id, name, slug) values (${store.id}, ${store.name}, ${store.slug})`;
    await admin`insert into categories (id, name, slug) values (${category.id}, ${category.name}, ${category.slug})`;
    const signIn = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    for (const [key, user] of Object.entries(users)) {
      const email = `sizes-write-${key}-${randomUUID()}@repma.test`;
      const result = await authAdmin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
      if (result.error) throw result.error;
      user.id = result.data.user.id;
      await admin`
        insert into user_profiles (id, email, full_name, role, tenant_id)
        values (${user.id}, ${email}, ${`Sizes write ${key}`}, ${user.role}, ${user.tenantId})
      `;
      const session = await signIn.auth.signInWithPassword({ email, password: PASSWORD });
      if (session.error) throw session.error;
      user.token = session.data.session.access_token;
    }
  });

  afterAll(async () => {
    const ids = Object.values(users)
      .map((user) => user.id)
      .filter(Boolean);
    await admin`delete from availability_events where tenant_id = ${store.id}`;
    await admin`delete from assortment_items where tenant_id = ${store.id}`;
    await admin`delete from user_profiles where id in ${admin(ids)}`;
    for (const id of ids) await authAdmin.auth.admin.deleteUser(id);
    await admin`delete from tenants where id = ${store.id}`;
    await admin`delete from product_sizes where product_id in (select id from products where name like ${`${token} %`})`;
    await admin`delete from products where name like ${`${token} %`}`;
    await admin`delete from categories where id = ${category.id}`;
    await admin.end();
  });

  describe('access', () => {
    it('without a session → 401 on both routes', async () => {
      const { id, sizes } = await seedProduct('Anon');
      expect((await request(app).post(`/api/v1/products/${id}/sizes`).send({ label: 'M', sku: sku() })).status).toBe(401);
      expect((await request(app).patch(`/api/v1/products/${id}/sizes/${sizes[0]!.id}`).send({ label: 'X' })).status).toBe(
        401,
      );
    });

    it.each(['manager', 'employee'] as const)('%s (no catalog:manage) → uniform 403, nothing written', async (role) => {
      const { id, sizes } = await seedProduct(`Guarded ${role}`);
      for (const res of [
        await add(id, { label: 'M', sku: sku() }, users[role]),
        await patch(id, sizes[0]!.id, { label: 'Hijacked', isActive: false }, users[role]),
      ]) {
        expect(res.status).toBe(403);
        expect(res.body).toEqual(FORBIDDEN);
      }
      expect(await admin`select id from product_sizes where product_id = ${id}`).toHaveLength(1);
      expect(await sizeRow(sizes[0]!.id)).toMatchObject({ label: 'S', is_active: true });
    });

    it('POST and PATCH ride the write limiter — without any X-Tenant-Id', async () => {
      const { id, sizes } = await seedProduct('Limiter');
      const post = await add(id, { label: 'M', sku: sku() });
      expect(post.status).toBe(201);
      expect(post.headers['ratelimit-limit']).toBe('30');

      const write = await patch(id, sizes[0]!.id, { label: 'XS' });
      expect(write.status).toBe(200);
      expect(write.headers['ratelimit-limit']).toBe('30');
    });

    it('a query parameter → 400 on both routes', async () => {
      const { id, sizes } = await seedProduct('Query');
      const post = await auth(request(app).post(`/api/v1/products/${id}/sizes?x=1`), users.admin).send({
        label: 'M',
        sku: sku(),
      });
      expect(post.status).toBe(400);
      const write = await auth(request(app).patch(`/api/v1/products/${id}/sizes/${sizes[0]!.id}?x=1`), users.editor).send({
        label: 'XS',
      });
      expect(write.status).toBe(400);
      expect(await admin`select id from product_sizes where product_id = ${id}`).toHaveLength(1);
      expect(await sizeRow(sizes[0]!.id)).toMatchObject({ label: 'S' });
    });

    it('there is no delete endpoint (RN-08) → 404, the size survives', async () => {
      const { id, sizes } = await seedProduct('Undeletable');
      const res = await auth(request(app).delete(`/api/v1/products/${id}/sizes/${sizes[0]!.id}`), users.editor);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(await sizeRow(sizes[0]!.id)).toBeDefined();
    });
  });

  describe('POST /products/:id/sizes', () => {
    it('201 with the whole product; the new size goes after the last one (inactive included), trimmed and active', async () => {
      const { id, sizes } = await seedProduct('Appendable', [0, 7, 3]);
      await admin`update product_sizes set is_active = false where id = ${sizes[1]!.id}`;
      const fresh = sku();
      const res = await add(id, { label: ' XL ', sku: ` ${fresh} ` });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id,
        name: `${token} Appendable`,
        description: null,
        imageUrl: null,
        categoryId: category.id,
        categoryName: category.name,
        isActive: true,
        sizes: [
          { id: sizes[0]!.id, label: 'S', sku: sizes[0]!.sku, position: 0, isActive: true },
          { id: sizes[2]!.id, label: 'L', sku: sizes[2]!.sku, position: 3, isActive: true },
          { id: sizes[1]!.id, label: 'M', sku: sizes[1]!.sku, position: 7, isActive: false },
          { id: expect.any(String), label: 'XL', sku: fresh, position: 8, isActive: true },
        ],
      });

      const listed = await auth(request(app).get('/api/v1/products').query({ search: `${token} Appendable` }), users.manager);
      expect(listed.body.items).toEqual([res.body]);
    });

    it('an explicit position is kept', async () => {
      const { id } = await seedProduct('Positioned', [0]);
      const res = await add(id, { label: 'XS', sku: sku(), position: 0 });
      expect(res.status).toBe(201);
      expect(res.body.sizes.map((size: { label: string; position: number }) => [size.label, size.position])).toEqual([
        ['S', 0],
        ['XS', 0],
      ]);
    });

    it('a label the product already has → 409 on `label`, nothing written; another product may reuse it', async () => {
      const { id } = await seedProduct('Labelled', [0, 1]);
      const res = await add(id, { label: 'M', sku: sku() });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error: {
          code: 'CONFLICT',
          message: 'This label is already used',
          details: [{ path: 'label', message: 'This label is already used' }],
        },
      });
      expect(await admin`select id from product_sizes where product_id = ${id}`).toHaveLength(2);

      const other = await seedProduct('Other labels');
      expect((await add(other.id, { label: 'M', sku: sku() })).status).toBe(201);
    });

    it('a SKU held by any size → 409 on `sku`, nothing written', async () => {
      const owner = await seedProduct('SKU owner');
      const { id } = await seedProduct('SKU thief');
      const taken = owner.sizes[0]!.sku;
      const res = await add(id, { label: 'M', sku: taken });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error: {
          code: 'CONFLICT',
          message: `SKU ${taken} is already in use`,
          details: [{ path: 'sku', message: `SKU ${taken} is already in use` }],
        },
      });
      expect(await admin`select id from product_sizes where product_id = ${id}`).toHaveLength(1);
    });

    it('unknown product → 404; malformed id, unknown keys (isActive, id), blank fields → 400', async () => {
      const res = await add(randomUUID(), { label: 'M', sku: sku() });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Product not found' } });

      const { id } = await seedProduct('Strict');
      expect((await add('nope', { label: 'M', sku: sku() })).status).toBe(400);
      for (const [body, path] of [
        [{ label: 'M', sku: sku(), isActive: false }, 'isActive'],
        [{ label: 'M', sku: sku(), id: randomUUID() }, 'id'],
        [{ label: ' ', sku: sku() }, 'label'],
        [{ label: 'M', sku: '' }, 'sku'],
        [{ label: 'M', sku: sku(), position: -1 }, 'position'],
      ] as const) {
        const bad = await add(id, body);
        expect(bad.status).toBe(400);
        expect(bad.body.error.details.map((detail: { path: string }) => detail.path)).toContain(path);
      }
      expect(await admin`select id from product_sizes where product_id = ${id}`).toHaveLength(1);
    });
  });

  describe('PATCH /products/:id/sizes/:sizeId', () => {
    it('edits label, SKU and position, each on its own → 200 with the whole product', async () => {
      const { id, sizes } = await seedProduct('Editable', [0, 1]);
      const [small, medium] = sizes as [SeededSize, SeededSize];

      const label = await patch(id, small.id, { label: ' XS ' });
      expect(label.status).toBe(200);
      expect(label.body.sizes[0]).toEqual({ id: small.id, label: 'XS', sku: small.sku, position: 0, isActive: true });

      const fresh = sku();
      const renamed = await patch(id, small.id, { sku: fresh });
      expect(renamed.status).toBe(200);
      expect(renamed.body.sizes[0]).toMatchObject({ id: small.id, sku: fresh });

      const moved = await patch(id, small.id, { position: 5 });
      expect(moved.status).toBe(200);
      expect(moved.body.sizes).toEqual([
        { id: medium.id, label: 'M', sku: medium.sku, position: 1, isActive: true },
        { id: small.id, label: 'XS', sku: fresh, position: 5, isActive: true },
      ]);
      expect(moved.body).toMatchObject({ id, name: `${token} Editable`, categoryName: category.name });
    });

    it('re-sending its own SKU or label is no conflict', async () => {
      const { id, sizes } = await seedProduct('Same values');
      const res = await patch(id, sizes[0]!.id, { label: 'S', sku: sizes[0]!.sku });
      expect(res.status).toBe(200);
    });

    it("another product's SKU → 409 on `sku`; a sibling's label → 409 on `label`; nothing changed", async () => {
      const owner = await seedProduct('Patch SKU owner');
      const { id, sizes } = await seedProduct('Patch clash', [0, 1]);
      const taken = owner.sizes[0]!.sku;

      const skuClash = await patch(id, sizes[0]!.id, { sku: taken });
      expect(skuClash.status).toBe(409);
      expect(skuClash.body.error.details).toEqual([{ path: 'sku', message: `SKU ${taken} is already in use` }]);

      const labelClash = await patch(id, sizes[0]!.id, { label: 'M', position: 9 });
      expect(labelClash.status).toBe(409);
      expect(labelClash.body.error.details).toEqual([{ path: 'label', message: 'This label is already used' }]);

      expect(await sizeRow(sizes[0]!.id)).toEqual({ label: 'S', sku: sizes[0]!.sku, position: 0, is_active: true });
    });

    it('a size of another product, an unknown size or product → 404; malformed ids, empty body, unknown keys → 400', async () => {
      const mine = await seedProduct('Mine');
      const theirs = await seedProduct('Theirs');
      const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Size not found' } };
      for (const [productId, sizeId] of [
        [mine.id, theirs.sizes[0]!.id],
        [mine.id, randomUUID()],
        [randomUUID(), mine.sizes[0]!.id],
      ]) {
        const res = await patch(productId!, sizeId!, { label: 'Stolen' });
        expect(res.status).toBe(404);
        expect(res.body).toEqual(NOT_FOUND);
      }
      expect(await sizeRow(theirs.sizes[0]!.id)).toMatchObject({ label: 'S' });

      const sizeId = mine.sizes[0]!.id;
      expect((await patch(mine.id, 'nope', { label: 'X' })).status).toBe(400);
      expect((await patch('nope', sizeId, { label: 'X' })).status).toBe(400);
      for (const body of [{}, { productId: theirs.id }, { label: '' }, { position: 1.5 }]) {
        expect((await patch(mine.id, sizeId, body)).status).toBe(400);
      }
    });

    it('deactivate (RN-08): the store keeps its assortment and history but cannot add the size; reactivate restores it', async () => {
      const { id, sizes } = await seedProduct('Retiring', [0, 1]);
      const [assorted, unassorted] = sizes as [SeededSize, SeededSize];
      const itemId = randomUUID();
      await admin`
        insert into assortment_items (id, tenant_id, size_id, is_available)
        values (${itemId}, ${store.id}, ${assorted.id}, false)
      `;
      await admin`
        insert into availability_events (tenant_id, assortment_item_id, type, created_by)
        values (${store.id}, ${itemId}, 'out_of_stock', ${users.manager.id})
      `;

      for (const size of sizes) {
        const res = await patch(id, size.id, { isActive: false });
        expect(res.status).toBe(200);
        expect(res.body.sizes.find((s: { id: string }) => s.id === size.id).isActive).toBe(false);
      }

      // The store's view: the size is still listed, flagged inactive, its
      // out-of-stock state and history intact.
      const item = await auth(request(app).get(`/api/v1/availability/${itemId}`), users.manager);
      expect(item.status).toBe(200);
      expect(item.body).toMatchObject({ id: itemId, sizeId: assorted.id, isAvailable: false, isActive: false });
      const events = await auth(request(app).get(`/api/v1/availability/${itemId}/events`), users.manager);
      expect(events.body.total).toBe(1);

      // No new additions (RN-08).
      const blocked = await auth(request(app).post('/api/v1/availability'), users.manager).send({ sizeId: unassorted.id });
      expect(blocked.status).toBe(400);
      expect(blocked.body.error.details).toEqual([{ path: 'sizeId', message: 'This size is inactive' }]);

      // Reactivate: additions are accepted again.
      const back = await patch(id, unassorted.id, { isActive: true });
      expect(back.status).toBe(200);
      const readd = await auth(request(app).post('/api/v1/availability'), users.manager).send({ sizeId: unassorted.id });
      expect(readd.status).toBe(201);
    });
  });
});
