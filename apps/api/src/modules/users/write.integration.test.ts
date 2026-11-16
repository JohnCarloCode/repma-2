import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../app.js';
import { env } from '../../config/env.js';

// Sub-task 7.4 — RF-11 `PATCH /users/:id` (name, role manager ↔ employee only,
// isActive, write-only password reset; email and store immutable) and RF-12
// `DELETE /users/:id` (identity deleted in Supabase Auth, profile cascades,
// availability events survive with no author — RN-09). Nobody can deactivate
// or delete themselves. `user:manage`, global router, write limiter. Requires
// the local Supabase stack.

const adminUrl = process.env.MIGRATIONS_DATABASE_URL;
if (!adminUrl) {
  throw new Error('MIGRATIONS_DATABASE_URL is not set — run `supabase start` and set up apps/api/.env first');
}

const admin = postgres(adminUrl);
const authAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const signIn = () => createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });

const PASSWORD = `users-write-${randomUUID()}`;
// Every email this suite creates starts with `mail`, so afterAll can sweep
// whatever a failing case left behind.
const mail = `uw${randomUUID().slice(0, 8)}`;
const store = { id: randomUUID(), name: `${mail} Store`, slug: `${mail}-store` };
const category = { id: randomUUID(), name: `${mail} Category`, slug: `${mail}-category` };
const product = { id: randomUUID(), name: `${mail} Product` };
const size = { id: randomUUID(), label: 'M', sku: `${mail}-M` };

type Role = 'platform_admin' | 'manager' | 'employee';

interface Account {
  role: Role;
  tenantId: string | null;
  email: string;
  id: string;
  token: string;
}

let counter = 0;

// An Auth identity + its profile, signed in.
async function createAccount(role: Role, tenantId: string | null = role === 'platform_admin' ? null : store.id): Promise<Account> {
  counter += 1;
  const email = `${mail}-${counter}@repma.test`;
  const created = await authAdmin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (created.error) throw created.error;
  const id = created.data.user.id;
  await admin`
    insert into user_profiles (id, email, full_name, role, tenant_id)
    values (${id}, ${email}, ${`${mail} user ${counter}`}, ${role}, ${tenantId})
  `;
  const session = await signIn().auth.signInWithPassword({ email, password: PASSWORD });
  if (session.error) throw session.error;
  return { role, tenantId, email, id, token: session.data.session.access_token };
}

// Several admins: the write limiter (30/min per user) is real — each describe
// block writes as its own admin.
const actors = {} as Record<'editor' | 'resetter' | 'deleter' | 'manager' | 'employee', Account>;
const FORBIDDEN = { error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action' } };
const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'User not found' } };

function patch(id: string, body: object, actor: Account = actors.editor) {
  return request(app).patch(`/api/v1/users/${id}`).set('Authorization', `Bearer ${actor.token}`).send(body);
}

function del(id: string, actor: Account = actors.deleter) {
  return request(app).delete(`/api/v1/users/${id}`).set('Authorization', `Bearer ${actor.token}`);
}

function me(account: Account) {
  return request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${account.token}`);
}

async function profile(id: string) {
  const [row] = await admin<{ full_name: string; role: Role; is_active: boolean; tenant_id: string | null }[]>`
    select full_name, role, is_active, tenant_id from user_profiles where id = ${id}
  `;
  return row;
}

async function canSignIn(email: string, password: string): Promise<boolean> {
  const { error } = await signIn().auth.signInWithPassword({ email, password });
  return !error;
}

function expectValidation(res: request.Response, path: string, message?: string) {
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('VALIDATION_ERROR');
  const issue = res.body.error.details.find((d: { path: string }) => d.path === path);
  expect(issue).toBeDefined();
  if (message) expect(issue.message).toBe(message);
}

describe('users edit & delete (RF-11, RF-12)', () => {
  beforeAll(async () => {
    await admin`insert into tenants (id, name, slug) values (${store.id}, ${store.name}, ${store.slug})`;
    await admin`insert into categories (id, name, slug) values (${category.id}, ${category.name}, ${category.slug})`;
    await admin`insert into products (id, name, category_id) values (${product.id}, ${product.name}, ${category.id})`;
    await admin`
      insert into product_sizes (id, product_id, label, sku, position)
      values (${size.id}, ${product.id}, ${size.label}, ${size.sku}, 0)
    `;
    actors.editor = await createAccount('platform_admin');
    actors.resetter = await createAccount('platform_admin');
    actors.deleter = await createAccount('platform_admin');
    actors.manager = await createAccount('manager');
    actors.employee = await createAccount('employee');
  });

  afterAll(async () => {
    await admin`delete from availability_events where tenant_id = ${store.id}`;
    await admin`delete from replenishment_lists where tenant_id = ${store.id}`;
    await admin`delete from assortment_items where tenant_id = ${store.id}`;
    // Profiles fall with their identities (ON DELETE CASCADE).
    const rows = await admin<{ id: string }[]>`select id from auth.users where email like ${`${mail}-%`}`;
    for (const { id } of rows) await authAdmin.auth.admin.deleteUser(id);
    await admin`delete from tenants where id = ${store.id}`;
    await admin`delete from product_sizes where id = ${size.id}`;
    await admin`delete from products where id = ${product.id}`;
    await admin`delete from categories where id = ${category.id}`;
    await admin.end();
  });

  describe('access', () => {
    it('without a session → 401', async () => {
      const target = actors.employee.id;
      expect((await request(app).patch(`/api/v1/users/${target}`).send({ fullName: 'x' })).status).toBe(401);
      expect((await request(app).delete(`/api/v1/users/${target}`)).status).toBe(401);
    });

    it.each(['manager', 'employee'] as const)('%s (no user:manage) → uniform 403, nothing changed', async (role) => {
      const target = await createAccount('employee');
      const patched = await patch(target.id, { fullName: 'Hacked' }, actors[role]);
      expect(patched.status).toBe(403);
      expect(patched.body).toEqual(FORBIDDEN);
      const deleted = await del(target.id, actors[role]);
      expect(deleted.status).toBe(403);
      expect(deleted.body).toEqual(FORBIDDEN);
      expect(await profile(target.id)).toMatchObject({ full_name: `${mail} user ${counter}` });
    });

    it('PATCH and DELETE ride the write limiter, without any X-Tenant-Id', async () => {
      const target = await createAccount('employee');
      const patched = await patch(target.id, { fullName: `${mail} Limiter` });
      expect(patched.status).toBe(200);
      expect(patched.headers['ratelimit-limit']).toBe('30');
      const deleted = await del(target.id);
      expect(deleted.status).toBe(204);
      expect(deleted.headers['ratelimit-limit']).toBe('30');
    });
  });

  describe('PATCH /users/:id — profile fields', () => {
    it('renames (trimmed) → 200 User, re-read from the profile', async () => {
      const target = await createAccount('employee');
      const res = await patch(target.id, { fullName: `  ${mail} Renamed  ` });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: target.id,
        email: target.email,
        fullName: `${mail} Renamed`,
        role: 'employee',
        isActive: true,
        tenant: { id: store.id, name: store.name, isActive: true },
        createdAt: expect.any(String),
      });
      const read = await request(app).get(`/api/v1/users/${target.id}`).set('Authorization', `Bearer ${actors.editor.token}`);
      expect(read.body).toEqual(res.body);
    });

    it.each([
      ['employee', 'manager'],
      ['manager', 'employee'],
    ] as const)('role %s → %s (RN-01: same store) → 200', async (from, to) => {
      const target = await createAccount(from);
      const res = await patch(target.id, { role: to });
      expect(res.status).toBe(200);
      expect(res.body.role).toBe(to);
      expect(res.body.tenant.id).toBe(store.id);
      // The new role's permissions apply on the next request.
      expect((await me(target)).body.role).toBe(to);
    });

    it('a store user cannot become a Platform Admin → 400 on role, unchanged', async () => {
      const target = await createAccount('manager');
      const res = await patch(target.id, { role: 'platform_admin', fullName: 'Changed' });
      expectValidation(res, 'role', 'A store user cannot become a Platform Admin');
      expect(await profile(target.id)).toMatchObject({ role: 'manager', full_name: `${mail} user ${counter}` });
    });

    it.each(['manager', 'employee'] as const)('a Platform Admin cannot become %s → 400 on role, unchanged', async (to) => {
      const target = await createAccount('platform_admin');
      const res = await patch(target.id, { role: to });
      expectValidation(res, 'role', "A Platform Admin's role cannot be changed");
      expect(await profile(target.id)).toMatchObject({ role: 'platform_admin', tenant_id: null });
    });

    it('the unchanged role is accepted (no-op), also for a Platform Admin', async () => {
      const target = await createAccount('platform_admin');
      const res = await patch(target.id, { role: 'platform_admin', fullName: `${mail} Same` });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ role: 'platform_admin', fullName: `${mail} Same`, tenant: null });
    });

    it.each([
      ['email', { email: 'other@repma.test' }],
      ['tenantId', { tenantId: randomUUID() }],
    ])('%s is immutable → 400 Unknown field', async (key, body) => {
      const target = await createAccount('employee');
      const res = await patch(target.id, body);
      expectValidation(res, key, 'Unknown field');
      expect(await profile(target.id)).toMatchObject({ tenant_id: store.id });
    });

    it.each([
      ['empty body', {}, ''],
      ['blank fullName', { fullName: '   ' }, 'fullName'],
      ['unknown role', { role: 'owner' }, 'role'],
      ['non-boolean isActive', { isActive: 'false' }, 'isActive'],
      ['short password', { password: 'short' }, 'password'],
      ['is_active snake case', { is_active: false }, 'is_active'],
    ])('%s → 400', async (_label, body, path) => {
      expectValidation(await patch(actors.employee.id, body), path);
    });

    it('a query param → 400', async () => {
      const res = await request(app)
        .patch(`/api/v1/users/${actors.employee.id}?x=1`)
        .set('Authorization', `Bearer ${actors.editor.token}`)
        .send({ fullName: 'x' });
      expect(res.status).toBe(400);
    });

    it('unknown id → 404, malformed id → 400', async () => {
      const unknown = await patch(randomUUID(), { fullName: 'x' });
      expect(unknown.status).toBe(404);
      expect(unknown.body).toEqual(NOT_FOUND);
      expect((await patch('not-a-uuid', { fullName: 'x' })).status).toBe(400);
    });
  });

  describe('PATCH /users/:id — status and password', () => {
    it('deactivate → the user gets 401 on the next request (RF-05); reactivate → 200 again', async () => {
      const target = await createAccount('employee');
      expect((await me(target)).status).toBe(200);

      const off = await patch(target.id, { isActive: false }, actors.resetter);
      expect(off.status).toBe(200);
      expect(off.body.isActive).toBe(false);
      expect((await me(target)).status).toBe(401);
      expect((await request(app).get('/api/v1/home/summary').set('Authorization', `Bearer ${target.token}`)).status).toBe(401);

      const on = await patch(target.id, { isActive: true }, actors.resetter);
      expect(on.status).toBe(200);
      expect(on.body.isActive).toBe(true);
      expect((await me(target)).status).toBe(200);
    });

    it('another Platform Admin can be deactivated', async () => {
      const target = await createAccount('platform_admin');
      const res = await patch(target.id, { isActive: false }, actors.resetter);
      expect(res.status).toBe(200);
      expect((await me(target)).status).toBe(401);
    });

    it('self-deactivation → 409 with a message for the UI, still active', async () => {
      const res = await patch(actors.resetter.id, { isActive: false, fullName: 'Changed' }, actors.resetter);
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: { code: 'CONFLICT', message: 'You cannot deactivate your own account' } });
      expect(await profile(actors.resetter.id)).toMatchObject({ is_active: true, full_name: `${mail} user 2` });
    });

    it('editing their own name (and isActive: true) is allowed', async () => {
      const res = await patch(actors.resetter.id, { fullName: `${mail} Me`, isActive: true }, actors.resetter);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ fullName: `${mail} Me`, isActive: true });
    });

    it('password reset → the new password signs in, the old one no longer does; never returned', async () => {
      const target = await createAccount('manager');
      const newPassword = `reset-${randomUUID()}`;
      const res = await patch(target.id, { password: newPassword, fullName: `${mail} Reset` }, actors.resetter);
      expect(res.status).toBe(200);
      expect(res.body.fullName).toBe(`${mail} Reset`);
      expect(JSON.stringify(res.body)).not.toContain(newPassword);
      expect(Object.keys(res.body)).not.toContain('password');
      expect(await canSignIn(target.email, newPassword)).toBe(true);
      expect(await canSignIn(target.email, PASSWORD)).toBe(false);
    });

    it('a password-only body resets just the password', async () => {
      const target = await createAccount('employee');
      const before = await profile(target.id);
      const newPassword = `reset-${randomUUID()}`;
      const res = await patch(target.id, { password: newPassword }, actors.resetter);
      expect(res.status).toBe(200);
      expect(await profile(target.id)).toEqual(before);
      expect(await canSignIn(target.email, newPassword)).toBe(true);
    });

    it('a rejected profile change leaves the password untouched', async () => {
      const target = await createAccount('employee');
      const res = await patch(target.id, { role: 'platform_admin', password: `reset-${randomUUID()}` }, actors.resetter);
      expect(res.status).toBe(400);
      expect(await canSignIn(target.email, PASSWORD)).toBe(true);
    });

    it('password reset on an unknown id → 404', async () => {
      const res = await patch(randomUUID(), { password: `reset-${randomUUID()}` }, actors.resetter);
      expect(res.status).toBe(404);
      expect(res.body).toEqual(NOT_FOUND);
    });
  });

  describe('DELETE /users/:id', () => {
    it('deletes → 204: identity and profile gone, GET → 404, the old token → 401, a second delete → 404', async () => {
      const target = await createAccount('employee');
      const res = await del(target.id);
      expect(res.status).toBe(204);
      expect(res.body).toEqual({});
      expect(await admin`select 1 from auth.users where id = ${target.id}`).toHaveLength(0);
      expect(await profile(target.id)).toBeUndefined();
      const read = await request(app).get(`/api/v1/users/${target.id}`).set('Authorization', `Bearer ${actors.deleter.token}`);
      expect(read.status).toBe(404);
      expect((await me(target)).status).toBe(401);
      const again = await del(target.id);
      expect(again.status).toBe(404);
      expect(again.body).toEqual(NOT_FOUND);
    });

    it('RN-09 — their availability events and replenishment lists survive with no author', async () => {
      const target = await createAccount('employee');
      const [item] = await admin<{ id: string }[]>`
        insert into assortment_items (tenant_id, size_id, is_available) values (${store.id}, ${size.id}, true)
        returning id
      `;
      // Recorded through the API, as the user would.
      for (const type of ['out_of_stock', 'restock']) {
        const flag = await request(app)
          .post(`/api/v1/availability/${item!.id}/events`)
          .set('Authorization', `Bearer ${target.token}`)
          .send({ type });
        expect(flag.status).toBe(201);
      }
      const list = await request(app)
        .post('/api/v1/replenishment-lists')
        .set('Authorization', `Bearer ${target.token}`)
        .send({ name: `${mail} list` });
      expect(list.status).toBe(201);
      const events = await admin<{ id: string }[]>`
        select id from availability_events where assortment_item_id = ${item!.id} and created_by = ${target.id}
      `;
      expect(events).toHaveLength(2);

      expect((await del(target.id)).status).toBe(204);

      const after = await admin<{ id: string; created_by: string | null }[]>`
        select id, created_by from availability_events where assortment_item_id = ${item!.id} order by id
      `;
      expect(after.map((e) => e.id).sort()).toEqual(events.map((e) => e.id).sort());
      expect(after.every((e) => e.created_by === null)).toBe(true);
      const [listRow] = await admin<{ created_by: string | null }[]>`
        select created_by from replenishment_lists where id = ${list.body.id}
      `;
      expect(listRow).toEqual({ created_by: null });

      // The store still reads the history, author shown as unknown.
      const history = await request(app)
        .get(`/api/v1/availability/${item!.id}/events`)
        .set('Authorization', `Bearer ${actors.manager.token}`);
      expect(history.status).toBe(200);
      expect(history.body.total).toBe(2);
      expect(history.body.items.every((e: { authorName: string | null }) => e.authorName === null)).toBe(true);
    });

    it('another Platform Admin can be deleted', async () => {
      const target = await createAccount('platform_admin');
      expect((await del(target.id)).status).toBe(204);
      expect(await profile(target.id)).toBeUndefined();
    });

    it('self-deletion → 409 with a message for the UI, still there', async () => {
      const res = await del(actors.deleter.id);
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: { code: 'CONFLICT', message: 'You cannot delete your own account' } });
      expect(await profile(actors.deleter.id)).toBeDefined();
      expect((await me(actors.deleter)).status).toBe(200);
    });

    it('unknown id → 404, malformed id → 400, a query param → 400', async () => {
      const unknown = await del(randomUUID());
      expect(unknown.status).toBe(404);
      expect(unknown.body).toEqual(NOT_FOUND);
      expect((await del('not-a-uuid')).status).toBe(400);
      const query = await request(app)
        .delete(`/api/v1/users/${randomUUID()}?x=1`)
        .set('Authorization', `Bearer ${actors.deleter.token}`);
      expect(query.status).toBe(400);
    });
  });
});
