import { z } from 'zod';

// Path params of a `/:id` route (architecture.md §7): ids are UUIDs, so a
// malformed one is a 400 VALIDATION_ERROR before any query runs.
export const idParams = z.object({ id: z.uuid() });

export type IdParams = z.output<typeof idParams>;

// Path params of a nested `/:id/items/:itemId` route: both ids are UUIDs.
export const itemParams = z.object({ id: z.uuid(), itemId: z.uuid() });

export type ItemParams = z.output<typeof itemParams>;

// The query of a route that takes none (standing rule (a)): `validate()`
// parses strictly, so any query parameter at all is a 400 instead of being
// silently ignored.
export const emptyQuery = z.object({});

// A query timestamp (`from`/`to` bounds): ISO 8601 with an explicit offset
// (`Z` or `±hh:mm`), parsed to a Date. The web sends local start/end-of-day
// bounds as `toISOString()`.
export const isoTimestamp = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

// Path params of a `/products/:id/sizes/:sizeId` route: both ids are UUIDs.
export const sizeParams = z.object({ id: z.uuid(), sizeId: z.uuid() });

export type SizeParams = z.output<typeof sizeParams>;
