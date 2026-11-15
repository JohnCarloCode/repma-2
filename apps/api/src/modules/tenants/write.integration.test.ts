import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../app.js';
import { env } from '../../config/env.js';

// Sub-task 7.1 — RF-07/RF-08 `POST /tenants`, `GET /tenants/:id`,
// `PATCH /tenants/:id`: `tenant:manage`, global router (no tenantContext),
// write limiter on POST/PATCH, read limiter on GET. Slugs generated from the
// name (RN-10), a slug collision is a 409, the slug never changes on rename.
// RF-05 end to end: deactivating a store locks its users out on their next
// request; reactivating lets them back in. Requires the local Supabase stack.
const adminUrl = process.env.MIGRATIONS_DATABASE_URL;
if (!adminUrl) {
  throw new Error('MIGRATIONS_DATABASE_URL is not set — run `supabase start` and set up apps/api/.env first');
}
const admin = postgres(adminUrl);
const authAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const PASSWORD = `tenants-write-${randomUUID()}`;
const token = `tw${randomUUID().slice(0, 8)}`;
// The store the manager/employee fixtures belong to (RF-05 target).
const home = { id: randomUUID(), name: `${token} Home`, slug: `${token}-home` };
// Stores created through the API, deleted in afterAll.
const created: string[] = [];

interface Fixture {
  role: 'platform_admin' | 'manager' | 'employee';
  tenantId: string | null;
  id: string;
  token: string;
}
const users: Record<'admin' | 'editor' | 'manager' | 'employee', Fixture> = {
  admin: { role: 'platform_admin', tenantId: null, id: '', token: '' },
  // The write limiter is real (30/min per user): PATCH calls go out as a
  // second Platform Admin so POST and PATCH suites never share a bucket.
  editor: { role: 'platform_admin', tenantId: null, id: '', token: '' },
  manager: { role: 'manager', tenantId: home.id, id: '', token: '' },
  employee: { role: 'employee', tenantId: home.id, id: '', token: '' },
};

const FORBIDDEN = { error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action' } };
const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Store not found' } };

function auth(req: request.Test, user: Fixture): request.Test {
  return req.set('Authorization', `Bearer ${user.token}`);
}

async function create(name: unknown, user: Fixture = users.admin) {
  const res = await auth(request(app).post('/api/v1/tenants'), user).send({ name });
  if (res.status === 201) created.push(res.body.id);
  return res;
}

function get(id: string, user: Fixture = users.admin) {
  return auth(request(app).get(`/api/v1/tenants/${id}`), user);
}

function patch(id: string, body: object, user: Fixture = users.editor) {
  return auth(request(app).patch(`/api/v1/tenants/${id}`), user).send(body);
}

describe('tenants writes (RF-07/RF-08)', () => {
  beforeAll(async () => {
    await admin`insert into tenants (id, name, slug) values (${home.id}, ${home.name}, ${home.slug})`;
    const signIn = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    for (const [key, user] of Object.entries(users)) {
      const email = `tenants-write-${key}-${randomUUID()}@repma.test`;
      const result = await authAdmin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
      if (result.error) throw result.error;
      user.id = result.data.user.id;
      await admin`
        insert into user_profiles (id, email, full_name, role, tenant_id)
        values (${user.id}, ${email}, ${`Tenants write ${key}`}, ${user.role}, ${user.tenantId})
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
    await admin`delete from tenants where id in ${admin([home.id, ...created])}`;
    await admin.end();
  });

  describe('access', () => {
    it('without a session → 401 on every route', async () => {
      expect((await request(app).post('/api/v1/tenants').send({ name: 'x' })).status).toBe(401);
      expect((await request(app).get(`/api/v1/tenants/${home.id}`)).status).toBe(401);
      expect((await request(app).patch(`/api/v1/tenants/${home.id}`).send({ name: 'x' })).status).toBe(401);
    });

    it.each(['manager', 'employee'] as const)('%s (no tenant:manage) → uniform 403 on every route', async (role) => {
      // Even on the user's own store: GET /tenants/:id is not a store-role read.
      for (const res of [
        await create(`${token} Forbidden`, users[role]),
        await get(home.id, users[role]),
        await patch(home.id, { isActive: false }, users[role]),
      ]) {
        expect(res.status).toBe(403);
        expect(res.body).toEqual(FORBIDDEN);
      }
      const [row] = await admin`select is_active from tenants where id = ${home.id}`;
      expect(row!.is_active).toBe(true);
    });

    it('POST and PATCH ride the write limiter, GET the read limiter — without any X-Tenant-Id', async () => {
      const post = await create(`${token} Limiter`);
      expect(post.status).toBe(201);
      expect(post.headers['ratelimit-limit']).toBe('30');

      const read = await get(post.body.id);
      expect(read.status).toBe(200);
      expect(read.headers['ratelimit-limit']).toBe('100');

      const write = await patch(post.body.id, { name: `${token} Limiter` });
      expect(write.status).toBe(200);
      expect(write.headers['ratelimit-limit']).toBe('30');
    });
  });

  describe('POST /tenants', () => {
    it('201 with the new store: trimmed name, slug generated from it, active', async () => {
      const res = await create(`  ${token} Café  Málaga  `);
      expect(res.status).toBe(201);
      const [row] = await admin`select name, slug, is_active, created_at from tenants where id = ${res.body.id}`;
      expect(res.body).toEqual({
        id: expect.any(String),
        name: `${token} Café  Málaga`,
        slug: `${token}-cafe-malaga`,
        isActive: true,
        createdAt: (row!.created_at as Date).toISOString(),
      });
      expect(row).toMatchObject({ name: `${token} Café  Málaga`, slug: `${token}-cafe-malaga`, is_active: true });
    });

    it('the new store appears in GET /tenants', async () => {
      const res = await create(`${token} Listed`);
      const list = await auth(request(app).get('/api/v1/tenants'), users.admin).query({ search: `${token} Listed` });
      expect(list.body.items).toEqual([res.body]);
    });

    it('an equivalent name (same slug) → 409 CONFLICT, nothing created', async () => {
      const first = await create(`${token} Twin Store`);
      expect(first.status).toBe(201);
      const res = await create(`${token.toUpperCase()} — twin   STORE!`);
      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error: { code: 'CONFLICT', message: 'A store with an equivalent name already exists' },
      });
      const rows = await admin`select id from tenants where slug = ${`${token}-twin-store`}`;
      expect(rows).toHaveLength(1);
    });

    it('a name with nothing to build a slug from → 400 on name', async () => {
      const res = await create('!!! ---');
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
      ['a client-chosen slug', { name: `${token} Slug`, slug: 'mine' }],
      ['an isActive key', { name: `${token} Inactive`, isActive: false }],
    ])('rejects %s → 400 VALIDATION_ERROR', async (_label, body) => {
      const res = await auth(request(app).post('/api/v1/tenants'), users.admin).send(body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a query parameter → 400', async () => {
      const res = await auth(request(app).post('/api/v1/tenants').query({ x: '1' }), users.admin).send({
        name: `${token} Query`,
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /tenants/:id', () => {
    it('200 with the store in the list shape', async () => {
      const res = await get(home.id);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: home.id,
        name: home.name,
        slug: home.slug,
        isActive: true,
        createdAt: expect.any(String),
      });
    });

    it('an unknown id → 404 "Store not found"', async () => {
      const res = await get(randomUUID());
      expect(res.status).toBe(404);
      expect(res.body).toEqual(NOT_FOUND);
    });

    it('a malformed id or a query parameter → 400', async () => {
      expect((await get('not-a-uuid')).status).toBe(400);
      expect((await get(home.id).query({ x: '1' })).status).toBe(400);
    });
  });

  describe('PATCH /tenants/:id', () => {
    it('renames: 200 with the updated store, slug unchanged', async () => {
      const store = (await create(`${token} Before`)).body;
      const res = await patch(store.id, { name: `  ${token} After  ` });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ...store, name: `${token} After` });
    });

    it('renaming to a name whose slug another store holds is fine — the slug is not regenerated', async () => {
      const store = (await create(`${token} Rename Source`)).body;
      await create(`${token} Rename Target`);
      const res = await patch(store.id, { name: `${token} Rename Target` });
      expect(res.status).toBe(200);
      expect(res.body.slug).toBe(`${token}-rename-source`);
    });

    it('deactivates and reactivates; inactive stores stay readable', async () => {
      const store = (await create(`${token} Toggle`)).body;
      const off = await patch(store.id, { isActive: false });
      expect(off.status).toBe(200);
      expect(off.body).toEqual({ ...store, isActive: false });
      expect((await get(store.id)).body.isActive).toBe(false);

      const on = await patch(store.id, { isActive: true });
      expect(on.body).toEqual(store);
    });

    it('name and isActive together', async () => {
      const store = (await create(`${token} Both`)).body;
      const res = await patch(store.id, { name: `${token} Both Renamed`, isActive: false });
      expect(res.body).toEqual({ ...store, name: `${token} Both Renamed`, isActive: false });
    });

    it('an unknown id → 404 "Store not found"', async () => {
      const res = await patch(randomUUID(), { isActive: false });
      expect(res.status).toBe(404);
      expect(res.body).toEqual(NOT_FOUND);
    });

    it.each([
      ['an empty body', {}],
      ['a blank name', { name: ' ' }],
      ['an over-long name', { name: 'x'.repeat(121) }],
      ['a non-boolean isActive', { isActive: 'false' }],
      ['a slug', { slug: 'new-slug' }],
      ['the snake_case is_active', { is_active: false }],
    ])('rejects %s → 400 VALIDATION_ERROR', async (_label, body) => {
      const res = await patch(home.id, body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('a malformed id → 400', async () => {
      expect((await patch('not-a-uuid', { isActive: true })).status).toBe(400);
    });
  });

  describe('RF-05 end to end: store suspension', () => {
    function me(user: Fixture) {
      return auth(request(app).get('/api/v1/auth/me'), user);
    }

    it("deactivating a store locks its users out on their next request; reactivating lets them back in", async () => {
      expect((await me(users.manager)).status).toBe(200);
      expect((await auth(request(app).get('/api/v1/home/summary'), users.employee)).status).toBe(200);

      expect((await patch(home.id, { isActive: false })).status).toBe(200);
      for (const user of [users.manager, users.employee]) {
        const res = await me(user);
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('UNAUTHENTICATED');
        expect((await auth(request(app).get('/api/v1/home/summary'), user)).status).toBe(401);
      }
      // The Platform Admin is unaffected.
      expect((await me(users.admin)).status).toBe(200);

      expect((await patch(home.id, { isActive: true })).status).toBe(200);
      expect((await me(users.manager)).status).toBe(200);
      expect((await auth(request(app).get('/api/v1/home/summary'), users.employee)).status).toBe(200);
    });
  });
});
