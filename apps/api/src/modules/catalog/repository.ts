import { and, asc, count, eq, exists, ilike, inArray, or } from 'drizzle-orm';
import type { Category, Pagination, Product, ProductListQuery } from 'shared';
import { pageToLimitOffset } from '../../core/http/pagination.js';
import { containsPattern } from '../../db/like.js';
import { categories } from '../../db/schema/categories.js';
import { productSizes } from '../../db/schema/productSizes.js';
import { products } from '../../db/schema/products.js';
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

// RF-15 — global repository, like categories (database.md §7.3). Two reads in
// one transaction: (1) the page of products — filters on the product, `search`
// on its name or any of its sizes' SKU (an EXISTS, so a product matching on
// several sizes is still one row); ordered by name, id as the tiebreaker; (2)
// every size of exactly those products, in `position` order (label breaks ties).
export function listProducts(query: ProductListQuery): Promise<{ items: Product[]; total: number }> {
  const { limit, offset } = pageToLimitOffset(query);
  const pattern = query.search ? containsPattern(query.search) : undefined;

  return withTenantContext(async (tx) => {
    const where = and(
      query.categoryId ? eq(products.categoryId, query.categoryId) : undefined,
      query.isActive === undefined ? undefined : eq(products.isActive, query.isActive),
      pattern
        ? or(
            ilike(products.name, pattern),
            exists(
              tx
                .select({ id: productSizes.id })
                .from(productSizes)
                .where(and(eq(productSizes.productId, products.id), ilike(productSizes.sku, pattern))),
            ),
          )
        : undefined,
    );

    const rows = await tx
      .select({
        id: products.id,
        name: products.name,
        description: products.description,
        imageUrl: products.imageUrl,
        categoryId: products.categoryId,
        categoryName: categories.name,
        isActive: products.isActive,
      })
      .from(products)
      .innerJoin(categories, eq(categories.id, products.categoryId))
      .where(where)
      .orderBy(asc(products.name), asc(products.id))
      .limit(limit)
      .offset(offset);
    const [totalRow] = await tx.select({ total: count() }).from(products).where(where);
    const total = totalRow?.total ?? 0;
    if (rows.length === 0) return { items: [], total };

    const sizes = await tx
      .select({
        productId: productSizes.productId,
        id: productSizes.id,
        label: productSizes.label,
        sku: productSizes.sku,
        position: productSizes.position,
        isActive: productSizes.isActive,
      })
      .from(productSizes)
      .where(
        inArray(
          productSizes.productId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(asc(productSizes.position), asc(productSizes.label));

    const items: Product[] = rows.map((row) => ({ ...row, sizes: [] }));
    const byId = new Map(items.map((item) => [item.id, item]));
    for (const { productId, ...size } of sizes) byId.get(productId)!.sizes.push(size);
    return { items, total };
  }, 'global');
}
