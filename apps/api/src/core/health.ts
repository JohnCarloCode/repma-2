import type { NextFunction, Request, Response } from 'express';
import { emptyQuery } from 'shared';
import { AppError } from './errors.js';
import { validate } from './http/validate.js';

// Factory so the liveness+DB-ping logic (RNF-10) is testable with a fake
// `ping` — no real database needed to prove the 503 branch (app.test.ts).
export function createHealthHandler(ping: () => Promise<void>) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    validate(emptyQuery, req.query); // RNF-08 — no query params
    try {
      await ping();
      res.json({ status: 'ok' });
    } catch {
      next(new AppError(503, 'SERVICE_UNAVAILABLE', 'Database is unreachable'));
    }
  };
}
