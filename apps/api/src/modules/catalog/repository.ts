import { asc, count } from 'drizzle-orm';
import type { Category, Pagination } from 'shared';
import { pageToLimitOffset } from '../../core/http/pagination.js';
import { categories } from '../../db/schema/categories.js';
import { withTenantContext } from '../../db/withTenantContext.js';

// RF-13 — global repository: categories are readable by any authenticated
// context (database.md §7.3). Ordered by name, id as the tiebreaker.
export function listCategories(query: Pagination): Promise<{ items: Category[]; total: number }> {
  const { limit, offset } = pageToLimitOffset(query);

  return withTenantContext(async (tx) => {
    const items = await tx
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .orderBy(asc(categories.name), asc(categories.id))
      .limit(limit)
      .offset(offset);
    const [totalRow] = await tx.select({ total: count() }).from(categories);
    return { items, total: totalRow?.total ?? 0 };
  }, 'global');
}
