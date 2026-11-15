import type { Category, Page, Pagination } from 'shared';
import { toPage } from '../../core/http/pagination.js';
import { listCategories as listCategoryRows } from './repository.js';

// RF-13
export async function listCategories(query: Pagination): Promise<Page<Category>> {
  const { items, total } = await listCategoryRows(query);
  return toPage(items, total, query);
}
