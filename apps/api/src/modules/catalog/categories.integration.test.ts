import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { app } from '../../app.js';
import { env } from '../../config/env.js';

// Sub-task 3.1 — RF-13 `GET /categories`: `catalog:read`, read limiter,
// global router (no tenantContext), pagination ordered by name. Requires the
// local Supabase stack. The catalog is global and shared with the seed and
// other suites, so assertions are scoped to this file's token-named rows.

// `catalog:read` is held by every role (architecture.md §6): a switch narrows
// the matrix for the employee to prove the route enforces it.
const narrowed = vi.hoisted(() => ({ read: false }));
vi.mock('shared', async (importOriginal) => {
  const original = await importOriginal<typeof import('shared')>();
  return {
    ...original,
    hasPermission: (subject: { role: import('shared').Role }, permission: import('shared').Permission) =>
      narrowed.read && subject.role === 'employee' && permission === 'catalog:read'
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

const PASSWORD = `categories-test-${randomUUID()}`;
const token = `cat${randomUUID().slice(0, 8)}`;
const store = randomUUID();
// Inserted out of name order.
const categories = [
  { id: randomUUID(), name: `${token} Socks` },
  { id: randomUUID(), name: `${token} Bags` },
  { id: randomUUID(), name: `${token} Hats` },
];
const [socks, bags, hats] = categories as [(typeof categories)[0], (typeof categories)[0], (typeof categories)[0]];

interface Fixture {
  role: 'platform_admin' | 'employee';
  tenantId: string | null;
  id: string;
  token: string;
}
const users: Record<'admin' | 'employee', Fixture> = {
  admin: { role: 'platform_admin', tenantId: null, id: '', token: '' },
  employee: { role: 'employee', tenantId: store, id: '', token: '' },
};

function list(user: Fixture, query: Record<string, string> = {}) {
  return request(app).get('/api/v1/categories').query(query).set('Authorization', `Bearer ${user.token}`);
}

function own(body: { items: { name: string }[] }): { name: string }[] {
  return body.items.filter((item) => item.name.startsWith(token));
}

describe('GET /categories (RF-13)', () => {
  beforeAll(async () => {
    await admin`insert into tenants (id, name, slug) values (${store}, 'Categories', ${`categories-${store}`})`;
    for (const category of categories) {
      await admin`
        insert into categories (id, name, slug, description)
        values (${category.id}, ${category.name}, ${`categories-test-${category.id}`}, 'not exposed')
      `;
    }
    const signIn = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    for (const [key, user] of Object.entries(users)) {
      const email = `categories-${key}-${randomUUID()}@repma.test`;
      const created = await authAdmin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
      if (created.error) throw created.error;
      user.id = created.data.user.id;
      await admin`
        insert into user_profiles (id, email, full_name, role, tenant_id)
        values (${user.id}, ${email}, ${`Categories ${key}`}, ${user.role}, ${user.tenantId})
      `;
      const session = await signIn.auth.signInWithPassword({ email, password: PASSWORD });
      if (session.error) throw session.error;
      user.token = session.data.session.access_token;
    }
  });

  afterAll(async () => {
    const userIds = Object.values(users)
      .map((user) => user.id)
      .filter(Boolean);
    await admin`delete from user_profiles where id in ${admin(userIds)}`;
    for (const id of userIds) await authAdmin.auth.admin.deleteUser(id);
    await admin`delete from tenants where id = ${store}`;
    await admin`delete from categories where id in ${admin(categories.map((c) => c.id))}`;
    await admin.end();
  });

  it('without a session → 401', async () => {
    const res = await request(app).get('/api/v1/categories');
    expect(res.status).toBe(401);
  });

  it('is served under the read limiter', async () => {
    const res = await list(users.employee);
    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('100');
  });

  it('enforces catalog:read: a session without it → uniform 403', async () => {
    narrowed.read = true;
    try {
      const res = await list(users.employee);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    } finally {
      narrowed.read = false;
    }
  });

  it('a store user lists the global categories by name, as { id, name }, in the envelope', async () => {
    const res = await list(users.employee, { pageSize: '100' });
    expect(res.status).toBe(200);
    expect(own(res.body)).toEqual([bags, hats, socks]);
    expect(res.body).toMatchObject({ page: 1, pageSize: 100 });
    expect(res.body.total).toBe(res.body.items.length); // one transaction: consistent with its page
  });

  it('is global: the platform admin reads it without X-Tenant-Id', async () => {
    const res = await list(users.admin, { pageSize: '100' });
    expect(res.status).toBe(200);
    expect(own(res.body)).toEqual([bags, hats, socks]);
  });

  // Other suites write global categories concurrently, so this checks the
  // slicing, not a cross-request snapshot.
  it('paginates: pageSize slices the list, total counts every category', async () => {
    const res = await list(users.employee, { pageSize: '1', page: '2' });
    expect(res.body.items).toHaveLength(1);
    expect(res.body).toMatchObject({ page: 2, pageSize: 1 });
    expect(res.body.total).toBeGreaterThanOrEqual(categories.length);
  });

  it.each([
    ['pageSize over the max', { pageSize: '101' }],
    ['an unknown parameter', { search: 'hats' }],
  ])('rejects %s → 400 VALIDATION_ERROR', async (_label, query) => {
    const res = await list(users.employee, query);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
