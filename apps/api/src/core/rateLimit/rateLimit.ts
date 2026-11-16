import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors.js';
import { MemoryRateLimitStore, type RateLimitStore } from './store.js';

// RNF-07 — the four families, per minute. Authenticated routes are keyed per
// user (a store's staff share one NAT'd IP); only the public routes — login
// and health — are keyed per IP.
export const rateLimitFamilies = {
  read: { limit: 100, windowMs: 60_000 },
  write: { limit: 30, windowMs: 60_000 },
  shopFloor: { limit: 120, windowMs: 60_000 }, // availability events + replenishment autosave
  login: { limit: 10, windowMs: 60_000 },
} as const;

export type RateLimitFamily = keyof typeof rateLimitFamilies;

export type RateLimitKey = (req: Request) => string;

// Key for the public routes. `req.ip` is the real client IP because of
// `trust proxy` (RNF-09).
export const byIp: RateLimitKey = (req) => req.ip ?? 'unknown';

// Key for every authenticated route: mounted AFTER `authenticate`. A missing
// identity is a mounting bug, so it fails loudly instead of sharing a bucket.
export const byUser: RateLimitKey = (req) => {
  if (!req.identity) throw new Error('rateLimit(byUser) mounted before authenticate');
  return `user:${req.identity.userId}`;
};

const defaultStore = new MemoryRateLimitStore();

// Mounted on each router with its family. Buckets are per family AND key, so
// a user's reads never eat into their writes. `RateLimit-Limit` is always set,
// which is what route tests assert to prove the right family is mounted.
export function rateLimit(family: RateLimitFamily, keyOf: RateLimitKey, store: RateLimitStore = defaultStore) {
  const { limit, windowMs } = rateLimitFamilies[family];

  const limiter = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { count, resetInMs } = await store.hit(`${family}:${keyOf(req)}`, windowMs);
    res.setHeader('RateLimit-Limit', limit);
    res.setHeader('RateLimit-Remaining', Math.max(0, limit - count));

    if (count > limit) {
      res.setHeader('Retry-After', Math.max(1, Math.ceil(resetInMs / 1000)));
      next(new AppError(429, 'RATE_LIMITED', 'Too many requests, try again later'));
      return;
    }
    next();
  };
  // Tagged so the surface audit (app.surface.test.ts) can read each route's
  // family and key from the router stack (RNF-07).
  return Object.assign(limiter, { rateLimitFamily: family, rateLimitKey: keyOf });
}
