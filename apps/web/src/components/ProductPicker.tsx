import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import type { AvailabilityProduct, AvailabilitySize, Category, Page } from 'shared';
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

interface ProductPickerProps {
  open: boolean;
  /** "Close" (or Escape / a scrim click) ends the session. Ignored while a confirm is in flight. */
  onClose: () => void;
  /** The flow title, e.g. "Add product". */
  title: string;
  /** The primary CTA, e.g. "Add to list". */
  confirmLabel: string;
  /** The CTA while `onConfirm` is in flight, e.g. "Adding…". */
  pendingLabel: string;
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

const PAGE_SIZE = 24;

/**
 * product-picker.md — the visual product & size selector, replenishment flow: the store's
 * assortment (`GET /availability`, AD-22) browsed by category and search, inactive products and
 * sizes included and selectable (RN-12/RN-08), availability state never shown nor filtered on
 * (DP-06). Stays open after confirm (adding several in a row is the common case).
 */
export function ProductPicker({ open, onClose, ...props }: ProductPickerProps) {
  const [pending, setPending] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={props.title}
      pending={pending}
      sheetOnMobile
      // Stable height: fixed at its maximum (viewport-capped) from tablet up, full-screen below.
      className="flex max-w-[960px] flex-col tablet:h-[min(800px,calc(100dvh-32px))]"
    >
      {/* Mounted only while open (the Dialog unmounts its panel), so every session starts clean. */}
      <PickerBody {...props} onClose={onClose} pending={pending} setPending={setPending} />
    </Modal>
  );
}

function PickerBody({
  confirmLabel,
  pendingLabel,
  disabledSizeIds,
  disabledLabel,
  onConfirm,
  onClose,
  pending,
  setPending,
}: Omit<ProductPickerProps, 'open' | 'title'> & { pending: boolean; setPending: (pending: boolean) => void }) {
  const scope = useStoreScope();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [page, setPage] = useState(1);
  const [product, setProduct] = useState<AvailabilityProduct | null>(null);
  const [sizeId, setSizeId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState('1');

  const products = useQuery({
    queryKey: scope.key('availability', 'picker', { page, search, categoryId }),
    queryFn: () => {
      const query = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (search) query.set('search', search);
      if (categoryId) query.set('categoryId', categoryId);
      return api.get<Page<AvailabilityProduct>>(`/availability?${query}`, scope.request);
    },
  });
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

  const selectProduct = (next: AvailabilityProduct) => {
    if (next.id === product?.id) return;
    setProduct(next);
    setSizeId(null);
  };

  const confirm = async () => {
    if (!product || !size || !quantityValid || pending) return;
    setPending(true);
    try {
      await onConfirm({ sizeId: size.sizeId, quantity: parsedQuantity, product, size });
      setSizeId(null);
      setQuantity('1');
    } catch {
      // The consumer owns the error (toast); the selection stays for a retry.
    } finally {
      setPending(false);
    }
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
              <EmptyState icon="inventory_2" title="No items in the assortment yet." />
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

      {product && (
        <section
          aria-label="Selection"
          className="flex max-h-[45%] flex-none flex-col gap-[12px] overflow-y-auto border-t border-border pt-base"
        >
          <div className="flex items-center gap-[12px]">
            <ProductThumb name={product.name} imageUrl={product.imageUrl} sizeClass="size-[44px]" />
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
            onSelect={(s) => setSizeId(s.sizeId)}
            selectedSizeId={size?.sizeId ?? null}
            disabledSizeIds={disabledSizeIds}
            disabledLabel={disabledLabel}
          />
          <DisabledCaption product={product} disabledSizeIds={disabledSizeIds} disabledLabel={disabledLabel} />
          <QuantityStepper
            value={quantity}
            valid={quantityValid}
            onChange={setQuantity}
            onStep={stepQuantity}
          />
        </section>
      )}

      <div className="flex flex-none flex-wrap justify-end gap-sm">
        <button type="button" className={secondaryButtonClass} disabled={pending} onClick={onClose}>
          Close
        </button>
        <button
          type="button"
          className={primaryButtonClass}
          disabled={pending || !size || !quantityValid}
          onClick={() => void confirm()}
        >
          {pending ? pendingLabel : confirmLabel}
        </button>
      </div>
    </div>
  );
}

const gridClass = 'grid grid-cols-2 gap-[12px] desktop:grid-cols-4';

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
      <ProductThumb name={product.name} imageUrl={product.imageUrl} sizeClass="h-[96px] w-full" />
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
          <div className="h-[96px] rounded-sm bg-surface-raised" />
          <div className="h-[14px] w-3/4 rounded-sm bg-surface-raised" />
          <div className="h-[10px] w-1/3 rounded-sm bg-surface-raised" />
        </div>
      ))}
    </div>
  );
}
