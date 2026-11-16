import { readFileSync } from 'node:fs';
import type { Router } from 'express';
import * as shared from 'shared';
import { describe, expect, it } from 'vitest';
import { v1, v1Routers } from './app.js';
import { byIp, byUser, type RateLimitFamily, type RateLimitKey } from './core/rateLimit/rateLimit.js';

// Plan 9.3 — the standing rules, audited over the routes the app really
// serves (the router stacks), so a new route is covered without touching this
// file: RNF-07 (one limiter, the documented family), RNF-08 (every input goes
// through `validate()` with a `shared` schema) and architecture.md §7 (the
// served surface and the documented one are the same set).

interface Endpoint {
  method: string;
  path: string;
  handlers: Array<(...args: never[]) => unknown>;
}

type Layer = Router['stack'][number];

function endpointsOf(stack: Layer[], prefix: string): Endpoint[] {
  return stack.flatMap((layer) => {
    if (!layer.route) return [];
    const route = layer.route as unknown as { path: string; methods: Record<string, boolean> };
    const path = route.path === '/' && prefix ? prefix : `${prefix}${route.path}`;
    return Object.keys(route.methods).map((method) => ({
      method: method.toUpperCase(),
      path,
      handlers: layer.route!.stack.map((l) => l.handle as Endpoint['handlers'][number]),
    }));
  });
}

const endpoints: Endpoint[] = [
  ...endpointsOf(v1.stack, ''),
  ...v1Routers.flatMap(([prefix, router]) => endpointsOf(router.stack, prefix)),
];
const id = (e: { method: string; path: string }) => `${e.method} ${e.path}`;

describe('router stacks', () => {
  it('mounts module routers only through v1Routers, and routers hold only routes', () => {
    const mounted = v1.stack.filter((layer) => !layer.route).map((layer) => layer.handle);
    expect(mounted).toEqual(v1Routers.map(([, router]) => router));
    // A router-level `use()` would hide middleware (e.g. a second limiter) from this audit.
    for (const [, router] of v1Routers) expect(router.stack.every((layer) => layer.route)).toBe(true);
  });
});

// RNF-07 (spec.md) / architecture.md §8: the shop-floor family covers flag
// events (RF-20) and per-item replenishment autosave (RF-28/RF-40); the two
// public routes are keyed per IP; every other read/write per user.
const SHOP_FLOOR = new Set([
  'POST /availability/:id/events',
  'POST /replenishment-lists/:id/items',
  'PATCH /replenishment-lists/:id/items/:itemId',
  'DELETE /replenishment-lists/:id/items/:itemId',
]);

function documentedLimiter(e: Endpoint): [RateLimitFamily, RateLimitKey] {
  if (id(e) === 'GET /health') return ['read', byIp];
  if (id(e) === 'POST /auth/login') return ['login', byIp];
  if (SHOP_FLOOR.has(id(e))) return ['shopFloor', byUser];
  return [e.method === 'GET' ? 'read' : 'write', byUser];
}

describe('rate limit per route (RNF-07)', () => {
  it.each(endpoints.map((e) => [id(e), e] as const))('%s has exactly its documented limiter', (_, e) => {
    const limiters = e.handlers.flatMap((h) => {
      const tag = h as unknown as { rateLimitFamily?: RateLimitFamily; rateLimitKey?: RateLimitKey };
      return tag.rateLimitFamily ? [[tag.rateLimitFamily, tag.rateLimitKey] as const] : [];
    });
    expect(limiters).toEqual([documentedLimiter(e)]);
  });
});

// Routes that take no payload: GET/DELETE by HTTP semantics, plus logout.
// Their body is never read (architecture.md §8 — "bodiless routes").
const BODILESS_WRITES = new Set(['POST /auth/logout']);

// The handler's source as Vitest runs it: `validate(<import>.<schema>, req.x)`.
const VALIDATED = /validate\(([\w$]+)\.(\w+), (?:\{ \.\.\.)?req\.(query|params|body)\b/g;

describe('input validation per route (RNF-08)', () => {
  it.each(endpoints.map((e) => [id(e), e] as const))('%s validates every input with a shared schema', (_, e) => {
    const source = e.handlers.at(-1)!.toString();
    const validated = [...source.matchAll(VALIDATED)];
    // Every schema is a `shared` export (AD-13), never an inline one.
    for (const [, , schema] of validated) expect(Object.keys(shared)).toContain(schema);
    // No input is read outside `validate()`.
    expect(source.match(/\breq\.(query|params|body)\b/g)?.length ?? 0).toBe(validated.length);

    const inputs = new Set(validated.map(([, , , input]) => input));
    expect(inputs.has('query')).toBe(true);
    expect(inputs.has('params')).toBe(e.path.includes(':'));
    const takesBody = ['POST', 'PATCH', 'PUT'].includes(e.method) && !BODILESS_WRITES.has(id(e));
    expect(inputs.has('body')).toBe(takesBody);
  });
});

// architecture.md §7 lists every endpoint as `METHOD /path` (or `GET/POST
// /path`, `GET`/`PATCH /path`) — parsed here so the doc and the app can't drift.
function documentedEndpoints(): Set<string> {
  const doc = readFileSync(new URL('../../../doc-ai/core/architecture.md', import.meta.url), 'utf8');
  const section = doc.slice(doc.indexOf('## 7. API surface'), doc.indexOf('## 8. '));
  const normalized = section.replaceAll('`/`', '/');
  const found = new Set<string>();
  for (const [, methods, path] of normalized.matchAll(/`((?:GET|POST|PATCH|PUT|DELETE)(?:\/(?:GET|POST|PATCH|PUT|DELETE))*) (\/[^`\s?]*)/g)) {
    for (const method of methods!.split('/')) found.add(`${method} ${path}`);
  }
  return found;
}

describe('API surface vs architecture.md §7', () => {
  const served = new Set(endpoints.map(id));
  const documented = documentedEndpoints();

  it('documents every served endpoint', () => {
    expect([...served].filter((e) => !documented.has(e))).toEqual([]);
  });

  it('serves every documented endpoint', () => {
    expect([...documented].filter((e) => !served.has(e))).toEqual([]);
  });
});
