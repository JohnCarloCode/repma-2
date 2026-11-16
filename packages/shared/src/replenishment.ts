import { z } from 'zod';
import { REPLENISHMENT_STATUSES, type ReplenishmentStatus } from './enums.js';
import { paginationQuery } from './pagination.js';
import { isoTimestamp } from './params.js';

// RF-26 — `GET /replenishment-lists` query: pagination plus optional filters,
// intersected. `status` is one or more statuses, comma-separated
// (`status=draft,processing`) — repeats are tolerated, an empty or unknown
// value is a 400. `search` matches the list name (blank after trimming = no
// filter). `from`/`to` bound `created_at`, both inclusive; an inverted range
// simply matches nothing. No sort param: the order is fixed (`created_at`
// descending).
export const replenishmentListQuery = paginationQuery.extend({
  status: z
    .string()
    .transform((value) => value.split(','))
    .pipe(z.array(z.enum(REPLENISHMENT_STATUSES)))
    .transform((statuses) => [...new Set(statuses)])
    .optional(),
  search: z.string().trim().max(100).optional(),
  from: isoTimestamp.optional(),
  to: isoTimestamp.optional(),
});

export type ReplenishmentListQuery = z.output<typeof replenishmentListQuery>;

// A list's own fields as both endpoints return them. `creatorName` is null
// when the creator was deleted (RN-09); `createdAt` is an ISO 8601 timestamp.
interface ReplenishmentListBase {
  id: string;
  name: string;
  status: ReplenishmentStatus;
  createdAt: string;
  creatorName: string | null;
}

// One page item of `GET /replenishment-lists` (RF-26): the list plus its
// figures — `itemCount` sizes covering `productCount` distinct products, of
// which `doneCount` are checked (RF-40). Counts, never quantities (RN-05).
export interface ReplenishmentListSummary extends ReplenishmentListBase {
  itemCount: number;
  productCount: number;
  doneCount: number;
}

// One line of a list (RF-28/RF-40), embedding its size's identity (RF-26) so
// the detail's table, its client-side filters and the picker's disabled set
// (keyed on `sizeId`, RN-04) need no extra fetch. `quantity` is the requested
// quantity (`quantity_requested`), never a stock figure.
export interface ReplenishmentListItem {
  id: string;
  sizeId: string;
  sizeLabel: string;
  sku: string;
  quantity: number;
  isDone: boolean;
  product: { id: string; name: string; imageUrl: string | null; categoryId: string; categoryName: string };
}

// `GET /replenishment-lists/:id` — the list with its notes and every item,
// ordered by product (product name, then size `position` — RF-26): the order
// the detail renders its product groups in. Progress (`done/total`) is
// derived from the items.
export interface ReplenishmentList extends ReplenishmentListBase {
  notes: string | null;
  items: ReplenishmentListItem[];
}

// A list name: trimmed, required, at most 120 characters.
const listName = z.string().trim().min(1, 'Name is required').max(120);
// Notes: trimmed, at most 2000 characters; blank (or null) clears them.
const listNotes = z
  .string()
  .trim()
  .max(2000)
  .nullable()
  .transform((notes) => notes || null);

// RF-27 — `POST /replenishment-lists` body: a name and optional notes, nothing
// else. A list has no generated origin (DP-06): no key here builds it from
// availability flags, and `validate()` is strict, so any extra key is a 400.
// The list always starts empty and `draft`.
export const createReplenishmentListBody = z.object({
  name: listName,
  notes: listNotes.optional(),
});

export type CreateReplenishmentListBody = z.output<typeof createReplenishmentListBody>;

// RF-30 — `PATCH /replenishment-lists/:id` body: any of name, notes, status
// (free transitions — no state machine). An empty body is a 400: a PATCH that
// changes nothing is a client bug, not a no-op.
export const updateReplenishmentListBody = z
  .object({
    name: listName.optional(),
    notes: listNotes.optional(),
    status: z.enum(REPLENISHMENT_STATUSES).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'At least one field is required');

export type UpdateReplenishmentListBody = z.output<typeof updateReplenishmentListBody>;

// A requested quantity: an integer from 1 to 9999 (`quantity_requested`,
// CHECK > 0 in the DB; the upper bound only rejects typos — no real line asks
// for more).
const itemQuantity = z.number().int().min(1).max(9999);

// RF-28 — `POST /replenishment-lists/:id/items` body: the size and its
// requested quantity (1 when omitted, RF-27). Nothing else — the store comes
// from the request context, every new line starts unchecked (RF-40), and no
// availability field exists here (DP-06): strict validation makes any extra
// key a 400.
export const addReplenishmentListItemBody = z.object({
  sizeId: z.uuid(),
  quantity: itemQuantity.default(1),
});

export type AddReplenishmentListItemBody = z.output<typeof addReplenishmentListItemBody>;

// RF-28/RF-40 — `PATCH /replenishment-lists/:id/items/:itemId` body: the
// quantity and/or the done check. An empty body is a 400.
export const updateReplenishmentListItemBody = z
  .object({
    quantity: itemQuantity.optional(),
    isDone: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'At least one field is required');

export type UpdateReplenishmentListItemBody = z.output<typeof updateReplenishmentListItemBody>;
