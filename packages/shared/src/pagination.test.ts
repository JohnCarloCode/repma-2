import { describe, expect, it } from 'vitest';
import { paginationQuery } from './pagination.js';

describe('paginationQuery (architecture.md §7)', () => {
  it('defaults to page 1, pageSize 20 and coerces query strings', () => {
    expect(paginationQuery.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(paginationQuery.parse({ page: '3', pageSize: '50' })).toEqual({ page: 3, pageSize: 50 });
  });

  it('rejects pageSize over 100 and page below 1', () => {
    expect(paginationQuery.safeParse({ pageSize: '101' }).success).toBe(false);
    expect(paginationQuery.safeParse({ page: '0' }).success).toBe(false);
  });
});
