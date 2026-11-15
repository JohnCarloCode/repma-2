import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'react-router';
import type { AvailabilityProduct, Category, Page } from 'shared';
import { InactiveBadge } from '../components/InactiveBadge';
import { ProductThumb } from '../components/availability/ProductThumb';
import { AgingFigure, SizeRun } from '../components/availability/SizeRun';
import { FilterBand, SearchField, filterControlClass } from '../components/list/FilterBand';
import { PageHeader } from '../components/list/PageHeader';
import { Pagination } from '../components/list/Pagination';
import { EmptyState, ErrorState } from '../components/list/states';
import { useEmptyPageRecovery, useListParams } from '../components/list/useListParams';
import { oldestOutage } from '../lib/aging';
import { api } from '../lib/apiClient';
import { useStoreScope } from '../tenant/activeStore';

/**
 * Router state every tile link carries to `/availability/:id`: the list's
 * query string, so the detail's back action returns to the same view
 * (availability.md §Flows · Open a size's detail).
 */
export interface AvailabilityLinkState {
  listSearch: string;
}

const cardClass = 'overflow-hidden rounded-md border border-border bg-surface';

/**
 * availability.md — the store's assortment read by product, one line per
 * product carrying its size run and the oldest outage's elapsed figure (AD-22).
 * Interim until 6.3: no "Add to assortment" header action (the ProductPicker ships there).
 */
export function AvailabilityPage() {
  const scope = useStoreScope();
  const location = useLocation();
  const list = useListParams(['search', 'categoryId', 'outOfStock'] as const);
  const { page } = list;
  const { search, categoryId } = list.filters;
  const outOfStock = list.filters.outOfStock === 'true';

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: scope.key('availability', 'list', { page, search, categoryId, outOfStock }),
    queryFn: () => {
      const query = new URLSearchParams({ page: String(page) });
      if (search) query.set('search', search);
      if (categoryId) query.set('categoryId', categoryId);
      // The API accepts only the literal `true`: the param is omitted when off.
      if (outOfStock) query.set('outOfStock', 'true');
      return api.get<Page<AvailabilityProduct>>(`/availability?${query}`, scope.request);
    },
  });
  useEmptyPageRecovery(data, list.setPage);

  // Global catalog route: no `X-Tenant-Id`, and a key outside the store scope.
  const categories = useQuery({
    queryKey: ['categories', { pageSize: 100 }],
    queryFn: () => api.get<Page<Category>>('/categories?pageSize=100'),
  });

  const linkState: AvailabilityLinkState = { listSearch: location.search };

  return (
    <main className="flex flex-col gap-lg">
      <PageHeader
        title="Availability"
        subtitle={data && `${scope.store.name} · ${data.total} ${data.total === 1 ? 'product' : 'products'}`}
      />
      <FilterBand>
        <SearchField
          label="Search"
          placeholder="Search by name or SKU…"
          value={search}
          onChange={(value) => list.setFilter('search', value)}
        />
        <select
          aria-label="Category"
          value={categoryId}
          onChange={(e) => list.setFilter('categoryId', e.target.value)}
          className={`${filterControlClass} tablet:min-w-[200px]`}
        >
          <option value="">All categories</option>
          {categories.data?.items.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <label className={`${filterControlClass} inline-flex cursor-pointer items-center gap-sm`}>
          <input
            type="checkbox"
            checked={outOfStock}
            onChange={(e) => list.setFilter('outOfStock', e.target.checked ? 'true' : '')}
            className="size-[16px] accent-accent"
          />
          Only out of stock
        </label>
      </FilterBand>
      {isPending ? (
        <AvailabilitySkeleton />
      ) : isError ? (
        <ErrorState message={error.message} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        !list.hasFilters ? (
          <EmptyState icon="inventory_2" title="No items in the assortment yet." />
        ) : (
          <EmptyState
            icon={outOfStock && !search && !categoryId ? 'check_circle' : 'search'}
            title={outOfStock && !search && !categoryId ? 'No out-of-stock items.' : 'No results for these filters.'}
            action={{ label: 'Clear filters', onClick: list.clearFilters }}
          />
        )
      ) : (
        <>
          <ul aria-label="Products" className={`${cardClass} divide-y divide-border`}>
            {data.items.map((product) => (
              <ProductLine key={product.id} product={product} linkState={linkState} />
            ))}
          </ul>
          <Pagination data={data} onPageChange={list.setPage} />
        </>
      )}
    </main>
  );
}

/** Three zones: identity, the run, the oldest outage's figure right-aligned on the run's first line. */
function ProductLine({ product, linkState }: { product: AvailabilityProduct; linkState: AvailabilityLinkState }) {
  const since = oldestOutage(product.sizes);
  return (
    <li className="flex flex-wrap items-start gap-base px-base py-[10px]">
      <div className="flex min-w-0 flex-[0_1_240px] items-center gap-[12px] pt-[6px]">
        <ProductThumb name={product.name} imageUrl={product.imageUrl} />
        <div className="flex min-w-0 flex-col gap-[2px]">
          <span className="flex flex-wrap items-center gap-sm">
            <span className="text-body-medium text-text">{product.name}</span>
            {!product.isActive && <InactiveBadge />}
          </span>
          <span className="text-caption text-text-secondary">{product.categoryName}</span>
        </div>
      </div>
      <div className="min-w-0 flex-[1_1_280px]">
        <SizeRun
          sizes={product.sizes}
          label={`${product.name} sizes`}
          href={(size) => `/availability/${size.id}`}
          linkState={linkState}
        />
      </div>
      <div className="w-[56px] flex-none pt-[12px] text-right">
        {since ? <AgingFigure since={since} /> : <span className="font-mono text-data text-text-secondary">—</span>}
      </div>
    </li>
  );
}

/** Loading: static product lines in the real geometry — identity blocks plus a row of 44px tiles, so nothing jumps. */
function AvailabilitySkeleton() {
  return (
    <div role="status" aria-label="Loading" className={`${cardClass} divide-y divide-border`}>
      {Array.from({ length: 6 }, (_, line) => (
        <div key={line} className="flex flex-wrap items-start gap-base px-base py-[10px]">
          <div className="flex min-w-0 flex-[0_1_240px] items-center gap-[12px] pt-[6px]">
            <div className="size-[32px] flex-none rounded-sm bg-surface-raised" />
            <div className="h-[14px] flex-1 rounded-sm bg-surface-raised" />
          </div>
          <div className="flex min-w-0 flex-[1_1_280px] flex-wrap gap-sm">
            {Array.from({ length: 6 }, (_, tile) => (
              <div key={tile} className="size-[44px] rounded-sm bg-surface-raised" />
            ))}
          </div>
          <div className="w-[56px] flex-none" />
        </div>
      ))}
    </div>
  );
}
