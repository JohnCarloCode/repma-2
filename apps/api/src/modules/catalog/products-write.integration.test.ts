import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../app.js';
import { env } from '../../config/env.js';

// Sub-task 8.2 — RF-16 `POST /products`, `PATCH /products/:id`:
// `catalog:manage`, global router (no tenantContext), write limiter. Creation
// requires ≥1 size (RN-11) and writes product + sizes in one transaction; SKUs
// are globally unique (409 per offending row); labels unique per product
// (400). Retirement is soft (RN-08): the store keeps reading its assortment
// and history, but no new additions. Requires the local Supabase stack. The
// catalog is global, so every name/SKU is token-prefixed.
const adminUrl = process.env.MIGRATIONS_DATABASE_URL;
if (!adminUrl) {
  throw new Error('MIGRATIONS_DATABASE_URL is not set — run `supabase start` and set up apps/api/.env first');
}
const admin = postgres(adminUrl);
const authAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const PASSWORD = `products-write-${randomUUID()}`;
const token = `pw${randomUUID().slice(0, 8)}`;
const store = { id: randomUUID(), name: `${token} Store`, slug: `${token}-store` };
const shoes = { id: randomUUID(), name: `${token} Shoes`, slug: `${token}-shoes` };
const bags = { id: randomUUID(), name: `${token} Bags`, slug: `${token}-bags` };
// RF-46's own category, so its product set is exactly what that suite creates.
const kits = { id: randomUUID(), name: `${token} Kits`, slug: `${token}-kits` };
// Products created through the API, deleted in afterAll.
const created: string[] = [];

interface Fixture {
  role: 'platform_admin' | 'manager' | 'employee';
  tenantId: string | null;
  id: string;
  token: string;
}
const users: Record<'admin' | 'editor' | 'orderer' | 'manager' | 'employee', Fixture> = {
  admin: { role: 'platform_admin', tenantId: null, id: '', token: '' },
  // The write limiter is real (30/min per user): PATCH calls go out as a
  // second Platform Admin so POST and PATCH suites never share a bucket.
  editor: { role: 'platform_admin', tenantId: null, id: '', token: '' },
  // The RF-46 suite (product order) goes out as a third one, for the same reason.
  orderer: { role: 'platform_admin', tenantId: null, id: '', token: '' },
  manager: { role: 'manager', tenantId: store.id, id: '', token: '' },
  employee: { role: 'employee', tenantId: store.id, id: '', token: '' },
};

const FORBIDDEN = { error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action' } };
const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Product not found' } };

let skuCounter = 0;
const sku = () => `${token}-SKU-${++skuCounter}`;

function auth(req: request.Test, user: Fixture): request.Test {
  return req.set('Authorization', `Bearer ${user.token}`);
}

async function create(body: object, user: Fixture = users.admin) {
  const res = await auth(request(app).post('/api/v1/products'), user).send(body);
  if (res.status === 201) created.push(res.body.id);
  return res;
}

function patch(id: string, body: object, user: Fixture = users.editor) {
  return auth(request(app).patch(`/api/v1/products/${id}`), user).send(body);
}

function product(name: string, sizes: object[] = [{ label: 'One size', sku: sku() }]) {
  return { name: `${token} ${name}`, categoryId: shoes.id, sizes };
}

async function productRows(name: string) {
  return admin`select id from products where name = ${`${token} ${name}`}`;
}

describe('products writes (RF-16)', () => {
  beforeAll(async () => {
    await admin`insert into tenants (id, name, slug) values (${store.id}, ${store.name}, ${store.slug})`;
    await admin`
      insert into categories (id, name, slug) values
        (${shoes.id}, ${shoes.name}, ${shoes.slug}), (${bags.id}, ${bags.name}, ${bags.slug}),
        (${kits.id}, ${kits.name}, ${kits.slug})
    `;
    const signIn = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    for (const [key, user] of Object.entries(users)) {
      const email = `products-write-${key}-${randomUUID()}@repma.test`;
      const result = await authAdmin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
      if (result.error) throw result.error;
      user.id = result.data.user.id;
      await admin`
        insert into user_profiles (id, email, full_name, role, tenant_id)
        values (${user.id}, ${email}, ${`Products write ${key}`}, ${user.role}, ${user.tenantId})
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
    await admin`delete from categories where id in ${admin([shoes.id, bags.id, kits.id])}`;
    await admin.end();
  });

  describe('access', () => {
    it('without a session → 401 on both routes', async () => {
      expect((await request(app).post('/api/v1/products').send(product('Anon'))).status).toBe(401);
      expect((await request(app).patch(`/api/v1/products/${randomUUID()}`).send({ name: 'x' })).status).toBe(401);
    });

    it.each(['manager', 'employee'] as const)('%s (no catalog:manage) → uniform 403, nothing written', async (role) => {
      const target = (await create(product(`Guarded ${role}`))).body;
      for (const res of [
        await create(product(`Forbidden ${role}`), users[role]),
        await patch(target.id, { name: `${token} Hijacked ${role}`, isActive: false }, users[role]),
      ]) {
        expect(res.status).toBe(403);
        expect(res.body).toEqual(FORBIDDEN);
      }
      expect(await productRows(`Forbidden ${role}`)).toHaveLength(0);
      const [row] = await admin`select name, is_active from products where id = ${target.id}`;
      expect(row).toEqual({ name: `${token} Guarded ${role}`, is_active: true });
    });

    it('POST and PATCH ride the write limiter — without any X-Tenant-Id', async () => {
      const post = await create(product('Limiter'));
      expect(post.status).toBe(201);
      expect(post.headers['ratelimit-limit']).toBe('30');

      const write = await patch(post.body.id, { name: `${token} Limiter` });
      expect(write.status).toBe(200);
      expect(write.headers['ratelimit-limit']).toBe('30');
    });

    it('a query parameter → 400 on both routes', async () => {
      const post = await auth(request(app).post('/api/v1/products?x=1'), users.admin).send(product('Query'));
      expect(post.status).toBe(400);
      expect(await productRows('Query')).toHaveLength(0);
      const write = await auth(request(app).patch(`/api/v1/products/${randomUUID()}?x=1`), users.editor).send({
        name: 'x',
      });
      expect(write.status).toBe(400);
    });
  });

  describe('POST /products', () => {
    it('201 with the product in the GET /products shape: sizes embedded, positions defaulted to body order', async () => {
      const skus = [sku(), sku(), sku()];
      const res = await create({
        name: `  ${token} Trail Runner `,
        description: '  Grippy. ',
        categoryId: shoes.id,
        sizes: [
          { label: ' 42 ', sku: ` ${skus[0]} ` },
          { label: '40', sku: skus[1] },
          { label: '41', sku: skus[2], position: 0 },
        ],
      });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id: expect.any(String),
        name: `${token} Trail Runner`,
        description: 'Grippy.',
        imageUrl: null,
        categoryId: shoes.id,
        categoryName: shoes.name,
        isActive: true,
        // Ordered by position, label breaking the 0–0 tie.
        sizes: [
          { id: expect.any(String), label: '41', sku: skus[2], position: 0, isActive: true },
          { id: expect.any(String), label: '42', sku: skus[0], position: 0, isActive: true },
          { id: expect.any(String), label: '40', sku: skus[1], position: 1, isActive: true },
        ],
      });

      const listed = await auth(request(app).get('/api/v1/products').query({ search: `${token} Trail` }), users.manager);
      expect(listed.body.items).toEqual([res.body]);
    });

    it('description is optional (null) and blank → null', async () => {
      expect((await create(product('No description'))).body.description).toBeNull();
      expect((await create({ ...product('Blank description'), description: '  ' })).body.description).toBeNull();
    });

    it.each([
      ['missing', {}],
      ['empty', { sizes: [] }],
    ])('sizes %s → 400 on `sizes` (RN-11), nothing written', async (_case, sizes) => {
      const { sizes: _drop, ...body } = product('Sizeless');
      const res = await create({ ...body, ...sizes });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toEqual([{ path: 'sizes', message: expect.any(String) }]);
      expect(await productRows('Sizeless')).toHaveLength(0);
    });

    it('a repeated label → 400 on the repeating row', async () => {
      const res = await create(
        product('Twin labels', [
          { label: 'M', sku: sku() },
          { label: 'L', sku: sku() },
          { label: 'M', sku: sku() },
        ]),
      );
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([{ path: 'sizes.2.label', message: 'This label is already used' }]);
      expect(await productRows('Twin labels')).toHaveLength(0);
    });

    it('a SKU held by another size → 409 naming the row; nothing written', async () => {
      const taken = (await create(product('Owner'))).body.sizes[0].sku;
      const fresh = sku();
      const res = await create(
        product('Thief', [
          { label: 'S', sku: fresh },
          { label: 'M', sku: taken },
        ]),
      );
      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error: {
          code: 'CONFLICT',
          message: `SKU ${taken} is already in use`,
          details: [{ path: 'sizes.1.sku', message: `SKU ${taken} is already in use` }],
        },
      });
      expect(await productRows('Thief')).toHaveLength(0);
      expect(await admin`select id from product_sizes where sku = ${fresh}`).toHaveLength(0);
    });

    it('a SKU repeated within the body → 409 on the later row(s)', async () => {
      const twin = sku();
      const res = await create(
        product('Twin SKUs', [
          { label: 'S', sku: twin },
          { label: 'M', sku: sku() },
          { label: 'L', sku: twin },
        ]),
      );
      expect(res.status).toBe(409);
      expect(res.body.error.details).toEqual([
        { path: 'sizes.2.sku', message: `SKU ${twin} is repeated in this product` },
      ]);
      expect(await productRows('Twin SKUs')).toHaveLength(0);
    });

    it('an unknown category → 400 on `categoryId`', async () => {
      const res = await create({ ...product('Orphan'), categoryId: randomUUID() });
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([{ path: 'categoryId', message: 'Category not found' }]);
      expect(await productRows('Orphan')).toHaveLength(0);
    });

    it('field 400s: blank name, bad categoryId, image/isActive keys, unknown size keys', async () => {
      for (const [body, path] of [
        [{ ...product('x'), name: '  ' }, 'name'],
        [{ ...product('x'), categoryId: 'nope' }, 'categoryId'],
        [{ ...product('x'), imageUrl: 'http://x' }, 'imageUrl'],
        [{ ...product('x'), isActive: false }, 'isActive'],
        [product('x', [{ label: 'M', sku: sku(), isActive: false }]), 'sizes.0.isActive'],
        [product('x', [{ label: 'M', sku: ' ' }]), 'sizes.0.sku'],
      ] as const) {
        const res = await create(body);
        expect(res.status).toBe(400);
        expect(res.body.error.details.map((detail: { path: string }) => detail.path)).toContain(path);
      }
    });
  });

  describe('PATCH /products/:id', () => {
    it('edits name, description and category → 200 with the updated product; sizes untouched', async () => {
      const original = (await create(product('Editable'))).body;
      const res = await patch(original.id, {
        name: `${token} Edited`,
        description: 'Now with words',
        categoryId: bags.id,
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ...original,
        name: `${token} Edited`,
        description: 'Now with words',
        categoryId: bags.id,
        categoryName: bags.name,
      });

      const cleared = await patch(original.id, { description: null });
      expect(cleared.body.description).toBeNull();
    });

    it('an unknown category → 400 on `categoryId`, nothing changed', async () => {
      const original = (await create(product('Recategorized'))).body;
      const res = await patch(original.id, { categoryId: randomUUID(), name: `${token} Renamed` });
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([{ path: 'categoryId', message: 'Category not found' }]);
      const [row] = await admin`select name, category_id from products where id = ${original.id}`;
      expect(row).toEqual({ name: original.name, category_id: shoes.id });
    });

    it('unknown id → 404; malformed id, empty body, sizes/imageUrl keys → 400', async () => {
      const res = await patch(randomUUID(), { name: 'x' });
      expect(res.status).toBe(404);
      expect(res.body).toEqual(NOT_FOUND);

      const target = (await create(product('Strict'))).body;
      expect((await patch('nope', { name: 'x' })).status).toBe(400);
      for (const body of [{}, { sizes: [] }, { imageUrl: 'http://x' }]) {
        expect((await patch(target.id, body)).status).toBe(400);
      }
    });

    it('retire (RN-08): the store keeps reading its assortment and history but cannot add new sizes; reactivate restores it', async () => {
      const retired = (
        await create(
          product('Retiree', [
            { label: 'S', sku: sku() },
            { label: 'M', sku: sku() },
          ]),
        )
      ).body;
      const [assorted, unassorted] = retired.sizes;
      const itemId = randomUUID();
      await admin`
        insert into assortment_items (id, tenant_id, size_id, is_available)
        values (${itemId}, ${store.id}, ${assorted.id}, false)
      `;
      await admin`
        insert into availability_events (tenant_id, assortment_item_id, type, created_by)
        values (${store.id}, ${itemId}, 'out_of_stock', ${users.manager.id})
      `;

      const res = await patch(retired.id, { isActive: false });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ...retired, isActive: false });

      // The store's view: the product is still listed, flagged inactive, its
      // size and out-of-stock state intact; the history is untouched.
      const list = await auth(request(app).get(`/api/v1/availability?productId=${retired.id}`), users.manager);
      expect(list.status).toBe(200);
      expect(list.body.items).toEqual([
        expect.objectContaining({
          id: retired.id,
          isActive: false,
          sizes: [expect.objectContaining({ id: itemId, sizeId: assorted.id, isAvailable: false, isActive: true })],
        }),
      ]);
      const events = await auth(request(app).get(`/api/v1/availability/${itemId}/events`), users.manager);
      expect(events.body.total).toBe(1);
      expect(events.body.items[0].type).toBe('out_of_stock');

      // No new additions (RN-08).
      const add = await auth(request(app).post('/api/v1/availability'), users.manager).send({ sizeId: unassorted.id });
      expect(add.status).toBe(400);
      expect(add.body.error.details).toEqual([{ path: 'sizeId', message: 'This product is inactive' }]);

      const inactive = await auth(request(app).get('/api/v1/products').query({ isActive: 'false', search: `${token} Retiree` }), users.editor);
      expect(inactive.body.items.map((item: { id: string }) => item.id)).toEqual([retired.id]);

      // Reactivate: additions are accepted again.
      const back = await patch(retired.id, { isActive: true });
      expect(back.status).toBe(200);
      expect(back.body.isActive).toBe(true);
      const readd = await auth(request(app).post('/api/v1/availability'), users.manager).send({ sizeId: unassorted.id });
      expect(readd.status).toBe(201);
    });
  });

  describe('product order within a category (RF-46)', () => {
    const NOT_FOUND_CATEGORY = { error: { code: 'NOT_FOUND', message: 'Category not found' } };
    const kitProducts: string[] = [];

    function reorder(categoryId: string, body: object, user: Fixture = users.orderer) {
      return auth(request(app).put(`/api/v1/categories/${categoryId}/products/order`), user).send(body);
    }

    async function positions(categoryId: string): Promise<string[]> {
      const rows = await admin<{ id: string }[]>`
        select id from products where category_id = ${categoryId} order by position, name, id
      `;
      return rows.map((row) => row.id);
    }

    async function listed(categoryId: string): Promise<string[]> {
      const res = await auth(request(app).get('/api/v1/products').query({ categoryId, pageSize: 100 }), users.manager);
      return res.body.items.map((item: { id: string }) => item.id);
    }

    beforeAll(async () => {
      // Names in reverse of creation order: creation order, not the name, decides.
      for (const name of ['Order C', 'Order B', 'Order A']) {
        const res = await create({ ...product(name), categoryId: kits.id }, users.orderer);
        expect(res.status).toBe(201);
        kitProducts.push(res.body.id);
      }
    });

    it('a new product goes last in its category', async () => {
      expect(await positions(kits.id)).toEqual(kitProducts);
      expect(await listed(kits.id)).toEqual(kitProducts);
    });

    it('204: positions rewritten 0..n-1 and GET /products follows them — inactive products included', async () => {
      const retired = await patch(kitProducts[0]!, { isActive: false }, users.orderer);
      expect(retired.status).toBe(200);
      const ids = [kitProducts[2]!, kitProducts[0]!, kitProducts[1]!];
      const res = await reorder(kits.id, { ids });
      expect(res.status).toBe(204);
      expect(res.headers['ratelimit-limit']).toBe('30');
      const rows = await admin<{ id: string; position: number }[]>`
        select id, position from products where category_id = ${kits.id} order by position
      `;
      expect(rows).toEqual(ids.map((id, position) => ({ id, position })));
      expect(await listed(kits.id)).toEqual(ids);
    });

    it('a product moved to another category goes last there; staying put keeps its place', async () => {
      const moved = (await create(product('Order Mover'), users.orderer)).body;
      const before = await positions(kits.id);
      const same = await patch(before[0]!, { categoryId: kits.id, name: `${token} Order Renamed` }, users.orderer);
      expect(same.status).toBe(200);
      expect(await positions(kits.id)).toEqual(before);

      const res = await patch(moved.id, { categoryId: kits.id }, users.orderer);
      expect(res.status).toBe(200);
      expect(await positions(kits.id)).toEqual([...before, moved.id]);
      kitProducts.push(moved.id);
    });

    it('a set that is not exactly the category\'s products → 409, nothing changes', async () => {
      const before = await positions(kits.id);
      const [shoe] = await admin<{ id: string }[]>`select id from products where category_id <> ${kits.id} and name like ${`${token} %`} limit 1`;
      for (const ids of [before.slice(1), [...before.slice(1), shoe!.id], [...before, randomUUID()]]) {
        const res = await reorder(kits.id, { ids: [...ids].reverse() });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('CONFLICT');
      }
      expect(await positions(kits.id)).toEqual(before);
    });

    it('an unknown category → 404', async () => {
      const res = await reorder(randomUUID(), { ids: [randomUUID()] });
      expect(res.status).toBe(404);
      expect(res.body).toEqual(NOT_FOUND_CATEGORY);
    });

    it.each([
      ['an empty list', { ids: [] }],
      ['a repeated id', { ids: [randomUUID(), randomUUID()].flatMap((id) => [id, id]) }],
      ['a malformed id', { ids: ['nope'] }],
      ['an unknown key', { ids: [randomUUID()], extra: 1 }],
    ])('rejects %s → 400 VALIDATION_ERROR', async (_label, body) => {
      const res = await reorder(kits.id, body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('a malformed category id or a query parameter → 400', async () => {
      expect((await reorder('nope', { ids: kitProducts })).status).toBe(400);
      const query = await auth(request(app).put(`/api/v1/categories/${kits.id}/products/order?x=1`), users.orderer).send({
        ids: kitProducts,
      });
      expect(query.status).toBe(400);
    });

    it('without a session → 401', async () => {
      const res = await request(app).put(`/api/v1/categories/${kits.id}/products/order`).send({ ids: kitProducts });
      expect(res.status).toBe(401);
    });

    it.each(['manager', 'employee'] as const)('%s (no catalog:manage) → 403, nothing changes', async (role) => {
      const before = await positions(kits.id);
      const res = await reorder(kits.id, { ids: [...before].reverse() }, users[role]);
      expect(res.status).toBe(403);
      expect(res.body).toEqual(FORBIDDEN);
      expect(await positions(kits.id)).toEqual(before);
    });
  });
});
