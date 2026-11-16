import { and, asc, count, eq, exists, ilike, inArray, max, or } from 'drizzle-orm';
import type {
  Category,
  CreateProductBody,
  CreateProductSizeBody,
  Pagination,
  Product,
  ProductListQuery,
  UpdateCategoryBody,
  UpdateProductBody,
  UpdateProductSizeBody,
} from 'shared';
import { pageToLimitOffset } from '../../core/http/pagination.js';
import { containsPattern } from '../../db/like.js';
import { categories } from '../../db/schema/categories.js';
import { productSizes } from '../../db/schema/productSizes.js';
import { products } from '../../db/schema/products.js';
import { type Tx, withTenantContext } from '../../db/withTenantContext.js';

// The `Category` shape every categories endpoint returns.
const categoryColumns = {
  id: categories.id,
  name: categories.name,
  slug: categories.slug,
  description: categories.description,
};

// The `Product` shape every products endpoint returns, without its sizes
// (`withSizes` embeds them); joined with `categories` for `categoryName`.
const productColumns = {
  id: products.id,
  name: products.name,
  description: products.description,
  imageUrl: products.imageUrl,
  categoryId: products.categoryId,
  categoryName: categories.name,
  isActive: products.isActive,
};

// RF-13 — global repository: categories are readable by any authenticated
// context (database.md §7.3). Ordered by name, id as the tiebreaker.
export function listCategories(query: Pagination): Promise<{ items: Category[]; total: number }> {
  const { limit, offset } = pageToLimitOffset(query);

  return withTenantContext(async (tx) => {
    const items = await tx
      .select(categoryColumns)
      .from(categories)
      .orderBy(asc(categories.name), asc(categories.id))
      .limit(limit)
      .offset(offset);
    const [totalRow] = await tx.select({ total: count() }).from(categories);
    return { items, total: totalRow?.total ?? 0 };
  }, 'global');
}

// RF-14 — insert a category; RLS lets only the Platform Admin write the
// catalog (database.md §7.3). A taken slug is detected through the UNIQUE via
// ON CONFLICT DO NOTHING, so a concurrent create of an equivalent name lands on
// the same answer.
export function insertCategory(name: string, slug: string, description: string | null): Promise<Category | 'duplicate'> {
  return withTenantContext(async (tx) => {
    const [row] = await tx
      .insert(categories)
      .values({ name, slug, description })
      .onConflictDoNothing({ target: categories.slug })
      .returning(categoryColumns);
    return row ?? 'duplicate';
  }, 'global');
}

// RF-14 — rename and/or edit the description; the slug is never touched and
// `updated_at` is set by the trigger.
export function updateCategory(id: string, body: UpdateCategoryBody): Promise<Category | null> {
  return withTenantContext(async (tx) => {
    const [row] = await tx.update(categories).set(body).where(eq(categories.id, id)).returning(categoryColumns);
    return row ?? null;
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
      .select(productColumns)
      .from(products)
      .innerJoin(categories, eq(categories.id, products.categoryId))
      .where(where)
      .orderBy(asc(products.name), asc(products.id))
      .limit(limit)
      .offset(offset);
    const [totalRow] = await tx.select({ total: count() }).from(products).where(where);
    const items = await withSizes(tx, rows);
    return { items, total: totalRow?.total ?? 0 };
  }, 'global');
}

// Every size of exactly these products (inactive ones included, flagged), in
// `position` order — label breaks ties — embedded per product, product order kept.
async function withSizes(tx: Tx, rows: Omit<Product, 'sizes'>[]): Promise<Product[]> {
  if (rows.length === 0) return [];
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
  return items;
}

// One product in the `GET /products` item shape, or null.
async function selectProduct(tx: Tx, id: string): Promise<Product | null> {
  const rows = await tx
    .select(productColumns)
    .from(products)
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(eq(products.id, id));
  const [product] = await withSizes(tx, rows);
  return product ?? null;
}

async function categoryExists(tx: Tx, id: string): Promise<boolean> {
  const [row] = await tx.select({ id: categories.id }).from(categories).where(eq(categories.id, id));
  return row !== undefined;
}

// Body rows (by index) whose SKU could not be inserted: `repeated` within the
// body or `taken` by an existing size.
export interface SkuConflict {
  index: number;
  sku: string;
  reason: 'taken' | 'repeated';
}

// Thrown inside the transaction so it rolls back; caught right outside it.
class SkuConflictError extends Error {
  constructor(readonly conflicts: SkuConflict[]) {
    super('SKU conflict');
  }
}

// RF-16 / RN-11 — the product and its sizes in one transaction (RLS: only the
// Platform Admin writes the catalog, database.md §7.3). The category must
// exist. Sizes go in one INSERT … ON CONFLICT (sku) DO NOTHING: a SKU held by
// another size — or repeated within the body, the later rows then skipped —
// comes back missing, so the whole create is rolled back and reported per row
// (race-safe: a concurrent create of the same SKU lands on the same answer).
// A missing `position` takes the row's index in the body.
export async function insertProduct(
  body: CreateProductBody,
): Promise<Product | 'category_not_found' | { conflicts: SkuConflict[] }> {
  try {
    return await withTenantContext(async (tx) => {
      if (!(await categoryExists(tx, body.categoryId))) return 'category_not_found';

      const [product] = await tx
        .insert(products)
        .values({ name: body.name, description: body.description ?? null, categoryId: body.categoryId })
        .returning({ id: products.id });
      const inserted = await tx
        .insert(productSizes)
        .values(
          body.sizes.map((size, index) => ({
            productId: product!.id,
            label: size.label,
            sku: size.sku,
            position: size.position ?? index,
          })),
        )
        .onConflictDoNothing({ target: productSizes.sku })
        .returning({ sku: productSizes.sku });

      if (inserted.length < body.sizes.length) {
        const insertedSkus = new Set(inserted.map((row) => row.sku));
        const seen = new Set<string>();
        const conflicts: SkuConflict[] = [];
        body.sizes.forEach(({ sku }, index) => {
          if (seen.has(sku)) conflicts.push({ index, sku, reason: 'repeated' });
          else if (!insertedSkus.has(sku)) conflicts.push({ index, sku, reason: 'taken' });
          seen.add(sku);
        });
        throw new SkuConflictError(conflicts);
      }
      return (await selectProduct(tx, product!.id))!;
    }, 'global');
  } catch (error) {
    if (error instanceof SkuConflictError) return { conflicts: error.conflicts };
    throw error;
  }
}

// RF-16 / RN-08 — edit name/description/category and/or retire/reactivate
// (`is_active`, soft: sizes, assortments and history are untouched).
// `updated_at` is set by the trigger.
export function updateProduct(id: string, body: UpdateProductBody): Promise<Product | 'not_found' | 'category_not_found'> {
  return withTenantContext(async (tx) => {
    if (body.categoryId && !(await categoryExists(tx, body.categoryId))) return 'category_not_found';
    const [row] = await tx.update(products).set(body).where(eq(products.id, id)).returning({ id: products.id });
    if (!row) return 'not_found';
    return (await selectProduct(tx, row.id))!;
  }, 'global');
}

// RF-37 — a size write that hit one of `product_sizes`' UNIQUEs (database.md
// §4.5): the product's `label` or the global `sku`. Postgres reports the first
// violated constraint, so one field per answer.
export type SizeConflict = { field: 'label' | 'sku' };

const SIZE_UNIQUES: Record<string, SizeConflict['field']> = {
  product_sizes_product_id_label_unique: 'label',
  product_sizes_sku_unique: 'sku',
};

// The field behind a unique violation (23505) on `product_sizes`, else null.
// Drizzle wraps the driver error, so look at the error and its cause.
function sizeConflict(error: unknown): SizeConflict | null {
  for (const candidate of [error, (error as { cause?: unknown })?.cause]) {
    const { code, constraint_name } = (candidate ?? {}) as { code?: string; constraint_name?: string };
    const field = code === '23505' && constraint_name ? SIZE_UNIQUES[constraint_name] : undefined;
    if (field) return { field };
  }
  return null;
}

// RF-37 — add a size to an existing product (RLS: Platform Admin only,
// database.md §7.3). A missing `position` goes after the product's last size,
// inactive ones included. Conflicts are detected by the UNIQUEs themselves, so
// a concurrent write lands on the same answer.
export async function insertSize(productId: string, body: CreateProductSizeBody): Promise<Product | 'not_found' | SizeConflict> {
  try {
    return await withTenantContext(async (tx) => {
      const [product] = await tx.select({ id: products.id }).from(products).where(eq(products.id, productId));
      if (!product) return 'not_found';
      let position = body.position;
      if (position === undefined) {
        const [last] = await tx
          .select({ position: max(productSizes.position) })
          .from(productSizes)
          .where(eq(productSizes.productId, productId));
        position = last?.position === null || last?.position === undefined ? 0 : last.position + 1;
      }
      await tx.insert(productSizes).values({ productId, label: body.label, sku: body.sku, position });
      return (await selectProduct(tx, productId))!;
    }, 'global');
  } catch (error) {
    const conflict = sizeConflict(error);
    if (conflict) return conflict;
    throw error;
  }
}

// RF-37 / RN-08 — edit a size's label, SKU, position and/or `is_active` (soft
// deactivate/reactivate: assortments and history are untouched). The size
// must belong to the product. `updated_at` is set by the trigger.
export async function updateSize(
  productId: string,
  sizeId: string,
  body: UpdateProductSizeBody,
): Promise<Product | 'not_found' | SizeConflict> {
  try {
    return await withTenantContext(async (tx) => {
      const [row] = await tx
        .update(productSizes)
        .set(body)
        .where(and(eq(productSizes.id, sizeId), eq(productSizes.productId, productId)))
        .returning({ id: productSizes.id });
      if (!row) return 'not_found';
      return (await selectProduct(tx, productId))!;
    }, 'global');
  } catch (error) {
    const conflict = sizeConflict(error);
    if (conflict) return conflict;
    throw error;
  }
}

// RF-17 — is there such a product (checked before uploading, so an unknown id
// never leaves an object in the bucket).
export function productExists(id: string): Promise<boolean> {
  return withTenantContext(async (tx) => {
    const [row] = await tx.select({ id: products.id }).from(products).where(eq(products.id, id));
    return row !== undefined;
  }, 'global');
}

// RF-17 — point the product at its new image. The previous URL is read under a
// row lock in the same transaction, so concurrent replacements each get the
// exact URL they replaced (the caller deletes that object). Null when the
// product vanished meanwhile.
export function setProductImage(id: string, imageUrl: string): Promise<{ product: Product; previous: string | null } | null> {
  return withTenantContext(async (tx) => {
    const [row] = await tx.select({ imageUrl: products.imageUrl }).from(products).where(eq(products.id, id)).for('update');
    if (!row) return null;
    await tx.update(products).set({ imageUrl }).where(eq(products.id, id));
    return { product: (await selectProduct(tx, id))!, previous: row.imageUrl };
  }, 'global');
}
