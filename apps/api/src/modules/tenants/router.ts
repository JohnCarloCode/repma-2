import { Router } from 'express';
import { authenticate } from '../../core/auth/authenticate.js';
import { authorize } from '../../core/authz/authorize.js';
import { byUser, rateLimit } from '../../core/rateLimit/rateLimit.js';
import * as controller from './controller.js';

// Global router (architecture.md §5.2): never mounts tenantContext — the
// Platform Admin manages stores without an active one (no X-Tenant-Id).
export const tenantsRouter = Router();

// RF-06
tenantsRouter.get('/', authenticate, rateLimit('read', byUser), authorize('tenant:manage'), controller.list);

// RF-07 — create a store; the slug is generated (RN-10).
tenantsRouter.post('/', authenticate, rateLimit('write', byUser), authorize('tenant:manage'), controller.create);

tenantsRouter.get('/:id', authenticate, rateLimit('read', byUser), authorize('tenant:manage'), controller.get);

// RF-08 — rename and/or (de)activate; stores are never deleted.
tenantsRouter.patch('/:id', authenticate, rateLimit('write', byUser), authorize('tenant:manage'), controller.update);
