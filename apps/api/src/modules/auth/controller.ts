import type { Request, Response } from 'express';
import { emptyQuery, loginBody } from 'shared';
import { clearSessionCookie, setSessionCookie } from '../../core/auth/session.js';
import { validate } from '../../core/http/validate.js';
import * as service from './service.js';

// RF-01 — the tokens travel only in the HttpOnly cookie; the body is the
// session (same shape as /me), never a token.
export async function login(req: Request, res: Response): Promise<void> {
  validate(emptyQuery, req.query);
  const { tokens, session } = await service.login(validate(loginBody, req.body));
  setSessionCookie(res, tokens);
  res.json(session);
}

// RF-03 — invalidates the cookie (the Supabase session is not revoked).
// Bodiless: any body is ignored (architecture.md §8).
export function logout(req: Request, res: Response): void {
  validate(emptyQuery, req.query);
  clearSessionCookie(res);
  res.status(204).end();
}

// RF-02
export async function me(req: Request, res: Response): Promise<void> {
  if (!req.identity) throw new Error('auth/me mounted without authenticate');
  validate(emptyQuery, req.query);
  res.json(await service.getSession(req.identity));
}
