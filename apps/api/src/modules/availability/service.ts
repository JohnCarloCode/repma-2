import type {
  AvailabilityEventFeedQuery,
  AvailabilityEventType,
  AvailabilityFeedEvent,
  AvailabilityItem,
  AvailabilityItemEvent,
  AvailabilityListQuery,
  AvailabilityProduct,
  Page,
  Pagination,
} from 'shared';
import { AppError } from '../../core/errors.js';
import { toPage } from '../../core/http/pagination.js';
import {
  getItem as getItemRow,
  listAssortment as listAssortmentRows,
  listFeedEvents,
  listItemEvents,
  recordEvent as recordEventRow,
} from './repository.js';

// RF-23
export async function listEvents(query: AvailabilityEventFeedQuery): Promise<Page<AvailabilityFeedEvent>> {
  const { items, total } = await listFeedEvents(query);
  return toPage(items, total, query);
}

// RF-18 / AD-22 — the envelope paginates products, not sizes.
export async function listAssortment(query: AvailabilityListQuery): Promise<Page<AvailabilityProduct>> {
  const { items, total } = await listAssortmentRows(query);
  return toPage(items, total, query);
}

// RN-03 — an unknown id and another store's item are one and the same 404:
// nothing in the answer reveals that a foreign item exists.
function itemNotFound(): AppError {
  return new AppError(404, 'NOT_FOUND', 'Item not found');
}

// `GET /availability/:id`
export async function getItem(id: string): Promise<AvailabilityItem> {
  const item = await getItemRow(id);
  if (!item) throw itemNotFound();
  return item;
}

// RF-21
export async function listHistory(id: string, query: Pagination): Promise<Page<AvailabilityItemEvent>> {
  const result = await listItemEvents(id, query);
  if (!result) throw itemNotFound();
  return toPage(result.items, result.total, query);
}

// RF-20 — record a flag and answer with the updated item. An event matching
// the current state is a 409 (RN-14); the message names the state the item is
// already in, so the client can show it as is.
export async function recordEvent(id: string, type: AvailabilityEventType): Promise<AvailabilityItem> {
  const result = await recordEventRow(id, type);
  if (result === 'not_found') throw itemNotFound();
  if (result === 'same_state') {
    const state = type === 'out_of_stock' ? 'out of stock' : 'available';
    throw new AppError(409, 'CONFLICT', `This size is already ${state}`);
  }
  return result.item;
}
