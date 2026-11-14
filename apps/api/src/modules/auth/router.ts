import { Router } from 'express';
import { authenticate } from '../../core/auth/authenticate.js';
import { byIp, byUser, rateLimit } from '../../core/rateLimit/rateLimit.js';
import * as controller from './controller.js';

// Global router (architecture.md §5.2): no tenantContext. Login is public and
// limited per IP pre-auth (login family); the others authenticate first and
// are limited per user (RNF-07): logout as a write, me as a read.
export const authRouter = Router();

authRouter.post('/login', rateLimit('login', byIp), controller.login);
authRouter.post('/logout', authenticate, rateLimit('write', byUser), controller.logout);
authRouter.get('/me', authenticate, rateLimit('read', byUser), controller.me);
