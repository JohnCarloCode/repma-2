import type { Category, Page, Pagination, Product, ProductListQuery } from 'shared';
import { toPage } from '../../core/http/pagination.js';
import { listCategories as listCategoryRows, listProducts as listProductRows } from './repository.js';

// RF-13
export async function listCategories(query: Pagination): Promise<Page<Category>> {
  const { items, total } = await listCategoryRows(query);
  return toPage(items, total, query);
}

// RF-15
export async function listProducts(query: ProductListQuery): Promise<Page<Product>> {
  const { items, total } = await listProductRows(query);
  return toPage(items, total, query);
}
