import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { app } from '../../app.js';
import { env } from '../../config/env.js';

// Sub-task 2.9 — RF-23 `GET /availability/events`: `activity:read`, read
// limiter, tenantContext (+ RLS), reverse-chronological pagination, inclusive
// `from`/`to`, author null-safe (RN-09), item identity embedded. Requires the
// local Supabase stack. Both stores are this file's own, so every assertion
// can be exact.

// `activity:read` is held by every role today (architecture.md §6), so no
// real user lacks it: a switch narrows the matrix for the employee to prove
// the route really enforces it.
const narrowed = vi.hoisted(() => ({ activity: false }));
vi.mock('shared', async (importOriginal) => {
  const original = await importOriginal<typeof import('shared')>();
  return {
    ...original,
    hasPermission: (subject: { role: import('shared').Role }, permission: import('shared').Permission) =>
      narrowed.activity && subject.role === 'employee' && permission === 'activity:read'
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

const PASSWORD = `events-test-${randomUUID()}`;
const storeA = randomUUID();
const storeB = randomUUID();
const categoryId = randomUUID();
const productId = randomUUID();
const PRODUCT = `Events Runner ${randomUUID().slice(0, 8)}`;
const size42 = randomUUID();
const sizeM = randomUUID();
const itemA42 = randomUUID();
const itemAM = randomUUID();
const itemB42 = randomUUID();
const deletedAuthor = randomUUID();

interface Fixture {
  role: 'platform_admin' | 'manager' | 'employee';
  tenantId: string | null;
  fullName: string;
  id: string;
  token: string;
}
const users: Record<'admin' | 'manager' | 'employee' | 'employeeB', Fixture> = {
  admin: { role: 'platform_admin', tenantId: null, fullName: 'Events Admin', id: '', token: '' },
  manager: { role: 'manager', tenantId: storeA, fullName: 'Events Manager', id: '', token: '' },
  employee: { role: 'employee', tenantId: storeA, fullName: 'Events Employee', id: '', token: '' },
  employeeB: { role: 'employee', tenantId: storeB, fullName: 'Events Employee B', id: '', token: '' },
};

// Store A's history, newest first as the feed returns it.
const e4 = { id: randomUUID(), item: itemAM, type: 'restock', at: '2026-01-04T10:00:00.000Z' } as const;
const e3 = { id: randomUUID(), item: itemAM, type: 'out_of_stock', at: '2026-01-03T10:00:00.000Z' } as const;
const e2 = { id: randomUUID(), item: itemA42, type: 'restock', at: '2026-01-02T10:00:00.000Z' } as const;
const e1 = { id: randomUUID(), item: itemA42, type: 'out_of_stock', at: '2026-01-01T10:00:00.000Z' } as const;
const eB = { id: randomUUID(), item: itemB42, type: 'out_of_stock', at: '2026-01-02T12:00:00.000Z' } as const;

const FORBIDDEN = { error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action' } };

function feed(user: Fixture, query: Record<string, string> = {}, tenantHeader?: string) {
  const req = request(app)
    .get('/api/v1/availability/events')
    .query(query)
    .set('Authorization', `Bearer ${user.token}`);
  return tenantHeader === undefined ? req : req.set('X-Tenant-Id', tenantHeader);
}

function ids(body: { items: { id: string }[] }): string[] {
  return body.items.map((item) => item.id);
}

describe('GET /availability/events (RF-23)', () => {
  beforeAll(async () => {
    await admin`
      insert into tenants (id, name, slug) values
        (${storeA}, 'Events A', ${`events-a-${storeA}`}),
        (${storeB}, 'Events B', ${`events-b-${storeB}`})
    `;
    await admin`insert into categories (id, name, slug) values (${categoryId}, 'Events', ${`events-${categoryId}`})`;
    await admin`insert into products (id, name, category_id) values (${productId}, ${PRODUCT}, ${categoryId})`;
    await admin`
      insert into product_sizes (id, product_id, label, sku) values
        (${size42}, ${productId}, '42', ${`EV-${size42}`}),
        (${sizeM}, ${productId}, 'M', ${`EV-${sizeM}`})
    `;
    await admin`
      insert into assortment_items (id, tenant_id, size_id, is_available) values
        (${itemA42}, ${storeA}, ${size42}, true),
        (${itemAM}, ${storeA}, ${sizeM}, true),
        (${itemB42}, ${storeB}, ${size42}, false)
    `;

    const signIn = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    for (const [key, user] of Object.entries(users)) {
      const email = `events-${key}-${randomUUID()}@repma.test`;
      const created = await authAdmin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
      if (created.error) throw created.error;
      user.id = created.data.user.id;
      await admin`
        insert into user_profiles (id, email, full_name, role, tenant_id)
        values (${user.id}, ${email}, ${user.fullName}, ${user.role}, ${user.tenantId})
      `;
      const session = await signIn.auth.signInWithPassword({ email, password: PASSWORD });
      if (session.error) throw session.error;
      user.token = session.data.session.access_token;
    }

    // A store-A member who flags e3 and is then deleted: `created_by` goes
    // NULL (ON DELETE SET NULL) and the event survives (RN-09).
    await admin`insert into auth.users (id) values (${deletedAuthor})`;
    await admin`
      insert into user_profiles (id, email, full_name, role, tenant_id)
      values (${deletedAuthor}, ${`events-deleted-${deletedAuthor}@repma.test`}, 'Gone', 'employee', ${storeA})
    `;

    const authors = new Map([
      [e1.id, users.employee.id],
      [e2.id, users.manager.id],
      [e3.id, deletedAuthor],
      [e4.id, users.admin.id], // a platform admin's name is readable by store members (database.md §7.3)
      [eB.id, users.employeeB.id],
    ]);
    for (const event of [e1, e2, e3, e4, eB]) {
      await admin`
        insert into availability_events (id, tenant_id, assortment_item_id, type, created_by, created_at)
        values (${event.id}, ${event === eB ? storeB : storeA}, ${event.item}, ${event.type},
                ${authors.get(event.id)!}, ${event.at})
      `;
    }
    await admin`delete from auth.users where id = ${deletedAuthor}`; // cascades to the profile
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
    await admin`delete from product_sizes where product_id = ${productId}`;
    await admin`delete from products where id = ${productId}`;
    await admin`delete from categories where id = ${categoryId}`;
    await admin.end();
  });

  describe('access', () => {
    it('without a session → 401', async () => {
      const res = await request(app).get('/api/v1/availability/events');
      expect(res.status).toBe(401);
    });

    it('is served under the read limiter', async () => {
      const res = await feed(users.employee);
      expect(res.status).toBe(200);
      expect(res.headers['ratelimit-limit']).toBe('100');
    });

    it('enforces activity:read: a session without it → uniform 403', async () => {
      narrowed.activity = true;
      try {
        const res = await feed(users.employee);
        expect(res.status).toBe(403);
        expect(res.body).toEqual(FORBIDDEN);
      } finally {
        narrowed.activity = false;
      }
    });
  });

  describe('shape and order', () => {
    it('returns the store events newest first, item identity embedded, author null when deleted (RN-09)', async () => {
      const res = await feed(users.employee);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        items: [
          {
            id: e4.id,
            type: 'restock',
            createdAt: e4.at,
            authorName: 'Events Admin',
            item: { id: itemAM, productName: PRODUCT, sizeLabel: 'M' },
          },
          {
            id: e3.id,
            type: 'out_of_stock',
            createdAt: e3.at,
            authorName: null,
            item: { id: itemAM, productName: PRODUCT, sizeLabel: 'M' },
          },
          {
            id: e2.id,
            type: 'restock',
            createdAt: e2.at,
            authorName: 'Events Manager',
            item: { id: itemA42, productName: PRODUCT, sizeLabel: '42' },
          },
          {
            id: e1.id,
            type: 'out_of_stock',
            createdAt: e1.at,
            authorName: 'Events Employee',
            item: { id: itemA42, productName: PRODUCT, sizeLabel: '42' },
          },
        ],
        page: 1,
        pageSize: 20,
        total: 4,
      });
    });

    it('the manager reads the same feed', async () => {
      const res = await feed(users.manager);
      expect(ids(res.body)).toEqual([e4.id, e3.id, e2.id, e1.id]);
    });

    it('paginates: page/pageSize slice the ordered feed, total counts it all', async () => {
      const first = await feed(users.employee, { pageSize: '3' });
      expect(ids(first.body)).toEqual([e4.id, e3.id, e2.id]);
      expect(first.body).toMatchObject({ page: 1, pageSize: 3, total: 4 });

      const second = await feed(users.employee, { pageSize: '3', page: '2' });
      expect(ids(second.body)).toEqual([e1.id]);
      expect(second.body).toMatchObject({ page: 2, pageSize: 3, total: 4 });

      const beyond = await feed(users.employee, { pageSize: '3', page: '3' });
      expect(beyond.body).toEqual({ items: [], page: 3, pageSize: 3, total: 4 });
    });
  });

  describe('from/to filters', () => {
    it('both bounds are inclusive, and total reflects the filter', async () => {
      const res = await feed(users.employee, { from: e2.at, to: e3.at });
      expect(ids(res.body)).toEqual([e3.id, e2.id]);
      expect(res.body.total).toBe(2);
    });

    it('each bound works alone', async () => {
      const from = await feed(users.employee, { from: e3.at });
      expect(ids(from.body)).toEqual([e4.id, e3.id]);
      const to = await feed(users.employee, { to: e1.at });
      expect(ids(to.body)).toEqual([e1.id]);
    });

    it('accepts an explicit offset (local midnight)', async () => {
      // 2026-01-02T00:00+02:00 = 2026-01-01T22:00Z → e1 (10:00Z on the 1st) is out.
      const res = await feed(users.employee, { from: '2026-01-02T00:00:00+02:00', to: '2026-01-02T23:59:59.999+02:00' });
      expect(ids(res.body)).toEqual([e2.id]);
    });

    it('an inverted range matches nothing', async () => {
      const res = await feed(users.employee, { from: e3.at, to: e2.at });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
    });

    it.each([
      ['a non-date from', { from: 'yesterday' }],
      ['a date without time', { to: '2026-01-02' }],
      ['a timestamp without offset', { from: '2026-01-02T00:00:00' }],
      ['pageSize over the max', { pageSize: '101' }],
      ['an unknown parameter', { type: 'restock' }],
    ])('rejects %s → 400 VALIDATION_ERROR', async (_label, query) => {
      const res = await feed(users.employee, query);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('tenant scoping', () => {
    it("a store user sees only their own store's events", async () => {
      const res = await feed(users.employeeB);
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([
        {
          id: eB.id,
          type: 'out_of_stock',
          createdAt: eB.at,
          authorName: 'Events Employee B',
          item: { id: itemB42, productName: PRODUCT, sizeLabel: '42' },
        },
      ]);
      expect(res.body.total).toBe(1);
    });

    it("another store's X-Tenant-Id → uniform 403 (no cross-tenant read)", async () => {
      const res = await feed(users.employee, {}, storeB);
      expect(res.status).toBe(403);
      expect(res.body).toEqual(FORBIDDEN);
    });

    it('platform_admin without X-Tenant-Id → 400 TENANT_REQUIRED', async () => {
      const res = await feed(users.admin);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('TENANT_REQUIRED');
    });

    it('platform_admin reads the store named by X-Tenant-Id, and only it', async () => {
      const a = await feed(users.admin, {}, storeA);
      expect(ids(a.body)).toEqual([e4.id, e3.id, e2.id, e1.id]);
      const b = await feed(users.admin, {}, storeB);
      expect(ids(b.body)).toEqual([eB.id]);
      expect(b.body.total).toBe(1);
    });
  });
});
