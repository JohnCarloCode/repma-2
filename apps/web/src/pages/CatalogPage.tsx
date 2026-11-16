import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import type { AvailabilityItem, AvailabilityProduct, Category, Page, Product, ProductSize } from 'shared';
import { InactiveBadge } from '../components/InactiveBadge';
import { Sheet } from '../components/Sheet';
import { secondaryButtonClass, textButtonClass } from '../components/buttons';
import { ProductThumb } from '../components/availability/ProductThumb';
import { DataTable, type Column } from '../components/list/DataTable';
import { FilterBand, SearchField, filterControlClass } from '../components/list/FilterBand';
import { PageHeader } from '../components/list/PageHeader';
import { Pagination } from '../components/list/Pagination';
import { EmptyState, ErrorState, LoadingState } from '../components/list/states';
import { useListParams } from '../components/list/useListParams';
import { ApiError, api } from '../lib/apiClient';
import { useToast } from '../lib/toast';
import { useStoreScope } from '../tenant/activeStore';
import { sizeIdMessage } from './AvailabilityPage';

/**
 * The `isActive` URL param (catalog.md §Edge cases): absent = the default "Active"; `all` and
 * `false` are explicit choices, so back/refresh keep them. `true` is accepted as Active too.
 */
const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Inactive' },
] as const;

/**
 * Per product id: its sizes in this store's assortment, catalog size id → assortment item id
 * (the `/availability/:id` link target). An absent product has none.
 */
type Assorted = Map<string, Map<string, string>>;

/** The cross-reference query as the row cell and the sheet read it. */
interface AssortedQuery {
  data?: Assorted;
  isError: boolean;
  refetch: () => unknown;
}

/**
 * catalog.md — the manager's view of the global catalog (RF-15, RF-35): products table with the
 * store's assortment cross-referenced per rendered page (RF-18 `productId`). A row opens the
 * product detail slide-over, this page's only add surface (per size, RF-19).
 */
export function CatalogPage() {
  const scope = useStoreScope();
  const list = useListParams(['search', 'categoryId', 'isActive'] as const);
  const { page } = list;
  const { search, categoryId } = list.filters;
  const status = list.filters.isActive === 'all' || list.filters.isActive === 'false' ? list.filters.isActive : 'true';

  // Global catalog route: no `X-Tenant-Id`, and a key outside the store scope.
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['products', { page, search, categoryId, isActive: status }],
    queryFn: () => {
      const query = new URLSearchParams({ page: String(page) });
      if (search) query.set('search', search);
      if (categoryId) query.set('categoryId', categoryId);
      if (status !== 'all') query.set('isActive', status);
      return api.get<Page<Product>>(`/products?${query}`);
    },
  });

  // The assortment cross-reference: exactly the rendered products, `pageSize` = the ids sent so
  // the default page size never truncates it. Under the store's `availability` family, so adds
  // and removals (6.6, /availability) refresh it.
  const ids = data?.items.map((p) => p.id) ?? [];
  const assorted = useQuery({
    queryKey: scope.key('availability', 'catalog', ids),
    queryFn: () => {
      const query = new URLSearchParams({ productId: ids.join(','), pageSize: String(ids.length) });
      return api.get<Page<AvailabilityProduct>>(`/availability?${query}`, scope.request);
    },
    select: (res): Assorted => new Map(res.items.map((p) => [p.id, new Map(p.sizes.map((s) => [s.sizeId, s.id]))])),
    enabled: ids.length > 0,
  });

  // The sheet shows the product from the current page data (so a products refetch reaches it),
  // falling back to the row it was opened from; `open` is separate so it can animate out.
  const [detail, setDetail] = useState<{ product: Product; open: boolean } | null>(null);
  const shown = detail && (data?.items.find((p) => p.id === detail.product.id) ?? detail.product);

  const categories = useQuery({
    queryKey: ['categories', { pageSize: 100 }],
    queryFn: () => api.get<Page<Category>>('/categories?pageSize=100'),
  });

  const columns: Column<Product>[] = [
    {
      header: 'Product',
      cell: (product) => (
        <span className={`flex items-center gap-[12px] ${product.isActive ? '' : 'text-text-secondary'}`}>
          <ProductThumb name={product.name} imageUrl={product.imageUrl} sizeClass="size-[40px]" />
          <span className="text-body-medium">{product.name}</span>
        </span>
      ),
    },
    {
      header: 'Sizes',
      cell: (product) => (
        <span className="text-caption text-text-secondary">
          {product.sizes.length} {product.sizes.length === 1 ? 'size' : 'sizes'}
        </span>
      ),
    },
    { header: 'Category', cell: (product) => product.categoryName },
    { header: 'Status', cell: (product) => (product.isActive ? null : <InactiveBadge />) },
    {
      header: 'In assortment',
      cell: (product) => <AssortmentCell total={product.sizes.length} assorted={assorted} id={product.id} />,
    },
  ];

  return (
    <main className="flex flex-col gap-lg">
      <PageHeader
        title="Catalog"
        subtitle={data && `${data.total} ${data.total === 1 ? 'product' : 'products'} in the global catalog`}
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
        <select
          aria-label="Status"
          value={status}
          onChange={(e) => list.setFilter('isActive', e.target.value === 'true' ? '' : e.target.value)}
          className={`${filterControlClass} tablet:min-w-[160px]`}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </FilterBand>
      {/* Non-blocking (catalog.md §States): the table stays, the column degrades to "—". */}
      {assorted.isError && <AssortedError onRetry={() => void assorted.refetch()} />}
      {isPending ? (
        <LoadingState columns={columns.length} />
      ) : isError ? (
        <ErrorState message={error.message} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        list.hasFilters ? (
          <EmptyState
            icon="search"
            title="No results for these filters"
            action={{ label: 'Clear filters', onClick: list.clearFilters }}
          />
        ) : (
          <EmptyState icon="menu_book" title="No active products in the catalog" />
        )
      ) : (
        <>
          <DataTable
            label="Products"
            columns={columns}
            rows={data.items}
            rowKey={(product) => product.id}
            onRowClick={(product) => setDetail({ product, open: true })}
          />
          <Pagination data={data} onPageChange={list.setPage} />
        </>
      )}
      {shown && (
        <ProductSheet
          product={shown}
          open={detail.open}
          onClose={() => setDetail({ ...detail, open: false })}
          assorted={assorted}
        />
      )}
    </main>
  );
}

/**
 * catalog.md §Products table · In assortment: the check when any size is in the store's
 * assortment, "N of M sizes" when only some are (M = all the product's sizes, as in the Sizes
 * column); "—" when none is — or when the cross-reference failed (indeterminate). Blank while
 * it loads: no verdict yet.
 */
function AssortmentCell({
  id,
  total,
  assorted,
}: {
  id: string;
  total: number;
  assorted: AssortedQuery;
}) {
  if (assorted.isError) return <Dash />;
  if (!assorted.data) return <Skeleton />;
  const count = assorted.data.get(id)?.size ?? 0;
  if (count === 0) return <Dash />;
  return (
    <span className="inline-flex flex-col">
      <span className="inline-flex items-center gap-xs">
        <span className="icon" aria-hidden>
          check
        </span>
        In assortment
      </span>
      {count < total && (
        <span className="font-mono text-caption text-text-secondary">
          {count} of {total} sizes
        </span>
      )}
    </span>
  );
}

const Dash = () => <span className="text-text-secondary">—</span>;
const Skeleton = () => <span aria-hidden className="inline-block h-[14px] w-[80px] rounded-sm bg-surface-raised" />;

/** The non-blocking cross-reference failure notice (catalog.md §States), on the page and in the sheet. */
function AssortedError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-sm rounded-sm bg-alert-soft px-base text-alert">
      <span className="icon" aria-hidden>
        error
      </span>
      <span>Assortment status could not be loaded.</span>
      <button type="button" className={textButtonClass} onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

/**
 * catalog.md §Product detail — the slide-over, from the row's data (no extra fetch): image,
 * category, status, description, aggregate assortment status, and the size list with each size's
 * state in this store: "In assortment" → its `/availability/:id`, "Add to assortment" (active
 * product and size, RN-08; not already in, RN-04) or "—". While the cross-reference loads or has
 * failed no size gets a verdict, so no add is offered (the API stays the authority either way).
 */
function ProductSheet({
  product,
  open,
  onClose,
  assorted,
}: {
  product: Product;
  open: boolean;
  onClose: () => void;
  assorted: AssortedQuery;
}) {
  const { add, pending } = useAddSize();
  const items = assorted.data?.get(product.id);

  const status = (size: ProductSize) => {
    if (assorted.isError) return <Dash />;
    if (!assorted.data) return <Skeleton />;
    const itemId = items?.get(size.id);
    if (itemId) {
      return (
        <Link to={`/availability/${itemId}`} className={`${textButtonClass} gap-xs`}>
          <span className="icon" aria-hidden>
            check
          </span>
          In assortment
        </Link>
      );
    }
    if (!product.isActive || !size.isActive) return <Dash />;
    const adding = pending.has(size.id);
    return (
      <button type="button" className={secondaryButtonClass} disabled={adding} onClick={() => void add(size.id)}>
        {adding ? 'Adding…' : 'Add to assortment'}
      </button>
    );
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={product.name}
      footer={
        <button type="button" className={textButtonClass} onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="flex flex-col gap-lg">
        <div className="flex items-start gap-base">
          <ProductThumb name={product.name} imageUrl={product.imageUrl} sizeClass="size-[96px]" />
          <div className="flex min-w-0 flex-col gap-xs">
            <span className="text-text-secondary">{product.categoryName}</span>
            {!product.isActive && (
              <span>
                <InactiveBadge />
              </span>
            )}
            <AssortmentCell id={product.id} total={product.sizes.length} assorted={assorted} />
          </div>
        </div>
        {product.description && <p>{product.description}</p>}
        {assorted.isError && <AssortedError onRetry={() => void assorted.refetch()} />}
        <section className="flex flex-col gap-sm">
          <h3 className="text-label text-text-secondary">Sizes</h3>
          <ul aria-label="Sizes" className="flex flex-col">
            {product.sizes.map((size) => (
              <li
                key={size.id}
                className="flex min-h-[56px] items-center justify-between gap-base border-b border-border py-xs last:border-b-0"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="flex flex-wrap items-center gap-sm">
                    <span className={`text-body-medium ${size.isActive ? '' : 'text-text-secondary'}`}>{size.label}</span>
                    {!size.isActive && <InactiveBadge />}
                  </span>
                  <span className="font-mono text-caption text-text-secondary">{size.sku}</span>
                </span>
                {status(size)}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Sheet>
  );
}

/**
 * catalog.md §Flows · Add size to assortment: `POST /availability { sizeId }` directly, one
 * request in flight per size. Unlike the picker's add (`/availability`, inline messages) every
 * outcome is a toast here. 201 → "Added to assortment"; 409 (RN-04, added elsewhere) → the API
 * message; 400 on `sizeId` (RN-08) → its detail message. The size stays pending until the
 * invalidated queries have refetched, so it flips straight to its new state: the store's
 * `availability` family after 201/409 (row + sheet), the global products after a 400 (the size or
 * product now reads inactive and loses the action). Home is untouched (the item starts available).
 */
function useAddSize() {
  const scope = useStoreScope();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());

  const add = async (sizeId: string) => {
    if (pending.has(sizeId)) return;
    setPending((current) => new Set(current).add(sizeId));
    try {
      await api.post<AvailabilityItem>('/availability', { sizeId }, scope.request);
      toast.success('Added to assortment');
      await queryClient.invalidateQueries({ queryKey: scope.key('availability') });
    } catch (err) {
      const field = err instanceof ApiError && err.status === 400 ? sizeIdMessage(err.details) : undefined;
      toast.error(field ?? err);
      if (err instanceof ApiError && err.status === 409) {
        await queryClient.invalidateQueries({ queryKey: scope.key('availability') });
      } else if (field) {
        await queryClient.invalidateQueries({ queryKey: ['products'] });
      }
    } finally {
      setPending((current) => {
        const next = new Set(current);
        next.delete(sizeId);
        return next;
      });
    }
  };
  return { add, pending };
}
