import type { Request, Response } from 'express';
import {
  addReplenishmentListItemBody,
  createReplenishmentListBody,
  emptyQuery,
  idParams,
  itemParams,
  replenishmentListQuery,
  updateReplenishmentListBody,
  updateReplenishmentListItemBody,
} from 'shared';
import { validate } from '../../core/http/validate.js';
import * as service from './service.js';

// RF-26
export async function list(req: Request, res: Response): Promise<void> {
  res.json(await service.listLists(validate(replenishmentListQuery, req.query)));
}

// RF-26 — `GET /replenishment-lists/:id`
export async function get(req: Request, res: Response): Promise<void> {
  const { id } = validate(idParams, req.params);
  validate(emptyQuery, req.query);
  res.json(await service.getList(id));
}

// RF-27 — 201 with the new (empty, `draft`) list in the detail shape.
export async function create(req: Request, res: Response): Promise<void> {
  validate(emptyQuery, req.query);
  res.status(201).json(await service.createList(validate(createReplenishmentListBody, req.body)));
}

// RF-30 — 200 with the updated list in the detail shape.
export async function update(req: Request, res: Response): Promise<void> {
  const { id } = validate(idParams, req.params);
  validate(emptyQuery, req.query);
  res.json(await service.updateList(id, validate(updateReplenishmentListBody, req.body)));
}

// RF-29 — 204; the items are deleted in cascade (RN-09).
export async function remove(req: Request, res: Response): Promise<void> {
  const { id } = validate(idParams, req.params);
  validate(emptyQuery, req.query);
  await service.deleteList(id);
  res.status(204).end();
}

// RF-28 — 201 with the new line (`ReplenishmentListItem`).
export async function addItem(req: Request, res: Response): Promise<void> {
  const { id } = validate(idParams, req.params);
  validate(emptyQuery, req.query);
  res.status(201).json(await service.addItem(id, validate(addReplenishmentListItemBody, req.body)));
}

// RF-28/RF-40 — 200 with the updated line.
export async function updateItem(req: Request, res: Response): Promise<void> {
  const { id, itemId } = validate(itemParams, req.params);
  validate(emptyQuery, req.query);
  res.json(await service.updateItem(id, itemId, validate(updateReplenishmentListItemBody, req.body)));
}

// RF-28 — 204.
export async function removeItem(req: Request, res: Response): Promise<void> {
  const { id, itemId } = validate(itemParams, req.params);
  validate(emptyQuery, req.query);
  await service.deleteItem(id, itemId);
  res.status(204).end();
}
