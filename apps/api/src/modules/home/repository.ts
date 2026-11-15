import { and, count, eq, inArray, not } from 'drizzle-orm';
import type { HomeSummary } from 'shared';
import { assortmentItems } from '../../db/schema/assortmentItems.js';
import { replenishmentListItems } from '../../db/schema/replenishmentListItems.js';
import { replenishmentLists } from '../../db/schema/replenishmentLists.js';
import { withTenantContext } from '../../db/withTenantContext.js';

const OPEN = ['draft', 'processing'] as const;

// RF-41 — three COUNTs in one transaction. Tenant-scoped: RLS keeps every
// table to the active store (database.md §7.3). Two worlds side by side,
// never joined (DP-06): the list counts never look at availability and the
// out-of-stock count never looks at lists.
export function getSummary(): Promise<HomeSummary> {
  return withTenantContext(async (tx) => {
    const [lists] = await tx
      .select({ total: count() })
      .from(replenishmentLists)
      .where(inArray(replenishmentLists.status, [...OPEN]));
    // Unchecked lines across **all** open lists.
    const [pending] = await tx
      .select({ total: count() })
      .from(replenishmentListItems)
      .innerJoin(replenishmentLists, eq(replenishmentLists.id, replenishmentListItems.listId))
      .where(and(inArray(replenishmentLists.status, [...OPEN]), not(replenishmentListItems.isDone)));
    // Out-of-stock sizes from the event-log cache (database.md §4.6/§4.7),
    // on the partial `assortment_items_out_of_stock_idx`. Inactive
    // products/sizes count too: they stay visible and flagged (RN-08).
    const [outOfStock] = await tx
      .select({ total: count() })
      .from(assortmentItems)
      .where(not(assortmentItems.isAvailable));
    return {
      openLists: lists?.total ?? 0,
      pendingItems: pending?.total ?? 0,
      outOfStock: outOfStock?.total ?? 0,
    };
  });
}
