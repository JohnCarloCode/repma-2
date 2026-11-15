import { and, count, desc, eq, gte, lte } from 'drizzle-orm';
import type { AvailabilityEventFeedQuery, AvailabilityFeedEvent } from 'shared';
import { pageToLimitOffset } from '../../core/http/pagination.js';
import { assortmentItems } from '../../db/schema/assortmentItems.js';
import { availabilityEvents } from '../../db/schema/availabilityEvents.js';
import { productSizes } from '../../db/schema/productSizes.js';
import { products } from '../../db/schema/products.js';
import { userProfiles } from '../../db/schema/userProfiles.js';
import { withTenantContext } from '../../db/withTenantContext.js';

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
