import { describe, expect, it } from 'vitest';
import { availabilityRouter } from './router.js';

// architecture.md §7 — `GET /availability/events` is declared before any
// parameterised route (`GET /availability/:id`, Phase 3): Express matches in
// declaration order, so `/:id` declared first would capture `events` as an id.
describe('availability router order', () => {
  it('declares GET /events before every parameterised route', () => {
    const paths = availabilityRouter.stack.flatMap((layer) => (layer.route ? [String(layer.route.path)] : []));
    const events = paths.indexOf('/events');
    expect(events).toBeGreaterThanOrEqual(0);
    expect(paths.slice(0, events).filter((path) => path.includes(':'))).toEqual([]);
  });
});
