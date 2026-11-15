import type { AvailabilityEventFeedQuery, AvailabilityFeedEvent, Page } from 'shared';
import { toPage } from '../../core/http/pagination.js';
import { listFeedEvents } from './repository.js';

// RF-23
export async function listEvents(query: AvailabilityEventFeedQuery): Promise<Page<AvailabilityFeedEvent>> {
  const { items, total } = await listFeedEvents(query);
  return toPage(items, total, query);
}
