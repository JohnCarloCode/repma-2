import { Router } from 'express';
import { authenticate } from '../../core/auth/authenticate.js';
import { authorize } from '../../core/authz/authorize.js';
import { byUser, rateLimit } from '../../core/rateLimit/rateLimit.js';
import { tenantContext } from '../../core/tenant/tenantContext.js';
import * as controller from './controller.js';

// Tenant-scoped router (architecture.md §5.2), in the §3.3 order
// authenticate → rateLimit → tenantContext → authorize.
export const homeRouter = Router();

// RF-41 — Home's KPI strip. `availability:read` is Home's route guard
// (architecture.md §7).
homeRouter.get(
  '/summary',
  authenticate,
  rateLimit('read', byUser),
  tenantContext,
  authorize('availability:read'),
  controller.summary,
);
