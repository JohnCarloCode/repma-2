import { Router } from 'express';
import { authenticate } from '../../core/auth/authenticate.js';
import { authorize } from '../../core/authz/authorize.js';
import { byUser, rateLimit } from '../../core/rateLimit/rateLimit.js';
import * as controller from './controller.js';

// Global router (architecture.md §5.2): never mounts tenantContext — the
// Platform Admin manages every user without an active store (no X-Tenant-Id).
export const usersRouter = Router();

// RF-09
usersRouter.get('/', authenticate, rateLimit('read', byUser), authorize('user:manage'), controller.list);

// RF-10 — Supabase Auth identity + profile, compensated (architecture.md §9).
usersRouter.post('/', authenticate, rateLimit('write', byUser), authorize('user:manage'), controller.create);

usersRouter.get('/:id', authenticate, rateLimit('read', byUser), authorize('user:manage'), controller.get);

// RF-11 — profile fields + optional write-only password reset (Supabase Auth admin).
usersRouter.patch('/:id', authenticate, rateLimit('write', byUser), authorize('user:manage'), controller.update);

// RF-12 — the identity is deleted in Supabase Auth; the profile cascades.
usersRouter.delete('/:id', authenticate, rateLimit('write', byUser), authorize('user:manage'), controller.remove);
