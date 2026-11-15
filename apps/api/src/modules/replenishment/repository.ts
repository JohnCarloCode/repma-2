import { and, asc, count, countDistinct, desc, eq, gte, ilike, inArray, lte, type SQL, sql } from 'drizzle-orm';
import type {
  AddReplenishmentListItemBody,
  CreateReplenishmentListBody,
  ReplenishmentList,
  ReplenishmentListItem,
  ReplenishmentListQuery,
  ReplenishmentListSummary,
  UpdateReplenishmentListBody,
  UpdateReplenishmentListItemBody,
} from 'shared';
import { pageToLimitOffset } from '../../core/http/pagination.js';
import { requestContext } from '../../core/tenant/context.js';
import { containsPattern } from '../../db/like.js';
import { assortmentItems } from '../../db/schema/assortmentItems.js';
import { categories } from '../../db/schema/categories.js';
import { productSizes } from '../../db/schema/productSizes.js';
import { products } from '../../db/schema/products.js';
import { replenishmentListItems } from '../../db/schema/replenishmentListItems.js';
import { replenishmentLists } from '../../db/schema/replenishmentLists.js';
import { userProfiles } from '../../db/schema/userProfiles.js';
import { type Tx, withTenantContext } from '../../db/withTenantContext.js';

// RF-26 — the store's lists, most recent first (id as the tiebreaker so pages
// are stable), on the `(tenant_id, created_at DESC)` index (database.md §8);
// RLS keeps them to the active store (§7.3). `status`/`search` are residual
// filters. Each list's figures come from a LATERAL aggregate over its own
// items (the `(list_id, size_id)` UNIQUE serves it). `productCount` is the
// number of DISTINCT products the sizes belong to — items reference sizes,
// not products (§4.9). The creator is a LEFT JOIN: a deleted user leaves
// `created_by` NULL and the list survives (RN-09).
export function listLists(
  query: ReplenishmentListQuery,
): Promise<{ items: ReplenishmentListSummary[]; total: number }> {
  const where = and(
    query.status ? inArray(replenishmentLists.status, query.status) : undefined,
    query.search ? ilike(replenishmentLists.name, containsPattern(query.search)) : undefined,
    query.from ? gte(replenishmentLists.createdAt, query.from) : undefined,
    query.to ? lte(replenishmentLists.createdAt, query.to) : undefined,
  );
  const { limit, offset } = pageToLimitOffset(query);

  return withTenantContext(async (tx) => {
    const figures = tx
      .select({
        itemCount: count().as('item_count'),
        productCount: countDistinct(productSizes.productId).as('product_count'),
        doneCount: sql<number>`count(*) filter (where ${replenishmentListItems.isDone})`.mapWith(Number).as('done_count'),
      })
      .from(replenishmentListItems)
      .innerJoin(productSizes, eq(productSizes.id, replenishmentListItems.sizeId))
      .where(eq(replenishmentListItems.listId, replenishmentLists.id))
      .as('figures');

    const rows = await tx
      .select({
        id: replenishmentLists.id,
        name: replenishmentLists.name,
        status: replenishmentLists.status,
        createdAt: replenishmentLists.createdAt,
        creatorName: userProfiles.fullName,
        itemCount: figures.itemCount,
        productCount: figures.productCount,
        doneCount: figures.doneCount,
      })
      .from(replenishmentLists)
      .leftJoin(userProfiles, eq(userProfiles.id, replenishmentLists.createdBy))
      .leftJoinLateral(figures, sql`true`)
      .where(where)
      .orderBy(desc(replenishmentLists.createdAt), desc(replenishmentLists.id))
      .limit(limit)
      .offset(offset);
    const [totalRow] = await tx.select({ total: count() }).from(replenishmentLists).where(where);
    return {
      items: rows.map(({ createdAt, ...list }) => ({ ...list, createdAt: createdAt.toISOString() })),
      total: totalRow?.total ?? 0,
    };
  });
}

// RF-26 — one list with its items, in one transaction. Under RLS another
// store's list is simply no row, so an unknown id and a foreign one are the
// same `undefined` (RN-03). Items are ordered by product — name, then id so
// two same-named products never interleave, then size `position` — the order
// the detail renders its product groups in.
export function getList(id: string): Promise<ReplenishmentList | undefined> {
  return withTenantContext((tx) => selectList(tx, id));
}

async function selectList(tx: Tx, id: string): Promise<ReplenishmentList | undefined> {
  const [list] = await tx
    .select({
      id: replenishmentLists.id,
      name: replenishmentLists.name,
      status: replenishmentLists.status,
      notes: replenishmentLists.notes,
      createdAt: replenishmentLists.createdAt,
      creatorName: userProfiles.fullName,
    })
    .from(replenishmentLists)
    .leftJoin(userProfiles, eq(userProfiles.id, replenishmentLists.createdBy))
    .where(eq(replenishmentLists.id, id));
  if (!list) return undefined;

  const { createdAt, ...rest } = list;
  return {
    ...rest,
    createdAt: createdAt.toISOString(),
    items: await selectItems(tx, eq(replenishmentListItems.listId, id)),
  };
}

// The list lines matching `where`, each embedding its size's identity (the
// `ReplenishmentListItem` shape), in the detail's product order.
async function selectItems(tx: Tx, where: SQL): Promise<ReplenishmentListItem[]> {
  const rows = await tx
    .select({
      id: replenishmentListItems.id,
      sizeId: productSizes.id,
      sizeLabel: productSizes.label,
      sku: productSizes.sku,
      quantity: replenishmentListItems.quantityRequested,
      isDone: replenishmentListItems.isDone,
      productId: products.id,
      productName: products.name,
      categoryId: categories.id,
      categoryName: categories.name,
    })
    .from(replenishmentListItems)
    .innerJoin(productSizes, eq(productSizes.id, replenishmentListItems.sizeId))
    .innerJoin(products, eq(products.id, productSizes.productId))
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(where)
    .orderBy(asc(products.name), asc(products.id), asc(productSizes.position), asc(productSizes.label));
  return rows.map(({ productId, productName, categoryId, categoryName, ...item }) => ({
    ...item,
    product: { id: productId, name: productName, categoryId, categoryName },
  }));
}

// RF-27 — a manual list: always empty and `draft` (the column default). The
// store and the creator come from the request context, never from the body.
// Returns the new list in the detail shape, read back in the same transaction.
export function createList(body: CreateReplenishmentListBody): Promise<ReplenishmentList> {
  const { tenantId, userId } = requestContext.getStore()!; // withTenantContext fails closed without them
  return withTenantContext(async (tx) => {
    const [row] = await tx
      .insert(replenishmentLists)
      .values({ tenantId: tenantId!, createdBy: userId, name: body.name, notes: body.notes ?? null })
      .returning({ id: replenishmentLists.id });
    return (await selectList(tx, row!.id))!;
  });
}

// RF-30 — partial update; `updated_at` is set by the `set_updated_at` trigger.
// Under RLS another store's list matches no row, so unknown and foreign are
// the same `undefined` (RN-03). Returns the updated list in the detail shape.
export function updateList(id: string, body: UpdateReplenishmentListBody): Promise<ReplenishmentList | undefined> {
  return withTenantContext(async (tx) => {
    const updated = await tx
      .update(replenishmentLists)
      .set(body)
      .where(eq(replenishmentLists.id, id))
      .returning({ id: replenishmentLists.id });
    return updated.length ? selectList(tx, id) : undefined;
  });
}

// RF-29 — the items go with it by `ON DELETE CASCADE` (RN-09). `false` when
// no row matched: unknown or another store's (RN-03).
export function deleteList(id: string): Promise<boolean> {
  return withTenantContext(async (tx) => {
    const deleted = await tx
      .delete(replenishmentLists)
      .where(eq(replenishmentLists.id, id))
      .returning({ id: replenishmentLists.id });
    return deleted.length > 0;
  });
}

// The list a line write targets, locked against a concurrent delete for the
// rest of the transaction (`FOR KEY SHARE` — what the line's FK would take
// anyway). Under RLS another store's list is no row (RN-03).
async function lockList(tx: Tx, id: string): Promise<{ tenantId: string } | undefined> {
  const [list] = await tx
    .select({ tenantId: replenishmentLists.tenantId })
    .from(replenishmentLists)
    .where(eq(replenishmentLists.id, id))
    .for('key share');
  return list;
}

// RF-28 — add a line. Checked in order: the list exists in the store (RN-03),
// the size is in the store's assortment (RN-12 — membership only: an inactive
// size still assorted is accepted, RN-08; availability state is never looked
// at, DP-06), the size is not on the list yet (RN-04: the UNIQUE
// `(list_id, size_id)` via ON CONFLICT DO NOTHING, so a concurrent duplicate
// lands on the same answer). The line's store is the list's, never the body's;
// `is_done` starts false (RF-40). The composite FK stays the structural
// backstop of the RN-12 check.
export function addItem(
  listId: string,
  body: AddReplenishmentListItemBody,
): Promise<ReplenishmentListItem | 'list_not_found' | 'not_in_assortment' | 'duplicate'> {
  return withTenantContext(async (tx) => {
    const list = await lockList(tx, listId);
    if (!list) return 'list_not_found';

    const [assorted] = await tx
      .select({ id: assortmentItems.id })
      .from(assortmentItems)
      .where(eq(assortmentItems.sizeId, body.sizeId))
      .for('key share');
    if (!assorted) return 'not_in_assortment';

    const [row] = await tx
      .insert(replenishmentListItems)
      .values({ tenantId: list.tenantId, listId, sizeId: body.sizeId, quantityRequested: body.quantity })
      .onConflictDoNothing({ target: [replenishmentListItems.listId, replenishmentListItems.sizeId] })
      .returning({ id: replenishmentListItems.id });
    if (!row) return 'duplicate';
    return (await selectItems(tx, eq(replenishmentListItems.id, row.id)))[0]!;
  });
}

// RF-28/RF-40 — quantity and/or done check of one line of the list;
// `updated_at` is set by the trigger (the list's own row is not touched).
export function updateItem(
  listId: string,
  itemId: string,
  body: UpdateReplenishmentListItemBody,
): Promise<ReplenishmentListItem | 'list_not_found' | 'item_not_found'> {
  return withTenantContext(async (tx) => {
    if (!(await lockList(tx, listId))) return 'list_not_found';
    const ofList = and(eq(replenishmentListItems.id, itemId), eq(replenishmentListItems.listId, listId))!;
    const updated = await tx
      .update(replenishmentListItems)
      .set({ quantityRequested: body.quantity, isDone: body.isDone })
      .where(ofList)
      .returning({ id: replenishmentListItems.id });
    if (!updated.length) return 'item_not_found';
    return (await selectItems(tx, ofList))[0]!;
  });
}

// RF-28 — remove one line of the list.
export function deleteItem(listId: string, itemId: string): Promise<'list_not_found' | 'item_not_found' | 'deleted'> {
  return withTenantContext(async (tx) => {
    if (!(await lockList(tx, listId))) return 'list_not_found';
    const deleted = await tx
      .delete(replenishmentListItems)
      .where(and(eq(replenishmentListItems.id, itemId), eq(replenishmentListItems.listId, listId)))
      .returning({ id: replenishmentListItems.id });
    return deleted.length ? 'deleted' : 'item_not_found';
  });
}
