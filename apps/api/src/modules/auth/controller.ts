import type { Request, Response } from 'express';
import { loginBody } from 'shared';
import { clearSessionCookie, setSessionCookie } from '../../core/auth/session.js';
import { validate } from '../../core/http/validate.js';
import * as service from './service.js';

// RF-01 — the tokens travel only in the HttpOnly cookie; the body is the
// session (same shape as /me), never a token.
export async function login(req: Request, res: Response): Promise<void> {
  const { tokens, session } = await service.login(validate(loginBody, req.body));
  setSessionCookie(res, tokens);
  res.json(session);
}

// RF-03 — invalidates the cookie (the Supabase session is not revoked).
export function logout(_req: Request, res: Response): void {
  clearSessionCookie(res);
  res.status(204).end();
}

// RF-02
export async function me(req: Request, res: Response): Promise<void> {
  if (!req.identity) throw new Error('auth/me mounted without authenticate');
  res.json(await service.getSession(req.identity));
}
