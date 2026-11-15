import type { Request, Response } from 'express';
import { emptyQuery } from 'shared';
import { validate } from '../../core/http/validate.js';
import * as service from './service.js';

// RF-41 — `GET /home/summary`; it takes no query (any parameter → 400).
export async function summary(req: Request, res: Response): Promise<void> {
  validate(emptyQuery, req.query);
  res.json(await service.getSummary());
}
