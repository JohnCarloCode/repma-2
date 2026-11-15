import type {
  AddReplenishmentListItemBody,
  CreateReplenishmentListBody,
  Page,
  ReplenishmentList,
  ReplenishmentListItem,
  ReplenishmentListQuery,
  ReplenishmentListSummary,
  UpdateReplenishmentListBody,
  UpdateReplenishmentListItemBody,
} from 'shared';
import { AppError } from '../../core/errors.js';
import { toPage } from '../../core/http/pagination.js';
import {
  addItem as addItemRow,
  createList as createListRow,
  deleteItem as deleteItemRow,
  deleteList as deleteListRow,
  getList as getListRow,
  listLists as listListRows,
  updateItem as updateItemRow,
  updateList as updateListRow,
} from './repository.js';

// RF-26
export async function listLists(query: ReplenishmentListQuery): Promise<Page<ReplenishmentListSummary>> {
  const { items, total } = await listListRows(query);
  return toPage(items, total, query);
}

// RN-03 — an unknown id and another store's list are one and the same 404:
// nothing in the answer reveals that a foreign list exists.
function listNotFound(): AppError {
  return new AppError(404, 'NOT_FOUND', 'List not found');
}

// RF-26 — `GET /replenishment-lists/:id`
export async function getList(id: string): Promise<ReplenishmentList> {
  const list = await getListRow(id);
  if (!list) throw listNotFound();
  return list;
}

// RF-27 — manual creation only (DP-06).
export function createList(body: CreateReplenishmentListBody): Promise<ReplenishmentList> {
  return createListRow(body);
}

// RF-30 — free status transitions; name/notes edits.
export async function updateList(id: string, body: UpdateReplenishmentListBody): Promise<ReplenishmentList> {
  const list = await updateListRow(id, body);
  if (!list) throw listNotFound();
  return list;
}

// RF-29 — its items go with it (RN-09).
export async function deleteList(id: string): Promise<void> {
  if (!(await deleteListRow(id))) throw listNotFound();
}

// A line that does not belong to the (visible) list — unknown, removed
// elsewhere, or another list's — is one 404.
function itemNotFound(): AppError {
  return new AppError(404, 'NOT_FOUND', 'Item not found');
}

// RF-28 — add a size to the list. A size outside the store's assortment is a
// 400 on `sizeId` (RN-12); a size already on the list a 409 (RN-04).
export async function addItem(listId: string, body: AddReplenishmentListItemBody): Promise<ReplenishmentListItem> {
  const result = await addItemRow(listId, body);
  if (result === 'list_not_found') throw listNotFound();
  if (result === 'not_in_assortment') {
    const message = "This size is not in the store's assortment";
    throw new AppError(400, 'VALIDATION_ERROR', message, [{ path: 'sizeId', message }]);
  }
  if (result === 'duplicate') throw new AppError(409, 'CONFLICT', 'This size is already on the list');
  return result;
}

// RF-28/RF-40 — quantity and/or done check.
export async function updateItem(
  listId: string,
  itemId: string,
  body: UpdateReplenishmentListItemBody,
): Promise<ReplenishmentListItem> {
  const result = await updateItemRow(listId, itemId, body);
  if (result === 'list_not_found') throw listNotFound();
  if (result === 'item_not_found') throw itemNotFound();
  return result;
}

// RF-28 — remove a line.
export async function deleteItem(listId: string, itemId: string): Promise<void> {
  const result = await deleteItemRow(listId, itemId);
  if (result === 'list_not_found') throw listNotFound();
  if (result === 'item_not_found') throw itemNotFound();
}
