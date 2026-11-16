import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { app } from '../../app.js';
import { env } from '../../config/env.js';

// Sub-task 6.2 — the assortment writes: RF-19 `POST /availability {sizeId}`
// and RF-44 `DELETE /availability/:id`. `assortment:manage` (manager and
// platform admin; the employee lacks it), write limiter, tenantContext (+ RLS).
// Additions: starts available with no events, inactive product/size rejected
// (RN-08), duplicate → 409 (RN-04), `is_available` in the body → 400 (RF-22).
// Removal: only while unreferenced — both RESTRICT paths (events, list lines)
// answer a clean 409 (RN-13). Requires the local Supabase stack. Both stores
// are this file's own, so assertions are exact.

// The manager holds `assortment:manage`; a switch narrows it to prove the
// routes enforce the permission (the employee's lack of it is the real matrix).
const narrowed = vi.hoisted(() => ({ manage: false }));
vi.mock('shared', async (importOriginal) => {
  const original = await importOriginal<typeof import('shared')>();
  return {
    ...original,
    hasPermission: (subject: { role: import('shared').Role }, permission: import('shared').Permission) =>
      narrowed.manage && subject.role === 'manager' && permission === 'assortment:manage'
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

const PASSWORD = `assortment-test-${randomUUID()}`;
const storeA = randomUUID();
const storeB = randomUUID();
const categoryId = randomUUID();
const CATEGORY = `Assort Cat ${categoryId.slice(0, 8)}`;
const productId = randomUUID();
const inactiveProductId = randomUUID();
const PRODUCT = `Assort Runner ${randomUUID().slice(0, 8)}`;
// Sizes of the active product (one inactive), and one of the inactive product.
const sizes = {
  add: randomUUID(), // added by the happy path
  dup: randomUUID(), // already in store A
  inactive: randomUUID(), // is_active = false
  free: randomUUID(), // in the assortment, unreferenced (removal happy path)
  evented: randomUUID(), // in the assortment with an event
  listed: randomUUID(), // in the assortment on a list
  admin: randomUUID(), // added/removed by the platform admin in store B
  ofInactiveProduct: randomUUID(),
};
const items = { dup: randomUUID(), free: randomUUID(), evented: randomUUID(), listed: randomUUID(), foreign: randomUUID() };
const listId = randomUUID();

interface Fixture {
  role: 'platform_admin' | 'manager' | 'employee';
  tenantId: string | null;
  fullName: string;
  id: string;
  token: string;
}
const users: Record<'admin' | 'manager' | 'employee' | 'managerB', Fixture> = {
  admin: { role: 'platform_admin', tenantId: null, fullName: 'Assort Admin', id: '', token: '' },
  manager: { role: 'manager', tenantId: storeA, fullName: 'Assort Manager', id: '', token: '' },
  employee: { role: 'employee', tenantId: storeA, fullName: 'Assort Employee', id: '', token: '' },
  managerB: { role: 'manager', tenantId: storeB, fullName: 'Assort Manager B', id: '', token: '' },
};

const FORBIDDEN = { error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action' } };
const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Item not found' } };

function add(user: Fixture, body: unknown, tenantHeader?: string) {
  const req = request(app)
    .post('/api/v1/availability')
    .set('Authorization', `Bearer ${user.token}`)
    .send(body as object);
  return tenantHeader === undefined ? req : req.set('X-Tenant-Id', tenantHeader);
}

function remove(user: Fixture, id: string, tenantHeader?: string) {
  const req = request(app).delete(`/api/v1/availability/${id}`).set('Authorization', `Bearer ${user.token}`);
  return tenantHeader === undefined ? req : req.set('X-Tenant-Id', tenantHeader);
}

async function assorted(tenantId: string, sizeId: string) {
  return admin<{ id: string; is_available: boolean }[]>`
    select id, is_available from assortment_items where tenant_id = ${tenantId} and size_id = ${sizeId}
  `;
}

async function itemExists(id: string) {
  const [row] = await admin<{ n: number }[]>`select count(*)::int as n from assortment_items where id = ${id}`;
  return row!.n === 1;
}

beforeAll(async () => {
  await admin`
    insert into tenants (id, name, slug) values
      (${storeA}, 'Assort A', ${`assort-a-${storeA}`}),
      (${storeB}, 'Assort B', ${`assort-b-${storeB}`})
  `;
  await admin`insert into categories (id, name, slug) values (${categoryId}, ${CATEGORY}, ${`assort-${categoryId}`})`;
  await admin`
    insert into products (id, name, category_id, is_active) values
      (${productId}, ${PRODUCT}, ${categoryId}, true),
      (${inactiveProductId}, ${`${PRODUCT} retired`}, ${categoryId}, false)
  `;
  for (const [position, [key, sizeId]] of Object.entries(sizes).entries()) {
    const owner = key === 'ofInactiveProduct' ? inactiveProductId : productId;
    await admin`
      insert into product_sizes (id, product_id, label, sku, position, is_active)
      values (${sizeId}, ${owner}, ${String(40 + position)}, ${`AS-${sizeId}`}, ${position}, ${key !== 'inactive'})
    `;
  }
  await admin`
    insert into assortment_items (id, tenant_id, size_id) values
      (${items.dup}, ${storeA}, ${sizes.dup}),
      (${items.free}, ${storeA}, ${sizes.free}),
      (${items.evented}, ${storeA}, ${sizes.evented}),
      (${items.listed}, ${storeA}, ${sizes.listed}),
      (${items.foreign}, ${storeB}, ${sizes.free})
  `;

  const signIn = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  for (const [key, user] of Object.entries(users)) {
    const email = `assort-${key}-${randomUUID()}@repma.test`;
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

  // The two references RN-13 knows: an event, and a replenishment list line.
  await admin`
    insert into availability_events (tenant_id, assortment_item_id, type, created_by)
    values (${storeA}, ${items.evented}, 'out_of_stock', ${users.manager.id})
  `;
  await admin`update assortment_items set is_available = false where id = ${items.evented}`;
  await admin`
    insert into replenishment_lists (id, tenant_id, name, created_by)
    values (${listId}, ${storeA}, 'Assort list', ${users.manager.id})
  `;
  await admin`
    insert into replenishment_list_items (tenant_id, list_id, size_id, quantity_requested)
    values (${storeA}, ${listId}, ${sizes.listed}, 1)
  `;
});

afterAll(async () => {
  const userIds = Object.values(users)
    .map((user) => user.id)
    .filter(Boolean);
  await admin`delete from replenishment_lists where tenant_id in ${admin([storeA, storeB])}`; // items cascade
  await admin`delete from availability_events where tenant_id in ${admin([storeA, storeB])}`;
  await admin`delete from assortment_items where tenant_id in ${admin([storeA, storeB])}`;
  await admin`delete from user_profiles where id in ${admin(userIds)}`;
  for (const id of userIds) await authAdmin.auth.admin.deleteUser(id);
  await admin`delete from tenants where id in ${admin([storeA, storeB])}`;
  await admin`delete from product_sizes where product_id in ${admin([productId, inactiveProductId])}`;
  await admin`delete from products where id in ${admin([productId, inactiveProductId])}`;
  await admin`delete from categories where id = ${categoryId}`;
  await admin.end();
});

describe('POST /availability — access and payload', () => {
  it('without a session → 401', async () => {
    const res = await request(app).post('/api/v1/availability').send({ sizeId: sizes.add });
    expect(res.status).toBe(401);
  });

  it('the employee lacks assortment:manage → uniform 403, nothing added', async () => {
    const res = await add(users.employee, { sizeId: sizes.add });
    expect(res.status).toBe(403);
    expect(res.body).toEqual(FORBIDDEN);
    expect(await assorted(storeA, sizes.add)).toEqual([]);
  });

  it('enforces assortment:manage: a narrowed manager → uniform 403', async () => {
    narrowed.manage = true;
    try {
      const res = await add(users.manager, { sizeId: sizes.add });
      expect(res.status).toBe(403);
      expect(res.body).toEqual(FORBIDDEN);
    } finally {
      narrowed.manage = false;
    }
    expect(await assorted(storeA, sizes.add)).toEqual([]);
  });

  it.each([
    ['`is_available` alongside the size (RF-22)', { sizeId: randomUUID(), is_available: false }, 'is_available'],
    ['`is_available` alone (RF-22)', { is_available: true }, 'is_available'],
    ['an extra field', { sizeId: randomUUID(), tenantId: randomUUID() }, 'tenantId'],
    ['a non-uuid sizeId', { sizeId: 'abc' }, 'sizeId'],
    ['no sizeId', {}, 'sizeId'],
  ])('rejects %s → 400 VALIDATION_ERROR', async (_label, body, path) => {
    const res = await add(users.manager, body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path })]));
  });

  it('a query parameter → 400 VALIDATION_ERROR (the route takes none)', async () => {
    const res = await add(users.manager, { sizeId: sizes.add }).query({ is_available: 'false' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'VALIDATION_ERROR', details: [{ path: 'is_available' }] });
  });

  it("another store's X-Tenant-Id → uniform 403", async () => {
    const res = await add(users.manager, { sizeId: sizes.add }, storeB);
    expect(res.status).toBe(403);
    expect(res.body).toEqual(FORBIDDEN);
    expect(await assorted(storeB, sizes.add)).toEqual([]);
  });

  it('platform_admin without X-Tenant-Id → 400 TENANT_REQUIRED', async () => {
    const res = await add(users.admin, { sizeId: sizes.add });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TENANT_REQUIRED');
  });

  it('is served under the write limiter (RNF-07)', async () => {
    const res = await add(users.manager, { sizeId: sizes.dup }); // already assorted → 409
    expect(res.status).toBe(409);
    expect(res.headers['ratelimit-limit']).toBe('30');
  });
});

describe('POST /availability — the addition (RF-19)', () => {
  it('adds the size → 201 with the new item: available, no events, the GET /availability/:id shape', async () => {
    const res = await add(users.manager, { sizeId: sizes.add });
    expect(res.status).toBe(201);
    const [row] = await assorted(storeA, sizes.add);
    expect(row).toEqual({ id: expect.any(String), is_available: true });
    expect(res.body).toEqual({
      id: row!.id,
      sizeId: sizes.add,
      label: '40',
      sku: `AS-${sizes.add}`,
      isAvailable: true,
      isActive: true,
      latestEventAt: null,
      product: { id: productId, name: PRODUCT, imageUrl: null, categoryName: CATEGORY, isActive: true },
    });
    const [events] = await admin<{ n: number }[]>`
      select count(*)::int as n from availability_events where assortment_item_id = ${row!.id}
    `;
    expect(events!.n).toBe(0);

    const detail = await request(app)
      .get(`/api/v1/availability/${row!.id}`)
      .set('Authorization', `Bearer ${users.manager.token}`);
    expect(detail.body).toEqual(res.body);
  });

  it('a size already in the assortment → 409 CONFLICT (RN-04), no second row', async () => {
    const res = await add(users.manager, { sizeId: sizes.dup });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: { code: 'CONFLICT', message: 'This size is already in the assortment' } });
    expect(await assorted(storeA, sizes.dup)).toHaveLength(1);
  });

  it('the same size in another store is a separate assortment (RN-04 is per store)', async () => {
    const res = await add(users.managerB, { sizeId: sizes.dup });
    expect(res.status).toBe(201);
    expect(await assorted(storeB, sizes.dup)).toHaveLength(1);
    expect(await assorted(storeA, sizes.dup)).toEqual([{ id: items.dup, is_available: true }]);
  });

  it('an inactive size → 400 VALIDATION_ERROR on sizeId (RN-08), nothing added', async () => {
    const res = await add(users.manager, { sizeId: sizes.inactive });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'This size is inactive',
        details: [{ path: 'sizeId', message: 'This size is inactive' }],
      },
    });
    expect(await assorted(storeA, sizes.inactive)).toEqual([]);
  });

  it("a size of an inactive product → 400 VALIDATION_ERROR on sizeId (RN-08), even if the size is active", async () => {
    const res = await add(users.manager, { sizeId: sizes.ofInactiveProduct });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'This product is inactive',
        details: [{ path: 'sizeId', message: 'This product is inactive' }],
      },
    });
    expect(await assorted(storeA, sizes.ofInactiveProduct)).toEqual([]);
  });

  it('an unknown size → 400 VALIDATION_ERROR on sizeId', async () => {
    const res = await add(users.manager, { sizeId: randomUUID() });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'This size is not in the catalog',
        details: [{ path: 'sizeId', message: 'This size is not in the catalog' }],
      },
    });
  });

  it("platform_admin adds under the store's X-Tenant-Id — the row is that store's", async () => {
    const res = await add(users.admin, { sizeId: sizes.admin }, storeB);
    expect(res.status).toBe(201);
    expect(await assorted(storeB, sizes.admin)).toEqual([{ id: res.body.id, is_available: true }]);
    expect(await assorted(storeA, sizes.admin)).toEqual([]);
  });
});

describe('DELETE /availability/:id — access and params', () => {
  it('without a session → 401', async () => {
    const res = await request(app).delete(`/api/v1/availability/${items.free}`);
    expect(res.status).toBe(401);
  });

  it('the employee lacks assortment:manage → uniform 403, the item stays', async () => {
    const res = await remove(users.employee, items.free);
    expect(res.status).toBe(403);
    expect(res.body).toEqual(FORBIDDEN);
    expect(await itemExists(items.free)).toBe(true);
  });

  it('enforces assortment:manage: a narrowed manager → uniform 403', async () => {
    narrowed.manage = true;
    try {
      const res = await remove(users.manager, items.free);
      expect(res.status).toBe(403);
    } finally {
      narrowed.manage = false;
    }
    expect(await itemExists(items.free)).toBe(true);
  });

  it('a non-uuid id → 400 VALIDATION_ERROR on `id`', async () => {
    const res = await remove(users.manager, 'nope');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'VALIDATION_ERROR', details: [{ path: 'id' }] });
  });

  it('a query parameter → 400 VALIDATION_ERROR', async () => {
    const res = await remove(users.manager, items.free).query({ force: 'true' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'VALIDATION_ERROR', details: [{ path: 'force' }] });
  });

  it("RLS isolation: another store's item is the same 404 as an unknown id (RN-03), and stays", async () => {
    const unknown = await remove(users.manager, randomUUID());
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual(NOT_FOUND);
    const foreign = await remove(users.manager, items.foreign);
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(NOT_FOUND);
    expect(await itemExists(items.foreign)).toBe(true);
  });

  it("another store's X-Tenant-Id → uniform 403", async () => {
    const res = await remove(users.manager, items.foreign, storeB);
    expect(res.status).toBe(403);
    expect(await itemExists(items.foreign)).toBe(true);
  });

  it('platform_admin without X-Tenant-Id → 400 TENANT_REQUIRED', async () => {
    const res = await remove(users.admin, items.foreign);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TENANT_REQUIRED');
  });

  it('is served under the write limiter (RNF-07)', async () => {
    const res = await remove(users.manager, items.evented); // referenced → 409
    expect(res.status).toBe(409);
    expect(res.headers['ratelimit-limit']).toBe('30');
  });
});

describe('DELETE /availability/:id — only unreferenced items (RF-44, RN-13)', () => {
  it('an item with availability events → 409 CONFLICT; item and history stay', async () => {
    const res = await remove(users.manager, items.evented);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: { code: 'CONFLICT', message: 'This size has availability history and cannot be removed' },
    });
    expect(await itemExists(items.evented)).toBe(true);
    const [events] = await admin<{ n: number }[]>`
      select count(*)::int as n from availability_events where assortment_item_id = ${items.evented}
    `;
    expect(events!.n).toBe(1);
  });

  it('an item on a replenishment list → 409 CONFLICT; item and line stay', async () => {
    const res = await remove(users.manager, items.listed);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: { code: 'CONFLICT', message: 'This size is on a replenishment list and cannot be removed' },
    });
    expect(await itemExists(items.listed)).toBe(true);
    const [lines] = await admin<{ n: number }[]>`
      select count(*)::int as n from replenishment_list_items where list_id = ${listId}
    `;
    expect(lines!.n).toBe(1);
  });

  it('an unreferenced item → 204, gone; then the same id → 404', async () => {
    const res = await remove(users.manager, items.free);
    expect(res.status).toBe(204);
    expect(res.body).toEqual({});
    expect(await itemExists(items.free)).toBe(false);
    expect(await itemExists(items.foreign)).toBe(true); // store B's row of the same size untouched

    const again = await remove(users.manager, items.free);
    expect(again.status).toBe(404);
  });

  it('a removed size can be added again (the correction loop)', async () => {
    const res = await add(users.manager, { sizeId: sizes.free });
    expect(res.status).toBe(201);
    expect(await assorted(storeA, sizes.free)).toEqual([{ id: res.body.id, is_available: true }]);
  });

  it("platform_admin removes under the store's X-Tenant-Id", async () => {
    const [row] = await assorted(storeB, sizes.admin);
    const res = await remove(users.admin, row!.id, storeB);
    expect(res.status).toBe(204);
    expect(await itemExists(row!.id)).toBe(false);
  });
});
