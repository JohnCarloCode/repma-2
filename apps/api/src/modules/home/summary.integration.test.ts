import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { app } from '../../app.js';
import { env } from '../../config/env.js';

// Sub-task 5.1 — RF-41 `GET /home/summary`: `availability:read`, read
// limiter, tenantContext (+ RLS), and the three figures against this file's
// own stores (A, B and an empty C), so every assertion can be exact.
// Requires the local Supabase stack.

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

const PASSWORD = `home-test-${randomUUID()}`;
const token = `home${randomUUID().slice(0, 8)}`;
const storeA = randomUUID();
const storeB = randomUUID();
const storeC = randomUUID(); // nothing in it: honest zeros
const stores = [storeA, storeB, storeC];
const category = { id: randomUUID(), name: `${token} Apparel` };

const jacket = { id: randomUUID(), name: `${token} Jacket`, isActive: true };
const retired = { id: randomUUID(), name: `${token} Retired Boot`, isActive: false }; // RN-08
const scarf = { id: randomUUID(), name: `${token} Scarf`, isActive: true }; // store B only
const products = [jacket, retired, scarf];

interface SizeFixture {
  id: string;
  product: (typeof products)[number];
  label: string;
}
const size = (product: SizeFixture['product'], label: string): SizeFixture => ({ id: randomUUID(), product, label });
const jacketS = size(jacket, 'S');
const jacketM = size(jacket, 'M');
const jacketL = size(jacket, 'L');
const retired42 = size(retired, '42');
const scarfOne = size(scarf, 'One size');
const sizes = [jacketS, jacketM, jacketL, retired42, scarfOne];

// Store A: 2 of 4 sizes out of stock — one of the retired product (still
// flagged and visible, RN-08), and one sitting on an open list too: the two
// worlds are counted apart (DP-06). Store B: 1 of 1.
const assortment = [
  { tenantId: storeA, size: jacketS, isAvailable: true },
  { tenantId: storeA, size: jacketM, isAvailable: false },
  { tenantId: storeA, size: jacketL, isAvailable: true },
  { tenantId: storeA, size: retired42, isAvailable: false },
  { tenantId: storeB, size: scarfOne, isAvailable: false },
];

interface ListFixture {
  id: string;
  tenantId: string;
  status: 'draft' | 'processing' | 'done';
  lines: { size: SizeFixture; isDone: boolean }[];
}
const list = (tenantId: string, status: ListFixture['status'], lines: ListFixture['lines']): ListFixture => ({
  id: randomUUID(),
  tenantId,
  status,
  lines,
});
const lists = [
  // Store A — open: draft (2 unchecked of 3), processing (2 of 2), empty draft;
  // the done list's unchecked lines never count.
  list(storeA, 'draft', [
    { size: jacketS, isDone: false },
    { size: jacketM, isDone: true },
    { size: retired42, isDone: false },
  ]),
  list(storeA, 'processing', [
    { size: jacketM, isDone: false },
    { size: jacketL, isDone: false },
  ]),
  list(storeA, 'draft', []),
  list(storeA, 'done', [
    { size: jacketS, isDone: false },
    { size: jacketL, isDone: false },
  ]),
  // Store B — one processing list, one unchecked line.
  list(storeB, 'processing', [{ size: scarfOne, isDone: false }]),
];

const expected = {
  storeA: { openLists: 3, pendingItems: 4, outOfStock: 2 },
  storeB: { openLists: 1, pendingItems: 1, outOfStock: 1 },
  storeC: { openLists: 0, pendingItems: 0, outOfStock: 0 },
};

interface Fixture {
  role: 'platform_admin' | 'manager' | 'employee';
  tenantId: string | null;
  id: string;
  token: string;
}
const user = (role: Fixture['role'], tenantId: string | null): Fixture => ({ role, tenantId, id: '', token: '' });
const users = {
  admin: user('platform_admin', null),
  manager: user('manager', storeA),
  employee: user('employee', storeA),
  employeeB: user('employee', storeB),
};

const FORBIDDEN = { error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action' } };

function summary(as: Fixture, tenantHeader?: string) {
  const req = request(app).get('/api/v1/home/summary').set('Authorization', `Bearer ${as.token}`);
  return tenantHeader === undefined ? req : req.set('X-Tenant-Id', tenantHeader);
}

describe('home summary (RF-41)', () => {
  beforeAll(async () => {
    for (const id of stores) {
      await admin`insert into tenants (id, name, slug) values (${id}, 'Home store', ${`home-${id}`})`;
    }
    await admin`insert into categories (id, name, slug) values (${category.id}, ${category.name}, ${`home-${category.id}`})`;
    for (const p of products) {
      await admin`
        insert into products (id, name, category_id, is_active)
        values (${p.id}, ${p.name}, ${category.id}, ${p.isActive})
      `;
    }
    for (const [position, s] of sizes.entries()) {
      await admin`
        insert into product_sizes (id, product_id, label, sku, position)
        values (${s.id}, ${s.product.id}, ${s.label}, ${`${token}-${randomUUID().slice(0, 8)}`}, ${position})
      `;
    }
    for (const a of assortment) {
      await admin`
        insert into assortment_items (tenant_id, size_id, is_available)
        values (${a.tenantId}, ${a.size.id}, ${a.isAvailable})
      `;
    }
    for (const l of lists) {
      await admin`
        insert into replenishment_lists (id, tenant_id, name, status)
        values (${l.id}, ${l.tenantId}, ${`${token} list`}, ${l.status})
      `;
      for (const line of l.lines) {
        await admin`
          insert into replenishment_list_items (tenant_id, list_id, size_id, quantity_requested, is_done)
          values (${l.tenantId}, ${l.id}, ${line.size.id}, 1, ${line.isDone})
        `;
      }
    }

    const signIn = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    for (const [key, fixture] of Object.entries(users)) {
      const email = `home-${key}-${randomUUID()}@repma.test`;
      const created = await authAdmin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
      if (created.error) throw created.error;
      fixture.id = created.data.user.id;
      await admin`
        insert into user_profiles (id, email, full_name, role, tenant_id)
        values (${fixture.id}, ${email}, ${`Home ${key}`}, ${fixture.role}, ${fixture.tenantId})
      `;
      const session = await signIn.auth.signInWithPassword({ email, password: PASSWORD });
      if (session.error) throw session.error;
      fixture.token = session.data.session.access_token;
    }
  });

  afterAll(async () => {
    const userIds = Object.values(users)
      .map((fixture) => fixture.id)
      .filter(Boolean);
    await admin`delete from replenishment_lists where tenant_id in ${admin(stores)}`; // items cascade
    await admin`delete from assortment_items where tenant_id in ${admin(stores)}`;
    await admin`delete from user_profiles where id in ${admin(userIds)}`;
    for (const id of userIds) await authAdmin.auth.admin.deleteUser(id);
    await admin`delete from tenants where id in ${admin(stores)}`;
    await admin`delete from product_sizes where id in ${admin(sizes.map((s) => s.id))}`;
    await admin`delete from products where id in ${admin(products.map((p) => p.id))}`;
    await admin`delete from categories where id = ${category.id}`;
    await admin.end();
  });

  describe('access', () => {
    it('without a session → 401', async () => {
      const res = await request(app).get('/api/v1/home/summary');
      expect(res.status).toBe(401);
    });

    it('is served under the read limiter', async () => {
      const res = await summary(users.employee);
      expect(res.status).toBe(200);
      expect(res.headers['ratelimit-limit']).toBe('100');
    });

    it('enforces availability:read: a session without it → uniform 403', async () => {
      narrowed.read = true;
      try {
        const res = await summary(users.employee);
        expect(res.status).toBe(403);
        expect(res.body).toEqual(FORBIDDEN);
      } finally {
        narrowed.read = false;
      }
    });

    it('any query param → 400 VALIDATION_ERROR', async () => {
      const res = await summary(users.employee).query({ status: 'draft' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('figures', () => {
    it('counts open lists (draft/processing), unchecked lines across all of them, and out-of-stock sizes', async () => {
      const res = await summary(users.employee);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(expected.storeA);
    });

    it('the manager reads the same figures', async () => {
      const res = await summary(users.manager);
      expect(res.body).toEqual(expected.storeA);
    });

    it('follows the flows: checking a line and closing a list move only the list figures', async () => {
      const [draft, processing] = lists;
      try {
        await admin`update replenishment_list_items set is_done = true where list_id = ${processing!.id}`;
        await admin`update replenishment_lists set status = 'done' where id = ${draft!.id}`;
        const res = await summary(users.employee);
        expect(res.body).toEqual({ openLists: 2, pendingItems: 0, outOfStock: 2 });
      } finally {
        await admin`update replenishment_list_items set is_done = false where list_id = ${processing!.id}`;
        await admin`update replenishment_lists set status = 'draft' where id = ${draft!.id}`;
      }
    });
  });

  describe('tenant scoping', () => {
    it("a store user reads only their own store's figures", async () => {
      const res = await summary(users.employeeB);
      expect(res.body).toEqual(expected.storeB);
    });

    it("another store's X-Tenant-Id → uniform 403", async () => {
      const res = await summary(users.employee, storeB);
      expect(res.status).toBe(403);
      expect(res.body).toEqual(FORBIDDEN);
    });

    it('platform_admin without X-Tenant-Id → 400 TENANT_REQUIRED', async () => {
      const res = await summary(users.admin);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('TENANT_REQUIRED');
    });

    it('platform_admin reads the store named by X-Tenant-Id, and only it — an empty store is all zeros', async () => {
      expect((await summary(users.admin, storeA)).body).toEqual(expected.storeA);
      expect((await summary(users.admin, storeB)).body).toEqual(expected.storeB);
      expect((await summary(users.admin, storeC)).body).toEqual(expected.storeC);
    });
  });
});
