import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../app.js';
import { env } from '../../config/env.js';

// Sub-task 8.1 — RF-14 `POST /categories`, `PATCH /categories/:id`:
// `catalog:manage`, global router (no tenantContext), write limiter. Slugs
// generated from the name (RN-10), a slug collision is a 409, the slug never
// changes on rename; there is no delete endpoint. Requires the local Supabase
// stack.
const adminUrl = process.env.MIGRATIONS_DATABASE_URL;
if (!adminUrl) {
  throw new Error('MIGRATIONS_DATABASE_URL is not set — run `supabase start` and set up apps/api/.env first');
}
const admin = postgres(adminUrl);
const authAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const PASSWORD = `categories-write-${randomUUID()}`;
const token = `cw${randomUUID().slice(0, 8)}`;
// The store the manager/employee fixtures belong to.
const store = { id: randomUUID(), name: `${token} Store`, slug: `${token}-store` };
// Categories created through the API, deleted in afterAll.
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
  // PUT /categories/order goes out as a third one, for the same reason.
  orderer: { role: 'platform_admin', tenantId: null, id: '', token: '' },
  manager: { role: 'manager', tenantId: store.id, id: '', token: '' },
  employee: { role: 'employee', tenantId: store.id, id: '', token: '' },
};

const FORBIDDEN = { error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action' } };
const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Category not found' } };

function auth(req: request.Test, user: Fixture): request.Test {
  return req.set('Authorization', `Bearer ${user.token}`);
}

async function create(body: object, user: Fixture = users.admin) {
  const res = await auth(request(app).post('/api/v1/categories'), user).send(body);
  if (res.status === 201) created.push(res.body.id);
  return res;
}

function patch(id: string, body: object, user: Fixture = users.editor) {
  return auth(request(app).patch(`/api/v1/categories/${id}`), user).send(body);
}

function reorder(body: object, user: Fixture = users.orderer) {
  return auth(request(app).put('/api/v1/categories/order'), user).send(body);
}

/** Every stored category id, in display order (RF-45) — the whole set, as the endpoint requires. */
async function storedOrder(): Promise<string[]> {
  const rows = await admin<{ id: string }[]>`select id from categories order by position, name, id`;
  return rows.map((row) => row.id);
}

/**
 * Sends the current order with `move` placed right before `before`. Categories are global and other
 * suites create theirs concurrently, so a 409 for a set that changed meanwhile is retried on a fresh read.
 * Everything else keeps its relative order, so other suites' assertions are unaffected.
 */
async function moveBefore(move: string, before: string) {
  for (let attempt = 0; ; attempt++) {
    const ids = (await storedOrder()).filter((id) => id !== move);
    ids.splice(ids.indexOf(before), 0, move);
    const res = await reorder({ ids });
    if (res.status !== 409 || attempt === 4) return { res, ids };
  }
}

describe('categories writes (RF-14)', () => {
  beforeAll(async () => {
    await admin`insert into tenants (id, name, slug) values (${store.id}, ${store.name}, ${store.slug})`;
    const signIn = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    for (const [key, user] of Object.entries(users)) {
      const email = `categories-write-${key}-${randomUUID()}@repma.test`;
      const result = await authAdmin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
      if (result.error) throw result.error;
      user.id = result.data.user.id;
      await admin`
        insert into user_profiles (id, email, full_name, role, tenant_id)
        values (${user.id}, ${email}, ${`Categories write ${key}`}, ${user.role}, ${user.tenantId})
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
    await admin`delete from user_profiles where id in ${admin(ids)}`;
    for (const id of ids) await authAdmin.auth.admin.deleteUser(id);
    await admin`delete from tenants where id = ${store.id}`;
    if (created.length > 0) await admin`delete from categories where id in ${admin(created)}`;
    await admin.end();
  });

  describe('access', () => {
    it('without a session → 401 on both routes', async () => {
      expect((await request(app).post('/api/v1/categories').send({ name: 'x' })).status).toBe(401);
      expect((await request(app).patch(`/api/v1/categories/${randomUUID()}`).send({ name: 'x' })).status).toBe(401);
    });

    it.each(['manager', 'employee'] as const)('%s (no catalog:manage) → uniform 403, nothing written', async (role) => {
      const target = (await create({ name: `${token} Guarded ${role}` })).body;
      for (const res of [
        await create({ name: `${token} Forbidden ${role}` }, users[role]),
        await patch(target.id, { name: `${token} Hijacked` }, users[role]),
      ]) {
        expect(res.status).toBe(403);
        expect(res.body).toEqual(FORBIDDEN);
      }
      const rows = await admin`select name from categories where name like ${`${token} %`}`;
      expect(rows.map((row) => row.name)).not.toContain(`${token} Forbidden ${role}`);
      expect(rows.map((row) => row.name)).not.toContain(`${token} Hijacked`);
    });

    it('POST and PATCH ride the write limiter — without any X-Tenant-Id', async () => {
      const post = await create({ name: `${token} Limiter` });
      expect(post.status).toBe(201);
      expect(post.headers['ratelimit-limit']).toBe('30');

      const write = await patch(post.body.id, { name: `${token} Limiter` });
      expect(write.status).toBe(200);
      expect(write.headers['ratelimit-limit']).toBe('30');
    });

    it('there is no delete endpoint (RF-14) → 404, the category survives', async () => {
      const target = (await create({ name: `${token} Undeletable` })).body;
      const res = await auth(request(app).delete(`/api/v1/categories/${target.id}`), users.editor);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(await admin`select id from categories where id = ${target.id}`).toHaveLength(1);
    });
  });

  describe('POST /categories', () => {
    it('201 with the new category: trimmed name, slug generated from it, trimmed description', async () => {
      const res = await create({ name: `  ${token} Trail  Running  `, description: '  Off-road shoes. ' });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id: expect.any(String),
        name: `${token} Trail  Running`,
        slug: `${token}-trail-running`,
        description: 'Off-road shoes.',
      });
      const [row] = await admin`select name, slug, description from categories where id = ${res.body.id}`;
      expect(row).toEqual({ name: `${token} Trail  Running`, slug: `${token}-trail-running`, description: 'Off-road shoes.' });
    });

    it('the description is optional; blank is stored as null', async () => {
      const bare = await create({ name: `${token} Bare` });
      expect(bare.status).toBe(201);
      expect(bare.body.description).toBeNull();
      const blank = await create({ name: `${token} Blank`, description: '   ' });
      expect(blank.body.description).toBeNull();
    });

    it('the new category appears in GET /categories in the same shape', async () => {
      const res = await create({ name: `${token} Listed`, description: 'Shown' });
      const list = await auth(request(app).get('/api/v1/categories'), users.employee).query({ pageSize: '100' });
      expect(list.body.items).toContainEqual(res.body);
    });

    it('an equivalent name (same slug) → 409 CONFLICT, nothing created', async () => {
      expect((await create({ name: `${token} Twin Category` })).status).toBe(201);
      const res = await create({ name: `${token.toUpperCase()} — twin   CATEGORY!` });
      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error: { code: 'CONFLICT', message: 'A category with an equivalent name already exists' },
      });
      expect(await admin`select id from categories where slug = ${`${token}-twin-category`}`).toHaveLength(1);
    });

    it('a name with nothing to build a slug from → 400 on name', async () => {
      const res = await create({ name: '!!! ---' });
      expect(res.status).toBe(400);
      expect(res.body.error).toEqual({
        code: 'VALIDATION_ERROR',
        message: 'Invalid request',
        details: [{ path: 'name', message: 'Name must contain letters or numbers' }],
      });
    });

    it.each([
      ['a missing name', {}],
      ['a blank name', { name: '   ' }],
      ['an over-long name', { name: 'x'.repeat(121) }],
      ['a non-string name', { name: 42 }],
      ['an over-long description', { name: `${token} Long`, description: 'x'.repeat(501) }],
      ['a client-chosen slug', { name: `${token} Slug`, slug: 'mine' }],
    ])('rejects %s → 400 VALIDATION_ERROR', async (_label, body) => {
      const res = await create(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a query parameter → 400', async () => {
      const res = await auth(request(app).post('/api/v1/categories').query({ x: '1' }), users.admin).send({
        name: `${token} Query`,
      });
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /categories/:id', () => {
    it('renames: 200 with the updated category, slug unchanged', async () => {
      const category = (await create({ name: `${token} Before`, description: 'Kept' }, users.editor)).body;
      const res = await patch(category.id, { name: `  ${token} After  ` });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ...category, name: `${token} After` });
    });

    it('edits the description; null or blank clears it', async () => {
      const category = (await create({ name: `${token} Described` }, users.editor)).body;
      const set = await patch(category.id, { description: 'Now described' });
      expect(set.body).toEqual({ ...category, description: 'Now described' });
      expect((await patch(category.id, { description: null })).body.description).toBeNull();
      await patch(category.id, { description: 'Again' });
      expect((await patch(category.id, { description: ' ' })).body.description).toBeNull();
    });

    it('renaming to a name whose slug another category holds is fine — the slug is not regenerated', async () => {
      const category = (await create({ name: `${token} Rename Source` }, users.editor)).body;
      await create({ name: `${token} Rename Target` }, users.editor);
      const res = await patch(category.id, { name: `${token} Rename Target` });
      expect(res.status).toBe(200);
      expect(res.body.slug).toBe(`${token}-rename-source`);
    });

    it('an unknown id → 404 "Category not found"', async () => {
      const res = await patch(randomUUID(), { name: `${token} Ghost` });
      expect(res.status).toBe(404);
      expect(res.body).toEqual(NOT_FOUND);
    });

    it.each([
      ['an empty body', {}],
      ['a blank name', { name: ' ' }],
      ['an over-long name', { name: 'x'.repeat(121) }],
      ['a non-string description', { description: 3 }],
      ['a slug', { slug: 'new-slug' }],
    ])('rejects %s → 400 VALIDATION_ERROR', async (_label, body) => {
      const res = await patch(randomUUID(), body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('a malformed id or a query parameter → 400', async () => {
      expect((await patch('not-a-uuid', { name: `${token} X` })).status).toBe(400);
      const res = await auth(request(app).patch(`/api/v1/categories/${randomUUID()}`).query({ x: '1' }), users.editor).send({
        name: `${token} X`,
      });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /categories/order (RF-45)', () => {
    it('204: the categories come back from GET /categories in the new order', async () => {
      const first = (await create({ name: `${token} Order A` })).body;
      const second = (await create({ name: `${token} Order B` })).body;
      // A new category goes last.
      const order = await storedOrder();
      expect(order.indexOf(second.id)).toBeGreaterThan(order.indexOf(first.id));

      const { res, ids } = await moveBefore(second.id, first.id);
      expect(res.status).toBe(204);
      expect(res.headers['ratelimit-limit']).toBe('30');
      const positions = await admin<{ id: string; position: number }[]>`
        select id, position from categories where id in ${admin([first.id, second.id])}
      `;
      const position = (id: string) => positions.find((p) => p.id === id)!.position;
      expect(position(second.id)).toBe(ids.indexOf(second.id));
      expect(position(first.id)).toBe(position(second.id) + 1);

      const list = await auth(request(app).get('/api/v1/categories').query({ pageSize: 100 }), users.manager);
      const listed = list.body.items.map((c: { id: string }) => c.id);
      expect(listed.indexOf(second.id)).toBeLessThan(listed.indexOf(first.id));
    });

    it('a set that is not exactly the stored categories → 409, nothing changes', async () => {
      const before = await storedOrder();
      for (const ids of [before.slice(1), [...before.slice(1), randomUUID()]]) {
        const res = await reorder({ ids: [...ids].reverse() });
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('CONFLICT');
      }
      expect(await storedOrder()).toEqual(expect.arrayContaining(before));
    });

    it.each([
      ['an empty list', { ids: [] }],
      ['a repeated id', { ids: [randomUUID(), randomUUID()].flatMap((id) => [id, id]) }],
      ['a malformed id', { ids: ['nope'] }],
      ['an unknown key', { ids: [randomUUID()], extra: 1 }],
    ])('rejects %s → 400 VALIDATION_ERROR', async (_label, body) => {
      const res = await reorder(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it.each(['manager', 'employee'] as const)('%s (no catalog:manage) → 403', async (role) => {
      const res = await reorder({ ids: await storedOrder() }, users[role]);
      expect(res.status).toBe(403);
      expect(res.body).toEqual(FORBIDDEN);
    });
  });
});
