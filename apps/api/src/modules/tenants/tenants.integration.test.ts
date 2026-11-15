import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../app.js';
import { env } from '../../config/env.js';

// Sub-task 2.6 — RF-06 `GET /tenants`: `tenant:manage`, read limiter, global
// router (no tenantContext), pagination + `search`. Requires the local
// Supabase stack. Stores carry a per-run token in their names so every
// assertion is scoped to this file's fixtures, whatever else the DB holds.
const adminUrl = process.env.MIGRATIONS_DATABASE_URL;
if (!adminUrl) {
  throw new Error('MIGRATIONS_DATABASE_URL is not set — run `supabase start` and set up apps/api/.env first');
}
const admin = postgres(adminUrl);
const authAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const PASSWORD = `tenants-test-${randomUUID()}`;
const token = `tnt${randomUUID().slice(0, 8)}`;
// Inserted out of name order; the inactive one must still be listed.
const stores = [
  { id: randomUUID(), name: `${token} Charlie`, isActive: true },
  { id: randomUUID(), name: `${token} Alpha`, isActive: true },
  { id: randomUUID(), name: `${token} Bravo`, isActive: false },
];
const [charlie, alpha, bravo] = stores as [(typeof stores)[0], (typeof stores)[0], (typeof stores)[0]];

interface Fixture {
  role: 'platform_admin' | 'manager' | 'employee';
  tenantId: string | null;
  id: string;
  token: string;
}
const users: Record<'admin' | 'manager' | 'employee', Fixture> = {
  admin: { role: 'platform_admin', tenantId: null, id: '', token: '' },
  manager: { role: 'manager', tenantId: alpha.id, id: '', token: '' },
  employee: { role: 'employee', tenantId: alpha.id, id: '', token: '' },
};

const FORBIDDEN = { error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action' } };

function list(user: Fixture, query: Record<string, string> = {}) {
  return request(app).get('/api/v1/tenants').query(query).set('Authorization', `Bearer ${user.token}`);
}

function names(body: { items: { name: string }[] }): string[] {
  return body.items.map((item) => item.name);
}

describe('GET /tenants (RF-06)', () => {
  beforeAll(async () => {
    for (const store of stores) {
      await admin`
        insert into tenants (id, name, slug, is_active)
        values (${store.id}, ${store.name}, ${`tenants-test-${store.id}`}, ${store.isActive})
      `;
    }
    const signIn = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    for (const [key, user] of Object.entries(users)) {
      const email = `tenants-${key}-${randomUUID()}@repma.test`;
      const created = await authAdmin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
      if (created.error) throw created.error;
      user.id = created.data.user.id;
      await admin`
        insert into user_profiles (id, email, full_name, role, tenant_id)
        values (${user.id}, ${email}, ${`Tenants ${key}`}, ${user.role}, ${user.tenantId})
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
    await admin`delete from tenants where id in ${admin(stores.map((store) => store.id))}`;
    await admin.end();
  });

  describe('access', () => {
    it('without a session → 401', async () => {
      const res = await request(app).get('/api/v1/tenants');
      expect(res.status).toBe(401);
    });

    it.each(['manager', 'employee'] as const)('%s (no tenant:manage) → uniform 403', async (role) => {
      const res = await list(users[role]);
      expect(res.status).toBe(403);
      expect(res.body).toEqual(FORBIDDEN);
    });

    it('platform_admin → 200 under the read limiter, without any X-Tenant-Id', async () => {
      const res = await list(users.admin);
      expect(res.status).toBe(200);
      expect(res.headers['ratelimit-limit']).toBe('100');
    });

    it('no tenantContext mounted: an X-Tenant-Id header is ignored, not resolved', async () => {
      // On a tenant-scoped router this header would be a 403 (unknown store).
      const res = await list(users.admin, { search: token }).set('X-Tenant-Id', randomUUID());
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(3);
    });
  });

  describe('listing', () => {
    it('search returns every matching store — inactive included — ordered by name, in the envelope', async () => {
      const res = await list(users.admin, { search: token });
      expect(res.status).toBe(200);
      const row = await admin`select created_at from tenants where id = ${alpha.id}`;
      expect(res.body).toEqual({
        items: [
          {
            id: alpha.id,
            name: alpha.name,
            slug: `tenants-test-${alpha.id}`,
            isActive: true,
            createdAt: (row[0]!.created_at as Date).toISOString(),
          },
          expect.objectContaining({ id: bravo.id, name: bravo.name, isActive: false }),
          expect.objectContaining({ id: charlie.id, name: charlie.name, isActive: true }),
        ],
        page: 1,
        pageSize: 20,
        total: 3,
      });
    });

    it('search is a case-insensitive substring of the name', async () => {
      const res = await list(users.admin, { search: `${token.toUpperCase()} BRA` });
      expect(names(res.body)).toEqual([bravo.name]);
      expect(res.body.total).toBe(1);
    });

    it('LIKE metacharacters in search are literal', async () => {
      const res = await list(users.admin, { search: `${token}%a` });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [], page: 1, pageSize: 20, total: 0 });
    });

    it('a blank search is no filter', async () => {
      const res = await list(users.admin, { search: '   ', pageSize: '100' });
      expect(res.status).toBe(200);
      expect(res.body.total).toBeGreaterThanOrEqual(3);
    });

    it('paginates: page/pageSize slice the ordered result, total counts them all', async () => {
      const first = await list(users.admin, { search: token, pageSize: '2' });
      expect(names(first.body)).toEqual([alpha.name, bravo.name]);
      expect(first.body).toMatchObject({ page: 1, pageSize: 2, total: 3 });

      const second = await list(users.admin, { search: token, pageSize: '2', page: '2' });
      expect(names(second.body)).toEqual([charlie.name]);
      expect(second.body).toMatchObject({ page: 2, pageSize: 2, total: 3 });

      const beyond = await list(users.admin, { search: token, pageSize: '2', page: '3' });
      expect(beyond.body).toEqual({ items: [], page: 3, pageSize: 2, total: 3 });
    });

    it.each([
      ['pageSize over the max', { pageSize: '101' }],
      ['page 0', { page: '0' }],
      ['an over-long search', { search: 'x'.repeat(101) }],
      ['an unknown parameter', { isActive: 'true' }],
    ])('rejects %s → 400 VALIDATION_ERROR', async (_label, query) => {
      const res = await list(users.admin, query);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
