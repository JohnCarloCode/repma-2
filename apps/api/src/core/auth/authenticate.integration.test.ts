import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import express from 'express';
import { parseCookie } from 'cookie';
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTVerifyGetKey,
} from 'jose';
import postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../../config/env.js';
import { errorHandler } from '../errors.js';
import { authenticate, createAuthenticate, verifyAccessToken } from './authenticate.js';
import { SESSION_COOKIE, type SessionTokens } from './session.js';

// Sub-task 1.11 — RF-04, RF-05, AD-20, architecture.md §5.2 step 1 — and
// 1.13's transparent refresh (AD-23, RF-43) against the real local Auth. Requires
// the local Supabase stack: real users are created through Auth admin and
// signed in with the password grant, so the main path verifies genuine
// Supabase access tokens against the local JWKS. Profiles and stores are
// fixtures written over the admin connection.
const adminUrl = process.env.MIGRATIONS_DATABASE_URL;
if (!adminUrl) {
  throw new Error('MIGRATIONS_DATABASE_URL is not set — run `supabase start` and set up apps/api/.env first');
}
const admin = postgres(adminUrl);
const authAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const PASSWORD = `auth-test-${randomUUID()}`;
const issuer = new URL('/auth/v1', env.SUPABASE_URL).href;

const activeStore = randomUUID();
const suspendedStore = randomUUID();

interface Fixture {
  role: 'platform_admin' | 'manager' | 'employee';
  tenantId: string | null;
  profile: boolean;
  id: string;
  token: string;
  refreshToken: string;
}
const users: Record<'manager' | 'admin' | 'deactivated' | 'inSuspendedStore' | 'noProfile', Fixture> = {
  manager: { role: 'manager', tenantId: activeStore, profile: true, id: '', token: '', refreshToken: '' },
  admin: { role: 'platform_admin', tenantId: null, profile: true, id: '', token: '', refreshToken: '' },
  deactivated: { role: 'employee', tenantId: activeStore, profile: true, id: '', token: '', refreshToken: '' },
  inSuspendedStore: { role: 'manager', tenantId: suspendedStore, profile: true, id: '', token: '', refreshToken: '' },
  noProfile: { role: 'employee', tenantId: activeStore, profile: false, id: '', token: '', refreshToken: '' },
};

function appWith(middleware = authenticate) {
  const app = express();
  app.get('/whoami', middleware, (req, res) => {
    res.json(req.identity);
  });
  app.use(errorHandler);
  return app;
}

function cookieFor(accessToken: string, refreshToken = 'unused'): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(JSON.stringify({ accessToken, refreshToken }))}`;
}

// The response's session cookie: the tokens when (re-)issued, null when
// cleared, undefined when the response does not touch it.
function sessionCookieSet(res: request.Response): SessionTokens | null | undefined {
  const header = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (header === undefined) return undefined;
  const value = parseCookie(header.split(';')[0] ?? '')[SESSION_COOKIE];
  return value ? (JSON.parse(value) as SessionTokens) : null;
}

function expectUnauthenticated(res: request.Response) {
  expect(res.status).toBe(401);
  expect(res.body).toEqual({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
}

describe('authenticate', () => {
  beforeAll(async () => {
    await admin`
      insert into tenants (id, name, slug) values
        (${activeStore}, 'Auth Active', ${`auth-active-${activeStore}`}),
        (${suspendedStore}, 'Auth Suspended', ${`auth-suspended-${suspendedStore}`})
    `;
    const signIn = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    for (const [key, user] of Object.entries(users)) {
      const email = `auth-${key.toLowerCase()}-${randomUUID()}@repma.test`;
      const created = await authAdmin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
      if (created.error) throw created.error;
      user.id = created.data.user.id;
      if (user.profile) {
        await admin`
          insert into user_profiles (id, email, full_name, role, tenant_id)
          values (${user.id}, ${email}, ${`Auth ${key}`}, ${user.role}, ${user.tenantId})
        `;
      }
      const session = await signIn.auth.signInWithPassword({ email, password: PASSWORD });
      if (session.error) throw session.error;
      user.token = session.data.session.access_token;
      user.refreshToken = session.data.session.refresh_token;
    }
    // Deactivated after sign-in: the token stays cryptographically valid.
    await admin`update user_profiles set is_active = false where id = ${users.deactivated.id}`;
    await admin`update tenants set is_active = false where id = ${suspendedStore}`;
  });

  afterAll(async () => {
    const ids = Object.values(users).map((user) => user.id).filter(Boolean);
    await admin`delete from user_profiles where id in ${admin(ids)}`;
    for (const id of ids) await authAdmin.auth.admin.deleteUser(id);
    await admin`delete from tenants where id in ${admin([activeStore, suspendedStore])}`;
    await admin.end();
  });

  describe('valid Supabase token (local JWKS, AD-20)', () => {
    it('Bearer: loads the store user identity with its own store as tenantId', async () => {
      const res = await request(appWith()).get('/whoami').set('Authorization', `Bearer ${users.manager.token}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ userId: users.manager.id, role: 'manager', tenantId: activeStore });
    });

    it('cookie: the platform admin has no tenantId', async () => {
      const res = await request(appWith()).get('/whoami').set('Cookie', cookieFor(users.admin.token));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ userId: users.admin.id, role: 'platform_admin', tenantId: null });
    });
  });

  describe('token source priority (RF-04)', () => {
    it('uses the cookie over the Bearer header', async () => {
      const res = await request(appWith())
        .get('/whoami')
        .set('Cookie', cookieFor(users.admin.token))
        .set('Authorization', `Bearer ${users.manager.token}`);
      expect(res.status).toBe(200);
      expect(res.body.userId).toBe(users.admin.id);
    });

    it('a bad cookie is not rescued by a valid Bearer header', async () => {
      const res = await request(appWith())
        .get('/whoami')
        .set('Cookie', cookieFor('garbage', users.manager.refreshToken))
        .set('Authorization', `Bearer ${users.manager.token}`);
      expectUnauthenticated(res);
      expect(sessionCookieSet(res)).toBeUndefined(); // only an expired token triggers a refresh
    });
  });

  describe('rejected tokens → uniform 401', () => {
    it('no token', async () => {
      expectUnauthenticated(await request(appWith()).get('/whoami'));
    });

    it('garbage token', async () => {
      expectUnauthenticated(await request(appWith()).get('/whoami').set('Authorization', 'Bearer not.a.jwt'));
    });

    it('tampered Supabase token (payload changed, signature kept)', async () => {
      const [header, payload, signature] = users.manager.token.split('.') as [string, string, string];
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<string, unknown>;
      const forged = Buffer.from(JSON.stringify({ ...claims, sub: users.admin.id })).toString('base64url');
      const res = await request(appWith()).get('/whoami').set('Authorization', `Bearer ${header}.${forged}.${signature}`);
      expectUnauthenticated(res);
    });

    describe('tokens signed with a test key', () => {
      let sign: (sub: string, expiresAt: number) => Promise<string>;
      let withTestKeys: ReturnType<typeof createAuthenticate>;

      beforeAll(async () => {
        const { publicKey, privateKey } = await generateKeyPair('ES256');
        const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'ES256' };
        // The test key next to the real Supabase JWKS: an expired access token
        // is signed here, the refreshed one comes from the local Auth.
        const testKeys = createLocalJWKSet({ keys: [jwk] });
        const supabaseKeys = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
        const keys: JWTVerifyGetKey = (header, token) =>
          header.kid === 'test-key' ? testKeys(header, token) : supabaseKeys(header, token);
        withTestKeys = createAuthenticate(keys);
        sign = (sub, expiresAt) =>
          new SignJWT({ role: 'authenticated' })
            .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
            .setSubject(sub)
            .setIssuer(issuer)
            .setAudience('authenticated')
            .setIssuedAt(expiresAt - 3600)
            .setExpirationTime(expiresAt)
            .sign(privateKey);
      });

      const now = () => Math.floor(Date.now() / 1000);

      it('control: a current token with the same keys is accepted', async () => {
        const token = await sign(users.manager.id, now() + 600);
        const res = await request(appWith(withTestKeys)).get('/whoami').set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
      });

      it('expired Bearer token → 401, no refresh attempted (no refresh token)', async () => {
        const token = await sign(users.manager.id, now() - 60);
        const res = await request(appWith(withTestKeys)).get('/whoami').set('Authorization', `Bearer ${token}`);
        expectUnauthenticated(res);
        expect(sessionCookieSet(res)).toBeUndefined();
      });

      describe('transparent refresh (AD-23, RF-43)', () => {
        it('expired cookie access token + valid refresh token → request proceeds with a re-issued cookie', async () => {
          const expired = await sign(users.manager.id, now() - 60);
          const res = await request(appWith(withTestKeys))
            .get('/whoami')
            .set('Cookie', cookieFor(expired, users.manager.refreshToken));
          expect(res.status).toBe(200);
          expect(res.body).toEqual({ userId: users.manager.id, role: 'manager', tenantId: activeStore });

          const reissued = sessionCookieSet(res);
          expect(reissued?.accessToken).toBeDefined();
          expect(reissued?.accessToken).not.toBe(expired);
          expect(reissued?.refreshToken).not.toBe(users.manager.refreshToken); // Supabase rotates it
          // A genuine Supabase token for the same user, usable as is on the next request.
          expect(await verifyAccessToken(reissued?.accessToken ?? '')).toBe(users.manager.id);
          const next = await request(appWith()).get('/whoami').set('Cookie', cookieFor(reissued?.accessToken ?? ''));
          expect(next.status).toBe(200);
          expect(sessionCookieSet(next)).toBeUndefined();
        });

        it('revoked refresh token → 401 + cleared cookie', async () => {
          const signOut = await authAdmin.auth.admin.signOut(users.admin.token, 'global');
          if (signOut.error) throw signOut.error;
          const expired = await sign(users.admin.id, now() - 60);
          const res = await request(appWith(withTestKeys))
            .get('/whoami')
            .set('Cookie', cookieFor(expired, users.admin.refreshToken));
          expectUnauthenticated(res);
          expect(sessionCookieSet(res)).toBeNull();
        });

        it('a refresh token Supabase does not know → 401 + cleared cookie', async () => {
          const expired = await sign(users.manager.id, now() - 60);
          const res = await request(appWith(withTestKeys)).get('/whoami').set('Cookie', cookieFor(expired, 'not-a-token'));
          expectUnauthenticated(res);
          expect(sessionCookieSet(res)).toBeNull();
        });

        it('the refreshed identity still goes through the profile load (RF-05)', async () => {
          const expired = await sign(users.deactivated.id, now() - 60);
          const res = await request(appWith(withTestKeys))
            .get('/whoami')
            .set('Cookie', cookieFor(expired, users.deactivated.refreshToken));
          expectUnauthenticated(res);
        });
      });

      it('a key outside the Supabase JWKS (forged token)', async () => {
        const token = await sign(users.manager.id, now() + 600);
        expectUnauthenticated(await request(appWith()).get('/whoami').set('Authorization', `Bearer ${token}`));
      });
    });
  });

  describe('per-request profile load (RF-05)', () => {
    it('deactivated user', async () => {
      const res = await request(appWith()).get('/whoami').set('Authorization', `Bearer ${users.deactivated.token}`);
      expectUnauthenticated(res);
    });

    it('active user of a deactivated store', async () => {
      const res = await request(appWith()).get('/whoami').set('Authorization', `Bearer ${users.inSuspendedStore.token}`);
      expectUnauthenticated(res);
    });

    it('authenticated in Supabase but without a profile', async () => {
      const res = await request(appWith()).get('/whoami').set('Authorization', `Bearer ${users.noProfile.token}`);
      expectUnauthenticated(res);
    });
  });
});
