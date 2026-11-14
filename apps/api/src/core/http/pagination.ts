import type { Page, Pagination } from 'shared';

// Server-side half of the pagination convention (architecture.md §7): the
// `paginationQuery` request schema and the `Page<T>` envelope live in
// `shared` (consumed by api and web); these helpers only run here.
export function pageToLimitOffset({ page, pageSize }: Pagination): { limit: number; offset: number } {
  return { limit: pageSize, offset: (page - 1) * pageSize };
}

export function toPage<T>(items: T[], total: number, { page, pageSize }: Pagination): Page<T> {
  return { items, page, pageSize, total };
}
