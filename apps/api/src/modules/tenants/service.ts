import type { CreateTenantBody, Page, Tenant, TenantListQuery, UpdateTenantBody } from 'shared';
import { AppError } from '../../core/errors.js';
import { toPage } from '../../core/http/pagination.js';
import { slugify } from '../../core/slug.js';
import { findTenant, insertTenant, listTenants, updateTenant } from './repository.js';

function storeNotFound(): AppError {
  return new AppError(404, 'NOT_FOUND', 'Store not found');
}

// RF-06
export async function list(query: TenantListQuery): Promise<Page<Tenant>> {
  const { items, total } = await listTenants(query);
  return toPage(items, total, query);
}

// RF-07 — the slug is generated from the name (RN-10). A name with nothing to
// build one from is a 400 on `name`; a slug another store already holds is a
// 409 (platform-tenants.md shows it inline on the Name field).
export async function create(body: CreateTenantBody): Promise<Tenant> {
  const slug = slugify(body.name);
  if (!slug) {
    const message = 'Name must contain letters or numbers';
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', [{ path: 'name', message }]);
  }
  const result = await insertTenant(body.name, slug);
  if (result === 'duplicate') throw new AppError(409, 'CONFLICT', 'A store with an equivalent name already exists');
  return result;
}

export async function get(id: string): Promise<Tenant> {
  const tenant = await findTenant(id);
  if (!tenant) throw storeNotFound();
  return tenant;
}

// RF-08 — deactivation takes effect on the store users' next request (RF-05:
// `authenticate` checks the store's `is_active` every time).
export async function update(id: string, body: UpdateTenantBody): Promise<Tenant> {
  const tenant = await updateTenant(id, body);
  if (!tenant) throw storeNotFound();
  return tenant;
}
