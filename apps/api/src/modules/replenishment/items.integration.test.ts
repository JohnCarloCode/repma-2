import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { app } from '../../app.js';
import { env } from '../../config/env.js';

// Sub-task 4.4 — RF-28/RF-40 list items: `POST /replenishment-lists/:id/items`,
// `PATCH …/items/:itemId`, `DELETE …/items/:itemId`. `replenishment:manage`,
// shop-floor limiter (RNF-07), tenantContext (+ RLS), assortment membership
// (RN-12, inactive-but-assorted allowed — RN-08), availability state never
// gating a line (DP-06), one size per list (RN-04), quantity bounds, and the
// list/item 404s (RN-03). Requires the local Supabase stack. Both stores are
// this file's own.

// `replenishment:manage` is held by every role (architecture.md §6): a switch
// narrows the matrix for the employee to prove the routes enforce it.
const narrowed = vi.hoisted(() => ({ manage: false }));
vi.mock('shared', async (importOriginal) => {
  const original = await importOriginal<typeof import('shared')>();
  return {
    ...original,
    hasPermission: (subject: { role: import('shared').Role }, permission: import('shared').Permission) =>
      narrowed.manage && subject.role === 'employee' && permission === 'replenishment:manage'
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

const PASSWORD = `repl-items-${randomUUID()}`;
const token = `rpli${randomUUID().slice(0, 8)}`;
const storeA = randomUUID();
const storeB = randomUUID();
const category = { id: randomUUID(), name: `${token} Apparel` };
const product = { id: randomUUID(), name: `${token} Field Jacket` };
// Discontinued: product and size inactive, the size still in store A's assortment.
const retired = { id: randomUUID(), name: `${token} Old Parka` };
const sizes = {
  s: { id: randomUUID(), productId: product.id, label: 'S', sku: `${token}-S`, position: 0 },
  m: { id: randomUUID(), productId: product.id, label: 'M', sku: `${token}-M`, position: 1 },
  // Flagged out of stock in store A.
  l: { id: randomUUID(), productId: product.id, label: 'L', sku: `${token}-L`, position: 2 },
  // Only in store B's assortment.
  xl: { id: randomUUID(), productId: product.id, label: 'XL', sku: `${token}-XL`, position: 3 },
  retired: { id: randomUUID(), productId: retired.id, label: 'One size', sku: `${token}-OLD`, position: 0 },
};

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
  admin: user('platform_admin', null, 'Repl-i admin'),
  manager: user('manager', storeA, 'Repl-i manager'),
  employee: user('employee', storeA, 'Repl-i employee'),
  employeeB: user('employee', storeB, 'Repl-i employee B'),
};

const FORBIDDEN = { error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action' } };
const LIST_NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'List not found' } };
const ITEM_NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Item not found' } };
const NOT_IN_ASSORTMENT = "This size is not in the store's assortment";
const URL = '/api/v1/replenishment-lists';

function as<T extends request.Test>(req: T, who: Fixture, tenantHeader?: string): T {
  req.set('Authorization', `Bearer ${who.token}`);
  return tenantHeader === undefined ? req : (req.set('X-Tenant-Id', tenantHeader) as T);
}
const add = (who: Fixture, listId: string, body: unknown, tenantHeader?: string) =>
  as(request(app).post(`${URL}/${listId}/items`), who, tenantHeader).send(body as object);
const update = (who: Fixture, listId: string, itemId: string, body: unknown, tenantHeader?: string) =>
  as(request(app).patch(`${URL}/${listId}/items/${itemId}`), who, tenantHeader).send(body as object);
const remove = (who: Fixture, listId: string, itemId: string, tenantHeader?: string) =>
  as(request(app).delete(`${URL}/${listId}/items/${itemId}`), who, tenantHeader);

// A list inserted through the admin connection, optionally with lines on
// sizes S (quantity 1, done) and M (quantity 2, not done). Returns the list id
// and its line ids by size.
async function seedList(
  tenantId: string,
  options: { lines?: boolean } = {},
): Promise<{ id: string; lines: { s: string; m: string } }> {
  const id = randomUUID();
  await admin`
    insert into replenishment_lists (id, tenant_id, name, created_by)
    values (${id}, ${tenantId}, ${`${token} seeded`}, ${tenantId === storeA ? users.manager.id : users.employeeB.id})
  `;
  const lines = { s: '', m: '' };
  if (options.lines) {
    for (const [i, key] of (['s', 'm'] as const).entries()) {
      const [row] = await admin`
        insert into replenishment_list_items (tenant_id, list_id, size_id, quantity_requested, is_done)
        values (${tenantId}, ${id}, ${sizes[key].id}, ${i + 1}, ${i === 0})
        returning id
      `;
      lines[key] = row!.id as string;
    }
  }
  return { id, lines };
}

async function lineRows(listId: string) {
  return admin`
    select id, tenant_id, size_id, quantity_requested, is_done, updated_at
    from replenishment_list_items where list_id = ${listId} order by created_at, id
  `;
}

function expectValidationError(res: request.Response, path?: string) {
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('VALIDATION_ERROR');
  if (path !== undefined) {
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(path);
  }
}

const itemShape = (key: keyof typeof sizes, quantity: number, isDone: boolean) => {
  const size = sizes[key];
  const owner = size.productId === product.id ? product : retired;
  return {
    id: expect.any(String),
    sizeId: size.id,
    sizeLabel: size.label,
    sku: size.sku,
    quantity,
    isDone,
    product: {
      id: owner.id,
      name: owner.name,
      imageUrl: owner.id === product.id ? imageUrl : null,
      categoryId: category.id,
      categoryName: category.name,
    },
  };
};

// The active product carries an image, which every item shape embeds; the retired one has none.
const imageUrl = 'https://example.test/repl-i.webp';

describe('replenishment list items (RF-28, RF-40)', () => {
  beforeAll(async () => {
    await admin`
      insert into tenants (id, name, slug) values
        (${storeA}, 'Repl-i A', ${`repl-i-a-${storeA}`}),
        (${storeB}, 'Repl-i B', ${`repl-i-b-${storeB}`})
    `;
    await admin`insert into categories (id, name, slug) values (${category.id}, ${category.name}, ${`repli-${category.id}`})`;
    await admin`insert into products (id, name, category_id, image_url) values (${product.id}, ${product.name}, ${category.id}, ${imageUrl})`;
    await admin`
      insert into products (id, name, category_id, is_active)
      values (${retired.id}, ${retired.name}, ${category.id}, false)
    `;
    for (const s of Object.values(sizes)) {
      await admin`
        insert into product_sizes (id, product_id, label, sku, position, is_active)
        values (${s.id}, ${s.productId}, ${s.label}, ${s.sku}, ${s.position}, ${s !== sizes.retired})
      `;
    }
    for (const s of [sizes.s, sizes.m, sizes.l, sizes.retired]) {
      await admin`
        insert into assortment_items (tenant_id, size_id, is_available)
        values (${storeA}, ${s.id}, ${s !== sizes.l})
      `;
    }
    for (const s of [sizes.s, sizes.m, sizes.xl]) {
      await admin`insert into assortment_items (tenant_id, size_id) values (${storeB}, ${s.id})`;
    }

    const signIn = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    for (const [key, fixture] of Object.entries(users)) {
      const email = `repli-${key}-${randomUUID()}@repma.test`;
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
  });

  afterAll(async () => {
    const userIds = Object.values(users)
      .map((fixture) => fixture.id)
      .filter(Boolean);
    await admin`delete from replenishment_lists where tenant_id in ${admin([storeA, storeB])}`; // items cascade
    await admin`delete from availability_events where tenant_id in ${admin([storeA, storeB])}`;
    await admin`delete from assortment_items where tenant_id in ${admin([storeA, storeB])}`;
    await admin`delete from user_profiles where id in ${admin(userIds)}`;
    for (const id of userIds) await authAdmin.auth.admin.deleteUser(id);
    await admin`delete from tenants where id in ${admin([storeA, storeB])}`;
    await admin`delete from product_sizes where product_id in ${admin([product.id, retired.id])}`;
    await admin`delete from products where id in ${admin([product.id, retired.id])}`;
    await admin`delete from categories where id = ${category.id}`;
    await admin.end();
  });

  describe('POST /replenishment-lists/:id/items', () => {
    it('without a session → 401', async () => {
      const res = await request(app).post(`${URL}/${randomUUID()}/items`).send({ sizeId: sizes.s.id });
      expect(res.status).toBe(401);
    });

    it('is served under the shop-floor limiter', async () => {
      const { id } = await seedList(storeA);
      const res = await add(users.employee, id, { sizeId: sizes.s.id, quantity: 1 });
      expect(res.status).toBe(201);
      expect(res.headers['ratelimit-limit']).toBe('120');
    });

    it('enforces replenishment:manage: a session without it → uniform 403, nothing added', async () => {
      const { id } = await seedList(storeA);
      narrowed.manage = true;
      try {
        const res = await add(users.employee, id, { sizeId: sizes.s.id, quantity: 1 });
        expect(res.status).toBe(403);
        expect(res.body).toEqual(FORBIDDEN);
        expect(await lineRows(id)).toHaveLength(0);
      } finally {
        narrowed.manage = false;
      }
    });

    it('adds an unchecked line in the list’s store → 201 item shape, as the detail shows it', async () => {
      const { id } = await seedList(storeA);
      const res = await add(users.employee, id, { sizeId: sizes.m.id, quantity: 3 });
      expect(res.status).toBe(201);
      expect(res.body).toEqual(itemShape('m', 3, false));
      const rows = await lineRows(id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: res.body.id,
        tenant_id: storeA,
        size_id: sizes.m.id,
        quantity_requested: 3,
        is_done: false,
      });

      const detail = await as(request(app).get(`${URL}/${id}`), users.manager);
      expect(detail.body.items).toEqual([res.body]);
    });

    it('quantity defaults to 1 when omitted (RF-27)', async () => {
      const { id } = await seedList(storeA);
      const res = await add(users.employee, id, { sizeId: sizes.s.id });
      expect(res.status).toBe(201);
      expect(res.body.quantity).toBe(1);
    });

    it('RN-12: a size outside the store’s assortment → 400 on sizeId, nothing added', async () => {
      const { id } = await seedList(storeA);
      // XL is in store B's assortment only; the other id is no size at all.
      for (const sizeId of [sizes.xl.id, randomUUID()]) {
        const res = await add(users.employee, id, { sizeId, quantity: 1 });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({
          error: {
            code: 'VALIDATION_ERROR',
            message: NOT_IN_ASSORTMENT,
            details: [{ path: 'sizeId', message: NOT_IN_ASSORTMENT }],
          },
        });
      }
      expect(await lineRows(id)).toHaveLength(0);
    });

    it('RN-12/RN-08: an inactive product/size still in the assortment can be added', async () => {
      const { id } = await seedList(storeA);
      const res = await add(users.employee, id, { sizeId: sizes.retired.id, quantity: 2 });
      expect(res.status).toBe(201);
      expect(res.body).toEqual(itemShape('retired', 2, false));
    });

    it('DP-06: an out-of-stock size can be added, and adding it leaves availability untouched', async () => {
      const { id } = await seedList(storeA);
      const res = await add(users.employee, id, { sizeId: sizes.l.id, quantity: 4 });
      expect(res.status).toBe(201);
      expect(res.body).toEqual(itemShape('l', 4, false));
      const [assorted] = await admin`
        select is_available from assortment_items where tenant_id = ${storeA} and size_id = ${sizes.l.id}
      `;
      expect(assorted!.is_available).toBe(false);
      expect(await admin`select 1 from availability_events where tenant_id = ${storeA}`).toHaveLength(0);
    });

    it('RN-04: a size already on the list → 409, nothing added; the same size on another list is fine', async () => {
      const { id } = await seedList(storeA, { lines: true });
      const res = await add(users.employee, id, { sizeId: sizes.s.id, quantity: 5 });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: { code: 'CONFLICT', message: 'This size is already on the list' } });
      expect(await lineRows(id)).toHaveLength(2);

      const elsewhere = await seedList(storeA);
      expect((await add(users.employee, elsewhere.id, { sizeId: sizes.s.id, quantity: 5 })).status).toBe(201);
    });

    it('quantity is an integer from 1 to 9999', async () => {
      const { id } = await seedList(storeA);
      for (const quantity of [0, -1, 1.5, '2', null, 10000]) {
        expectValidationError(await add(users.employee, id, { sizeId: sizes.s.id, quantity }), 'quantity');
      }
      expect(await lineRows(id)).toHaveLength(0);
      const res = await add(users.employee, id, { sizeId: sizes.s.id, quantity: 9999 });
      expect(res.status).toBe(201);
      expect(res.body.quantity).toBe(9999);
    });

    it('sizeId is a required uuid; no other key is accepted (no done flag, store or availability field)', async () => {
      const { id } = await seedList(storeA);
      expectValidationError(await add(users.employee, id, { quantity: 1 }), 'sizeId');
      expectValidationError(await add(users.employee, id, { sizeId: 'nope', quantity: 1 }), 'sizeId');
      const base = { sizeId: sizes.s.id, quantity: 1 };
      for (const [key, value] of [
        ['isDone', true],
        ['tenantId', storeB],
        ['listId', id],
        ['is_available', false],
        ['isAvailable', false],
      ] as const) {
        expectValidationError(await add(users.employee, id, { ...base, [key]: value }), key);
      }
      expectValidationError(await add(users.employee, id, base).query({ force: 'true' }));
      expect(await lineRows(id)).toHaveLength(0);
    });

    it('unknown or another store’s list → the same 404 "List not found", nothing added; malformed id → 400', async () => {
      const foreign = await seedList(storeB);
      for (const listId of [randomUUID(), foreign.id]) {
        // S is in both assortments: the 404 comes from the list, not RN-12.
        const res = await add(users.employee, listId, { sizeId: sizes.s.id, quantity: 1 });
        expect(res.status).toBe(404);
        expect(res.body).toEqual(LIST_NOT_FOUND);
      }
      expect(await lineRows(foreign.id)).toHaveLength(0);
      expectValidationError(await add(users.employee, 'nope', { sizeId: sizes.s.id }), 'id');
    });

    it("another store's X-Tenant-Id → uniform 403", async () => {
      const { id } = await seedList(storeA);
      const res = await add(users.employee, id, { sizeId: sizes.s.id }, storeB);
      expect(res.status).toBe(403);
      expect(res.body).toEqual(FORBIDDEN);
    });

    it('platform_admin: TENANT_REQUIRED without X-Tenant-Id; adds under the list’s own store only', async () => {
      const { id } = await seedList(storeB);
      const noHeader = await add(users.admin, id, { sizeId: sizes.xl.id });
      expect(noHeader.status).toBe(400);
      expect(noHeader.body.error.code).toBe('TENANT_REQUIRED');
      expect((await add(users.admin, id, { sizeId: sizes.xl.id }, storeA)).body).toEqual(LIST_NOT_FOUND);
      const res = await add(users.admin, id, { sizeId: sizes.xl.id }, storeB);
      expect(res.status).toBe(201);
      expect((await lineRows(id))[0]!.tenant_id).toBe(storeB);
    });
  });

  describe('PATCH /replenishment-lists/:id/items/:itemId', () => {
    it('without a session → 401', async () => {
      const res = await request(app).patch(`${URL}/${randomUUID()}/items/${randomUUID()}`).send({ isDone: true });
      expect(res.status).toBe(401);
    });

    it('is served under the shop-floor limiter', async () => {
      const { id, lines } = await seedList(storeA, { lines: true });
      const res = await update(users.employee, id, lines.m, { isDone: true });
      expect(res.status).toBe(200);
      expect(res.headers['ratelimit-limit']).toBe('120');
    });

    it('enforces replenishment:manage: a session without it → uniform 403, nothing changed', async () => {
      const { id, lines } = await seedList(storeA, { lines: true });
      narrowed.manage = true;
      try {
        const res = await update(users.employee, id, lines.m, { quantity: 7, isDone: true });
        expect(res.status).toBe(403);
        expect(res.body).toEqual(FORBIDDEN);
      } finally {
        narrowed.manage = false;
      }
      expect((await lineRows(id))[1]).toMatchObject({ quantity_requested: 2, is_done: false });
    });

    it('changes the quantity only → 200 item shape, the check untouched', async () => {
      const { id, lines } = await seedList(storeA, { lines: true });
      const res = await update(users.employee, id, lines.s, { quantity: 6 });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ...itemShape('s', 6, true), id: lines.s });
      expect((await lineRows(id))[0]).toMatchObject({ quantity_requested: 6, is_done: true });
    });

    it('toggles the done check both ways (RF-40), the quantity untouched', async () => {
      const { id, lines } = await seedList(storeA, { lines: true });
      const checked = await update(users.employee, id, lines.m, { isDone: true });
      expect(checked.body).toEqual({ ...itemShape('m', 2, true), id: lines.m });
      const unchecked = await update(users.employee, id, lines.m, { isDone: false });
      expect(unchecked.body).toEqual({ ...itemShape('m', 2, false), id: lines.m });
      expect((await lineRows(id))[1]).toMatchObject({ quantity_requested: 2, is_done: false });
    });

    it('both fields at once; the line’s updated_at moves, the list row is not touched', async () => {
      const { id, lines } = await seedList(storeA, { lines: true });
      const [before] = await admin`select updated_at from replenishment_lists where id = ${id}`;
      const lineBefore = (await lineRows(id))[1]!;
      const res = await update(users.employee, id, lines.m, { quantity: 9, isDone: true });
      expect(res.body).toEqual({ ...itemShape('m', 9, true), id: lines.m });
      const lineAfter = (await lineRows(id))[1]!;
      expect(lineAfter).toMatchObject({ quantity_requested: 9, is_done: true });
      expect((lineAfter.updated_at as Date).getTime()).toBeGreaterThan((lineBefore.updated_at as Date).getTime());
      const [after] = await admin`select updated_at from replenishment_lists where id = ${id}`;
      expect(after!.updated_at).toEqual(before!.updated_at);
    });

    it('empty body, bad values and any other key → 400, nothing changed', async () => {
      const { id, lines } = await seedList(storeA, { lines: true });
      expectValidationError(await update(users.employee, id, lines.m, {}));
      for (const quantity of [0, 10000, 2.5, '3', null]) {
        expectValidationError(await update(users.employee, id, lines.m, { quantity }), 'quantity');
      }
      expectValidationError(await update(users.employee, id, lines.m, { isDone: 'yes' }), 'isDone');
      for (const [key, value] of [
        ['sizeId', sizes.l.id],
        ['tenantId', storeB],
        ['is_available', false],
      ] as const) {
        expectValidationError(await update(users.employee, id, lines.m, { isDone: true, [key]: value }), key);
      }
      expectValidationError(await update(users.employee, id, lines.m, { isDone: true }).query({ x: '1' }));
      expect((await lineRows(id))[1]).toMatchObject({ size_id: sizes.m.id, quantity_requested: 2, is_done: false });
    });

    it('an unknown line or another list’s line → 404 "Item not found", the other line untouched', async () => {
      const { id } = await seedList(storeA, { lines: true });
      const other = await seedList(storeA, { lines: true });
      for (const itemId of [randomUUID(), other.lines.m]) {
        const res = await update(users.employee, id, itemId, { isDone: true });
        expect(res.status).toBe(404);
        expect(res.body).toEqual(ITEM_NOT_FOUND);
      }
      expect((await lineRows(other.id))[1]).toMatchObject({ is_done: false });
    });

    it('unknown or another store’s list → "List not found", the foreign line untouched; malformed ids → 400', async () => {
      const foreign = await seedList(storeB, { lines: true });
      for (const listId of [randomUUID(), foreign.id]) {
        const res = await update(users.employee, listId, foreign.lines.m, { quantity: 8 });
        expect(res.status).toBe(404);
        expect(res.body).toEqual(LIST_NOT_FOUND);
      }
      expect((await lineRows(foreign.id))[1]).toMatchObject({ quantity_requested: 2 });
      expectValidationError(await update(users.employee, foreign.id, 'nope', { quantity: 8 }), 'itemId');
      expectValidationError(await update(users.employee, 'nope', foreign.lines.m, { quantity: 8 }), 'id');
    });
  });

  describe('DELETE /replenishment-lists/:id/items/:itemId', () => {
    it('without a session → 401', async () => {
      const res = await request(app).delete(`${URL}/${randomUUID()}/items/${randomUUID()}`);
      expect(res.status).toBe(401);
    });

    it('is served under the shop-floor limiter', async () => {
      const { id, lines } = await seedList(storeA, { lines: true });
      const res = await remove(users.employee, id, lines.m);
      expect(res.status).toBe(204);
      expect(res.headers['ratelimit-limit']).toBe('120');
    });

    it('enforces replenishment:manage: a session without it → uniform 403, nothing removed', async () => {
      const { id, lines } = await seedList(storeA, { lines: true });
      narrowed.manage = true;
      try {
        const res = await remove(users.employee, id, lines.m);
        expect(res.status).toBe(403);
        expect(res.body).toEqual(FORBIDDEN);
      } finally {
        narrowed.manage = false;
      }
      expect(await lineRows(id)).toHaveLength(2);
    });

    it('removes the line → 204; the rest of the list and the assortment stay; a second DELETE → 404', async () => {
      const { id, lines } = await seedList(storeA, { lines: true });
      const res = await remove(users.employee, id, lines.m);
      expect(res.status).toBe(204);
      expect(res.text).toBe('');
      expect((await lineRows(id)).map((row) => row.id)).toEqual([lines.s]);
      expect(
        await admin`select 1 from assortment_items where tenant_id = ${storeA} and size_id = ${sizes.m.id}`,
      ).toHaveLength(1);

      const again = await remove(users.employee, id, lines.m);
      expect(again.status).toBe(404);
      expect(again.body).toEqual(ITEM_NOT_FOUND);
      // The size can be re-added (the "Undo" path), starting unchecked.
      const readded = await add(users.employee, id, { sizeId: sizes.m.id, quantity: 2 });
      expect(readded.body).toEqual(itemShape('m', 2, false));
    });

    it('another list’s line → 404 "Item not found", nothing removed', async () => {
      const { id } = await seedList(storeA, { lines: true });
      const other = await seedList(storeA, { lines: true });
      const res = await remove(users.employee, id, other.lines.s);
      expect(res.status).toBe(404);
      expect(res.body).toEqual(ITEM_NOT_FOUND);
      expect(await lineRows(other.id)).toHaveLength(2);
    });

    it('unknown or another store’s list → "List not found", the foreign line untouched', async () => {
      const foreign = await seedList(storeB, { lines: true });
      for (const listId of [randomUUID(), foreign.id]) {
        const res = await remove(users.employee, listId, foreign.lines.s);
        expect(res.status).toBe(404);
        expect(res.body).toEqual(LIST_NOT_FOUND);
      }
      expect(await lineRows(foreign.id)).toHaveLength(2);
      expect((await remove(users.employeeB, foreign.id, foreign.lines.s)).status).toBe(204);
    });
  });
});
