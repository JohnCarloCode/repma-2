import { z } from 'zod';

// Path params of a `/:id` route (architecture.md §7): ids are UUIDs, so a
// malformed one is a 400 VALIDATION_ERROR before any query runs.
export const idParams = z.object({ id: z.uuid() });

export type IdParams = z.output<typeof idParams>;

// The query of a route that takes none (standing rule (a)): `validate()`
// parses strictly, so any query parameter at all is a 400 instead of being
// silently ignored.
export const emptyQuery = z.object({});
