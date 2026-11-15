import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../errors.js';
import { byUser, rateLimit, rateLimitFamilies, type RateLimitFamily } from './rateLimit.js';
import { MemoryRateLimitStore } from './store.js';

describe('rate limit families (RNF-07)', () => {
  it('match the documented per-minute limits', () => {
    expect(rateLimitFamilies).toEqual({
      read: { limit: 100, windowMs: 60_000 },
      write: { limit: 30, windowMs: 60_000 },
      shopFloor: { limit: 120, windowMs: 60_000 },
      login: { limit: 10, windowMs: 60_000 },
    });
  });
});

describe('MemoryRateLimitStore (AD-16)', () => {
  it('counts per key in a fixed window and resets when it ends', async () => {
    let now = 0;
    const store = new MemoryRateLimitStore(() => now);
    expect(await store.hit('a', 1000)).toEqual({ count: 1, resetInMs: 1000 });
    now = 400;
    expect(await store.hit('a', 1000)).toEqual({ count: 2, resetInMs: 600 });
    expect(await store.hit('b', 1000)).toEqual({ count: 1, resetInMs: 1000 });
    now = 1000;
    expect(await store.hit('a', 1000)).toEqual({ count: 1, resetInMs: 1000 });
  });
});

describe('rateLimit middleware', () => {
  function buildApp(family: RateLimitFamily, store = new MemoryRateLimitStore()) {
    const app = express();
    app.get('/', rateLimit(family, (req) => String(req.headers['x-key']), store), (_req, res) => {
      res.json({ ok: true });
    });
    app.use(errorHandler);
    return app;
  }

  it('lets the limit through, then answers 429 with the error envelope and Retry-After', async () => {
    const app = buildApp('login');
    for (let i = 0; i < 10; i++) {
      const res = await request(app).get('/').set('x-key', 'ip-1');
      expect(res.status).toBe(200);
      expect(res.headers['ratelimit-limit']).toBe('10');
    }
    const blocked = await request(app).get('/').set('x-key', 'ip-1');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.headers['ratelimit-remaining']).toBe('0');
  });

  it('keeps separate buckets per key and per family', async () => {
    const store = new MemoryRateLimitStore();
    const login = buildApp('login', store);
    for (let i = 0; i < 11; i++) await request(login).get('/').set('x-key', 'user-1');

    expect((await request(login).get('/').set('x-key', 'user-2')).status).toBe(200);
    const write = buildApp('write', store);
    const res = await request(write).get('/').set('x-key', 'user-1');
    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('30');
  });
});

describe('byUser key (RNF-07: authenticated routes are limited per user)', () => {
  it('keys by the authenticated user id', () => {
    const req = { identity: { userId: 'u1', role: 'manager', tenantId: 't1' } } as express.Request;
    expect(byUser(req)).toBe('user:u1');
  });

  it('throws when mounted before authenticate', () => {
    expect(() => byUser({} as express.Request)).toThrow(/before authenticate/);
  });
});
