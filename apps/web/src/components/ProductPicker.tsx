import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import type { AvailabilityProduct, AvailabilitySize, Category, Page, Product } from 'shared';
import { api } from '../lib/apiClient';
import { useStoreScope } from '../tenant/activeStore';
import { InactiveBadge } from './InactiveBadge';
import { Modal } from './Modal';
import { ProductThumb } from './availability/ProductThumb';
import { SizeRun } from './availability/SizeRun';
import { primaryButtonClass, secondaryButtonClass } from './buttons';
import { textInputClass } from './form';
import { SearchField } from './list/FilterBand';
import { Pagination } from './list/Pagination';
import { EmptyState, ErrorState } from './list/states';

/** What the picker hands its consumer on confirm: the size to add plus its identity (for optimistic rendering). */
export interface PickerSelection {
  sizeId: string;
  quantity: number;
  product: AvailabilityProduct;
  size: AvailabilitySize;
}

/** The assortment flow's selection: no extra fields (availability.md §Add size to assortment). */
export type AssortmentSelection = Omit<PickerSelection, 'quantity'>;

interface CommonProps {
  open: boolean;
  /** "Close" (or Escape / a scrim click) ends the session. Ignored while a confirm is in flight. */
  onClose: () => void;
  /** The flow title, e.g. "Add product". */
  title: string;
  /** The primary CTA, e.g. "Add to list". */
  confirmLabel: string;
  /** The CTA while `onConfirm` is in flight, e.g. "Adding…". */
  pendingLabel: string;
}

/** Replenishment flow (the default): the store's assortment, a quantity field, stays open after confirm. */
interface ReplenishmentFlowProps {
  flow?: 'replenishment';
  /** Sizes that can't be picked again (RN-04), by `sizeId` — e.g. the list's `items[].sizeId`. */
  disabledSizeIds: ReadonlySet<string>;
  /** Why those sizes are disabled, e.g. "Already on the list". */
  disabledLabel: string;
  /**
   * The consumer's mutation (the picker performs none). While the promise is pending the CTA shows
   * `pendingLabel` and the dialog can't be dismissed. Resolved: the picker stays open with the
   * product still selected, the size cleared and the quantity back to 1 — the consumer's
   * `disabledSizeIds` update is the feedback. Rejected: the selection is kept; the consumer
   * surfaces the error itself (toast) — the rejection is swallowed here.
   */
  onConfirm: (selection: PickerSelection) => Promise<unknown>;
}

/**
 * Assortment flow: the global catalog (`GET /products?isActive=true`, inactive sizes dropped — RN-08),
 * no extra fields, closes after confirm. The picker builds the disabled set itself (sizes the store
 * already carries, RN-04) from the `productId` cross-reference of the grid page — the consumer
 * can't know which products are on screen.
 */
interface AssortmentFlowProps {
  flow: 'assortment';
  /**
   * The consumer's mutation. Resolved with nothing: the picker closes. Resolved with a message:
   * the picker stays open and shows it inline on the size step (the 409/400 mapping —
   * availability.md §Flows). Rejected: the consumer surfaced the error (toast); the selection stays.
   */
  onConfirm: (selection: AssortmentSelection) => Promise<string | void>;
}

type ProductPickerProps = CommonProps & (ReplenishmentFlowProps | AssortmentFlowProps);

const ASSORTED_LABEL = 'Already in the assortment';
const NO_SIZES: ReadonlySet<string> = new Set();

/** A catalog product on the card/run shape, active sizes only (the assortment flow never offers inactive ones). */
function toPickerProduct(product: Product): AvailabilityProduct {
  return {
    id: product.id,
    name: product.name,
    imageUrl: product.imageUrl,
    categoryName: product.categoryName,
    isActive: product.isActive,
    sizes: product.sizes
      .filter((s) => s.isActive)
      .map((s) => ({ id: s.id, sizeId: s.id, label: s.label, sku: s.sku, isAvailable: true, isActive: true, latestEventAt: null })),
  };
}

const PAGE_SIZE = 24;

/**
 * product-picker.md — the visual product & size selector. Replenishment flow: the store's
 * assortment (`GET /availability`, AD-22) browsed by category and search, inactive products and
 * sizes included and selectable (RN-12/RN-08), availability state never shown nor filtered on
 * (DP-06); stays open after confirm (adding several in a row is the common case). Assortment
 * flow: the active catalog, no quantity, closes after confirm.
 */
export function ProductPicker(props: ProductPickerProps) {
  const { open, onClose } = props;
  const [pending, setPending] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={props.title}
      pending={pending}
      sheetOnMobile
      // Stable height: fixed at its maximum (viewport-capped) from tablet up, full-screen below.
      className="flex flex-col tablet:h-[min(880px,calc(100dvh-48px))] tablet:max-w-[min(1200px,calc(100vw-64px))]"
    >
      {/* Mounted only while open (the Dialog unmounts its panel), so every session starts clean. */}
      <PickerBody {...props} pending={pending} setPending={setPending} />
    </Modal>
  );
}

function PickerBody(
  props: ProductPickerProps & { pending: boolean; setPending: (pending: boolean) => void },
) {
  const { confirmLabel, pendingLabel, onClose, pending, setPending } = props;
  const assortment = props.flow === 'assortment';
  const scope = useStoreScope();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [page, setPage] = useState(1);
  const [product, setProduct] = useState<AvailabilityProduct | null>(null);
  const [sizeId, setSizeId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [error, setError] = useState<string | null>(null);

  const gridQuery = () => {
    const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (search) query.set('search', search);
    if (categoryId) query.set('categoryId', categoryId);
    return query;
  };
  // Catalog order (RF-46), not the default aging one: building a list never leans on availability (DP-06).
  const stock = useQuery({
    queryKey: scope.key('availability', 'picker', { page, search, categoryId, sort: 'catalog' }),
    queryFn: () => {
      const query = gridQuery();
      query.set('sort', 'catalog');
      return api.get<Page<AvailabilityProduct>>(`/availability?${query}`, scope.request);
    },
    enabled: !assortment,
  });
  // Global catalog route (no `X-Tenant-Id`); the cache keeps the API shape, the card shape is a `select`.
  const catalog = useQuery({
    queryKey: ['products', { isActive: true, page, pageSize: PAGE_SIZE, search, categoryId }],
    queryFn: () => {
      const query = gridQuery();
      query.set('isActive', 'true');
      return api.get<Page<Product>>(`/products?${query}`);
    },
    select: (data): Page<AvailabilityProduct> => ({ ...data, items: data.items.map(toPickerProduct) }),
    enabled: assortment,
  });
  const products = assortment ? catalog : stock;
  // Assortment flow, RN-04: which of the grid page's sizes the store already carries — the
  // `productId` cross-reference (one request per grid page, `pageSize` = the ids sent). Under the
  // `availability` family, so the consumer's invalidation after an add refreshes it.
  const gridIds = assortment ? (catalog.data?.items.map((p) => p.id) ?? []) : [];
  const assorted = useQuery({
    queryKey: scope.key('availability', 'picker', 'assorted', gridIds),
    queryFn: () => {
      const query = new URLSearchParams({ productId: gridIds.join(','), pageSize: String(gridIds.length) });
      return api.get<Page<AvailabilityProduct>>(`/availability?${query}`, scope.request);
    },
    select: (data) => new Set(data.items.flatMap((p) => p.sizes.map((s) => s.sizeId))),
    enabled: gridIds.length > 0,
  });
  const disabledSizeIds = assortment ? (assorted.data ?? NO_SIZES) : props.disabledSizeIds;
  const disabledLabel = assortment ? ASSORTED_LABEL : props.disabledLabel;
  // Global catalog route: no `X-Tenant-Id`, and the key `/availability` already shares.
  const categories = useQuery({
    queryKey: ['categories', { pageSize: 100 }],
    queryFn: () => api.get<Page<Category>>('/categories?pageSize=100'),
  });

  const filter = (next: { search?: string; categoryId?: string }) => {
    if (next.search !== undefined) setSearch(next.search);
    if (next.categoryId !== undefined) setCategoryId(next.categoryId);
    setPage(1);
  };

  const size = product?.sizes.find((s) => s.sizeId === sizeId && !disabledSizeIds.has(s.sizeId)) ?? null;
  const parsedQuantity = /^\d+$/.test(quantity.trim()) ? Number(quantity.trim()) : NaN;
  const quantityValid = Number.isInteger(parsedQuantity) && parsedQuantity >= 1 && parsedQuantity <= 9999;

  const ready = Boolean(product && size) && (assortment || quantityValid);

  const selectProduct = (next: AvailabilityProduct) => {
    if (next.id === product?.id) return;
    setProduct(next);
    setSizeId(null);
    setError(null);
  };

  const selectSize = (next: AvailabilitySize) => {
    setSizeId(next.sizeId);
    setError(null);
  };

  const confirm = async () => {
    if (!product || !size || !ready || pending) return;
    setPending(true);
    setError(null);
    let close = false;
    try {
      if (props.flow === 'assortment') {
        const message = await props.onConfirm({ sizeId: size.sizeId, product, size });
        if (message) setError(message);
        else close = true;
      } else {
        await props.onConfirm({ sizeId: size.sizeId, quantity: parsedQuantity, product, size });
        setSizeId(null);
        setQuantity('1');
      }
    } catch {
      // The consumer owns the error (toast); the selection stays for a retry.
    } finally {
      setPending(false);
    }
    if (close) onClose();
  };

  const stepQuantity = (delta: number) =>
    setQuantity(String(Math.min(9999, Math.max(1, (quantityValid ? parsedQuantity : 1) + delta))));

  return (
    <div className="mt-base flex min-h-0 flex-1 flex-col gap-base">
      <div className="grid">
        <SearchField
          label="Search products"
          placeholder="Search by name or SKU…"
          value={search}
          onChange={(value) => filter({ search: value })}
        />
      </div>

      {/* Below desktop the selection panel stacks under the browse zone; from desktop it is a fixed
          column on the right, so picking a product never shrinks the grid. */}
      <div className="flex min-h-0 flex-1 flex-col gap-base desktop:flex-row">
        <div className="flex min-h-0 flex-1 flex-col gap-base tablet:flex-row">
          <CategoryRail
            categories={categories.data?.items ?? []}
            value={categoryId}
            onChange={(value) => filter({ categoryId: value })}
          />
          {/* The grid zone keeps its height whatever the result count; it scrolls internally. */}
          <div className="flex min-h-[120px] flex-1 flex-col gap-base overflow-y-auto">
            {products.isPending ? (
              <GridSkeleton />
            ) : products.isError ? (
              <ErrorState message={products.error.message} onRetry={() => void products.refetch()} />
            ) : products.data.items.length === 0 ? (
              search || categoryId ? (
                <EmptyState
                  icon="search"
                  title="No results for these filters."
                  action={{ label: 'Clear filters', onClick: () => filter({ search: '', categoryId: '' }) }}
                />
              ) : (
                <EmptyState
                  icon="inventory_2"
                  title={assortment ? 'No active products in the catalog.' : 'No items in the assortment yet.'}
                />
              )
            ) : (
              <>
                <ul aria-label="Products" className={gridClass}>
                  {products.data.items.map((item) => (
                    <li key={item.id}>
                      <ProductCard product={item} selected={item.id === product?.id} onSelect={selectProduct} />
                    </li>
                  ))}
                </ul>
                {products.data.total > products.data.pageSize && (
                  <Pagination data={products.data} onPageChange={setPage} />
                )}
              </>
            )}
          </div>
        </div>

        {product ? (
          <section
            aria-label="Selection"
            className={`${selectionColumnClass} flex max-h-[45%] flex-col gap-[12px] overflow-y-auto border-t pt-base`}
          >
            <div className="flex items-center gap-[12px]">
              <ProductThumb name={product.name} imageUrl={product.imageUrl} />
              <div className="flex min-w-0 flex-col gap-[2px]">
                <span className="flex flex-wrap items-center gap-sm">
                  <span className="text-body-medium text-text">{product.name}</span>
                  {!product.isActive && <InactiveBadge />}
                </span>
                <span className="text-caption text-text-secondary">{product.categoryName}</span>
              </div>
            </div>
            <SizeRun
              sizes={product.sizes}
              label={`${product.name} sizes`}
              onSelect={selectSize}
              selectedSizeId={size?.sizeId ?? null}
              disabledSizeIds={disabledSizeIds}
              disabledLabel={disabledLabel}
            />
            {assortment && product.sizes.every((s) => disabledSizeIds.has(s.sizeId)) ? (
              <p className="text-caption text-text-secondary">No sizes available to add</p>
            ) : (
              <DisabledCaption product={product} disabledSizeIds={disabledSizeIds} disabledLabel={disabledLabel} />
            )}
            {error && (
              <p role="alert" className="text-caption text-alert">
                {error}
              </p>
            )}
            {!assortment && (
              <QuantityStepper value={quantity} valid={quantityValid} onChange={setQuantity} onStep={stepQuantity} />
            )}
          </section>
        ) : (
          <p className={`${selectionColumnClass} hidden text-body text-text-secondary desktop:block`}>
            Select a product to choose its size.
          </p>
        )}
      </div>

      <div className="flex flex-none flex-wrap justify-end gap-sm">
        <button type="button" className={secondaryButtonClass} disabled={pending} onClick={onClose}>
          Close
        </button>
        <button
          type="button"
          className={primaryButtonClass}
          disabled={pending || !ready}
          onClick={() => void confirm()}
        >
          {pending ? pendingLabel : confirmLabel}
        </button>
      </div>
    </div>
  );
}

// From tablet up: as many columns of cards at least 180px wide as the grid zone allows
// (product-picker.md §Implementation contract — Layout).
const gridClass = 'grid grid-cols-2 gap-[12px] tablet:grid-cols-[repeat(auto-fill,minmax(180px,1fr))]';

/** The selection panel's slot: under the browse zone, a 320px right column from desktop. */
const selectionColumnClass =
  'flex-none border-border desktop:max-h-none desktop:w-[320px] desktop:border-t-0 desktop:border-l desktop:pt-0 desktop:pl-base';

const chipClass =
  'inline-flex h-[44px] flex-none items-center rounded-sm px-[12px] text-body text-left transition-colors ' +
  'hover:bg-surface-hover aria-pressed:bg-accent-soft aria-pressed:text-text';

/** "All" + `GET /categories`, single-select: horizontal chips below tablet, a left rail from tablet up. */
function CategoryRail({
  categories,
  value,
  onChange,
}: {
  categories: Category[];
  value: string;
  onChange: (categoryId: string) => void;
}) {
  const options = [{ id: '', name: 'All' }, ...categories];
  return (
    <nav aria-label="Categories" className="flex-none overflow-x-auto tablet:w-[180px] tablet:overflow-y-auto">
      <ul className="flex gap-xs tablet:flex-col">
        {options.map((category) => (
          <li key={category.id} className="flex-none">
            <button
              type="button"
              aria-pressed={category.id === value}
              onClick={() => onChange(category.id)}
              className={`${chipClass} text-text-secondary tablet:w-full`}
            >
              {category.name}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** A grid card: a button (keyboard navigable) with the image or its initials placeholder, name and size count. */
function ProductCard({
  product,
  selected,
  onSelect,
}: {
  product: AvailabilityProduct;
  selected: boolean;
  onSelect: (product: AvailabilityProduct) => void;
}) {
  const count = product.sizes.length;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(product)}
      className={`flex h-full w-full flex-col gap-sm rounded-md border p-sm text-left transition-colors hover:border-border-strong ${
        selected ? 'border-accent-bright bg-accent-soft' : 'border-border bg-surface'
      }`}
    >
      <ProductThumb name={product.name} imageUrl={product.imageUrl} sizeClass="aspect-square w-full" zoom={false} />
      <span className="line-clamp-2 text-body-medium text-text">{product.name}</span>
      <span className="mt-auto flex flex-wrap items-center gap-sm">
        <span className="text-caption text-text-secondary">{count === 1 ? 'One size' : `${count} sizes`}</span>
        {!product.isActive && <InactiveBadge />}
      </span>
    </button>
  );
}

/** Names the disabled sizes as text, so the disabled state never rests on the tile's color alone. */
function DisabledCaption({
  product,
  disabledSizeIds,
  disabledLabel,
}: {
  product: AvailabilityProduct;
  disabledSizeIds: ReadonlySet<string>;
  disabledLabel: string;
}) {
  const labels = product.sizes.filter((s) => disabledSizeIds.has(s.sizeId)).map((s) => s.label);
  if (labels.length === 0) return null;
  return (
    <p className="text-caption text-text-secondary">
      {disabledLabel}: {labels.join(', ')}
    </p>
  );
}

/** The replenishment flow's extra field: quantity requested, an integer 1–9999 (the API's bounds). */
function QuantityStepper({
  value,
  valid,
  onChange,
  onStep,
}: {
  value: string;
  valid: boolean;
  onChange: (value: string) => void;
  onStep: (delta: number) => void;
}) {
  const stepClass = `${secondaryButtonClass} w-[44px] px-0`;
  const id = useId();
  return (
    <div className="flex flex-col gap-xs">
      <label htmlFor={id} className="text-label text-text-secondary">
        Quantity
      </label>
      <div className="flex items-center gap-sm">
        <button type="button" className={stepClass} aria-label="Decrease quantity" onClick={() => onStep(-1)}>
          <span className="icon" aria-hidden>
            remove
          </span>
        </button>
        <input
          id={id}
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!valid}
          aria-describedby={valid ? undefined : `${id}-error`}
          className={`${textInputClass} w-[96px] text-right tabular-nums`}
        />
        <button type="button" className={stepClass} aria-label="Increase quantity" onClick={() => onStep(1)}>
          <span className="icon" aria-hidden>
            add
          </span>
        </button>
      </div>
      {!valid && (
        <p id={`${id}-error`} className="text-caption text-alert">
          Enter a whole number from 1 to 9999.
        </p>
      )}
    </div>
  );
}

/** Loading: static skeleton cards in the grid's geometry (no shimmer — DESIGN §Motion). */
function GridSkeleton() {
  return (
    <div role="status" aria-label="Loading" className={gridClass}>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex flex-col gap-sm rounded-md border border-border p-sm">
          <div className="aspect-square rounded-sm bg-surface-raised" />
          <div className="h-[14px] w-3/4 rounded-sm bg-surface-raised" />
          <div className="h-[10px] w-1/3 rounded-sm bg-surface-raised" />
        </div>
      ))}
    </div>
  );
}
