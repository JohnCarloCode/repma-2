import { Router } from 'express';
import { authenticate } from '../../core/auth/authenticate.js';
import { authorize } from '../../core/authz/authorize.js';
import { byUser, rateLimit } from '../../core/rateLimit/rateLimit.js';
import * as controller from './controller.js';

// Global router (architecture.md §5.2): the catalog is global, so it never
// mounts tenantContext. Mounted at the API root because the family spans
// `/categories` and `/products` (architecture.md §7); the writes
// (RF-14/16/17/37) ship in Phase 8.
export const catalogRouter = Router();

catalogRouter.get(
  '/categories',
  authenticate,
  rateLimit('read', byUser),
  authorize('catalog:read'),
  controller.listCategories,
);

catalogRouter.get(
  '/products',
  authenticate,
  rateLimit('read', byUser),
  authorize('catalog:read'),
  controller.listProducts,
);
