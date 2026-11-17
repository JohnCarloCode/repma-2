import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { app } from '../../app.js';
import { env } from '../../config/env.js';

// Sub-task 3.1 — RF-18 / AD-22 `GET /availability`: `availability:read`, read
// limiter, tenantContext (+ RLS), a page of products each carrying its full
// size run, filters `search`/`categoryId`/`outOfStock` (+ `productId`, plan
// 6.1), the fixed aging-desc order. Requires the local Supabase stack. Both stores are this file's own,
// so every assertion can be exact.

// `availability:read` is held by every role (architecture.md §6): a switch
// narrows the matrix for the employee to prove the route enforces it.
const narrowed = vi.hoisted(() => ({ read: false }));
vi.mock('shared', async (importOriginal) => {
  const original = await importOriginal<typeof import('shared')>();
  return {
    ...original,
    hasPermission: (subject: { role: import('shared').Role }, permission: import('shared').Permission) =>
      narrowed.read && subject.role === 'employee' && permission === 'availability:read'
        ? false
        : original.hasPermission(subject, permission),
  };
});

const adminUrl = process.env.MIGRATIONS_DATABASE_URL;
if (!adminUrl) {
  throw new Error('MIGRATIONS_DATABASE_URL is not set — run `supabase start` and set up apps/api/.env first');
}
const admin = postgres(adminUrl);
const authAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const PASSWORD = `list-test-${randomUUID()}`;
const token = `avl${randomUUID().slice(0, 8)}`;
const storeA = randomUUID();
const storeB = randomUUID();
// Category and product positions contradict the names, so `sort=catalog`
// (RF-45, RF-46) is told apart from both name and aging order: Footwear
// (position 0) before Apparel (1); Charlie before Zeta, Bravo before Alpha.
const footwear = { id: randomUUID(), name: `${token} Footwear`, position: 0 };
const apparel = { id: randomUUID(), name: `${token} Apparel`, position: 1 };

// Store A's assortment. Expected order (RF-18): Zeta (oldest outage
// 2026-01-01) → Alpha (outage 2026-01-10) → fully available by name: Bravo,
// Charlie. Names are chosen so the aging order contradicts the name order.
const zeta = { id: randomUUID(), name: `${token} Zeta Boot`, categoryId: footwear.id, isActive: true, position: 1 };
const alpha = { id: randomUUID(), name: `${token} Alpha Tee`, categoryId: apparel.id, isActive: true, position: 1 };
const bravo = { id: randomUUID(), name: `${token} Bravo Cap`, categoryId: apparel.id, isActive: false, position: 0 };
const charlie = { id: randomUUID(), name: `${token} Charlie Sock`, categoryId: footwear.id, isActive: true, position: 0 };
// Only in store B.
const delta = { id: randomUUID(), name: `${token} Delta Scarf`, categoryId: apparel.id, isActive: true, position: 2 };
const products = [zeta, alpha, bravo, charlie, delta];

interface SizeFixture {
  id: string;
  productId: string;
  label: string;
  sku: string;
  position: number;
  isActive: boolean;
}
function size(productId: string, label: string, position: number, isActive = true): SizeFixture {
  return { id: randomUUID(), productId, label, sku: `${token}-${label}-${randomUUID().slice(0, 6)}`, position, isActive };
}
// Inserted out of position order where it matters: the run must follow
// `position`, not insertion or label order.
const zeta38 = size(zeta.id, '38', 2);
const zeta36 = size(zeta.id, '36', 0);
const zeta37 = size(zeta.id, '37', 1);
const alphaS = size(alpha.id, 'S', 0);
const alphaM = size(alpha.id, 'M', 1);
const bravoOne = size(bravo.id, 'One size', 0);
const charlieL = size(charlie.id, 'L', 1, false);
const charlieS = size(charlie.id, 'S', 0);
const zeta39 = size(zeta.id, '39', 3); // in the catalog, not in store A's assortment
const deltaOne = size(delta.id, 'One size', 0);
const sizes = [zeta38, zeta36, zeta37, alphaS, alphaM, bravoOne, charlieL, charlieS, zeta39, deltaOne];

const item = (tenantId: string, sizeId: string, isAvailable: boolean) => ({
  id: randomUUID(),
  tenantId,
  sizeId,
  isAvailable,
});
const iZeta36 = item(storeA, zeta36.id, true);
const iZeta37 = item(storeA, zeta37.id, false);
const iZeta38 = item(storeA, zeta38.id, false);
const iAlphaS = item(storeA, alphaS.id, false);
const iAlphaM = item(storeA, alphaM.id, true);
const iBravo = item(storeA, bravoOne.id, true);
const iCharlieL = item(storeA, charlieL.id, true);
const iCharlieS = item(storeA, charlieS.id, true);
const iDelta = item(storeB, deltaOne.id, false);
const items = [iZeta36, iZeta37, iZeta38, iAlphaS, iAlphaM, iBravo, iCharlieL, iCharlieS, iDelta];

// Strictly alternating histories whose latest event matches the flag (RN-14).
const events: { itemId: string; tenantId: string; type: 'out_of_stock' | 'restock'; at: string }[] = [
  { itemId: iZeta36.id, tenantId: storeA, type: 'out_of_stock', at: '2025-12-01T09:00:00.000Z' },
  { itemId: iZeta36.id, tenantId: storeA, type: 'restock', at: '2025-12-02T09:00:00.000Z' },
  { itemId: iZeta37.id, tenantId: storeA, type: 'out_of_stock', at: '2025-12-20T09:00:00.000Z' },
  { itemId: iZeta37.id, tenantId: storeA, type: 'restock', at: '2025-12-21T09:00:00.000Z' },
  { itemId: iZeta37.id, tenantId: storeA, type: 'out_of_stock', at: '2026-01-01T09:00:00.000Z' },
  { itemId: iZeta38.id, tenantId: storeA, type: 'out_of_stock', at: '2026-01-05T09:00:00.000Z' },
  { itemId: iAlphaS.id, tenantId: storeA, type: 'out_of_stock', at: '2026-01-10T09:00:00.000Z' },
  { itemId: iDelta.id, tenantId: storeB, type: 'out_of_stock', at: '2026-01-02T09:00:00.000Z' },
];

const runSize = (s: SizeFixture, i: { id: string; isAvailable: boolean }, latestEventAt: string | null) => ({
  id: i.id,
  sizeId: s.id,
  label: s.label,
  sku: s.sku,
  isAvailable: i.isAvailable,
  isActive: s.isActive,
  latestEventAt,
});
const expected = {
  zeta: {
    id: zeta.id,
    name: zeta.name,
    imageUrl: null,
    categoryName: footwear.name,
    isActive: true,
    sizes: [
      runSize(zeta36, iZeta36, '2025-12-02T09:00:00.000Z'),
      runSize(zeta37, iZeta37, '2026-01-01T09:00:00.000Z'),
      runSize(zeta38, iZeta38, '2026-01-05T09:00:00.000Z'),
    ],
  },
  alpha: {
    id: alpha.id,
    name: alpha.name,
    imageUrl: 'https://example.test/alpha.png',
    categoryName: apparel.name,
    isActive: true,
    sizes: [runSize(alphaS, iAlphaS, '2026-01-10T09:00:00.000Z'), runSize(alphaM, iAlphaM, null)],
  },
  bravo: {
    id: bravo.id,
    name: bravo.name,
    imageUrl: null,
    categoryName: apparel.name,
    isActive: false,
    sizes: [runSize(bravoOne, iBravo, null)],
  },
  charlie: {
    id: charlie.id,
    name: charlie.name,
    imageUrl: null,
    categoryName: footwear.name,
    isActive: true,
    sizes: [runSize(charlieS, iCharlieS, null), runSize(charlieL, iCharlieL, null)],
  },
};

interface Fixture {
  role: 'platform_admin' | 'manager' | 'employee';
  tenantId: string | null;
  id: string;
  token: string;
}
const users: Record<'admin' | 'manager' | 'employee' | 'employeeB', Fixture> = {
  admin: { role: 'platform_admin', tenantId: null, id: '', token: '' },
  manager: { role: 'manager', tenantId: storeA, id: '', token: '' },
  employee: { role: 'employee', tenantId: storeA, id: '', token: '' },
  employeeB: { role: 'employee', tenantId: storeB, id: '', token: '' },
};

const FORBIDDEN = { error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action' } };

function list(user: Fixture, query: Record<string, string> = {}, tenantHeader?: string) {
  const req = request(app).get('/api/v1/availability').query(query).set('Authorization', `Bearer ${user.token}`);
  return tenantHeader === undefined ? req : req.set('X-Tenant-Id', tenantHeader);
}

function ids(body: { items: { id: string }[] }): string[] {
  return body.items.map((product) => product.id);
}

describe('GET /availability (RF-18, AD-22)', () => {
  beforeAll(async () => {
    await admin`
      insert into tenants (id, name, slug) values
        (${storeA}, 'List A', ${`list-a-${storeA}`}),
        (${storeB}, 'List B', ${`list-b-${storeB}`})
    `;
    for (const category of [footwear, apparel]) {
      await admin`
        insert into categories (id, name, slug, position)
        values (${category.id}, ${category.name}, ${`list-${category.id}`}, ${category.position})
      `;
    }
    for (const product of products) {
      await admin`
        insert into products (id, name, category_id, is_active, position, image_url)
        values (${product.id}, ${product.name}, ${product.categoryId}, ${product.isActive}, ${product.position},
                ${product === alpha ? expected.alpha.imageUrl : null})
      `;
    }
    for (const s of sizes) {
      await admin`
        insert into product_sizes (id, product_id, label, sku, position, is_active)
        values (${s.id}, ${s.productId}, ${s.label}, ${s.sku}, ${s.position}, ${s.isActive})
      `;
    }
    for (const i of items) {
      await admin`
        insert into assortment_items (id, tenant_id, size_id, is_available)
        values (${i.id}, ${i.tenantId}, ${i.sizeId}, ${i.isAvailable})
      `;
    }
    for (const e of events) {
      await admin`
        insert into availability_events (tenant_id, assortment_item_id, type, created_at)
        values (${e.tenantId}, ${e.itemId}, ${e.type}, ${e.at})
      `;
    }

    const signIn = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    for (const [key, user] of Object.entries(users)) {
      const email = `list-${key}-${randomUUID()}@repma.test`;
      const created = await authAdmin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
      if (created.error) throw created.error;
      user.id = created.data.user.id;
      await admin`
        insert into user_profiles (id, email, full_name, role, tenant_id)
        values (${user.id}, ${email}, ${`List ${key}`}, ${user.role}, ${user.tenantId})
      `;
      const session = await signIn.auth.signInWithPassword({ email, password: PASSWORD });
      if (session.error) throw session.error;
      user.token = session.data.session.access_token;
    }
  });

  afterAll(async () => {
    const userIds = Object.values(users)
      .map((user) => user.id)
      .filter(Boolean);
    await admin`delete from availability_events where tenant_id in ${admin([storeA, storeB])}`;
    await admin`delete from assortment_items where tenant_id in ${admin([storeA, storeB])}`;
    await admin`delete from user_profiles where id in ${admin(userIds)}`;
    for (const id of userIds) await authAdmin.auth.admin.deleteUser(id);
    await admin`delete from tenants where id in ${admin([storeA, storeB])}`;
    await admin`delete from product_sizes where id in ${admin(sizes.map((s) => s.id))}`;
    await admin`delete from products where id in ${admin(products.map((p) => p.id))}`;
    await admin`delete from categories where id in ${admin([footwear.id, apparel.id])}`;
    await admin.end();
  });

  describe('access', () => {
    it('without a session → 401', async () => {
      const res = await request(app).get('/api/v1/availability');
      expect(res.status).toBe(401);
    });

    it('is served under the read limiter', async () => {
      const res = await list(users.employee);
      expect(res.status).toBe(200);
      expect(res.headers['ratelimit-limit']).toBe('100');
    });

    it('enforces availability:read: a session without it → uniform 403', async () => {
      narrowed.read = true;
      try {
        const res = await list(users.employee);
        expect(res.status).toBe(403);
        expect(res.body).toEqual(FORBIDDEN);
      } finally {
        narrowed.read = false;
      }
    });
  });

  describe('grouping and order', () => {
    it('returns a page of products, each with its full run in position order, aging descending then by name', async () => {
      const res = await list(users.employee);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        items: [expected.zeta, expected.alpha, expected.bravo, expected.charlie],
        page: 1,
        pageSize: 20,
        total: 4,
      });
    });

    it('the manager reads the same listing', async () => {
      const res = await list(users.manager);
      expect(ids(res.body)).toEqual([zeta.id, alpha.id, bravo.id, charlie.id]);
    });

    it('paginates products, never splitting a run across pages', async () => {
      const pages = [];
      for (const page of ['1', '2', '3', '4']) {
        const res = await list(users.employee, { pageSize: '1', page });
        expect(res.body).toMatchObject({ page: Number(page), pageSize: 1, total: 4 });
        pages.push(...res.body.items);
      }
      expect(pages).toEqual([expected.zeta, expected.alpha, expected.bravo, expected.charlie]);

      const beyond = await list(users.employee, { pageSize: '3', page: '2' });
      expect(beyond.body).toEqual({ items: [expected.charlie], page: 2, pageSize: 3, total: 4 });
      const past = await list(users.employee, { pageSize: '3', page: '3' });
      expect(past.body).toEqual({ items: [], page: 3, pageSize: 3, total: 4 });
    });

    it('sort=catalog follows the catalog order instead (RF-45, RF-46): category position, then product position', async () => {
      const res = await list(users.employee, { sort: 'catalog' });
      expect(res.body).toEqual({
        items: [expected.charlie, expected.zeta, expected.bravo, expected.alpha],
        page: 1,
        pageSize: 20,
        total: 4,
      });
      const apparelPage = await list(users.employee, { sort: 'catalog', categoryId: apparel.id, pageSize: '1', page: '2' });
      expect(ids(apparelPage.body)).toEqual([alpha.id]);
    });
  });

  describe('filters', () => {
    it('outOfStock=true selects products with ≥1 size out, returning their complete run', async () => {
      const res = await list(users.employee, { outOfStock: 'true' });
      expect(res.body).toEqual({ items: [expected.zeta, expected.alpha], page: 1, pageSize: 20, total: 2 });
    });

    it('categoryId narrows to that category', async () => {
      const res = await list(users.employee, { categoryId: footwear.id });
      expect(res.body.items).toEqual([expected.zeta, expected.charlie]);
      expect(res.body.total).toBe(2);
    });

    it('search matches the product name (case-insensitive substring)', async () => {
      const res = await list(users.employee, { search: 'ALPHA t' });
      expect(res.body.items).toEqual([expected.alpha]);
      expect(res.body.total).toBe(1);
    });

    it('search matches a size SKU and still returns the complete run', async () => {
      const res = await list(users.employee, { search: zeta38.sku.toLowerCase() });
      expect(res.body.items).toEqual([expected.zeta]);
    });

    it("search ignores the SKU of a catalog size the store doesn't carry", async () => {
      const res = await list(users.employee, { search: zeta39.sku });
      expect(res.body).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
    });

    it('search treats LIKE metacharacters literally; blank search = no filter', async () => {
      const percent = await list(users.employee, { search: '%' });
      expect(percent.body.total).toBe(0);
      const blank = await list(users.employee, { search: '   ' });
      expect(blank.body.total).toBe(4);
    });

    it('filters intersect', async () => {
      const res = await list(users.employee, { outOfStock: 'true', categoryId: apparel.id, search: token });
      expect(res.body.items).toEqual([expected.alpha]);
      const none = await list(users.employee, { outOfStock: 'true', categoryId: footwear.id, search: 'Alpha' });
      expect(none.body.total).toBe(0);
    });

    it('productId (one or more, comma-separated) selects exactly those products, in the RF-18 order', async () => {
      const res = await list(users.employee, { productId: `${charlie.id},${zeta.id}` });
      expect(res.body).toEqual({ items: [expected.zeta, expected.charlie], page: 1, pageSize: 20, total: 2 });
      const one = await list(users.employee, { productId: alpha.id });
      expect(one.body.items).toEqual([expected.alpha]);
    });

    it('productId tolerates repeats; a product the store does not carry is simply absent', async () => {
      const res = await list(users.employee, { productId: `${alpha.id},${alpha.id},${delta.id}` });
      expect(res.body).toEqual({ items: [expected.alpha], page: 1, pageSize: 20, total: 1 });
    });

    it('productId intersects the other filters', async () => {
      const res = await list(users.employee, { productId: `${zeta.id},${charlie.id}`, outOfStock: 'true' });
      expect(res.body.items).toEqual([expected.zeta]);
      expect(res.body.total).toBe(1);
    });

    it('productId accepts up to 100 ids (the page-size cap)', async () => {
      const filler = Array.from({ length: 99 }, () => randomUUID());
      const res = await list(users.employee, { productId: [bravo.id, ...filler].join(','), pageSize: '100' });
      expect(res.status).toBe(200);
      expect(ids(res.body)).toEqual([bravo.id]);
    });

    it('a repeated productId param → 400 VALIDATION_ERROR (one comma-separated param)', async () => {
      const res = await request(app)
        .get(`/api/v1/availability?productId=${alpha.id}&productId=${zeta.id}`)
        .set('Authorization', `Bearer ${users.employee.token}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it.each([
      ['an empty productId', { productId: '' }],
      ['a non-uuid productId entry', { productId: `${alpha.id},shoes` }],
      ['more than 100 productIds', { productId: Array.from({ length: 101 }, () => randomUUID()).join(',') }],
      ['outOfStock other than true', { outOfStock: 'false' }],
      ['a non-uuid categoryId', { categoryId: 'shoes' }],
      ['a sort other than catalog', { sort: 'name' }],
      ['an empty sort', { sort: '' }],
      ['pageSize over the max', { pageSize: '101' }],
      ['is_available', { is_available: 'false' }],
    ])('rejects %s → 400 VALIDATION_ERROR', async (_label, query) => {
      const res = await list(users.employee, query);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('tenant scoping', () => {
    it("a store user sees only their own store's assortment", async () => {
      const res = await list(users.employeeB);
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([
        {
          id: delta.id,
          name: delta.name,
          imageUrl: null,
          categoryName: apparel.name,
          isActive: true,
          sizes: [runSize(deltaOne, iDelta, '2026-01-02T09:00:00.000Z')],
        },
      ]);
      expect(res.body.total).toBe(1);
    });

    it("another store's X-Tenant-Id → uniform 403", async () => {
      const res = await list(users.employee, {}, storeB);
      expect(res.status).toBe(403);
      expect(res.body).toEqual(FORBIDDEN);
    });

    it('platform_admin without X-Tenant-Id → 400 TENANT_REQUIRED', async () => {
      const res = await list(users.admin);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('TENANT_REQUIRED');
    });

    it('platform_admin reads the store named by X-Tenant-Id, and only it', async () => {
      const a = await list(users.admin, {}, storeA);
      expect(ids(a.body)).toEqual([zeta.id, alpha.id, bravo.id, charlie.id]);
      const b = await list(users.admin, {}, storeB);
      expect(ids(b.body)).toEqual([delta.id]);
    });
  });
});
