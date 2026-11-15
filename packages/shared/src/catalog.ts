import { z } from 'zod';
import { paginationQuery } from './pagination.js';

// RF-13 — `GET /categories` query: pagination only, ordered by name. Its
// consumers (the `/availability` category filter, the ProductPicker rail)
// read the whole list in one page (`pageSize=100`).
export const categoryListQuery = paginationQuery;

// One category as the listing returns it: what its consumers render and send.
export interface Category {
  id: string;
  name: string;
}

// RF-15 — `GET /products` query: pagination plus optional filters,
// intersected. `search` matches the product name and the SKU of any of its
// sizes (blank after trimming = no filter); `isActive` is `true`/`false` on
// the product's own flag (absent = both). No sort param: ordered by name.
export const productListQuery = paginationQuery.extend({
  categoryId: z.uuid().optional(),
  search: z.string().trim().max(100).optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export type ProductListQuery = z.output<typeof productListQuery>;

// One catalog size (database.md §4.5): the sellable unit, SKU included.
// Inactive sizes are embedded and flagged; consumers that add to the
// assortment skip them (RN-08).
export interface ProductSize {
  id: string;
  label: string;
  sku: string;
  position: number;
  isActive: boolean;
}

// One page item of `GET /products` (RF-15): the product with every size
// embedded in `position` order — what the picker's assortment flow, the
// `/catalog` table + slide-over and the platform catalog render without an
// extra fetch.
export interface Product {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  categoryId: string;
  categoryName: string;
  isActive: boolean;
  sizes: ProductSize[];
}
