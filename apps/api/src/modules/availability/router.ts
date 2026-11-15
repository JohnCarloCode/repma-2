import { Router } from 'express';
import { authenticate } from '../../core/auth/authenticate.js';
import { authorize } from '../../core/authz/authorize.js';
import { byUser, rateLimit } from '../../core/rateLimit/rateLimit.js';
import { tenantContext } from '../../core/tenant/tenantContext.js';
import * as controller from './controller.js';

// Tenant-scoped router (architecture.md §5.2): every route mounts
// tenantContext, in the §3.3 order authenticate → rateLimit → tenantContext →
// authorize. The rest of the family (RF-18/20/21/22/44) ships in Phase 3.
export const availabilityRouter = Router();

// RF-23 — MUST stay above `GET /:id` (architecture.md §7): Express matches in
// declaration order, and `/:id` would capture `events`. router.test.ts guards it.
availabilityRouter.get(
  '/events',
  authenticate,
  rateLimit('read', byUser),
  tenantContext,
  authorize('activity:read'),
  controller.listEvents,
);
