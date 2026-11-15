import type { Page, Tenant, TenantListQuery } from 'shared';
import { toPage } from '../../core/http/pagination.js';
import { listTenants } from './repository.js';

// RF-06
export async function list(query: TenantListQuery): Promise<Page<Tenant>> {
  const { items, total } = await listTenants(query);
  return toPage(items, total, query);
}
