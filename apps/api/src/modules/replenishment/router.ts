import { Router } from 'express';
import { authenticate } from '../../core/auth/authenticate.js';
import { authorize } from '../../core/authz/authorize.js';
import { byUser, rateLimit } from '../../core/rateLimit/rateLimit.js';
import { tenantContext } from '../../core/tenant/tenantContext.js';
import * as controller from './controller.js';

// Tenant-scoped router (architecture.md §5.2): every route mounts
// tenantContext, in the §3.3 order authenticate → rateLimit → tenantContext →
// authorize.
export const replenishmentRouter = Router();

// RF-26 — the store's lists, most recent first, with their figures.
replenishmentRouter.get(
  '/',
  authenticate,
  rateLimit('read', byUser),
  tenantContext,
  authorize('replenishment:read'),
  controller.list,
);

// RF-26 — one list with its items, ordered by product.
replenishmentRouter.get(
  '/:id',
  authenticate,
  rateLimit('read', byUser),
  tenantContext,
  authorize('replenishment:read'),
  controller.get,
);

// RF-27 — create a list by hand; there is no generated origin (DP-06). The
// list writes ride the write limiter family (RNF-07).
replenishmentRouter.post(
  '/',
  authenticate,
  rateLimit('write', byUser),
  tenantContext,
  authorize('replenishment:manage'),
  controller.create,
);

// RF-30 — name, notes and/or status (free transitions).
replenishmentRouter.patch(
  '/:id',
  authenticate,
  rateLimit('write', byUser),
  tenantContext,
  authorize('replenishment:manage'),
  controller.update,
);

// RF-29 — delete a list and, in cascade, its items (RN-09).
replenishmentRouter.delete(
  '/:id',
  authenticate,
  rateLimit('write', byUser),
  tenantContext,
  authorize('replenishment:manage'),
  controller.remove,
);

// RF-28/RF-40 — per-item autosave, one tap per line: the shop-floor limiter
// family (RNF-07).
replenishmentRouter.post(
  '/:id/items',
  authenticate,
  rateLimit('shopFloor', byUser),
  tenantContext,
  authorize('replenishment:manage'),
  controller.addItem,
);

replenishmentRouter.patch(
  '/:id/items/:itemId',
  authenticate,
  rateLimit('shopFloor', byUser),
  tenantContext,
  authorize('replenishment:manage'),
  controller.updateItem,
);

replenishmentRouter.delete(
  '/:id/items/:itemId',
  authenticate,
  rateLimit('shopFloor', byUser),
  tenantContext,
  authorize('replenishment:manage'),
  controller.removeItem,
);
