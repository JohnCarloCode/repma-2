import { pgEnum } from 'drizzle-orm/pg-core';
import { AVAILABILITY_EVENT_TYPES, REPLENISHMENT_STATUSES, ROLES } from 'shared';

// database.md §5 — closed, stable domains. A new value is a conscious migration
// (`ALTER TYPE … ADD VALUE`); the literals come from packages/shared so API,
// web and DB share one source.
export const userRole = pgEnum('user_role', ROLES);

export const availabilityEventType = pgEnum('availability_event_type', AVAILABILITY_EVENT_TYPES);

export const replenishmentStatus = pgEnum('replenishment_status', REPLENISHMENT_STATUSES);
