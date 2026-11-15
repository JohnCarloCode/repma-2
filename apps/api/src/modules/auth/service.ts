import { isAuthApiError } from '@supabase/supabase-js';
import { rolePermissions, type AuthSession, type LoginBody } from 'shared';
import { loadIdentity, type Identity } from '../../core/auth/authenticate.js';
import type { SessionTokens } from '../../core/auth/session.js';
import { AppError } from '../../core/errors.js';
import { requestContext } from '../../core/tenant/context.js';
import { createAuthClient } from '../../lib/supabase.js';
import { findSession } from './repository.js';

// login.md — wrong credentials, a deactivated user and a user of a
// deactivated store all get this exact 401: the client never learns which.
function invalidCredentials(): AppError {
  return new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
}

// RF-02 — user, role, store (null for the Platform Admin) and the effective
// permissions from the shared matrix (architecture.md §6).
export async function getSession(identity: Identity): Promise<AuthSession> {
  const row = await findSession(identity);
  // authenticate/login just loaded this active profile; missing now = a race
  // with a deletion, so the session is simply gone.
  if (!row) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
  return {
    user: { id: identity.userId, email: row.email, fullName: row.fullName },
    role: identity.role,
    store: row.storeId && row.storeName ? { id: row.storeId, name: row.storeName } : null,
    permissions: rolePermissions[identity.role],
  };
}

// RF-01 — Supabase password grant via the anon key, then the same profile
// gate `authenticate` applies on every request (RF-05), so a deactivated
// account never receives a session.
export async function login({ email, password }: LoginBody): Promise<{ tokens: SessionTokens; session: AuthSession }> {
  const { data, error } = await createAuthClient().auth.signInWithPassword({ email, password });
  if (error) {
    if (isAuthApiError(error) && error.status === 429) {
      throw new AppError(429, 'RATE_LIMITED', 'Too many requests, try again later');
    }
    // 4xx from Supabase Auth = the credentials were refused (invalid_credentials,
    // email_not_confirmed, …). Anything else (unreachable, 5xx) is ours: 500.
    if (isAuthApiError(error) && error.status >= 400 && error.status < 500) throw invalidCredentials();
    throw error;
  }

  const identity = await loadIdentity(data.user.id);
  if (!identity) throw invalidCredentials();

  return {
    tokens: { accessToken: data.session.access_token, refreshToken: data.session.refresh_token },
    // No `authenticate` ran on login: the identity context starts here.
    session: await requestContext.run({ ...identity }, () => getSession(identity)),
  };
}
