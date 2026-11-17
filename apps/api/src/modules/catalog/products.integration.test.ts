import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { app } from '../../app.js';
import { env } from '../../config/env.js';

// Sub-task 6.1 — RF-15 `GET /products`: `catalog:read`, read limiter, global
// router (no tenantContext), each product with its sizes embedded in
// `position` order, filters `categoryId`/`search` (name + size SKU)/`isActive`,
// in catalog order (category position — RF-45 —, then product position — RF-46). Requires the local Supabase stack. The catalog is global
// and shared with the seed and other suites, so every assertion is scoped to
// this file's own categories or token-named rows.

// `catalog:read` is held by every role (architecture.md §6): a switch narrows
// the matrix for the employee to prove the route enforces it.
const narrowed = vi.hoisted(() => ({ read: false }));
vi.mock('shared', async (importOriginal) => {
  const original = await importOriginal<typeof import('shared')>();
  return {
    ...original,
    hasPermission: (subject: { role: import('shared').Role }, permission: import('shared').Permission) =>
      narrowed.read && subject.role === 'employee' && permission === 'catalog:read'
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

const PASSWORD = `products-test-${randomUUID()}`;
const token = `prd${randomUUID().slice(0, 8)}`;
const store = randomUUID();
// Positions contradict the names: Footwear (0) before Apparel (1), and within
// Footwear Charlie (0) before Bravo (1). The listing must follow the positions.
const footwear = { id: randomUUID(), name: `${token} Footwear`, position: 0 };
const apparel = { id: randomUUID(), name: `${token} Apparel`, position: 1 };

const charlie = {
  id: randomUUID(),
  name: `${token} Charlie Cap`,
  categoryId: footwear.id,
  position: 0,
  isActive: false,
  description: null,
  imageUrl: null,
};
const bravo = {
  id: randomUUID(),
  name: `${token} Bravo Boot`,
  categoryId: footwear.id,
  position: 1,
  isActive: true,
  description: 'Leather boot',
  imageUrl: 'http://127.0.0.1:54321/storage/v1/object/public/products/bravo.jpg',
};
const alpha = {
  id: randomUUID(),
  name: `${token} Alpha Tee`,
  categoryId: apparel.id,
  position: 0,
  isActive: true,
  description: null,
  imageUrl: null,
};
const products = [charlie, bravo, alpha];

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
// Inserted out of position order: the embedded run must follow `position`.
const bravo43 = size(bravo.id, '43', 2, false);
const bravo41 = size(bravo.id, '41', 0);
const bravo42 = size(bravo.id, '42', 1);
const alphaOne = size(alpha.id, 'One size', 0);
const charlieOne = size(charlie.id, 'One size', 0);
const sizes = [bravo43, bravo41, bravo42, alphaOne, charlieOne];

function embedded(s: SizeFixture) {
  return { id: s.id, label: s.label, sku: s.sku, position: s.position, isActive: s.isActive };
}
function product(p: (typeof products)[number], categoryName: string, run: SizeFixture[]) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    imageUrl: p.imageUrl,
    categoryId: p.categoryId,
    categoryName,
    isActive: p.isActive,
    sizes: run.map(embedded),
  };
}
const expected = {
  alpha: product(alpha, apparel.name, [alphaOne]),
  bravo: product(bravo, footwear.name, [bravo41, bravo42, bravo43]),
  charlie: product(charlie, footwear.name, [charlieOne]),
};

interface Fixture {
  role: 'platform_admin' | 'employee';
  tenantId: string | null;
  id: string;
  token: string;
}
const users: Record<'admin' | 'employee', Fixture> = {
  admin: { role: 'platform_admin', tenantId: null, id: '', token: '' },
  employee: { role: 'employee', tenantId: store, id: '', token: '' },
};

function list(user: Fixture, query: Record<string, string> = {}) {
  return request(app).get('/api/v1/products').query(query).set('Authorization', `Bearer ${user.token}`);
}

describe('GET /products (RF-15)', () => {
  beforeAll(async () => {
    await admin`insert into tenants (id, name, slug) values (${store}, 'Products', ${`products-${store}`})`;
    for (const category of [footwear, apparel]) {
      await admin`
        insert into categories (id, name, slug, position)
        values (${category.id}, ${category.name}, ${`products-${category.id}`}, ${category.position})
      `;
    }
    for (const p of products) {
      await admin`
        insert into products (id, name, category_id, is_active, position, description, image_url)
        values (${p.id}, ${p.name}, ${p.categoryId}, ${p.isActive}, ${p.position}, ${p.description}, ${p.imageUrl})
      `;
    }
    for (const s of sizes) {
      await admin`
        insert into product_sizes (id, product_id, label, sku, position, is_active)
        values (${s.id}, ${s.productId}, ${s.label}, ${s.sku}, ${s.position}, ${s.isActive})
      `;
    }
    const signIn = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    for (const [key, user] of Object.entries(users)) {
      const email = `products-${key}-${randomUUID()}@repma.test`;
      const created = await authAdmin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
      if (created.error) throw created.error;
      user.id = created.data.user.id;
      await admin`
        insert into user_profiles (id, email, full_name, role, tenant_id)
        values (${user.id}, ${email}, ${`Products ${key}`}, ${user.role}, ${user.tenantId})
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
    await admin`delete from user_profiles where id in ${admin(userIds)}`;
    for (const id of userIds) await authAdmin.auth.admin.deleteUser(id);
    await admin`delete from tenants where id = ${store}`;
    await admin`delete from product_sizes where id in ${admin(sizes.map((s) => s.id))}`;
    await admin`delete from products where id in ${admin(products.map((p) => p.id))}`;
    await admin`delete from categories where id in ${admin([footwear.id, apparel.id])}`;
    await admin.end();
  });

  describe('access', () => {
    it('without a session → 401', async () => {
      const res = await request(app).get('/api/v1/products');
      expect(res.status).toBe(401);
    });

    it('is served under the read limiter', async () => {
      const res = await list(users.employee);
      expect(res.status).toBe(200);
      expect(res.headers['ratelimit-limit']).toBe('100');
    });

    it('enforces catalog:read: a session without it → uniform 403', async () => {
      narrowed.read = true;
      try {
        const res = await list(users.employee);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      } finally {
        narrowed.read = false;
      }
    });

    it('is global: the platform admin reads it without X-Tenant-Id', async () => {
      const res = await list(users.admin, { search: token });
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([expected.charlie, expected.bravo, expected.alpha]);
    });
  });

  describe('shape and order', () => {
    it('returns products in their in-category position, each with every size embedded in position order (inactive included)', async () => {
      const res = await list(users.employee, { categoryId: footwear.id });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [expected.charlie, expected.bravo], page: 1, pageSize: 20, total: 2 });
    });

    it('paginates products, never splitting their sizes', async () => {
      const first = await list(users.employee, { search: token, pageSize: '2' });
      expect(first.body).toEqual({ items: [expected.charlie, expected.bravo], page: 1, pageSize: 2, total: 3 });
      const second = await list(users.employee, { search: token, pageSize: '2', page: '2' });
      expect(second.body).toEqual({ items: [expected.alpha], page: 2, pageSize: 2, total: 3 });
    });
  });

  describe('filters', () => {
    it('search matches the product name (case-insensitive substring)', async () => {
      const res = await list(users.employee, { search: `${token} ALPHA t` });
      expect(res.body).toEqual({ items: [expected.alpha], page: 1, pageSize: 20, total: 1 });
    });

    it('search matches any size SKU — inactive sizes included — and returns the product once, with all its sizes', async () => {
      const res = await list(users.employee, { search: bravo43.sku.toLowerCase() });
      expect(res.body).toEqual({ items: [expected.bravo], page: 1, pageSize: 20, total: 1 });
      // A pattern hitting several of its SKUs still yields one row.
      const many = await list(users.employee, { search: `${token}-4` });
      expect(many.body.items).toEqual([expected.bravo]);
    });

    it('search treats LIKE metacharacters literally; blank search = no filter', async () => {
      const underscore = await list(users.employee, { search: `${token}_`, categoryId: footwear.id });
      expect(underscore.body.total).toBe(0);
      const blank = await list(users.employee, { search: '   ', categoryId: footwear.id });
      expect(blank.body.total).toBe(2);
    });

    it('isActive=true / false narrows on the product flag; absent returns both', async () => {
      const active = await list(users.employee, { categoryId: footwear.id, isActive: 'true' });
      expect(active.body.items).toEqual([expected.bravo]);
      const inactive = await list(users.employee, { categoryId: footwear.id, isActive: 'false' });
      expect(inactive.body.items).toEqual([expected.charlie]);
    });

    it('filters intersect', async () => {
      const res = await list(users.employee, { search: token, categoryId: footwear.id, isActive: 'true' });
      expect(res.body).toEqual({ items: [expected.bravo], page: 1, pageSize: 20, total: 1 });
      const none = await list(users.employee, { search: 'Alpha', categoryId: footwear.id });
      expect(none.body.total).toBe(0);
    });

    it.each([
      ['isActive other than true/false', { isActive: 'yes' }],
      ['a non-uuid categoryId', { categoryId: 'shoes' }],
      ['a sort param (the order is fixed)', { sort: 'name' }],
      ['pageSize over the max', { pageSize: '101' }],
    ])('rejects %s → 400 VALIDATION_ERROR', async (_label, query) => {
      const res = await list(users.employee, query);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
