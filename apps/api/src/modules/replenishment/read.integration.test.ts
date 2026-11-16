import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { app } from '../../app.js';
import { env } from '../../config/env.js';

// Sub-task 4.2 — RF-26 `GET /replenishment-lists` and
// `GET /replenishment-lists/:id`: `replenishment:read`, read limiter,
// tenantContext (+ RLS), the fixed `created_at DESC` order, filters
// `status` (multi) / `search` / `from`/`to`, per-list figures, and the
// detail's product order. Requires the local Supabase stack. Both stores are
// this file's own, so every assertion can be exact.

// `replenishment:read` is held by every role (architecture.md §6): a switch
// narrows the matrix for the employee to prove the routes enforce it.
const narrowed = vi.hoisted(() => ({ read: false }));
vi.mock('shared', async (importOriginal) => {
  const original = await importOriginal<typeof import('shared')>();
  return {
    ...original,
    hasPermission: (subject: { role: import('shared').Role }, permission: import('shared').Permission) =>
      narrowed.read && subject.role === 'employee' && permission === 'replenishment:read'
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

const PASSWORD = `repl-test-${randomUUID()}`;
const token = `rpl${randomUUID().slice(0, 8)}`;
const storeA = randomUUID();
const storeB = randomUUID();
const apparel = { id: randomUUID(), name: `${token} Apparel` };
const footwear = { id: randomUUID(), name: `${token} Footwear` };

// Two products share a name on purpose: the detail must keep each product's
// sizes adjacent even when the names tie.
const zulu = { id: randomUUID(), name: `${token} Zulu Jacket`, category: apparel };
const zuluTwin = { id: randomUUID(), name: `${token} Zulu Jacket`, category: apparel };
const alpha = { id: randomUUID(), name: `${token} Alpha Boot`, category: footwear };
const mike = { id: randomUUID(), name: `${token} Mike Cap`, category: apparel };
const bravo = { id: randomUUID(), name: `${token} Bravo Scarf`, category: apparel }; // store B only
const products = [zulu, zuluTwin, alpha, mike, bravo];

interface SizeFixture {
  id: string;
  product: (typeof products)[number];
  label: string;
  sku: string;
  position: number;
}
function size(product: SizeFixture['product'], label: string, position: number): SizeFixture {
  return { id: randomUUID(), product, label, sku: `${token}-${label}-${randomUUID().slice(0, 6)}`, position };
}
// Inserted out of position order: the detail must follow `position`.
const zuluL = size(zulu, 'L', 2);
const zuluS = size(zulu, 'S', 0);
const zuluTwinXS = size(zuluTwin, 'XS', 0);
const alpha36 = size(alpha, '36', 0);
const alpha37 = size(alpha, '37', 1);
const mikeOne = size(mike, 'One size', 0);
const bravoOne = size(bravo, 'One size', 0);
const sizes = [zuluL, zuluS, zuluTwinXS, alpha36, alpha37, mikeOne, bravoOne];
const assortment = [
  ...[zuluL, zuluS, zuluTwinXS, alpha36, alpha37, mikeOne].map((s) => ({ tenantId: storeA, sizeId: s.id })),
  { tenantId: storeB, sizeId: bravoOne.id },
];

interface Fixture {
  role: 'platform_admin' | 'manager' | 'employee';
  tenantId: string | null;
  id: string;
  token: string;
  fullName: string;
}
const user = (role: Fixture['role'], tenantId: string | null, fullName: string): Fixture => ({
  role,
  tenantId,
  fullName,
  id: '',
  token: '',
});
const users = {
  admin: user('platform_admin', null, 'Repl admin'),
  manager: user('manager', storeA, 'Repl manager'),
  employee: user('employee', storeA, 'Repl employee'),
  employeeB: user('employee', storeB, 'Repl employee B'),
};

interface LineFixture {
  id: string;
  size: SizeFixture;
  quantity: number;
  isDone: boolean;
}
const line = (s: SizeFixture, quantity: number, isDone = false): LineFixture => ({
  id: randomUUID(),
  size: s,
  quantity,
  isDone,
});
interface ListFixture {
  id: string;
  tenantId: string;
  name: string;
  status: 'draft' | 'processing' | 'done';
  notes: string | null;
  createdAt: string;
  creator: Fixture | null; // null = the creator was deleted (RN-09)
  lines: LineFixture[];
}
// Index order (`created_at DESC`): empty → morning → weekly → weeklyDone.
const weekly: ListFixture = {
  id: randomUUID(),
  tenantId: storeA,
  name: `${token} Weekly floor`,
  status: 'draft',
  notes: 'Back wall first',
  createdAt: '2026-03-01T10:00:00.000Z',
  creator: users.manager,
  // Inserted in an order that contradicts the expected one.
  lines: [line(zuluL, 2, true), line(mikeOne, 1), line(zuluS, 1), line(alpha37, 3, true), line(zuluTwinXS, 4)],
};
const morning: ListFixture = {
  id: randomUUID(),
  tenantId: storeA,
  name: `${token} Morning run`,
  status: 'processing',
  notes: null,
  createdAt: '2026-03-05T09:00:00.000Z',
  creator: users.employee,
  lines: [line(alpha36, 1)],
};
const empty: ListFixture = {
  id: randomUUID(),
  tenantId: storeA,
  name: `${token} Empty draft`,
  status: 'draft',
  notes: null,
  createdAt: '2026-03-10T08:00:00.000Z',
  creator: null,
  lines: [],
};
const weeklyDone: ListFixture = {
  id: randomUUID(),
  tenantId: storeA,
  name: `${token} Weekly done`,
  status: 'done',
  notes: null,
  createdAt: '2026-02-20T12:00:00.000Z',
  creator: users.manager,
  lines: [line(mikeOne, 6, true)],
};
const foreign: ListFixture = {
  id: randomUUID(),
  tenantId: storeB,
  name: `${token} Store B list`,
  status: 'processing',
  notes: null,
  createdAt: '2026-03-07T09:00:00.000Z',
  creator: users.employeeB,
  lines: [line(bravoOne, 2)],
};
const lists = [weekly, morning, empty, weeklyDone, foreign];

const summary = (list: ListFixture, figures: { itemCount: number; productCount: number; doneCount: number }) => ({
  id: list.id,
  name: list.name,
  status: list.status,
  createdAt: list.createdAt,
  creatorName: list.creator?.fullName ?? null,
  ...figures,
});
const expected = {
  // 5 sizes of 4 distinct products (the twins are two products), 2 checked.
  weekly: summary(weekly, { itemCount: 5, productCount: 4, doneCount: 2 }),
  morning: summary(morning, { itemCount: 1, productCount: 1, doneCount: 0 }),
  empty: summary(empty, { itemCount: 0, productCount: 0, doneCount: 0 }),
  weeklyDone: summary(weeklyDone, { itemCount: 1, productCount: 1, doneCount: 1 }),
  foreign: summary(foreign, { itemCount: 1, productCount: 1, doneCount: 0 }),
};

const detailItem = (l: LineFixture) => ({
  id: l.id,
  sizeId: l.size.id,
  sizeLabel: l.size.label,
  sku: l.size.sku,
  quantity: l.quantity,
  isDone: l.isDone,
  product: {
    id: l.size.product.id,
    name: l.size.product.name,
    imageUrl: null,
    categoryId: l.size.product.category.id,
    categoryName: l.size.product.category.name,
  },
});
const byLabel = (list: ListFixture, label: string, product: SizeFixture['product']) =>
  list.lines.find((l) => l.size.label === label && l.size.product === product)!;

const FORBIDDEN = { error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action' } };
const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'List not found' } };

function index(as: Fixture, query: Record<string, string | string[]> = {}, tenantHeader?: string) {
  const req = request(app).get('/api/v1/replenishment-lists').query(query).set('Authorization', `Bearer ${as.token}`);
  return tenantHeader === undefined ? req : req.set('X-Tenant-Id', tenantHeader);
}

function detail(as: Fixture, id: string, tenantHeader?: string) {
  const req = request(app).get(`/api/v1/replenishment-lists/${id}`).set('Authorization', `Bearer ${as.token}`);
  return tenantHeader === undefined ? req : req.set('X-Tenant-Id', tenantHeader);
}

function ids(body: { items: { id: string }[] }): string[] {
  return body.items.map((list) => list.id);
}

describe('replenishment lists — read (RF-26)', () => {
  beforeAll(async () => {
    await admin`
      insert into tenants (id, name, slug) values
        (${storeA}, 'Repl A', ${`repl-a-${storeA}`}),
        (${storeB}, 'Repl B', ${`repl-b-${storeB}`})
    `;
    for (const category of [apparel, footwear]) {
      await admin`insert into categories (id, name, slug) values (${category.id}, ${category.name}, ${`repl-${category.id}`})`;
    }
    for (const product of products) {
      await admin`insert into products (id, name, category_id) values (${product.id}, ${product.name}, ${product.category.id})`;
    }
    for (const s of sizes) {
      await admin`
        insert into product_sizes (id, product_id, label, sku, position)
        values (${s.id}, ${s.product.id}, ${s.label}, ${s.sku}, ${s.position})
      `;
    }
    for (const a of assortment) {
      await admin`insert into assortment_items (tenant_id, size_id) values (${a.tenantId}, ${a.sizeId})`;
    }

    const signIn = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    for (const [key, fixture] of Object.entries(users)) {
      const email = `repl-${key}-${randomUUID()}@repma.test`;
      const created = await authAdmin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
      if (created.error) throw created.error;
      fixture.id = created.data.user.id;
      await admin`
        insert into user_profiles (id, email, full_name, role, tenant_id)
        values (${fixture.id}, ${email}, ${fixture.fullName}, ${fixture.role}, ${fixture.tenantId})
      `;
      const session = await signIn.auth.signInWithPassword({ email, password: PASSWORD });
      if (session.error) throw session.error;
      fixture.token = session.data.session.access_token;
    }

    for (const list of lists) {
      await admin`
        insert into replenishment_lists (id, tenant_id, name, status, notes, created_by, created_at)
        values (${list.id}, ${list.tenantId}, ${list.name}, ${list.status}, ${list.notes},
                ${list.creator?.id ?? null}, ${list.createdAt})
      `;
      for (const l of list.lines) {
        await admin`
          insert into replenishment_list_items (id, tenant_id, list_id, size_id, quantity_requested, is_done)
          values (${l.id}, ${list.tenantId}, ${list.id}, ${l.size.id}, ${l.quantity}, ${l.isDone})
        `;
      }
    }
  });

  afterAll(async () => {
    const userIds = Object.values(users)
      .map((fixture) => fixture.id)
      .filter(Boolean);
    await admin`delete from replenishment_lists where tenant_id in ${admin([storeA, storeB])}`; // items cascade
    await admin`delete from assortment_items where tenant_id in ${admin([storeA, storeB])}`;
    await admin`delete from user_profiles where id in ${admin(userIds)}`;
    for (const id of userIds) await authAdmin.auth.admin.deleteUser(id);
    await admin`delete from tenants where id in ${admin([storeA, storeB])}`;
    await admin`delete from product_sizes where id in ${admin(sizes.map((s) => s.id))}`;
    await admin`delete from products where id in ${admin(products.map((p) => p.id))}`;
    await admin`delete from categories where id in ${admin([apparel.id, footwear.id])}`;
    await admin.end();
  });

  describe('GET /replenishment-lists', () => {
    describe('access', () => {
      it('without a session → 401', async () => {
        const res = await request(app).get('/api/v1/replenishment-lists');
        expect(res.status).toBe(401);
      });

      it('is served under the read limiter', async () => {
        const res = await index(users.employee);
        expect(res.status).toBe(200);
        expect(res.headers['ratelimit-limit']).toBe('100');
      });

      it('enforces replenishment:read: a session without it → uniform 403', async () => {
        narrowed.read = true;
        try {
          const res = await index(users.employee);
          expect(res.status).toBe(403);
          expect(res.body).toEqual(FORBIDDEN);
        } finally {
          narrowed.read = false;
        }
      });
    });

    describe('order and figures', () => {
      it('returns the store’s lists most recent first, each with its item, product and done counts', async () => {
        const res = await index(users.employee);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
          items: [expected.empty, expected.morning, expected.weekly, expected.weeklyDone],
          page: 1,
          pageSize: 20,
          total: 4,
        });
      });

      it('the manager reads the same listing', async () => {
        const res = await index(users.manager);
        expect(ids(res.body)).toEqual([empty.id, morning.id, weekly.id, weeklyDone.id]);
      });

      it('paginates in the same order', async () => {
        const second = await index(users.employee, { pageSize: '2', page: '2' });
        expect(second.body).toEqual({ items: [expected.weekly, expected.weeklyDone], page: 2, pageSize: 2, total: 4 });
        const past = await index(users.employee, { pageSize: '2', page: '3' });
        expect(past.body).toEqual({ items: [], page: 3, pageSize: 2, total: 4 });
      });
    });

    describe('filters', () => {
      it('status takes one status', async () => {
        const res = await index(users.employee, { status: 'draft' });
        expect(res.body).toMatchObject({ total: 2 });
        expect(ids(res.body)).toEqual([empty.id, weekly.id]);
      });

      it('status takes several, comma-separated (Home’s open work: draft,processing)', async () => {
        const res = await index(users.employee, { status: 'draft,processing' });
        expect(ids(res.body)).toEqual([empty.id, morning.id, weekly.id]);
        expect(res.body.total).toBe(3);
        const repeated = await index(users.employee, { status: 'done,done' });
        expect(ids(repeated.body)).toEqual([weeklyDone.id]);
      });

      it('search matches the name (case-insensitive substring)', async () => {
        const res = await index(users.employee, { search: 'WEEKLY' });
        expect(ids(res.body)).toEqual([weekly.id, weeklyDone.id]);
        expect(res.body.total).toBe(2);
      });

      it('search treats LIKE metacharacters literally; blank search = no filter', async () => {
        const percent = await index(users.employee, { search: '%' });
        expect(percent.body.total).toBe(0);
        const blank = await index(users.employee, { search: '   ' });
        expect(blank.body.total).toBe(4);
      });

      it('from/to bound created_at, both inclusive', async () => {
        const res = await index(users.employee, { from: weekly.createdAt, to: '2026-03-05T10:00:00+01:00' });
        expect(ids(res.body)).toEqual([morning.id, weekly.id]);
        const from = await index(users.employee, { from: '2026-03-05T09:00:00.001Z' });
        expect(ids(from.body)).toEqual([empty.id]);
        const to = await index(users.employee, { to: '2026-02-28T23:59:59.999Z' });
        expect(ids(to.body)).toEqual([weeklyDone.id]);
      });

      it('an inverted range matches nothing', async () => {
        const res = await index(users.employee, { from: '2026-03-10T00:00:00Z', to: '2026-03-01T00:00:00Z' });
        expect(res.body).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
      });

      it('filters intersect', async () => {
        const res = await index(users.employee, { status: 'draft', search: 'weekly' });
        expect(ids(res.body)).toEqual([weekly.id]);
        const none = await index(users.employee, { status: 'done', from: '2026-03-01T00:00:00Z' });
        expect(none.body.total).toBe(0);
      });

      it.each([
        ['an empty status', { status: '' }],
        ['an unknown status', { status: 'open' }],
        ['a trailing comma in status', { status: 'draft,' }],
        ['a repeated status param (the format is comma-separated)', { status: ['draft', 'done'] }],
        ['a from without an offset', { from: '2026-03-01T10:00:00' }],
        ['a date-only to', { to: '2026-03-01' }],
        ['a sort param (the order is fixed)', { sort: 'name' }],
        ['pageSize over the max', { pageSize: '101' }],
      ])('rejects %s → 400 VALIDATION_ERROR', async (_label, query) => {
        const res = await index(users.employee, query);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      });
    });

    describe('tenant scoping', () => {
      it("a store user sees only their own store's lists", async () => {
        const res = await index(users.employeeB);
        expect(res.body).toEqual({ items: [expected.foreign], page: 1, pageSize: 20, total: 1 });
      });

      it("another store's X-Tenant-Id → uniform 403", async () => {
        const res = await index(users.employee, {}, storeB);
        expect(res.status).toBe(403);
        expect(res.body).toEqual(FORBIDDEN);
      });

      it('platform_admin without X-Tenant-Id → 400 TENANT_REQUIRED', async () => {
        const res = await index(users.admin);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('TENANT_REQUIRED');
      });

      it('platform_admin reads the store named by X-Tenant-Id, and only it', async () => {
        const a = await index(users.admin, {}, storeA);
        expect(ids(a.body)).toEqual([empty.id, morning.id, weekly.id, weeklyDone.id]);
        const b = await index(users.admin, {}, storeB);
        expect(ids(b.body)).toEqual([foreign.id]);
      });
    });
  });

  describe('GET /replenishment-lists/:id', () => {
    describe('access', () => {
      it('without a session → 401', async () => {
        const res = await request(app).get(`/api/v1/replenishment-lists/${weekly.id}`);
        expect(res.status).toBe(401);
      });

      it('is served under the read limiter', async () => {
        const res = await detail(users.employee, weekly.id);
        expect(res.status).toBe(200);
        expect(res.headers['ratelimit-limit']).toBe('100');
      });

      it('enforces replenishment:read: a session without it → uniform 403', async () => {
        narrowed.read = true;
        try {
          const res = await detail(users.employee, weekly.id);
          expect(res.status).toBe(403);
          expect(res.body).toEqual(FORBIDDEN);
        } finally {
          narrowed.read = false;
        }
      });
    });

    it('returns the list with its items ordered by product name, then size position, products never interleaved', async () => {
      // The twins tie on name; each one's sizes stay adjacent (id decides which group comes first).
      const [first, second] = zulu.id < zuluTwin.id ? [zulu, zuluTwin] : [zuluTwin, zulu];
      const zuluLines = (product: SizeFixture['product']) =>
        product === zulu ? [byLabel(weekly, 'S', zulu), byLabel(weekly, 'L', zulu)] : [byLabel(weekly, 'XS', zuluTwin)];

      const res = await detail(users.employee, weekly.id);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: weekly.id,
        name: weekly.name,
        status: 'draft',
        notes: 'Back wall first',
        createdAt: weekly.createdAt,
        creatorName: 'Repl manager',
        items: [
          byLabel(weekly, '37', alpha),
          byLabel(weekly, 'One size', mike),
          ...zuluLines(first),
          ...zuluLines(second),
        ].map(detailItem),
      });
    });

    it('an empty list has no items; a deleted creator reads as null (RN-09)', async () => {
      const res = await detail(users.manager, empty.id);
      expect(res.body).toEqual({
        id: empty.id,
        name: empty.name,
        status: 'draft',
        notes: null,
        createdAt: empty.createdAt,
        creatorName: null,
        items: [],
      });
    });

    it('an unknown id and another store’s list are the same 404 (RN-03)', async () => {
      const unknown = await detail(users.employee, randomUUID());
      expect(unknown.status).toBe(404);
      expect(unknown.body).toEqual(NOT_FOUND);
      const crossTenant = await detail(users.employeeB, weekly.id);
      expect(crossTenant.status).toBe(404);
      expect(crossTenant.body).toEqual(NOT_FOUND);
    });

    it('a malformed id or any query param → 400 VALIDATION_ERROR', async () => {
      const malformed = await detail(users.employee, 'not-a-uuid');
      expect(malformed.status).toBe(400);
      expect(malformed.body.error.code).toBe('VALIDATION_ERROR');
      const query = await detail(users.employee, weekly.id).query({ sort: 'name' });
      expect(query.status).toBe(400);
      expect(query.body.error.code).toBe('VALIDATION_ERROR');
    });

    it("another store's X-Tenant-Id → uniform 403", async () => {
      const res = await detail(users.employee, weekly.id, storeB);
      expect(res.status).toBe(403);
      expect(res.body).toEqual(FORBIDDEN);
    });

    it('platform_admin without X-Tenant-Id → 400 TENANT_REQUIRED', async () => {
      const res = await detail(users.admin, weekly.id);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('TENANT_REQUIRED');
    });

    it('platform_admin reads a list only under its own store’s X-Tenant-Id', async () => {
      const own = await detail(users.admin, morning.id, storeA);
      expect(own.status).toBe(200);
      expect(own.body.items).toEqual([detailItem(morning.lines[0]!)]);
      const other = await detail(users.admin, morning.id, storeB);
      expect(other.status).toBe(404);
      expect(other.body).toEqual(NOT_FOUND);
    });
  });
});
