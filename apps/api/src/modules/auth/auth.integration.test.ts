import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { PERMISSIONS, rolePermissions } from 'shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../app.js';
import { env } from '../../config/env.js';
import { SESSION_COOKIE } from '../../core/auth/session.js';

// Sub-task 1.12 — RF-01/02/03, RNF-03, AD-12, RNF-07. Requires the local
// Supabase stack: real users are created through Auth admin and log in through
// the real app (Supabase password grant). Profiles and stores are fixtures
// written over the admin connection — no dependence on the demo seed.
//
// Every request carries its own X-Forwarded-For (`trust proxy`, RNF-09), so
// each test gets a fresh per-IP login bucket and only the rate-limit test
// exhausts one.

const adminUrl = process.env.MIGRATIONS_DATABASE_URL;
if (!adminUrl) {
  throw new Error('MIGRATIONS_DATABASE_URL is not set — run `supabase start` and set up apps/api/.env first');
}
const admin = postgres(adminUrl);
const authAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const PASSWORD = `login-test-${randomUUID()}`;
const activeStore = { id: randomUUID(), name: 'Login Active Store' };
const suspendedStore = { id: randomUUID(), name: 'Login Suspended Store' };

interface Fixture {
  role: 'platform_admin' | 'manager' | 'employee';
  tenantId: string | null;
  id: string;
  email: string;
}

const users: Record<'manager' | 'admin' | 'deactivated' | 'inSuspendedStore', Fixture> = {
  manager: { role: 'manager', tenantId: activeStore.id, id: '', email: '' },
  admin: { role: 'platform_admin', tenantId: null, id: '', email: '' },
  deactivated: { role: 'employee', tenantId: activeStore.id, id: '', email: '' },
  inSuspendedStore: { role: 'manager', tenantId: suspendedStore.id, id: '', email: '' },
};

let ipCounter = 0;
function freshIp(): string {
  ipCounter += 1;
  return `203.0.113.${ipCounter}`;
}

function setCookies(res: request.Response): string[] {
  const header = res.headers['set-cookie'] as unknown;
  return Array.isArray(header) ? (header as string[]) : [];
}

function sessionSetCookie(res: request.Response): string | undefined {
  return setCookies(res).find((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`));
}

function login(body: unknown, ip = freshIp()) {
  return request(app).post('/api/v1/auth/login').set('X-Forwarded-For', ip).send(body as object);
}

describe('auth endpoints', () => {
  beforeAll(async () => {
    await admin`
      insert into tenants (id, name, slug) values
        (${activeStore.id}, ${activeStore.name}, ${`login-active-${activeStore.id}`}),
        (${suspendedStore.id}, ${suspendedStore.name}, ${`login-suspended-${suspendedStore.id}`})
    `;
    for (const [key, user] of Object.entries(users)) {
      user.email = `login-${key.toLowerCase()}-${randomUUID()}@repma.test`;
      const created = await authAdmin.auth.admin.createUser({ email: user.email, password: PASSWORD, email_confirm: true });
      if (created.error) throw created.error;
      user.id = created.data.user.id;
      await admin`
        insert into user_profiles (id, email, full_name, role, tenant_id)
        values (${user.id}, ${user.email}, ${`Login ${key}`}, ${user.role}, ${user.tenantId})
      `;
    }
    await admin`update user_profiles set is_active = false where id = ${users.deactivated.id}`;
    await admin`update tenants set is_active = false where id = ${suspendedStore.id}`;
  });

  afterAll(async () => {
    const ids = Object.values(users).map((user) => user.id).filter(Boolean);
    await admin`delete from user_profiles where id in ${admin(ids)}`;
    for (const id of ids) await authAdmin.auth.admin.deleteUser(id);
    await admin`delete from tenants where id in ${admin([activeStore.id, suspendedStore.id])}`;
    await admin.end();
  });

  describe('login → me → logout round-trip (RF-01, RF-02, RF-03)', () => {
    it('a store user logs in, reads its session through the cookie, and logs out', async () => {
      const agent = request.agent(app);
      const ip = freshIp();
      const expectedSession = {
        user: { id: users.manager.id, email: users.manager.email, fullName: 'Login manager' },
        role: 'manager',
        store: activeStore,
        permissions: [...rolePermissions.manager],
      };

      const loggedIn = await agent
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email: users.manager.email, password: PASSWORD });
      expect(loggedIn.status).toBe(200);
      expect(loggedIn.body).toEqual(expectedSession);
      expect(loggedIn.headers['ratelimit-limit']).toBe('10');

      // The tokens travel only in the cookie, never in the body (AD-12).
      const cookie = sessionSetCookie(loggedIn);
      expect(cookie).toBeDefined();
      const tokens = JSON.parse(decodeURIComponent(cookie!.split(';')[0]!.slice(SESSION_COOKIE.length + 1))) as {
        accessToken: string;
        refreshToken: string;
      };
      expect(tokens.accessToken).toMatch(/^ey/);
      expect(tokens.refreshToken).not.toBe('');
      expect(JSON.stringify(loggedIn.body)).not.toContain(tokens.accessToken);

      const me = await agent.get('/api/v1/auth/me').set('X-Forwarded-For', ip);
      expect(me.status).toBe(200);
      expect(me.body).toEqual(expectedSession);
      expect(me.headers['ratelimit-limit']).toBe('100'); // read family, per user

      const loggedOut = await agent.post('/api/v1/auth/logout').set('X-Forwarded-For', ip);
      expect(loggedOut.status).toBe(204);
      expect(loggedOut.headers['ratelimit-limit']).toBe('30'); // write family, per user
      expect(sessionSetCookie(loggedOut)).toMatch(/Expires=Thu, 01 Jan 1970/);

      // The agent's jar dropped the cleared cookie: no session any more.
      const after = await agent.get('/api/v1/auth/me').set('X-Forwarded-For', ip);
      expect(after.status).toBe(401);
    });

    it('the Platform Admin has no store and every permission', async () => {
      const res = await login({ email: users.admin.email, password: PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        user: { id: users.admin.id, email: users.admin.email, fullName: 'Login admin' },
        role: 'platform_admin',
        store: null,
        permissions: [...PERMISSIONS],
      });
    });
  });

  describe('session cookie attributes (RF-01, RNF-03)', () => {
    it('is HttpOnly, SameSite=Lax, Path=/, and not Secure outside production', async () => {
      const res = await login({ email: users.admin.email, password: PASSWORD });
      const attributes = sessionSetCookie(res)!
        .split(';')
        .slice(1)
        .map((part) => part.trim().toLowerCase());
      expect(attributes).toContain('httponly');
      expect(attributes).toContain('samesite=lax');
      expect(attributes).toContain('path=/');
      expect(attributes).not.toContain('secure');
    });
  });

  describe('uniform 401 (login.md: the client never learns which case)', () => {
    const cases: [string, () => { email: string; password: string }][] = [
      ['wrong password', () => ({ email: users.manager.email, password: 'wrong-password' })],
      ['unknown email', () => ({ email: `nobody-${randomUUID()}@repma.test`, password: PASSWORD })],
      ['deactivated user', () => ({ email: users.deactivated.email, password: PASSWORD })],
      ['active user of a deactivated store', () => ({ email: users.inSuspendedStore.email, password: PASSWORD })],
    ];

    it.each(cases)('%s → the same 401, no cookie', async (_name, body) => {
      const res = await login(body());
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
      expect(sessionSetCookie(res)).toBeUndefined();
    });
  });

  describe('body validation (RNF-08, shared loginBody)', () => {
    it('invalid email and empty password → 400 per field', async () => {
      const res = await login({ email: 'not-an-email', password: '' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toEqual([
        { path: 'email', message: 'Enter a valid email address' },
        { path: 'password', message: 'Password is required' },
      ]);
    });

    it('an extra field → 400 "Unknown field" (whitelist)', async () => {
      const res = await login({ email: users.manager.email, password: PASSWORD, role: 'platform_admin' });
      expect(res.status).toBe(400);
      expect(res.body.error.details).toEqual([{ path: 'role', message: 'Unknown field' }]);
      expect(sessionSetCookie(res)).toBeUndefined();
    });

    it('no body → 400', async () => {
      const res = await request(app).post('/api/v1/auth/login').set('X-Forwarded-For', freshIp());
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
    it('a query param on login, me or logout → 400 "Unknown field" (RNF-08)', async () => {
      const agent = request.agent(app);
      const ip = freshIp();
      const query = await agent
        .post('/api/v1/auth/login?next=x')
        .set('X-Forwarded-For', ip)
        .send({ email: users.manager.email, password: PASSWORD });
      expect(query.status).toBe(400);
      expect(query.body.error.details).toEqual([{ path: 'next', message: 'Unknown field' }]);

      const loggedIn = await agent
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email: users.manager.email, password: PASSWORD });
      expect(loggedIn.status).toBe(200);
      const me = await agent.get('/api/v1/auth/me?x=1').set('X-Forwarded-For', ip);
      expect(me.status).toBe(400);
      expect(me.body.error.details).toEqual([{ path: 'x', message: 'Unknown field' }]);
      const logout = await agent.post('/api/v1/auth/logout?x=1').set('X-Forwarded-For', ip);
      expect(logout.status).toBe(400);
      expect(sessionSetCookie(logout)).toBeUndefined();
    });
  });

  describe('login rate limit (RNF-07: 10/min per IP, pre-auth)', () => {
    it('the 11th attempt from one IP → 429; another IP is unaffected', async () => {
      const ip = freshIp();
      for (let attempt = 1; attempt <= 10; attempt++) {
        const res = await login({}, ip);
        expect(res.status).toBe(400);
        expect(res.headers['ratelimit-limit']).toBe('10');
      }
      const limited = await login({}, ip);
      expect(limited.status).toBe(429);
      expect(limited.body.error.code).toBe('RATE_LIMITED');
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);

      expect((await login({})).status).toBe(400);
    });
  });

  describe('without a session → 401 (authenticate before the per-user limiter)', () => {
    it.each([
      ['GET', '/api/v1/auth/me'],
      ['POST', '/api/v1/auth/logout'],
    ])('%s %s', async (method, path) => {
      const req = method === 'GET' ? request(app).get(path) : request(app).post(path);
      const res = await req.set('X-Forwarded-For', freshIp());
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
      expect(res.headers['ratelimit-limit']).toBeUndefined();
    });

    it('a garbage session cookie on /me → 401', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('X-Forwarded-For', freshIp())
        .set('Cookie', `${SESSION_COOKIE}=garbage`);
      expect(res.status).toBe(401);
    });
  });
});
