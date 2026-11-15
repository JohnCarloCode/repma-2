import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { app } from '../../app.js';
import { env } from '../../config/env.js';

// Sub-task 4.3 — RF-27 `POST /replenishment-lists`, RF-30 `PATCH
// /replenishment-lists/:id`, RF-29 `DELETE /replenishment-lists/:id`:
// `replenishment:manage`, write limiter, tenantContext (+ RLS), strict bodies
// with no generated origin (DP-06), free status transitions, the item cascade
// (RN-09) and the uniform 404 for unknown/foreign lists (RN-03). Requires the
// local Supabase stack. Both stores are this file's own.

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

const PASSWORD = `repl-write-${randomUUID()}`;
const token = `rplw${randomUUID().slice(0, 8)}`;
const storeA = randomUUID();
const storeB = randomUUID();
const category = { id: randomUUID(), name: `${token} Apparel` };
const product = { id: randomUUID(), name: `${token} Field Jacket` };
const sizes = {
  s: { id: randomUUID(), label: 'S', sku: `${token}-S`, position: 0 },
  m: { id: randomUUID(), label: 'M', sku: `${token}-M`, position: 1 },
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
  admin: user('platform_admin', null, 'Repl-w admin'),
  manager: user('manager', storeA, 'Repl-w manager'),
  employee: user('employee', storeA, 'Repl-w employee'),
  // The write limiter is real (30/min per user): each route's suite acts as
  // its own store-A employee so the three never share a bucket.
  editor: user('employee', storeA, 'Repl-w editor'),
  deleter: user('employee', storeA, 'Repl-w deleter'),
  employeeB: user('employee', storeB, 'Repl-w employee B'),
};

const FORBIDDEN = { error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action' } };
const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'List not found' } };
const URL = '/api/v1/replenishment-lists';

function as<T extends request.Test>(req: T, who: Fixture, tenantHeader?: string): T {
  req.set('Authorization', `Bearer ${who.token}`);
  return tenantHeader === undefined ? req : (req.set('X-Tenant-Id', tenantHeader) as T);
}
const create = (who: Fixture, body: unknown, tenantHeader?: string) =>
  as(request(app).post(URL), who, tenantHeader).send(body as object);
const update = (who: Fixture, id: string, body: unknown, tenantHeader?: string) =>
  as(request(app).patch(`${URL}/${id}`), who, tenantHeader).send(body as object);
const remove = (who: Fixture, id: string, tenantHeader?: string) =>
  as(request(app).delete(`${URL}/${id}`), who, tenantHeader);

// A list inserted through the admin connection, optionally with lines (one
// per store-A size): the PATCH/DELETE targets.
async function seedList(
  tenantId: string,
  options: { status?: 'draft' | 'processing' | 'done'; notes?: string | null; lines?: boolean } = {},
): Promise<string> {
  const id = randomUUID();
  await admin`
    insert into replenishment_lists (id, tenant_id, name, status, notes, created_by)
    values (${id}, ${tenantId}, ${`${token} seeded`}, ${options.status ?? 'draft'}, ${options.notes ?? null},
            ${tenantId === storeA ? users.manager.id : users.employeeB.id})
  `;
  if (options.lines) {
    for (const [i, s] of [sizes.s, sizes.m].entries()) {
      await admin`
        insert into replenishment_list_items (tenant_id, list_id, size_id, quantity_requested, is_done)
        values (${tenantId}, ${id}, ${s.id}, ${i + 1}, ${i === 0})
      `;
    }
  }
  return id;
}

async function listRow(id: string) {
  const [row] = await admin`
    select tenant_id, name, status, notes, created_by, created_at, updated_at
    from replenishment_lists where id = ${id}
  `;
  return row;
}
async function itemCount(id: string): Promise<number> {
  const [row] = await admin`select count(*)::int as n from replenishment_list_items where list_id = ${id}`;
  return row!.n as number;
}

function expectValidationError(res: request.Response, path?: string) {
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('VALIDATION_ERROR');
  if (path !== undefined) {
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(path);
  }
}

describe('replenishment lists — write (RF-27, RF-29, RF-30)', () => {
  beforeAll(async () => {
    await admin`
      insert into tenants (id, name, slug) values
        (${storeA}, 'Repl-w A', ${`repl-w-a-${storeA}`}),
        (${storeB}, 'Repl-w B', ${`repl-w-b-${storeB}`})
    `;
    await admin`insert into categories (id, name, slug) values (${category.id}, ${category.name}, ${`replw-${category.id}`})`;
    await admin`insert into products (id, name, category_id) values (${product.id}, ${product.name}, ${category.id})`;
    for (const s of Object.values(sizes)) {
      await admin`
        insert into product_sizes (id, product_id, label, sku, position)
        values (${s.id}, ${product.id}, ${s.label}, ${s.sku}, ${s.position})
      `;
      for (const tenantId of [storeA, storeB]) {
        await admin`insert into assortment_items (tenant_id, size_id) values (${tenantId}, ${s.id})`;
      }
    }

    const signIn = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    for (const [key, fixture] of Object.entries(users)) {
      const email = `replw-${key}-${randomUUID()}@repma.test`;
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
    await admin`delete from assortment_items where tenant_id in ${admin([storeA, storeB])}`;
    await admin`delete from user_profiles where id in ${admin(userIds)}`;
    for (const id of userIds) await authAdmin.auth.admin.deleteUser(id);
    await admin`delete from tenants where id in ${admin([storeA, storeB])}`;
    await admin`delete from product_sizes where product_id = ${product.id}`;
    await admin`delete from products where id = ${product.id}`;
    await admin`delete from categories where id = ${category.id}`;
    await admin.end();
  });

  describe('POST /replenishment-lists', () => {
    it('without a session → 401', async () => {
      const res = await request(app).post(URL).send({ name: 'x' });
      expect(res.status).toBe(401);
    });

    it('is served under the write limiter', async () => {
      const res = await create(users.employee, { name: `${token} limiter` });
      expect(res.status).toBe(201);
      expect(res.headers['ratelimit-limit']).toBe('30');
    });

    it('enforces replenishment:manage: a session without it → uniform 403, nothing created', async () => {
      narrowed.manage = true;
      try {
        const name = `${token} forbidden`;
        const res = await create(users.employee, { name });
        expect(res.status).toBe(403);
        expect(res.body).toEqual(FORBIDDEN);
        expect(await admin`select 1 from replenishment_lists where name = ${name}`).toHaveLength(0);
      } finally {
        narrowed.manage = false;
      }
    });

    it('creates an empty draft list in the active store, authored by the caller → 201 detail shape', async () => {
      const res = await create(users.employee, { name: `  ${token} Morning run  `, notes: '  Back wall first ' });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id: expect.any(String),
        name: `${token} Morning run`,
        status: 'draft',
        notes: 'Back wall first',
        createdAt: expect.any(String),
        creatorName: users.employee.fullName,
        items: [],
      });
      expect(new Date(res.body.createdAt).toISOString()).toBe(res.body.createdAt);
      const row = await listRow(res.body.id);
      expect(row).toMatchObject({ tenant_id: storeA, created_by: users.employee.id, status: 'draft' });

      const detail = await as(request(app).get(`${URL}/${res.body.id}`), users.manager);
      expect(detail.body).toEqual(res.body);
    });

    it('notes are optional; blank or null notes are stored as null', async () => {
      for (const body of [{}, { notes: '   ' }, { notes: null }]) {
        const res = await create(users.manager, { name: `${token} notes`, ...body });
        expect(res.status).toBe(201);
        expect(res.body.notes).toBeNull();
        expect((await listRow(res.body.id))!.notes).toBeNull();
      }
    });

    it('name is required, non-blank and at most 120 characters; notes at most 2000', async () => {
      expectValidationError(await create(users.employee, {}), 'name');
      expectValidationError(await create(users.employee, { name: '   ' }), 'name');
      expectValidationError(await create(users.employee, { name: 42 }), 'name');
      expectValidationError(await create(users.employee, { name: 'x'.repeat(121) }), 'name');
      expectValidationError(await create(users.employee, { name: 'ok', notes: 'x'.repeat(2001) }), 'notes');
      expect((await create(users.employee, { name: 'x'.repeat(120) })).status).toBe(201);
    });

    it('has no generated origin (DP-06): any origin/generation key or query param → 400', async () => {
      for (const key of ['origin', 'fromOutOfStock', 'generate', 'source']) {
        expectValidationError(await create(users.employee, { name: `${token} gen`, [key]: true }), key);
      }
      expectValidationError(await create(users.employee, { name: `${token} gen` }).query({ from: 'availability' }));
      expect(await admin`select 1 from replenishment_lists where name = ${`${token} gen`}`).toHaveLength(0);
    });

    it('takes no status, store, author or item from the body → 400', async () => {
      const name = `${token} extra`;
      expectValidationError(await create(users.employee, { name, status: 'done' }), 'status');
      expectValidationError(await create(users.employee, { name, tenantId: storeB }), 'tenantId');
      expectValidationError(await create(users.employee, { name, createdBy: users.manager.id }), 'createdBy');
      expectValidationError(await create(users.employee, { name, items: [] }), 'items');
      expectValidationError(await create(users.employee, { name, is_available: false }), 'is_available');
    });

    it("another store's X-Tenant-Id → uniform 403", async () => {
      const res = await create(users.employee, { name: `${token} cross` }, storeB);
      expect(res.status).toBe(403);
      expect(res.body).toEqual(FORBIDDEN);
    });

    it('platform_admin without X-Tenant-Id → 400 TENANT_REQUIRED', async () => {
      const res = await create(users.admin, { name: `${token} admin` });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('TENANT_REQUIRED');
    });

    it('platform_admin creates in the store named by X-Tenant-Id, visible only there', async () => {
      const res = await create(users.admin, { name: `${token} admin-made` }, storeB);
      expect(res.status).toBe(201);
      expect(res.body.creatorName).toBe(users.admin.fullName);
      expect((await listRow(res.body.id))!.tenant_id).toBe(storeB);
      expect((await as(request(app).get(`${URL}/${res.body.id}`), users.employeeB)).status).toBe(200);
      expect((await as(request(app).get(`${URL}/${res.body.id}`), users.employee)).status).toBe(404);
    });
  });

  describe('PATCH /replenishment-lists/:id', () => {
    it('without a session → 401', async () => {
      const res = await request(app).patch(`${URL}/${randomUUID()}`).send({ name: 'x' });
      expect(res.status).toBe(401);
    });

    it('is served under the write limiter', async () => {
      const id = await seedList(storeA);
      const res = await update(users.editor, id, { status: 'processing' });
      expect(res.status).toBe(200);
      expect(res.headers['ratelimit-limit']).toBe('30');
    });

    it('enforces replenishment:manage: a session without it → uniform 403, nothing changed', async () => {
      const id = await seedList(storeA);
      narrowed.manage = true;
      try {
        const res = await update(users.editor, id, { status: 'done' });
        expect(res.status).toBe(403);
        expect(res.body).toEqual(FORBIDDEN);
        expect((await listRow(id))!.status).toBe('draft');
      } finally {
        narrowed.manage = false;
      }
    });

    it('renames (trimmed) and returns the whole list in the detail shape, items included', async () => {
      const id = await seedList(storeA, { status: 'processing', notes: 'Keep', lines: true });
      const res = await update(users.editor, id, { name: `  ${token} Renamed ` });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id,
        name: `${token} Renamed`,
        status: 'processing',
        notes: 'Keep',
        creatorName: users.manager.fullName,
      });
      expect(res.body.items).toEqual([
        expect.objectContaining({ sizeId: sizes.s.id, quantity: 1, isDone: true }),
        expect.objectContaining({ sizeId: sizes.m.id, quantity: 2, isDone: false }),
      ]);
      const detail = await as(request(app).get(`${URL}/${id}`), users.editor);
      expect(detail.body).toEqual(res.body);
    });

    it('status transitions are free (RF-30): draft → done → draft → processing', async () => {
      const id = await seedList(storeA);
      for (const status of ['done', 'draft', 'processing'] as const) {
        const res = await update(users.editor, id, { status });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(status);
        expect((await listRow(id))!.status).toBe(status);
      }
    });

    it('sets and clears notes (null or blank → null), touching only the fields sent', async () => {
      const id = await seedList(storeA, { status: 'processing' });
      const set = await update(users.manager, id, { notes: ' Ask for the M first ' });
      expect(set.body).toMatchObject({ notes: 'Ask for the M first', status: 'processing', name: `${token} seeded` });
      expect((await update(users.manager, id, { notes: null })).body.notes).toBeNull();
      await update(users.manager, id, { notes: 'again' });
      expect((await update(users.manager, id, { notes: '  ' })).body.notes).toBeNull();
      expect((await listRow(id))!.notes).toBeNull();
    });

    it('updates several fields at once; updated_at moves, created_at and the author do not', async () => {
      const id = await seedList(storeA);
      const before = (await listRow(id))!;
      const res = await update(users.editor, id, { name: `${token} all`, notes: 'n', status: 'done' });
      expect(res.body).toMatchObject({ name: `${token} all`, notes: 'n', status: 'done' });
      const after = (await listRow(id))!;
      expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
      expect(after.created_at).toEqual(before.created_at);
      expect(after.created_by).toBe(users.manager.id);
    });

    it('an empty body → 400; unknown keys, a bad status and a blank or long name → 400', async () => {
      const id = await seedList(storeA);
      expectValidationError(await update(users.editor, id, {}));
      expectValidationError(await update(users.editor, id, { status: 'archived' }), 'status');
      expectValidationError(await update(users.editor, id, { name: ' ' }), 'name');
      expectValidationError(await update(users.editor, id, { name: null }), 'name');
      expectValidationError(await update(users.editor, id, { name: 'x'.repeat(121) }), 'name');
      expectValidationError(await update(users.editor, id, { notes: 'x'.repeat(2001) }), 'notes');
      for (const key of ['tenantId', 'createdBy', 'createdAt', 'items', 'origin', 'is_available']) {
        expectValidationError(await update(users.editor, id, { status: 'done', [key]: null }), key);
      }
      expectValidationError(await update(users.editor, id, { status: 'done' }).query({ x: '1' }));
      expect((await listRow(id))!.status).toBe('draft');
    });

    it('a malformed id → 400', async () => {
      expectValidationError(await update(users.editor, 'not-a-uuid', { status: 'done' }), 'id');
    });

    it('an unknown id and another store’s list are the same 404 (RN-03); the foreign list is untouched', async () => {
      const unknown = await update(users.editor, randomUUID(), { status: 'done' });
      expect(unknown.status).toBe(404);
      expect(unknown.body).toEqual(NOT_FOUND);
      const foreignId = await seedList(storeB);
      const crossTenant = await update(users.editor, foreignId, { name: 'hijacked', status: 'done' });
      expect(crossTenant.status).toBe(404);
      expect(crossTenant.body).toEqual(NOT_FOUND);
      expect(await listRow(foreignId)).toMatchObject({ name: `${token} seeded`, status: 'draft' });
    });

    it("another store's X-Tenant-Id → uniform 403", async () => {
      const id = await seedList(storeA);
      const res = await update(users.editor, id, { status: 'done' }, storeB);
      expect(res.status).toBe(403);
      expect(res.body).toEqual(FORBIDDEN);
    });

    it('platform_admin: TENANT_REQUIRED without X-Tenant-Id; edits only under the list’s own store', async () => {
      const id = await seedList(storeA);
      const noHeader = await update(users.admin, id, { status: 'done' });
      expect(noHeader.status).toBe(400);
      expect(noHeader.body.error.code).toBe('TENANT_REQUIRED');
      const other = await update(users.admin, id, { status: 'done' }, storeB);
      expect(other.status).toBe(404);
      const own = await update(users.admin, id, { status: 'done' }, storeA);
      expect(own.status).toBe(200);
      expect(own.body.status).toBe('done');
    });
  });

  describe('DELETE /replenishment-lists/:id', () => {
    it('without a session → 401', async () => {
      const res = await request(app).delete(`${URL}/${randomUUID()}`);
      expect(res.status).toBe(401);
    });

    it('is served under the write limiter', async () => {
      const id = await seedList(storeA);
      const res = await remove(users.deleter, id);
      expect(res.status).toBe(204);
      expect(res.headers['ratelimit-limit']).toBe('30');
    });

    it('enforces replenishment:manage: a session without it → uniform 403, list kept', async () => {
      const id = await seedList(storeA, { lines: true });
      narrowed.manage = true;
      try {
        const res = await remove(users.deleter, id);
        expect(res.status).toBe(403);
        expect(res.body).toEqual(FORBIDDEN);
        expect(await listRow(id)).toBeDefined();
        expect(await itemCount(id)).toBe(2);
      } finally {
        narrowed.manage = false;
      }
    });

    it('deletes the list and, in cascade, its items (RN-09) → 204 with no body', async () => {
      const id = await seedList(storeA, { status: 'processing', lines: true });
      const other = await seedList(storeA, { lines: true });
      expect(await itemCount(id)).toBe(2);

      const res = await remove(users.deleter, id);
      expect(res.status).toBe(204);
      expect(res.text).toBe('');
      expect(await listRow(id)).toBeUndefined();
      expect(await itemCount(id)).toBe(0);
      // Only that list's lines go; the sizes and the assortment are untouched.
      expect(await itemCount(other)).toBe(2);
      expect(await admin`select 1 from assortment_items where tenant_id = ${storeA}`).toHaveLength(2);

      const detail = await as(request(app).get(`${URL}/${id}`), users.deleter);
      expect(detail.status).toBe(404);
      const again = await remove(users.deleter, id);
      expect(again.status).toBe(404);
      expect(again.body).toEqual(NOT_FOUND);
    });

    it('an unknown id and another store’s list are the same 404 (RN-03); the foreign list survives', async () => {
      const unknown = await remove(users.deleter, randomUUID());
      expect(unknown.status).toBe(404);
      expect(unknown.body).toEqual(NOT_FOUND);
      const foreignId = await seedList(storeB, { lines: true });
      const crossTenant = await remove(users.deleter, foreignId);
      expect(crossTenant.status).toBe(404);
      expect(crossTenant.body).toEqual(NOT_FOUND);
      expect(await listRow(foreignId)).toBeDefined();
      expect(await itemCount(foreignId)).toBe(2);
    });

    it('a malformed id or any query param → 400', async () => {
      expectValidationError(await remove(users.deleter, 'not-a-uuid'), 'id');
      const id = await seedList(storeA);
      expectValidationError(await remove(users.deleter, id).query({ cascade: 'false' }));
      expect(await listRow(id)).toBeDefined();
    });

    it("another store's X-Tenant-Id → uniform 403", async () => {
      const id = await seedList(storeA);
      const res = await remove(users.deleter, id, storeB);
      expect(res.status).toBe(403);
      expect(res.body).toEqual(FORBIDDEN);
      expect(await listRow(id)).toBeDefined();
    });

    it('platform_admin: TENANT_REQUIRED without X-Tenant-Id; deletes only under the list’s own store', async () => {
      const id = await seedList(storeB, { lines: true });
      const noHeader = await remove(users.admin, id);
      expect(noHeader.status).toBe(400);
      expect(noHeader.body.error.code).toBe('TENANT_REQUIRED');
      expect((await remove(users.admin, id, storeA)).status).toBe(404);
      expect((await remove(users.admin, id, storeB)).status).toBe(204);
      expect(await listRow(id)).toBeUndefined();
      expect(await itemCount(id)).toBe(0);
    });
  });
});
