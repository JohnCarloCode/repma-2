import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { app } from '../../app.js';
import { env } from '../../config/env.js';

// Sub-task 3.2 — `GET /availability/:id` (one size) and RF-21
// `GET /availability/:id/events` (its history): `availability:read`, read
// limiter, tenantContext (+ RLS), uuid params, and an unknown id answering
// exactly like another store's item (RN-03). Requires the local Supabase
// stack. Both stores are this file's own, so every assertion can be exact.

// `availability:read` is held by every role (architecture.md §6): a switch
// narrows the matrix for the employee to prove the routes enforce it.
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

const PASSWORD = `item-test-${randomUUID()}`;
const storeA = randomUUID();
const storeB = randomUUID();
const categoryId = randomUUID();
const CATEGORY = `Item Cat ${randomUUID().slice(0, 8)}`;
const productId = randomUUID();
const PRODUCT = `Item Runner ${randomUUID().slice(0, 8)}`;
const IMAGE = 'https://example.test/runner.png';
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
  admin: { role: 'platform_admin', tenantId: null, fullName: 'Item Admin', id: '', token: '' },
  manager: { role: 'manager', tenantId: storeA, fullName: 'Item Manager', id: '', token: '' },
  employee: { role: 'employee', tenantId: storeA, fullName: 'Item Employee', id: '', token: '' },
  employeeB: { role: 'employee', tenantId: storeB, fullName: 'Item Employee B', id: '', token: '' },
};

// itemA42's history, newest first as the endpoint returns it; it ends out of
// stock (strict alternation, RN-14). itemAM has no events (RN-07).
const e3 = { id: randomUUID(), item: itemA42, type: 'out_of_stock', at: '2026-02-03T10:00:00.000Z' } as const;
const e2 = { id: randomUUID(), item: itemA42, type: 'restock', at: '2026-02-02T10:00:00.000Z' } as const;
const e1 = { id: randomUUID(), item: itemA42, type: 'out_of_stock', at: '2026-02-01T10:00:00.000Z' } as const;
const eB = { id: randomUUID(), item: itemB42, type: 'out_of_stock', at: '2026-02-02T12:00:00.000Z' } as const;

const FORBIDDEN = { error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action' } };
const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Item not found' } };

function get(user: Fixture, path: string, query: Record<string, string> = {}, tenantHeader?: string) {
  const req = request(app)
    .get(`/api/v1/availability/${path}`)
    .query(query)
    .set('Authorization', `Bearer ${user.token}`);
  return tenantHeader === undefined ? req : req.set('X-Tenant-Id', tenantHeader);
}

function ids(body: { items: { id: string }[] }): string[] {
  return body.items.map((item) => item.id);
}

beforeAll(async () => {
  await admin`
    insert into tenants (id, name, slug) values
      (${storeA}, 'Item A', ${`item-a-${storeA}`}),
      (${storeB}, 'Item B', ${`item-b-${storeB}`})
  `;
  await admin`insert into categories (id, name, slug) values (${categoryId}, ${CATEGORY}, ${`item-${categoryId}`})`;
  await admin`
    insert into products (id, name, category_id, image_url, is_active)
    values (${productId}, ${PRODUCT}, ${categoryId}, ${IMAGE}, false)
  `;
  await admin`
    insert into product_sizes (id, product_id, label, sku, position, is_active) values
      (${size42}, ${productId}, '42', ${`IT-${size42}`}, 1, true),
      (${sizeM}, ${productId}, 'M', ${`IT-${sizeM}`}, 2, false)
  `;
  await admin`
    insert into assortment_items (id, tenant_id, size_id, is_available) values
      (${itemA42}, ${storeA}, ${size42}, false),
      (${itemAM}, ${storeA}, ${sizeM}, true),
      (${itemB42}, ${storeB}, ${size42}, false)
  `;

  const signIn = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  for (const [key, user] of Object.entries(users)) {
    const email = `item-${key}-${randomUUID()}@repma.test`;
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

  // A store-A member who flags e2 and is then deleted: `created_by` goes NULL
  // (ON DELETE SET NULL) and the event survives (RN-09).
  await admin`insert into auth.users (id) values (${deletedAuthor})`;
  await admin`
    insert into user_profiles (id, email, full_name, role, tenant_id)
    values (${deletedAuthor}, ${`item-deleted-${deletedAuthor}@repma.test`}, 'Gone', 'employee', ${storeA})
  `;

  const authors = new Map([
    [e1.id, users.employee.id],
    [e2.id, deletedAuthor],
    [e3.id, users.manager.id],
    [eB.id, users.employeeB.id],
  ]);
  for (const event of [e1, e2, e3, eB]) {
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

describe.each([
  ['GET /availability/:id', ''],
  ['GET /availability/:id/events (RF-21)', '/events'],
])('%s — access and params', (_label, suffix) => {
  it('without a session → 401', async () => {
    const res = await request(app).get(`/api/v1/availability/${itemA42}${suffix}`);
    expect(res.status).toBe(401);
  });

  it('is served under the read limiter', async () => {
    const res = await get(users.employee, `${itemA42}${suffix}`);
    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('100');
  });

  it('enforces availability:read: a session without it → uniform 403', async () => {
    narrowed.read = true;
    try {
      const res = await get(users.employee, `${itemA42}${suffix}`);
      expect(res.status).toBe(403);
      expect(res.body).toEqual(FORBIDDEN);
    } finally {
      narrowed.read = false;
    }
  });

  it('a non-uuid id → 400 VALIDATION_ERROR on `id`', async () => {
    const res = await get(users.employee, `not-a-uuid${suffix}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'VALIDATION_ERROR', details: [{ path: 'id' }] });
  });

  it("an unknown id and another store's item get the same 404 (RN-03)", async () => {
    const unknown = await get(users.employee, `${randomUUID()}${suffix}`);
    const foreign = await get(users.employee, `${itemB42}${suffix}`);
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual(NOT_FOUND);
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(NOT_FOUND);
  });

  it("another store's X-Tenant-Id → uniform 403", async () => {
    const res = await get(users.employee, `${itemB42}${suffix}`, {}, storeB);
    expect(res.status).toBe(403);
    expect(res.body).toEqual(FORBIDDEN);
  });

  it('platform_admin without X-Tenant-Id → 400 TENANT_REQUIRED', async () => {
    const res = await get(users.admin, `${itemA42}${suffix}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TENANT_REQUIRED');
  });

  it('platform_admin reads an item only under its own store’s X-Tenant-Id', async () => {
    expect((await get(users.admin, `${itemB42}${suffix}`, {}, storeB)).status).toBe(200);
    const elsewhere = await get(users.admin, `${itemB42}${suffix}`, {}, storeA);
    expect(elsewhere.status).toBe(404);
    expect(elsewhere.body).toEqual(NOT_FOUND);
  });
});

describe('GET /availability/:id — shape', () => {
  it('returns the size with its state, latest event and product identity', async () => {
    const res = await get(users.employee, itemA42);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: itemA42,
      sizeId: size42,
      label: '42',
      sku: `IT-${size42}`,
      isAvailable: false,
      isActive: true,
      latestEventAt: e3.at,
      product: { id: productId, name: PRODUCT, imageUrl: IMAGE, categoryName: CATEGORY, isActive: false },
    });
  });

  it('an item with no events is available with latestEventAt null (RN-07); inactive size flagged (RN-08)', async () => {
    const res = await get(users.manager, itemAM);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: itemAM, label: 'M', isAvailable: true, isActive: false, latestEventAt: null });
  });

  it('takes no query: any parameter → 400 VALIDATION_ERROR (whitelist)', async () => {
    const res = await get(users.employee, itemA42, { is_available: 'false' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'VALIDATION_ERROR', details: [{ path: 'is_available' }] });
  });

  it('a store user reads their own store’s copy of the same size', async () => {
    const res = await get(users.employeeB, itemB42);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: itemB42, sizeId: size42, latestEventAt: eB.at });
  });
});

describe('GET /availability/:id/events (RF-21) — history', () => {
  it("returns only this item's events newest first, author null when deleted (RN-09)", async () => {
    const res = await get(users.employee, `${itemA42}/events`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [
        { id: e3.id, type: 'out_of_stock', createdAt: e3.at, authorName: 'Item Manager' },
        { id: e2.id, type: 'restock', createdAt: e2.at, authorName: null },
        { id: e1.id, type: 'out_of_stock', createdAt: e1.at, authorName: 'Item Employee' },
      ],
      page: 1,
      pageSize: 20,
      total: 3,
    });
  });

  it('an item with no events → an empty page, not a 404', async () => {
    const res = await get(users.employee, `${itemAM}/events`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
  });

  it('paginates: page/pageSize slice the history, total counts it all', async () => {
    const first = await get(users.employee, `${itemA42}/events`, { pageSize: '2' });
    expect(ids(first.body)).toEqual([e3.id, e2.id]);
    expect(first.body).toMatchObject({ page: 1, pageSize: 2, total: 3 });

    const second = await get(users.employee, `${itemA42}/events`, { pageSize: '2', page: '2' });
    expect(ids(second.body)).toEqual([e1.id]);

    const beyond = await get(users.employee, `${itemA42}/events`, { pageSize: '2', page: '3' });
    expect(beyond.body).toEqual({ items: [], page: 3, pageSize: 2, total: 3 });
  });

  it("another store's history stays its own", async () => {
    const res = await get(users.employeeB, `${itemB42}/events`);
    expect(res.body.items).toEqual([
      { id: eB.id, type: 'out_of_stock', createdAt: eB.at, authorName: 'Item Employee B' },
    ]);
  });

  it.each([
    ['pageSize over the max', { pageSize: '101' }],
    ['an unknown parameter', { from: e1.at }],
  ])('rejects %s → 400 VALIDATION_ERROR', async (_label, query) => {
    const res = await get(users.employee, `${itemA42}/events`, query);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
