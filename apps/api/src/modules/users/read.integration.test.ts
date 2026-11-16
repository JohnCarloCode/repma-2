import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../app.js';
import { env } from '../../config/env.js';

// Sub-task 7.2 — RF-09 `GET /users` and `GET /users/:id`: `user:manage`,
// global router (no tenantContext, no X-Tenant-Id), read limiter. `search`
// matches the full name or the denormalized email as a literal substring;
// `tenantId` filters by store. Requires the local Supabase stack.
const adminUrl = process.env.MIGRATIONS_DATABASE_URL;
if (!adminUrl) {
  throw new Error('MIGRATIONS_DATABASE_URL is not set — run `supabase start` and set up apps/api/.env first');
}
const admin = postgres(adminUrl);
const authAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const PASSWORD = `users-read-${randomUUID()}`;
// `token` is in every fixture's full name; `mail` only in their emails.
const token = `ur${randomUUID().slice(0, 8)}`;
const mail = `um${randomUUID().slice(0, 8)}`;
const storeA = { id: randomUUID(), name: `${token} Store A`, slug: `${token}-store-a` };
// Deactivated store: its users stay listed (platform-users.md edge cases).
const storeB = { id: randomUUID(), name: `${token} Store B`, slug: `${token}-store-b` };

interface Fixture {
  role: 'platform_admin' | 'manager' | 'employee';
  tenantId: string | null;
  fullName: string;
  email: string;
  isActive: boolean;
  id: string;
  token: string;
}
function fixture(role: Fixture['role'], tenantId: string | null, name: string, isActive = true): Fixture {
  return { role, tenantId, fullName: `${token} ${name}`, email: `${mail}-${name.toLowerCase()}@repma.test`, isActive, id: '', token: '' };
}
// Names chosen so the alphabetical order is the declaration order.
const users = {
  admin: fixture('platform_admin', null, 'Alpha'),
  manager: fixture('manager', storeA.id, 'Bravo'),
  employee: fixture('employee', storeA.id, 'Charlie'),
  inactive: fixture('employee', storeB.id, 'Delta', false),
};
const ALL = [users.admin, users.manager, users.employee, users.inactive];

const FORBIDDEN = { error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action' } };

function auth(req: request.Test, user: Fixture = users.admin): request.Test {
  return req.set('Authorization', `Bearer ${user.token}`);
}

function list(query: Record<string, string | number> = {}, user: Fixture = users.admin) {
  return auth(request(app).get('/api/v1/users').query(query), user);
}

function get(id: string, user: Fixture = users.admin) {
  return auth(request(app).get(`/api/v1/users/${id}`), user);
}

function expected(user: Fixture) {
  const store = user.tenantId === storeA.id ? storeA : user.tenantId === storeB.id ? storeB : null;
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    isActive: user.isActive,
    tenant: store ? { id: store.id, name: store.name, isActive: store === storeA } : null,
    createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
  };
}

describe('users read (RF-09)', () => {
  beforeAll(async () => {
    await admin`insert into tenants (id, name, slug) values (${storeA.id}, ${storeA.name}, ${storeA.slug})`;
    await admin`insert into tenants (id, name, slug, is_active) values (${storeB.id}, ${storeB.name}, ${storeB.slug}, false)`;
    const signIn = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    for (const user of ALL) {
      const result = await authAdmin.auth.admin.createUser({ email: user.email, password: PASSWORD, email_confirm: true });
      if (result.error) throw result.error;
      user.id = result.data.user.id;
      await admin`
        insert into user_profiles (id, email, full_name, role, tenant_id, is_active)
        values (${user.id}, ${user.email}, ${user.fullName}, ${user.role}, ${user.tenantId}, ${user.isActive})
      `;
      // Users of the deactivated store cannot sign in (RF-05); they are only listed.
      if (user.tenantId === storeB.id) continue;
      const session = await signIn.auth.signInWithPassword({ email: user.email, password: PASSWORD });
      if (session.error) throw session.error;
      user.token = session.data.session.access_token;
    }
  });

  afterAll(async () => {
    const ids = ALL.map((user) => user.id).filter(Boolean);
    await admin`delete from user_profiles where id in ${admin(ids)}`;
    for (const id of ids) await authAdmin.auth.admin.deleteUser(id);
    await admin`delete from tenants where id in ${admin([storeA.id, storeB.id])}`;
    await admin.end();
  });

  describe('access', () => {
    it('without a session → 401 on both routes', async () => {
      expect((await request(app).get('/api/v1/users')).status).toBe(401);
      expect((await request(app).get(`/api/v1/users/${users.admin.id}`)).status).toBe(401);
    });

    it.each(['manager', 'employee'] as const)('%s (no user:manage) → uniform 403 on both routes', async (role) => {
      // Even for a user of their own store, or their own profile.
      for (const res of [await list({ tenantId: storeA.id }, users[role]), await get(users[role].id, users[role])]) {
        expect(res.status).toBe(403);
        expect(res.body).toEqual(FORBIDDEN);
      }
    });

    it('both routes ride the read limiter, without any X-Tenant-Id', async () => {
      const page = await list({ search: token });
      expect(page.status).toBe(200);
      expect(page.headers['ratelimit-limit']).toBe('100');

      const one = await get(users.manager.id);
      expect(one.status).toBe(200);
      expect(one.headers['ratelimit-limit']).toBe('100');
    });
  });

  describe('GET /users', () => {
    it('lists platform and store users of every store (inactive ones included), ordered by name', async () => {
      const res = await list({ search: token });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: ALL.map(expected), page: 1, pageSize: 20, total: 4 });
    });

    it('a Platform Admin row carries no store (RN-01)', async () => {
      const res = await list({ search: users.admin.fullName });
      expect(res.body.items).toEqual([expected(users.admin)]);
      expect(res.body.items[0].tenant).toBeNull();
    });

    it('paginates', async () => {
      const res = await list({ search: token, page: 2, pageSize: 3 });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [expected(users.inactive)], page: 2, pageSize: 3, total: 4 });
    });

    it('search matches the full name, case-insensitively', async () => {
      const res = await list({ search: `${token} bRAVO`.toUpperCase() });
      expect(res.body.items.map((u: { id: string }) => u.id)).toEqual([users.manager.id]);
    });

    it('search matches the denormalized email', async () => {
      const all = await list({ search: mail });
      expect(all.body.total).toBe(4);
      const one = await list({ search: `${mail}-charlie@` });
      expect(one.body.items.map((u: { id: string }) => u.id)).toEqual([users.employee.id]);
    });

    it('search is a literal substring: LIKE metacharacters never act as wildcards', async () => {
      for (const search of [`${token}%Alpha`, `${token}_Alpha`, `${mail}%`, `${token}\\`]) {
        const res = await list({ search });
        expect(res.status).toBe(200);
        expect(res.body.total).toBe(0);
      }
    });

    it('a blank search is no filter', async () => {
      const res = await list({ search: '   ', pageSize: 1 });
      expect(res.status).toBe(200);
      expect(res.body.total).toBeGreaterThanOrEqual(4);
    });

    it('tenantId filters to that store’s users', async () => {
      const a = await list({ tenantId: storeA.id });
      expect(a.body).toEqual({ items: [expected(users.manager), expected(users.employee)], page: 1, pageSize: 20, total: 2 });

      // A deactivated store's users stay listed, the store flagged inactive.
      const b = await list({ tenantId: storeB.id });
      expect(b.body.items).toEqual([expected(users.inactive)]);
      expect(b.body.items[0].tenant.isActive).toBe(false);
    });

    it('tenantId combines with search; an unknown store is just an empty page', async () => {
      const both = await list({ tenantId: storeA.id, search: 'charlie' });
      expect(both.body.items.map((u: { id: string }) => u.id)).toEqual([users.employee.id]);

      const none = await list({ tenantId: randomUUID() });
      expect(none.status).toBe(200);
      expect(none.body).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
    });

    it.each([
      [{ tenantId: 'not-a-uuid' }, 'tenantId'],
      [{ pageSize: 101 }, 'pageSize'],
      [{ search: 'x'.repeat(101) }, 'search'],
      [{ role: 'manager' }, 'role'],
    ])('invalid query %o → 400 VALIDATION_ERROR', async (query, path) => {
      const res = await list(query);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.map((d: { path: string }) => d.path)).toContain(path);
    });
  });

  describe('GET /users/:id', () => {
    it.each(['admin', 'manager', 'inactive'] as const)('200 with the %s user', async (key) => {
      const res = await get(users[key].id);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(expected(users[key]));
    });

    it('unknown id → 404 "User not found"', async () => {
      const res = await get(randomUUID());
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    });

    it('malformed id or any query param → 400 VALIDATION_ERROR', async () => {
      const bad = await get('not-a-uuid');
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('VALIDATION_ERROR');

      const query = await auth(request(app).get(`/api/v1/users/${users.admin.id}`).query({ x: '1' }));
      expect(query.status).toBe(400);
      expect(query.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
