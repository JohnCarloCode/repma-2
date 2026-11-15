import { Router } from 'express';
import { authenticate } from '../../core/auth/authenticate.js';
import { authorize } from '../../core/authz/authorize.js';
import { byUser, rateLimit } from '../../core/rateLimit/rateLimit.js';
import { tenantContext } from '../../core/tenant/tenantContext.js';
import * as controller from './controller.js';

// Tenant-scoped router (architecture.md §5.2): every route mounts
// tenantContext, in the §3.3 order authenticate → rateLimit → tenantContext →
// authorize.
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

// RF-18 / AD-22 — the assortment grouped by product.
availabilityRouter.get(
  '/',
  authenticate,
  rateLimit('read', byUser),
  tenantContext,
  authorize('availability:read'),
  controller.list,
);

// RF-19 — add a catalog size to the assortment. Assortment writes ride the
// write limiter family (RNF-07).
availabilityRouter.post(
  '/',
  authenticate,
  rateLimit('write', byUser),
  tenantContext,
  authorize('assortment:manage'),
  controller.addItem,
);

// Parameterised routes — below `/events` (see above).
availabilityRouter.get(
  '/:id',
  authenticate,
  rateLimit('read', byUser),
  tenantContext,
  authorize('availability:read'),
  controller.getItem,
);

// RF-21 — one item's history.
availabilityRouter.get(
  '/:id/events',
  authenticate,
  rateLimit('read', byUser),
  tenantContext,
  authorize('availability:read'),
  controller.listHistory,
);

// RF-20 — flag an item (the single write path of availability, AD-04). The
// shop-floor limiter family: one tap per size is its legitimate cadence (RNF-07).
availabilityRouter.post(
  '/:id/events',
  authenticate,
  rateLimit('shopFloor', byUser),
  tenantContext,
  authorize('availability:flag'),
  controller.recordEvent,
);

// RF-44 — remove an unreferenced item (RN-13).
availabilityRouter.delete(
  '/:id',
  authenticate,
  rateLimit('write', byUser),
  tenantContext,
  authorize('assortment:manage'),
  controller.removeItem,
);
