import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { app } from '../../app.js';
import { env } from '../../config/env.js';

// Sub-task 7.3 — RF-10 `POST /users`: Supabase Auth identity + profile,
// compensated (architecture.md §9); role↔store coherence (RN-01) and the
// store's existence/activity are 400s before anything is written; a taken
// email is a 409. `user:manage`, global router, write limiter. Requires the
// local Supabase stack.

// Switch for the compensation case: when set, the profile insert fails after
// the Auth identity was created.
const failure = vi.hoisted(() => ({ profileInsert: false }));

vi.mock('./repository.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('./repository.js')>();
  return {
    ...original,
    insertUserProfile: (...args: Parameters<typeof original.insertUserProfile>) =>
      failure.profileInsert ? Promise.reject(new Error('profile insert failed')) : original.insertUserProfile(...args),
  };
});

const adminUrl = process.env.MIGRATIONS_DATABASE_URL;
if (!adminUrl) {
  throw new Error('MIGRATIONS_DATABASE_URL is not set — run `supabase start` and set up apps/api/.env first');
}

const admin = postgres(adminUrl);
const authAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const signIn = () => createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });

const PASSWORD = `users-create-${randomUUID()}`;
// Every email this suite creates starts with `mail`, so afterAll can sweep
// whatever a failing case left behind.
const mail = `uc${randomUUID().slice(0, 8)}`;
const storeA = { id: randomUUID(), name: `${mail} Store A`, slug: `${mail}-store-a` };
const storeB = { id: randomUUID(), name: `${mail} Store B`, slug: `${mail}-store-b` }; // deactivated

interface Fixture {
  role: 'platform_admin' | 'manager' | 'employee';
  tenantId: string | null;
  email: string;
  id: string;
  token: string;
}

function fixture(role: Fixture['role'], tenantId: string | null, name: string): Fixture {
  return { role, tenantId, email: `${mail}-fixture-${name}@repma.test`, id: '', token: '' };
}

// Several admins: the write limiter (30/min per user) is real.
const users = {
  admin: fixture('platform_admin', null, 'admin'),
  admin2: fixture('platform_admin', null, 'admin2'),
  admin3: fixture('platform_admin', null, 'admin3'),
  manager: fixture('manager', storeA.id, 'manager'),
  employee: fixture('employee', storeA.id, 'employee'),
};
const FIXTURES = Object.values(users);
const FORBIDDEN = { error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action' } };

let counter = 0;
function newEmail(): string {
  counter += 1;
  return `${mail}-new${counter}@repma.test`;
}

function body(overrides: Record<string, unknown> = {}) {
  return { email: newEmail(), password: PASSWORD, fullName: 'New User', role: 'employee', tenantId: storeA.id, ...overrides };
}

function post(payload: unknown, user: Fixture = users.admin) {
  return request(app).post('/api/v1/users').set('Authorization', `Bearer ${user.token}`).send(payload as object);
}

async function authUserIds(email: string): Promise<string[]> {
  const rows = await admin<{ id: string }[]>`select id from auth.users where email = ${email}`;
  return rows.map((row) => row.id);
}

function expectValidation(res: request.Response, path: string, message?: string) {
  expect(res.status).toBe(400);
  expect(res.body.error.code).toBe('VALIDATION_ERROR');
  const issue = res.body.error.details.find((d: { path: string }) => d.path === path);
  expect(issue).toBeDefined();
  if (message) expect(issue.message).toBe(message);
}

describe('users create (RF-10)', () => {
  beforeAll(async () => {
    await admin`insert into tenants (id, name, slug) values (${storeA.id}, ${storeA.name}, ${storeA.slug})`;
    await admin`insert into tenants (id, name, slug, is_active) values (${storeB.id}, ${storeB.name}, ${storeB.slug}, false)`;
    for (const user of FIXTURES) {
      const result = await authAdmin.auth.admin.createUser({ email: user.email, password: PASSWORD, email_confirm: true });
      if (result.error) throw result.error;
      user.id = result.data.user.id;
      await admin`
        insert into user_profiles (id, email, full_name, role, tenant_id)
        values (${user.id}, ${user.email}, ${user.role}, ${user.role}, ${user.tenantId})
      `;
      const session = await signIn().auth.signInWithPassword({ email: user.email, password: PASSWORD });
      if (session.error) throw session.error;
      user.token = session.data.session.access_token;
    }
  });

  afterAll(async () => {
    // Profiles fall with their identities (ON DELETE CASCADE).
    const rows = await admin<{ id: string }[]>`select id from auth.users where email like ${`${mail}-%`}`;
    for (const { id } of rows) await authAdmin.auth.admin.deleteUser(id);
    await admin`delete from tenants where id in ${admin([storeA.id, storeB.id])}`;
    await admin.end();
  });

  describe('access', () => {
    it('without a session → 401', async () => {
      const res = await request(app).post('/api/v1/users').send(body());
      expect(res.status).toBe(401);
    });

    it.each(['manager', 'employee'] as const)('%s (no user:manage) → uniform 403, nothing created', async (role) => {
      const payload = body();
      const res = await post(payload, users[role]);
      expect(res.status).toBe(403);
      expect(res.body).toEqual(FORBIDDEN);
      expect(await authUserIds(payload.email)).toEqual([]);
    });

    it('rides the write limiter, without any X-Tenant-Id', async () => {
      const res = await post(body());
      expect(res.status).toBe(201);
      expect(res.headers['ratelimit-limit']).toBe('30');
    });
  });

  describe('happy paths', () => {
    it.each([
      ['manager', storeA.id],
      ['employee', storeA.id],
      ['platform_admin', undefined],
    ] as const)('creates a %s → 201 User, re-read from the profile', async (role, tenantId) => {
      const payload = body({ role, tenantId, fullName: `  ${mail} ${role}  ` });
      const res = await post(payload);
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id: expect.any(String),
        email: payload.email,
        fullName: `${mail} ${role}`,
        role,
        isActive: true,
        tenant: tenantId ? { id: storeA.id, name: storeA.name, isActive: true } : null,
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });
      // The identity and the profile share the id; the email is the profile's copy.
      expect(await authUserIds(payload.email)).toEqual([res.body.id]);
      const [profile] = await admin`select email, role, tenant_id from user_profiles where id = ${res.body.id}`;
      expect(profile).toEqual({ email: payload.email, role, tenant_id: tenantId ?? null });
      // GET /users/:id answers the same user.
      const read = await request(app).get(`/api/v1/users/${res.body.id}`).set('Authorization', `Bearer ${users.admin.token}`);
      expect(read.body).toEqual(res.body);
    });

    it('normalizes the email (trimmed, lowercased) and never returns the password', async () => {
      const email = newEmail();
      const res = await post(body({ email: `  ${email.toUpperCase()} ` }), users.admin2);
      expect(res.status).toBe(201);
      expect(res.body.email).toBe(email);
      expect(JSON.stringify(res.body)).not.toContain(PASSWORD);
      expect(Object.keys(res.body)).not.toContain('password');
    });

    it('the created user can sign in with the given password and reach the API', async () => {
      const payload = body({ role: 'manager' });
      expect((await post(payload, users.admin2)).status).toBe(201);
      const session = await signIn().auth.signInWithPassword({ email: payload.email, password: PASSWORD });
      expect(session.error).toBeNull();
      const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${session.data.session!.access_token}`);
      expect(me.status).toBe(200);
      expect(me.body.role).toBe('manager');
      expect(me.body.store).toEqual({ id: storeA.id, name: storeA.name });
    });
  });

  describe('validation (400 before anything is written)', () => {
    it.each([
      [{ role: 'manager', tenantId: undefined }, 'Select a store'],
      [{ role: 'employee', tenantId: undefined }, 'Select a store'],
      [{ role: 'platform_admin', tenantId: storeA.id }, 'A Platform Admin does not belong to a store'],
    ])('role↔store coherence (RN-01) %o → 400 on tenantId', async (overrides, message) => {
      const payload = body(overrides);
      const res = await post(payload, users.admin2);
      expectValidation(res, 'tenantId', message);
      expect(await authUserIds(payload.email)).toEqual([]);
    });

    it('unknown store → 400 on tenantId "Store not found"', async () => {
      const payload = body({ tenantId: randomUUID() });
      const res = await post(payload, users.admin2);
      expectValidation(res, 'tenantId', 'Store not found');
      expect(await authUserIds(payload.email)).toEqual([]);
    });

    it('deactivated store → 400 on tenantId "This store is inactive"', async () => {
      const payload = body({ tenantId: storeB.id });
      const res = await post(payload, users.admin2);
      expectValidation(res, 'tenantId', 'This store is inactive');
      expect(await authUserIds(payload.email)).toEqual([]);
    });

    it.each([
      [{ email: 'not-an-email' }, 'email', 'Enter a valid email address'],
      [{ email: undefined }, 'email', 'Enter a valid email address'],
      [{ password: 'short' }, 'password', 'Password must be at least 8 characters'],
      [{ password: 'x'.repeat(73) }, 'password', 'Password must be at most 72 characters'],
      [{ fullName: '   ' }, 'fullName', 'Full name is required'],
      [{ fullName: 'x'.repeat(121) }, 'fullName', 'Full name must be at most 120 characters'],
      [{ role: 'owner' }, 'role', 'Select a role'],
      [{ tenantId: 'not-a-uuid' }, 'tenantId', 'Select a store'],
      [{ isActive: false }, 'isActive', 'Unknown field'],
    ])('%o → 400 on %s', async (overrides, path, message) => {
      expectValidation(await post(body(overrides), users.admin3), path, message);
    });

    it('a query param → 400', async () => {
      const res = await request(app)
        .post('/api/v1/users')
        .query({ x: '1' })
        .set('Authorization', `Bearer ${users.admin3.token}`)
        .send(body());
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('duplicate email → 409', () => {
    it('an email already registered (any case) → 409, the existing user untouched', async () => {
      const res = await post(body({ email: users.manager.email.toUpperCase() }), users.admin3);
      expect(res.status).toBe(409);
      expect(res.body).toEqual({ error: { code: 'CONFLICT', message: 'A user with this email already exists' } });
      expect(await authUserIds(users.manager.email)).toEqual([users.manager.id]);
    });

    it('an email only a profile holds → 409 and the just-created identity is removed (compensation)', async () => {
      // A profile whose denormalized email has no matching Auth identity: Auth
      // accepts the email, the profile's UNIQUE rejects it.
      const email = newEmail();
      await admin`update user_profiles set email = ${email} where id = ${users.employee.id}`;
      try {
        const res = await post(body({ email }), users.admin3);
        expect(res.status).toBe(409);
        expect(res.body.error.message).toBe('A user with this email already exists');
        expect(await authUserIds(email)).toEqual([]);
      } finally {
        await admin`update user_profiles set email = ${users.employee.email} where id = ${users.employee.id}`;
      }
    });
  });

  describe('compensation (architecture.md §9)', () => {
    it('the profile insert fails → 500, the Auth identity is deleted, no profile left', async () => {
      const payload = body({ role: 'manager' });
      failure.profileInsert = true;
      try {
        const res = await post(payload, users.admin3);
        expect(res.status).toBe(500);
        expect(res.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
      } finally {
        failure.profileInsert = false;
      }
      expect(await authUserIds(payload.email)).toEqual([]);
      expect(await admin`select id from user_profiles where email = ${payload.email}`).toHaveLength(0);
      const session = await signIn().auth.signInWithPassword({ email: payload.email, password: PASSWORD });
      expect(session.error).not.toBeNull();
      // Nothing orphaned: the same email can be created right after.
      expect((await post(payload, users.admin3)).status).toBe(201);
    });
  });
});
