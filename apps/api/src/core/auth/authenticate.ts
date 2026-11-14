import { eq } from 'drizzle-orm';
import { isAuthApiError } from '@supabase/supabase-js';
import type { RequestHandler, Response } from 'express';
import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Role } from 'shared';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { tenants } from '../../db/schema/tenants.js';
import { userProfiles } from '../../db/schema/userProfiles.js';
import { withSessionBootstrap, withTenantContext } from '../../db/withTenantContext.js';
import { AppError } from '../errors.js';
import { createAuthClient } from '../../lib/supabase.js';
import { requestContext } from '../tenant/context.js';
import { clearSessionCookie, extractAccessToken, readSessionCookie, setSessionCookie } from './session.js';

// architecture.md §5.2 step 1 — who is calling. `tenantId` is the user's OWN
// store (null for the Platform Admin), not yet the active tenant: that is
// resolved by tenantContext (1.14) on tenant-scoped routers.
export interface Identity {
  userId: string;
  role: Role;
  tenantId: string | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    identity?: Identity;
  }
}

// AD-20 — Supabase signs access tokens with asymmetric keys published at the
// project's JWKS endpoint. jose fetches it once, caches the keys and only
// refetches on an unknown `kid` (rotation), so verification is local.
const supabaseAuthUrl = new URL('/auth/v1', env.SUPABASE_URL).href;
const supabaseJwks = createRemoteJWKSet(new URL(`${supabaseAuthUrl}/.well-known/jwks.json`));

const subject = z.uuid();

// The verified token's user id. Throws a jose error when the token is not
// acceptable (malformed, bad signature, expired, wrong issuer/audience) —
// `authenticate` branches on `errors.JWTExpired` to refresh instead of rejecting.
export async function verifyAccessToken(token: string, keys: JWTVerifyGetKey = supabaseJwks): Promise<string> {
  const { payload } = await jwtVerify(token, keys, {
    issuer: supabaseAuthUrl,
    audience: 'authenticated',
    algorithms: ['ES256', 'RS256'], // asymmetric only — never a shared secret
  });
  const result = subject.safeParse(payload.sub);
  if (!result.success) throw new errors.JWTClaimValidationFailed('invalid "sub" claim', payload, 'sub');
  return result.data;
}

// RF-05 — the profile is loaded on every request, which is what makes
// deactivation effective before the token expires (AD-20). null when the user
// has no profile, is inactive, or belongs to an inactive store.
export async function loadIdentity(userId: string): Promise<Identity | null> {
  // database.md §7.3 session bootstrap: only app.user_id is known yet.
  const [profile] = await withSessionBootstrap(userId, (tx) =>
    tx
      .select({ role: userProfiles.role, tenantId: userProfiles.tenantId, isActive: userProfiles.isActive })
      .from(userProfiles)
      .where(eq(userProfiles.id, userId)),
  );
  if (!profile?.isActive) return null;

  const identity: Identity = { userId, role: profile.role, tenantId: profile.tenantId };
  if (identity.tenantId === null) return identity;

  // Store user: with the profile known, the full context lets RLS show the
  // store its own `tenants` row (§7.3), whose is_active is checked here.
  const tenantId = identity.tenantId;
  const [store] = await requestContext.run(identity, () =>
    withTenantContext((tx) => tx.select({ isActive: tenants.isActive }).from(tenants).where(eq(tenants.id, tenantId))),
  );
  return store?.isActive ? identity : null;
}

// One uniform 401 for every failure: the client never learns which check
// failed (login.md relies on the same rule for credentials).
function unauthenticated(): AppError {
  return new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
}

// Errors that mean "this token is not acceptable" → 401. Anything else
// (JWKS endpoint unreachable or broken, DB down) is a server error.
function toHttpError(error: unknown): unknown {
  const rejected =
    error instanceof errors.JOSEError && !(error instanceof errors.JWKSTimeout) && !(error instanceof errors.JWKSInvalid);
  return rejected ? unauthenticated() : error;
}

// AD-23 / RF-43 — trades the cookie's refresh token for a new session and
// re-issues the cookie. Supabase refusing the refresh token (revoked, expired,
// already used: a 4xx) ends the session: cookie cleared + the uniform 401.
// A 429 is passed on; Supabase unreachable or 5xx is ours (500), as on login.
async function refreshSession(res: Response, refreshToken: string): Promise<string> {
  const { data, error } = await createAuthClient().auth.refreshSession({ refresh_token: refreshToken });
  if (error) {
    if (isAuthApiError(error) && error.status === 429) {
      throw new AppError(429, 'RATE_LIMITED', 'Too many requests, try again later');
    }
    if (isAuthApiError(error) && error.status >= 400 && error.status < 500) {
      clearSessionCookie(res);
      throw unauthenticated();
    }
    throw error;
  }
  if (!data.session) throw new Error('Supabase refresh returned no session');
  setSessionCookie(res, { accessToken: data.session.access_token, refreshToken: data.session.refresh_token });
  return data.session.access_token;
}

// `keys` is injectable so tests can verify tokens they sign themselves
// (e.g. an already-expired one); the app uses the Supabase JWKS.
export function createAuthenticate(keys: JWTVerifyGetKey = supabaseJwks): RequestHandler {
  return async (req, res, next) => {
    const token = extractAccessToken(req.headers);
    if (!token) throw unauthenticated();

    let userId: string;
    try {
      userId = await verifyAccessToken(token, keys);
    } catch (error) {
      // Only the cookie carries a refresh token (and, when present, it is the
      // token's source — RF-04); an expired Bearer token is a plain 401.
      const refreshToken = readSessionCookie(req.headers.cookie)?.refreshToken;
      if (!(error instanceof errors.JWTExpired && refreshToken)) throw toHttpError(error);
      const refreshed = await refreshSession(res, refreshToken);
      userId = await verifyAccessToken(refreshed, keys).catch((refreshedError: unknown) => {
        throw toHttpError(refreshedError);
      });
    }

    // RF-05 applies to a refreshed identity exactly as to any other.
    const identity = await loadIdentity(userId);
    if (!identity) throw unauthenticated();

    // §5.2 step 1 — the identity context: what global routers run under
    // (store users keep their own store, the Platform Admin none). On
    // tenant-scoped routers `tenantContext` replaces it with the active tenant.
    req.identity = identity;
    requestContext.run({ ...identity }, next);
  };
}

export const authenticate = createAuthenticate();
