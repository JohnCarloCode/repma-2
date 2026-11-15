import { paginationQuery } from 'shared';
import { describe, expect, it } from 'vitest';
import { validate } from './validate.js';
import { pageToLimitOffset, toPage } from './pagination.js';

describe('pagination helpers (architecture.md §7)', () => {
  it('the shared query schema goes through validate() with its defaults and coercion', () => {
    expect(validate(paginationQuery, {})).toEqual({ page: 1, pageSize: 20 });
    expect(validate(paginationQuery, { page: '3', pageSize: '50' })).toEqual({ page: 3, pageSize: 50 });
    expect(() => validate(paginationQuery, { pageSize: '101' })).toThrow();
  });

  it('maps page/pageSize to limit/offset and builds the envelope', () => {
    expect(pageToLimitOffset({ page: 3, pageSize: 20 })).toEqual({ limit: 20, offset: 40 });
    expect(toPage(['a'], 41, { page: 3, pageSize: 20 })).toEqual({ items: ['a'], page: 3, pageSize: 20, total: 41 });
  });
});
