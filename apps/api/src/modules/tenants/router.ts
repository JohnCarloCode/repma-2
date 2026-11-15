import { Router } from 'express';
import { authenticate } from '../../core/auth/authenticate.js';
import { authorize } from '../../core/authz/authorize.js';
import { byUser, rateLimit } from '../../core/rateLimit/rateLimit.js';
import * as controller from './controller.js';

// Global router (architecture.md §5.2): never mounts tenantContext — the
// Platform Admin manages stores without an active one. `GET /tenants/:id` and
// the writes (RF-07/08) ship with the Stores page (plan 7.1).
export const tenantsRouter = Router();

tenantsRouter.get('/', authenticate, rateLimit('read', byUser), authorize('tenant:manage'), controller.list);
