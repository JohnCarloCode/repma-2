import { parseCookie } from 'cookie';
import type { CookieOptions, Response } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';

// AD-12 / AD-23 — the API-managed HttpOnly session cookie carries the
// Supabase access and refresh tokens as one JSON value. Written on login,
// cleared on logout, re-issued by `authenticate` on refresh.
export const SESSION_COOKIE = 'repma_session';

const sessionTokens = z.object({ accessToken: z.string().min(1), refreshToken: z.string().min(1) });
export type SessionTokens = z.infer<typeof sessionTokens>;

// The session cookie's tokens; `undefined` when there is no session cookie,
// `null` when there is one but it is not a well-formed session.
export function readSessionCookie(cookieHeader: string | undefined): SessionTokens | null | undefined {
  if (!cookieHeader) return undefined;
  const value = parseCookie(cookieHeader)[SESSION_COOKIE];
  if (value === undefined) return undefined;
  try {
    const result = sessionTokens.safeParse(JSON.parse(value));
    return result.success ? result.data : null;
  } catch {
    return null; // not JSON
  }
}

// RF-04 — the cookie takes priority: when a session cookie is present, it is
// the only credential considered (a broken cookie is a 401, never a silent
// fall back to the header). Without one, `Authorization: Bearer <token>`.
// Returns null when there is no usable token.
export function extractAccessToken(headers: { cookie?: string; authorization?: string }): string | null {
  const session = readSessionCookie(headers.cookie);
  if (session !== undefined) return session?.accessToken ?? null;

  const match = /^Bearer\s+(\S+)\s*$/i.exec(headers.authorization ?? '');
  return match?.[1] ?? null;
}

// RF-01 / RNF-03 — HttpOnly (browser JS never sees a token), SameSite=Lax,
// Secure in production only (local dev runs over plain http). No maxAge: a
// browser-session cookie; the tokens inside carry their own lifetimes.
export function sessionCookieOptions(production = env.NODE_ENV === 'production'): CookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure: production, path: '/' };
}

export function setSessionCookie(res: Response, tokens: SessionTokens): void {
  res.cookie(SESSION_COOKIE, JSON.stringify(tokens), sessionCookieOptions()); // Express URL-encodes the value
}

// Same attributes as when set, or browsers keep the cookie.
export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
}
