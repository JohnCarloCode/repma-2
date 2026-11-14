// database.md §5 — the three closed Postgres enums, mirrored as typed
// constants so api, web and DB share one source of values. The api's Drizzle
// schema builds its pgEnums from these tuples; a new value is still a
// conscious migration (`ALTER TYPE … ADD VALUE`).
export const ROLES = ['platform_admin', 'manager', 'employee'] as const;
export type Role = (typeof ROLES)[number];

export const AVAILABILITY_EVENT_TYPES = ['out_of_stock', 'restock'] as const;
export type AvailabilityEventType = (typeof AVAILABILITY_EVENT_TYPES)[number];

export const REPLENISHMENT_STATUSES = ['draft', 'processing', 'done'] as const;
export type ReplenishmentStatus = (typeof REPLENISHMENT_STATUSES)[number];
