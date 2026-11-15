import type { Request, Response } from 'express';
import { tenantListQuery } from 'shared';
import { validate } from '../../core/http/validate.js';
import * as service from './service.js';

// RF-06
export async function list(req: Request, res: Response): Promise<void> {
  res.json(await service.list(validate(tenantListQuery, req.query)));
}
