import { describe, expect, it } from 'vitest';
import { availabilityRouter } from './router.js';

// architecture.md §7 — `GET /availability/events` is declared before any
// parameterised route (`GET /availability/:id` and its sub-routes): Express
// matches in declaration order, so `/:id` declared first would capture
// `events` as an id.
describe('availability router order', () => {
  const paths = availabilityRouter.stack.flatMap((layer) => (layer.route ? [String(layer.route.path)] : []));
  const events = paths.indexOf('/events');

  it('declares GET /events before every parameterised route', () => {
    expect(events).toBeGreaterThanOrEqual(0);
    expect(paths.slice(0, events).filter((path) => path.includes(':'))).toEqual([]);
  });

  it('declares GET /:id and GET /:id/events, both after /events', () => {
    expect(paths.indexOf('/:id')).toBeGreaterThan(events);
    expect(paths.indexOf('/:id/events')).toBeGreaterThan(events);
  });

  it('declares POST /:id/events (RF-20) after /events', () => {
    const post = availabilityRouter.stack.findIndex(
      (layer) => layer.route?.path === '/:id/events' && (layer.route as { methods?: Record<string, boolean> }).methods?.post,
    );
    expect(post).toBeGreaterThan(events);
  });
});
