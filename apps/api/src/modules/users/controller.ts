import type { Request, Response } from 'express';
import { createUserBody, emptyQuery, idParams, updateUserBody, userListQuery } from 'shared';
import { validate } from '../../core/http/validate.js';
import * as service from './service.js';

// RF-09
export async function list(req: Request, res: Response): Promise<void> {
  res.json(await service.list(validate(userListQuery, req.query)));
}

// RF-10 — 201 with the new user (never the password).
export async function create(req: Request, res: Response): Promise<void> {
  validate(emptyQuery, req.query);
  res.status(201).json(await service.create(validate(createUserBody, req.body)));
}

export async function get(req: Request, res: Response): Promise<void> {
  const { id } = validate(idParams, req.params);
  validate(emptyQuery, req.query);
  res.json(await service.get(id));
}

// RF-11 — 200 with the updated user (never the password).
export async function update(req: Request, res: Response): Promise<void> {
  const { id } = validate(idParams, req.params);
  validate(emptyQuery, req.query);
  res.json(await service.update(callerId(req), id, validate(updateUserBody, req.body)));
}

// RF-12
export async function remove(req: Request, res: Response): Promise<void> {
  const { id } = validate(idParams, req.params);
  validate(emptyQuery, req.query);
  await service.remove(callerId(req), id);
  res.status(204).end();
}

// RF-12's self-rules need who is calling; `authenticate` always runs first.
function callerId(req: Request): string {
  if (!req.identity) throw new Error('users router mounted without authenticate');
  return req.identity.userId;
}
