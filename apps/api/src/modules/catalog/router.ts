import { Router } from 'express';
import { authenticate } from '../../core/auth/authenticate.js';
import { authorize } from '../../core/authz/authorize.js';
import { byUser, rateLimit } from '../../core/rateLimit/rateLimit.js';
import * as controller from './controller.js';
import { parseImage } from './imageUpload.js';

// Global router (architecture.md §5.2): the catalog is global, so it never
// mounts tenantContext. Mounted at the API root because the family spans
// `/categories` and `/products` (architecture.md §7). Writes are
// `catalog:manage` on the write limiter.
export const catalogRouter = Router();

catalogRouter.get(
  '/categories',
  authenticate,
  rateLimit('read', byUser),
  authorize('catalog:read'),
  controller.listCategories,
);

// RF-14 — create/edit a category; the slug is generated (RN-10). No delete
// route: categories cannot be deleted in the MVP.
catalogRouter.post(
  '/categories',
  authenticate,
  rateLimit('write', byUser),
  authorize('catalog:manage'),
  controller.createCategory,
);

// RF-45 — the display order of every category, in one request.
catalogRouter.put(
  '/categories/order',
  authenticate,
  rateLimit('write', byUser),
  authorize('catalog:manage'),
  controller.reorderCategories,
);

catalogRouter.patch(
  '/categories/:id',
  authenticate,
  rateLimit('write', byUser),
  authorize('catalog:manage'),
  controller.updateCategory,
);

// RF-46 — the display order of every product of one category, in one request.
catalogRouter.put(
  '/categories/:id/products/order',
  authenticate,
  rateLimit('write', byUser),
  authorize('catalog:manage'),
  controller.reorderProducts,
);

catalogRouter.get(
  '/products',
  authenticate,
  rateLimit('read', byUser),
  authorize('catalog:read'),
  controller.listProducts,
);

// RF-16 — create a product with ≥1 size (RN-11; no image here — RF-17) and
// edit / retire it (RN-08, soft). Sizes have their own routes (RF-37).
catalogRouter.post(
  '/products',
  authenticate,
  rateLimit('write', byUser),
  authorize('catalog:manage'),
  controller.createProduct,
);

catalogRouter.patch(
  '/products/:id',
  authenticate,
  rateLimit('write', byUser),
  authorize('catalog:manage'),
  controller.updateProduct,
);

// RF-37 — add / edit a product's sizes (label, SKU, position, soft
// deactivation — RN-08). No delete route: sizes are never deleted.
catalogRouter.post(
  '/products/:id/sizes',
  authenticate,
  rateLimit('write', byUser),
  authorize('catalog:manage'),
  controller.addSize,
);

catalogRouter.patch(
  '/products/:id/sizes/:sizeId',
  authenticate,
  rateLimit('write', byUser),
  authorize('catalog:manage'),
  controller.updateSize,
);

// RF-17 — replace the product's image (multipart `image`, ≤5 MB, JPEG/PNG —
// RNF-06). Parsed after authorization, so nobody without `catalog:manage`
// gets a body read.
catalogRouter.post(
  '/products/:id/image',
  authenticate,
  rateLimit('write', byUser),
  authorize('catalog:manage'),
  parseImage,
  controller.uploadImage,
);
