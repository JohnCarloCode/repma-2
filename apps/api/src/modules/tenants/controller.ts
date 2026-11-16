import type { Request, Response } from 'express';
import { createTenantBody, emptyQuery, idParams, tenantListQuery, updateTenantBody } from 'shared';
import { validate } from '../../core/http/validate.js';
import * as service from './service.js';

// RF-06
export async function list(req: Request, res: Response): Promise<void> {
  res.json(await service.list(validate(tenantListQuery, req.query)));
}

// RF-07 — 201 with the new store.
export async function create(req: Request, res: Response): Promise<void> {
  validate(emptyQuery, req.query);
  res.status(201).json(await service.create(validate(createTenantBody, req.body)));
}

export async function get(req: Request, res: Response): Promise<void> {
  const { id } = validate(idParams, req.params);
  validate(emptyQuery, req.query);
  res.json(await service.get(id));
}

// RF-08 — 200 with the updated store.
export async function update(req: Request, res: Response): Promise<void> {
  const { id } = validate(idParams, req.params);
  validate(emptyQuery, req.query);
  res.json(await service.update(id, validate(updateTenantBody, req.body)));
}
