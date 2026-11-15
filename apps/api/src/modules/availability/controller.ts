import type { Request, Response } from 'express';
import {
  addAssortmentItemBody,
  availabilityEventBody,
  availabilityEventFeedQuery,
  availabilityListQuery,
  emptyQuery,
  idParams,
  paginationQuery,
} from 'shared';
import { validate } from '../../core/http/validate.js';
import * as service from './service.js';

// RF-23
export async function listEvents(req: Request, res: Response): Promise<void> {
  res.json(await service.listEvents(validate(availabilityEventFeedQuery, req.query)));
}

// RF-18 / AD-22
export async function list(req: Request, res: Response): Promise<void> {
  res.json(await service.listAssortment(validate(availabilityListQuery, req.query)));
}

// `GET /availability/:id`
export async function getItem(req: Request, res: Response): Promise<void> {
  const { id } = validate(idParams, req.params);
  validate(emptyQuery, req.query);
  res.json(await service.getItem(id));
}

// RF-21
export async function listHistory(req: Request, res: Response): Promise<void> {
  const { id } = validate(idParams, req.params);
  res.json(await service.listHistory(id, validate(paginationQuery, req.query)));
}

// RF-20 — 201 with the updated item.
export async function recordEvent(req: Request, res: Response): Promise<void> {
  const { id } = validate(idParams, req.params);
  validate(emptyQuery, req.query);
  const { type } = validate(availabilityEventBody, req.body);
  res.status(201).json(await service.recordEvent(id, type));
}

// RF-19 — 201 with the new item (`AvailabilityItem`).
export async function addItem(req: Request, res: Response): Promise<void> {
  validate(emptyQuery, req.query);
  const { sizeId } = validate(addAssortmentItemBody, req.body);
  res.status(201).json(await service.addItem(sizeId));
}

// RF-44 — 204.
export async function removeItem(req: Request, res: Response): Promise<void> {
  const { id } = validate(idParams, req.params);
  validate(emptyQuery, req.query);
  await service.deleteItem(id);
  res.status(204).end();
}
