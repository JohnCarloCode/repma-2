import { z } from 'zod';
import { AVAILABILITY_EVENT_TYPES, type AvailabilityEventType } from './enums.js';
import { paginationQuery } from './pagination.js';
import { isoTimestamp } from './params.js';

// RF-23 — `GET /availability/events` query: pagination plus optional
// `from`/`to` bounds on the event's `created_at`, both inclusive. An inverted
// range is not an error: it simply matches nothing.
export const availabilityEventFeedQuery = paginationQuery.extend({
  from: isoTimestamp.optional(),
  to: isoTimestamp.optional(),
});

export type AvailabilityEventFeedQuery = z.output<typeof availabilityEventFeedQuery>;

// One event of an item's history (RF-21): an event is nothing but its type,
// author and timestamp (RN-06). `authorName` is null when the author was
// deleted (RN-09); `createdAt` is an ISO 8601 timestamp.
export interface AvailabilityItemEvent {
  id: string;
  type: AvailabilityEventType;
  createdAt: string;
  authorName: string | null;
}

// One event of the store-wide feed (RF-23): the history event plus its item's
// identity — everything its consumers render, with no extra fetch.
export interface AvailabilityFeedEvent extends AvailabilityItemEvent {
  item: { id: string; productName: string; sizeLabel: string };
}

// RF-18 / AD-22 — `GET /availability` query: pagination (of products) plus
// optional filters, intersected. `search` matches the product name and the
// SKU of any size in the store's run (blank after trimming = no filter);
// `outOfStock=true` selects products with at least one size out of stock and
// still returns their complete run. No sort param: the order is fixed (RF-18).
export const availabilityListQuery = paginationQuery.extend({
  search: z.string().trim().max(100).optional(),
  categoryId: z.uuid().optional(),
  outOfStock: z.literal('true').transform(() => true).optional(),
});

export type AvailabilityListQuery = z.output<typeof availabilityListQuery>;

// One size of a product's run as the store carries it. `id` is the assortment
// item (the `/availability/:id` target); `sizeId` is the catalog size (what
// list items and the `/catalog` cross-reference key on). `latestEventAt` is
// the ISO timestamp of the item's latest event, null with no events (RN-07):
// while the size is out of stock it is the start of the current outage
// (strict alternation, RN-14) — the aging figure's origin (DP-07).
export interface AvailabilitySize {
  id: string;
  sizeId: string;
  label: string;
  sku: string;
  isAvailable: boolean;
  isActive: boolean;
  latestEventAt: string | null;
}

// One page item of `GET /availability` (AD-22): a product with its full run —
// every assorted size, in `position` order. Inactive products/sizes are
// listed and flagged (RN-08).
export interface AvailabilityProduct {
  id: string;
  name: string;
  imageUrl: string | null;
  categoryName: string;
  isActive: boolean;
  sizes: AvailabilitySize[];
}

// `GET /availability/:id` — one assortment item (a size as the store carries
// it) with its product's identity: what the detail page's summary card
// renders (name, label, SKU, state, aging origin, category, image, inactive
// flags — RN-08). The product carries no run.
export interface AvailabilityItem extends AvailabilitySize {
  product: Omit<AvailabilityProduct, 'sizes'>;
}

// RF-20 — `POST /availability/:id/events` body: the event type is the whole
// payload (RN-06). `validate()` is strict, so `is_available` or any other key
// is a 400 (RF-22, RN-05): the flag is derived by the API, never sent.
export const availabilityEventBody = z.object({ type: z.enum(AVAILABILITY_EVENT_TYPES) });

export type AvailabilityEventBody = z.output<typeof availabilityEventBody>;
