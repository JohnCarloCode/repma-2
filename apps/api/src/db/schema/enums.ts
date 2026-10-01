import { pgEnum } from 'drizzle-orm/pg-core';

// database.md §5 — closed, stable domains. A new value is a conscious migration
// (`ALTER TYPE … ADD VALUE`); the same literals are mirrored as typed constants
// in packages/shared (sub-task 1.10) so API, web and DB share one source.
export const userRole = pgEnum('user_role', ['platform_admin', 'manager', 'employee']);

export const availabilityEventType = pgEnum('availability_event_type', ['out_of_stock', 'restock']);

export const replenishmentStatus = pgEnum('replenishment_status', ['draft', 'processing', 'done']);
