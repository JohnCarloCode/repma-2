import type { RequestHandler } from 'express';
import { hasPermission, type Permission } from 'shared';
import { AppError } from '../errors.js';

// architecture.md §6 — one uniform 403 for every authorization refusal
// (missing permission here, a foreign X-Tenant-Id in tenantContext): the
// client never learns which check failed.
export function forbidden(): AppError {
  return new AppError(403, 'FORBIDDEN', 'You do not have permission to perform this action');
}

// architecture.md §6 — per-route permission check against the shared matrix
// (`packages/shared/src/permissions.ts`); no second matrix lives here.
export function authorize(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    // A missing identity is a mounting bug (authorize before authenticate).
    if (!req.identity) throw new Error('authorize mounted before authenticate');
    if (!hasPermission(req.identity, permission)) throw forbidden();
    next();
  };
}
