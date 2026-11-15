import type { Request, Response } from 'express';
import { availabilityEventFeedQuery } from 'shared';
import { validate } from '../../core/http/validate.js';
import * as service from './service.js';

// RF-23
export async function listEvents(req: Request, res: Response): Promise<void> {
  res.json(await service.listEvents(validate(availabilityEventFeedQuery, req.query)));
}
