import { z } from 'zod';

// architecture.md §7 — every listing takes `page`/`pageSize` (default 20, max
// 100) and answers `{ items, page, pageSize, total }`. Query-string values
// arrive as strings, hence the coercion. List schemas extend this shape.
export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type Pagination = z.output<typeof paginationQuery>;

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
