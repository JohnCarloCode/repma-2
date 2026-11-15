import { and, asc, count, desc, eq, gte, ilike, inArray, lte, max, or, sql } from 'drizzle-orm';
import type {
  AvailabilityEventFeedQuery,
  AvailabilityEventType,
  AvailabilityFeedEvent,
  AvailabilityItem,
  AvailabilityItemEvent,
  AvailabilityListQuery,
  AvailabilityProduct,
  Pagination,
} from 'shared';
import { pageToLimitOffset } from '../../core/http/pagination.js';
import { requestContext } from '../../core/tenant/context.js';
import { containsPattern } from '../../db/like.js';
import { assortmentItems } from '../../db/schema/assortmentItems.js';
import { availabilityEvents } from '../../db/schema/availabilityEvents.js';
import { categories } from '../../db/schema/categories.js';
import { productSizes } from '../../db/schema/productSizes.js';
import { products } from '../../db/schema/products.js';
import { userProfiles } from '../../db/schema/userProfiles.js';
import { type Tx, withTenantContext } from '../../db/withTenantContext.js';

// RF-23 — the store-wide feed. Tenant-scoped: RLS keeps it to the active store
// (database.md §7.3), riding the `(tenant_id, created_at DESC)` index (§8).
// Newest first, id as the tiebreaker so pages are stable. The author is a LEFT
// JOIN: a deleted user leaves `created_by` NULL and the event survives (RN-09).
export function listFeedEvents(
  query: AvailabilityEventFeedQuery,
): Promise<{ items: AvailabilityFeedEvent[]; total: number }> {
  const where = and(
    query.from ? gte(availabilityEvents.createdAt, query.from) : undefined,
    query.to ? lte(availabilityEvents.createdAt, query.to) : undefined,
  );
  const { limit, offset } = pageToLimitOffset(query);

  return withTenantContext(async (tx) => {
    const rows = await tx
      .select({
        id: availabilityEvents.id,
        type: availabilityEvents.type,
        createdAt: availabilityEvents.createdAt,
        authorName: userProfiles.fullName,
        itemId: availabilityEvents.assortmentItemId,
        productName: products.name,
        sizeLabel: productSizes.label,
      })
      .from(availabilityEvents)
      .innerJoin(assortmentItems, eq(assortmentItems.id, availabilityEvents.assortmentItemId))
      .innerJoin(productSizes, eq(productSizes.id, assortmentItems.sizeId))
      .innerJoin(products, eq(products.id, productSizes.productId))
      .leftJoin(userProfiles, eq(userProfiles.id, availabilityEvents.createdBy))
      .where(where)
      .orderBy(desc(availabilityEvents.createdAt), desc(availabilityEvents.id))
      .limit(limit)
      .offset(offset);
    const [totalRow] = await tx.select({ total: count() }).from(availabilityEvents).where(where);
    return {
      items: rows.map(({ itemId, productName, sizeLabel, createdAt, ...event }) => ({
        ...event,
        createdAt: createdAt.toISOString(),
        item: { id: itemId, productName, sizeLabel },
      })),
      total: totalRow?.total ?? 0,
    };
  });
}

// Each assortment item's latest event timestamp (RN-07), served by the
// `(assortment_item_id, created_at DESC)` index (database.md §8). With strict
// alternation (RN-14), an out-of-stock item's latest event is the start of
// its current outage — the aging origin (DP-07).
function latestEvents(tx: Tx) {
  return tx
    .select({
      itemId: availabilityEvents.assortmentItemId,
      at: max(availabilityEvents.createdAt).as('latest_event_at'),
    })
    .from(availabilityEvents)
    .groupBy(availabilityEvents.assortmentItemId)
    .as('latest_events');
}

// RF-18 / AD-22 — the assortment grouped by product. Tenant-scoped: RLS keeps
// `assortment_items` and the events to the active store (database.md §7.3).
// Two reads in one transaction: (1) the page of products — grouped over the
// store's assorted sizes so filters and the sort key see the whole run; (2)
// the complete runs of exactly those products. A run is never split.
export function listAssortment(
  query: AvailabilityListQuery,
): Promise<{ items: AvailabilityProduct[]; total: number }> {
  const { limit, offset } = pageToLimitOffset(query);
  const pattern = query.search ? containsPattern(query.search) : undefined;

  return withTenantContext(async (tx) => {
    const latest = latestEvents(tx);

    // The sort key (database.md §8): the oldest current outage in the run —
    // the earliest latest-event among the run's out-of-stock sizes. NULL for
    // a fully available product, which sorts after, by name.
    const matching = tx
      .select({
        productId: products.id,
        name: products.name,
        agingKey: sql`min(${latest.at}) filter (where not ${assortmentItems.isAvailable})`.as('aging_key'),
      })
      .from(assortmentItems)
      .innerJoin(productSizes, eq(productSizes.id, assortmentItems.sizeId))
      .innerJoin(products, eq(products.id, productSizes.productId))
      .leftJoin(latest, eq(latest.itemId, assortmentItems.id))
      .where(query.categoryId ? eq(products.categoryId, query.categoryId) : undefined)
      .groupBy(products.id)
      .having(
        and(
          // Product-level selects over the whole run (RF-18, RF-24).
          query.outOfStock ? sql`bool_or(not ${assortmentItems.isAvailable})` : undefined,
          pattern ? or(ilike(products.name, pattern), sql`bool_or(${productSizes.sku} ilike ${pattern})`) : undefined,
        ),
      )
      .as('matching');

    const page = await tx
      .select({ productId: matching.productId })
      .from(matching)
      .orderBy(sql`${matching.agingKey} asc nulls last`, asc(matching.name), asc(matching.productId))
      .limit(limit)
      .offset(offset);
    const [totalRow] = await tx.select({ total: count() }).from(matching);
    const total = totalRow?.total ?? 0;

    const productIds = page.map((row) => row.productId);
    if (productIds.length === 0) return { items: [], total };

    const rows = await tx
      .select({
        productId: products.id,
        productName: products.name,
        imageUrl: products.imageUrl,
        categoryName: categories.name,
        productActive: products.isActive,
        id: assortmentItems.id,
        sizeId: productSizes.id,
        label: productSizes.label,
        sku: productSizes.sku,
        isAvailable: assortmentItems.isAvailable,
        isActive: productSizes.isActive,
        latestEventAt: latest.at,
      })
      .from(assortmentItems)
      .innerJoin(productSizes, eq(productSizes.id, assortmentItems.sizeId))
      .innerJoin(products, eq(products.id, productSizes.productId))
      .innerJoin(categories, eq(categories.id, products.categoryId))
      .leftJoin(latest, eq(latest.itemId, assortmentItems.id))
      .where(inArray(products.id, productIds))
      .orderBy(asc(productSizes.position), asc(productSizes.label));

    const byProduct = new Map<string, AvailabilityProduct>();
    for (const productId of productIds) {
      byProduct.set(productId, { id: productId, name: '', imageUrl: null, categoryName: '', isActive: true, sizes: [] });
    }
    for (const { productId, productName, imageUrl, categoryName, productActive, latestEventAt, ...size } of rows) {
      const product = byProduct.get(productId)!;
      Object.assign(product, { name: productName, imageUrl, categoryName, isActive: productActive });
      product.sizes.push({ ...size, latestEventAt: latestEventAt ? latestEventAt.toISOString() : null });
    }
    return { items: [...byProduct.values()], total };
  });
}

// One assortment item with its product's identity, inside a caller's
// transaction. Under RLS another store's item is simply no row, so an
// unknown id and a foreign one are the same `undefined` (RN-03). The latest
// event is a correlated `max` on the `(assortment_item_id, created_at DESC)`
// index (database.md §8).
async function selectItem(tx: Tx, id: string): Promise<AvailabilityItem | undefined> {
  const [row] = await tx
    .select({
      id: assortmentItems.id,
      sizeId: productSizes.id,
      label: productSizes.label,
      sku: productSizes.sku,
      isAvailable: assortmentItems.isAvailable,
      isActive: productSizes.isActive,
      latestEventAt: sql`(select max(${availabilityEvents.createdAt}) from ${availabilityEvents}
        where ${availabilityEvents.assortmentItemId} = ${assortmentItems.id})`.mapWith(availabilityEvents.createdAt),
      productId: products.id,
      productName: products.name,
      imageUrl: products.imageUrl,
      categoryName: categories.name,
      productActive: products.isActive,
    })
    .from(assortmentItems)
    .innerJoin(productSizes, eq(productSizes.id, assortmentItems.sizeId))
    .innerJoin(products, eq(products.id, productSizes.productId))
    .innerJoin(categories, eq(categories.id, products.categoryId))
    .where(eq(assortmentItems.id, id));
  if (!row) return undefined;

  const { productId, productName, imageUrl, categoryName, productActive, latestEventAt, ...size } = row;
  return {
    ...size,
    latestEventAt: latestEventAt ? latestEventAt.toISOString() : null,
    product: { id: productId, name: productName, imageUrl, categoryName, isActive: productActive },
  };
}

// `GET /availability/:id` — one assortment item with its product's identity.
export function getItem(id: string): Promise<AvailabilityItem | undefined> {
  return withTenantContext((tx) => selectItem(tx, id));
}

// RF-20 / AD-04 — the single write path of availability (RN-05): one
// transaction that (1) locks the item row — `FOR UPDATE` serializes
// concurrent flags on the same item, so the second one reads the first one's
// committed state; (2) rejects an event matching the current state (RN-14 —
// the cached flag equals the latest event's state by the invariant); (3)
// inserts the event and (4) updates the cached flag to the derived state.
// The event's `created_at` is `clock_timestamp()`, read after the lock, not
// the transaction-start `now()`: a flag that waited on the lock must not be
// stamped earlier than the one it waited for, or "latest event" would no
// longer be the last one recorded. Returns the updated item (same shape as
// `GET /availability/:id`).
export function recordEvent(
  id: string,
  type: AvailabilityEventType,
): Promise<{ item: AvailabilityItem } | 'not_found' | 'same_state'> {
  return withTenantContext(async (tx) => {
    const [locked] = await tx
      .select({ tenantId: assortmentItems.tenantId, isAvailable: assortmentItems.isAvailable })
      .from(assortmentItems)
      .where(eq(assortmentItems.id, id))
      .for('update');
    if (!locked) return 'not_found';

    const isAvailable = type === 'restock';
    if (locked.isAvailable === isAvailable) return 'same_state';

    await tx.insert(availabilityEvents).values({
      tenantId: locked.tenantId,
      assortmentItemId: id,
      type,
      createdBy: requestContext.getStore()!.userId, // withTenantContext already failed closed without it
      createdAt: sql`clock_timestamp()`,
    });
    await tx.update(assortmentItems).set({ isAvailable }).where(eq(assortmentItems.id, id));
    return { item: (await selectItem(tx, id))! };
  });
}

// RF-21 — one item's history, newest first (id as the tiebreaker), on the
// `(assortment_item_id, created_at DESC)` index. The item is looked up first
// in the same transaction so an unknown or foreign item (RLS: no row) is
// `undefined` rather than an empty page — the same 404 as `getItem` (RN-03).
// The author is a LEFT JOIN: a deleted user leaves `created_by` NULL (RN-09).
export function listItemEvents(
  id: string,
  query: Pagination,
): Promise<{ items: AvailabilityItemEvent[]; total: number } | undefined> {
  const { limit, offset } = pageToLimitOffset(query);

  return withTenantContext(async (tx) => {
    const [item] = await tx
      .select({ id: assortmentItems.id })
      .from(assortmentItems)
      .where(eq(assortmentItems.id, id));
    if (!item) return undefined;

    const ofItem = eq(availabilityEvents.assortmentItemId, id);
    const rows = await tx
      .select({
        id: availabilityEvents.id,
        type: availabilityEvents.type,
        createdAt: availabilityEvents.createdAt,
        authorName: userProfiles.fullName,
      })
      .from(availabilityEvents)
      .leftJoin(userProfiles, eq(userProfiles.id, availabilityEvents.createdBy))
      .where(ofItem)
      .orderBy(desc(availabilityEvents.createdAt), desc(availabilityEvents.id))
      .limit(limit)
      .offset(offset);
    const [totalRow] = await tx.select({ total: count() }).from(availabilityEvents).where(ofItem);
    return {
      items: rows.map(({ createdAt, ...event }) => ({ ...event, createdAt: createdAt.toISOString() })),
      total: totalRow?.total ?? 0,
    };
  });
}
