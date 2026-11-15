import type { Request, Response } from 'express';
import { categoryListQuery } from 'shared';
import { validate } from '../../core/http/validate.js';
import * as service from './service.js';

// RF-13
export async function listCategories(req: Request, res: Response): Promise<void> {
  res.json(await service.listCategories(validate(categoryListQuery, req.query)));
}
