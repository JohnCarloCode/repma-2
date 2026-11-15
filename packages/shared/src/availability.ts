import { z } from 'zod';
import type { AvailabilityEventType } from './enums.js';
import { paginationQuery } from './pagination.js';

// An ISO 8601 timestamp with an explicit offset (`Z` or `±hh:mm`), parsed to
// a Date. The web sends local-midnight bounds as `toISOString()`.
const timestamp = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

// RF-23 — `GET /availability/events` query: pagination plus optional
// `from`/`to` bounds on the event's `created_at`, both inclusive. An inverted
// range is not an error: it simply matches nothing.
export const availabilityEventFeedQuery = paginationQuery.extend({
  from: timestamp.optional(),
  to: timestamp.optional(),
});

export type AvailabilityEventFeedQuery = z.output<typeof availabilityEventFeedQuery>;

// One event of the store-wide feed (RF-23): everything its consumers render,
// with no extra fetch. `authorName` is null when the author was deleted
// (RN-09); `createdAt` is an ISO 8601 timestamp.
export interface AvailabilityFeedEvent {
  id: string;
  type: AvailabilityEventType;
  createdAt: string;
  authorName: string | null;
  item: { id: string; productName: string; sizeLabel: string };
}
