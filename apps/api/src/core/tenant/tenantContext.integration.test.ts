import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '@supabase/supabase-js';
import { inArray } from 'drizzle-orm';
import express from 'express';
import postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../../config/env.js';
import { replenishmentLists } from '../../db/schema/replenishmentLists.js';
import { withTenantContext } from '../../db/withTenantContext.js';
import { authenticate } from '../auth/authenticate.js';
import { authorize } from '../authz/authorize.js';
import { errorHandler } from '../errors.js';
import { requestContext } from './context.js';
import { tenantContext } from './tenantContext.js';

// Sub-task 1.14 — architecture.md §5.2 (tenantContext, explicit per-router
// mounting), §6 (authorize, uniform 403), AD-19 (AsyncLocalStorage context).
// Requires the local Supabase stack: real users are created through Auth admin
// and signed in with the password grant; stores, profiles and one replenishment
// list per store are fixtures written over the admin connection.
const adminUrl = process.env.MIGRATIONS_DATABASE_URL;
if (!adminUrl) {
  throw new Error('MIGRATIONS_DATABASE_URL is not set — run `supabase start` and set up apps/api/.env first');
}
const admin = postgres(adminUrl);
const authAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const PASSWORD = `tenant-test-${randomUUID()}`;
const storeA = randomUUID();
const storeB = randomUUID();
const inactiveStore = randomUUID();
const listA = randomUUID();
const listB = randomUUID();

interface Fixture {
  role: 'platform_admin' | 'manager' | 'employee';
  tenantId: string | null;
  id: string;
  token: string;
}
const users: Record<'manager' | 'employee' | 'admin', Fixture> = {
  manager: { role: 'manager', tenantId: storeA, id: '', token: '' },
  employee: { role: 'employee', tenantId: storeA, id: '', token: '' },
  admin: { role: 'platform_admin', tenantId: null, id: '', token: '' },
};

const FORBIDDEN = { error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action' } };

// No real tenant-scoped router exists yet: a tiny one mounted the way §3.3/§5.2
// prescribe (authenticate → tenantContext → authorize), plus a global one.
function testApp() {
  const tenantScoped = express.Router();
  tenantScoped.use(authenticate, tenantContext);
  // Context read after real async work (a timer + a DB round trip).
  tenantScoped.get('/context', async (_req, res) => {
    await delay(10);
    await withTenantContext(async (tx) => tx.select().from(replenishmentLists).limit(1));
    res.json(requestContext.getStore());
  });
  // RLS through withTenantContext: both stores' lists are asked for by id.
  tenantScoped.get('/lists', async (_req, res) => {
    const rows = await withTenantContext((tx) =>
      tx
        .select({ id: replenishmentLists.id })
        .from(replenishmentLists)
        .where(inArray(replenishmentLists.id, [listA, listB])),
    );
    res.json(rows.map((row) => row.id));
  });
  tenantScoped.get('/assortment', authorize('assortment:manage'), (_req, res) => {
    res.json({ ok: true });
  });

  const global = express.Router();
  global.get('/context', authenticate, async (_req, res) => {
    await delay(10);
    res.json(requestContext.getStore());
  });
  global.get('/tenants', authenticate, authorize('tenant:manage'), (_req, res) => {
    res.json({ ok: true });
  });

  const app = express();
  app.use('/store', tenantScoped);
  app.use('/platform', global);
  app.use(errorHandler);
  return app;
}

const app = testApp();

function as(user: Fixture, path: string, tenantHeader?: string) {
  const req = request(app).get(path).set('Authorization', `Bearer ${user.token}`);
  return tenantHeader === undefined ? req : req.set('X-Tenant-Id', tenantHeader);
}

describe('tenantContext + authorize', () => {
  beforeAll(async () => {
    await admin`
      insert into tenants (id, name, slug, is_active) values
        (${storeA}, 'Tenant Ctx A', ${`tenant-ctx-a-${storeA}`}, true),
        (${storeB}, 'Tenant Ctx B', ${`tenant-ctx-b-${storeB}`}, true),
        (${inactiveStore}, 'Tenant Ctx Inactive', ${`tenant-ctx-inactive-${inactiveStore}`}, false)
    `;
    await admin`
      insert into replenishment_lists (id, tenant_id, name) values
        (${listA}, ${storeA}, 'List A'),
        (${listB}, ${storeB}, 'List B')
    `;
    const signIn = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    for (const [key, user] of Object.entries(users)) {
      const email = `tenant-ctx-${key}-${randomUUID()}@repma.test`;
      const created = await authAdmin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
      if (created.error) throw created.error;
      user.id = created.data.user.id;
      await admin`
        insert into user_profiles (id, email, full_name, role, tenant_id)
        values (${user.id}, ${email}, ${`Tenant ctx ${key}`}, ${user.role}, ${user.tenantId})
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
    await admin`delete from replenishment_lists where id in ${admin([listA, listB])}`;
    await admin`delete from user_profiles where id in ${admin(ids)}`;
    for (const id of ids) await authAdmin.auth.admin.deleteUser(id);
    await admin`delete from tenants where id in ${admin([storeA, storeB, inactiveStore])}`;
    await admin.end();
  });

  describe('store user (manager/employee)', () => {
    it('without header → own store as the active tenant', async () => {
      const res = await as(users.manager, '/store/context');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ userId: users.manager.id, role: 'manager', tenantId: storeA });
    });

    it('with its own store in the header (any case) → own store', async () => {
      const res = await as(users.employee, '/store/context', storeA.toUpperCase());
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ userId: users.employee.id, role: 'employee', tenantId: storeA });
    });

    it('with a foreign store in the header → uniform 403', async () => {
      const res = await as(users.manager, '/store/context', storeB);
      expect(res.status).toBe(403);
      expect(res.body).toEqual(FORBIDDEN);
    });

    it('with a malformed header → 403 (it is not its store)', async () => {
      const res = await as(users.manager, '/store/context', 'not-a-uuid');
      expect(res.status).toBe(403);
      expect(res.body).toEqual(FORBIDDEN);
    });

    it('RLS through withTenantContext returns only its own store’s row', async () => {
      const res = await as(users.manager, '/store/lists');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([listA]);
    });
  });

  describe('platform_admin', () => {
    it('without header on a tenant-scoped route → 400 TENANT_REQUIRED', async () => {
      const res = await as(users.admin, '/store/context');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('TENANT_REQUIRED');
    });

    it('with an empty header → 400 TENANT_REQUIRED', async () => {
      const res = await as(users.admin, '/store/context', '');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('TENANT_REQUIRED');
    });

    it('with an active store → that store is the active tenant', async () => {
      const res = await as(users.admin, '/store/context', storeB);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ userId: users.admin.id, role: 'platform_admin', tenantId: storeB });
    });

    it('RLS through withTenantContext returns only the selected store’s row', async () => {
      const res = await as(users.admin, '/store/lists', storeB);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([listB]);
    });

    it.each([
      ['a malformed uuid', 'not-a-uuid'],
      ['an unknown store', randomUUID()],
      ['an inactive store', inactiveStore],
    ])('with %s → 400 INVALID_TENANT', async (_case, header) => {
      const res = await as(users.admin, '/store/context', header);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        error: { code: 'INVALID_TENANT', message: 'X-Tenant-Id does not name an active store' },
      });
    });
  });

  describe('request context (AD-19)', () => {
    it('concurrent requests each keep their own context across awaits', async () => {
      const [manager, adminInB] = await Promise.all([
        as(users.manager, '/store/context'),
        as(users.admin, '/store/context', storeB),
      ]);
      expect(manager.body.tenantId).toBe(storeA);
      expect(adminInB.body.tenantId).toBe(storeB);
    });

    it('global routers run under the identity context (no tenantContext)', async () => {
      const manager = await as(users.manager, '/platform/context');
      expect(manager.body).toEqual({ userId: users.manager.id, role: 'manager', tenantId: storeA });
      // The header is ignored where tenantContext is not mounted.
      const adminRes = await as(users.admin, '/platform/context', storeB);
      expect(adminRes.body).toEqual({ userId: users.admin.id, role: 'platform_admin', tenantId: null });
    });

    it('without authenticate there is no context: withTenantContext fails closed', async () => {
      expect(requestContext.getStore()).toBeUndefined();
      await expect(withTenantContext(async () => 'ran')).rejects.toThrow(/no request context/);
    });
  });

  describe('authorize (architecture.md §6)', () => {
    it('allows a role holding the permission', async () => {
      const res = await as(users.manager, '/store/assortment');
      expect(res.status).toBe(200);
    });

    it('denies a role without it with the uniform 403', async () => {
      const res = await as(users.employee, '/store/assortment');
      expect(res.status).toBe(403);
      expect(res.body).toEqual(FORBIDDEN);
    });

    it('platform_admin holds every permission (tenant-scoped and global)', async () => {
      expect((await as(users.admin, '/store/assortment', storeA)).status).toBe(200);
      expect((await as(users.admin, '/platform/tenants')).status).toBe(200);
    });

    it('denies store roles on a platform permission with the same 403', async () => {
      const res = await as(users.manager, '/platform/tenants');
      expect(res.status).toBe(403);
      expect(res.body).toEqual(FORBIDDEN);
    });

    it('unauthenticated requests are 401 before tenantContext/authorize', async () => {
      const res = await request(app).get('/store/assortment').set('X-Tenant-Id', storeA);
      expect(res.status).toBe(401);
    });
  });
});
