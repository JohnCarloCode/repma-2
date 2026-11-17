import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { SIZE_PRESETS, createProductBody, type Page, type Product } from 'shared';
import { FormField } from '../components/FormField';
import { InactiveBadge } from '../components/InactiveBadge';
import { ConfirmModal, FormModal } from '../components/Modal';
import { ProductThumb } from '../components/availability/ProductThumb';
import { secondaryButtonClass, textButtonClass } from '../components/buttons';
import { textAreaClass, textInputClass } from '../components/form';
import { DataTable, RowAction, type Column } from '../components/list/DataTable';
import { FilterBand, SearchField, filterControlClass } from '../components/list/FilterBand';
import { Pagination } from '../components/list/Pagination';
import { EmptyState, ErrorState, LoadingState } from '../components/list/states';
import { useListParams } from '../components/list/useListParams';
import { ApiError, api } from '../lib/apiClient';
import { useToast } from '../lib/toast';
import { ProductEditModal } from './PlatformProductEditModal';
import { CATEGORY_OPTIONS, ImageField, PRODUCTS, fetchCategories, uploadProductImage } from './platformProductCommon';

/** A modal whose content outlives `open` so it can animate out. */
type Opened<T> = { value: T; open: boolean } | null;

let openings = 0;

/** `isActive` URL param: absent = All (the platform default — retired products stay listed). */
const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Inactive' },
] as const;

const PARTIAL_FAILURE = 'The product was created, but the image upload failed. Try again from Edit.';

/**
 * platform-catalog.md §Tab "Products": every product (retired ones included by default) with
 * search / category / status filters and pagination in the URL (`search`, `categoryId`,
 * `isActive`, `page`). Row actions: Edit (product fields, image, sizes) and Retire / Reactivate.
 * Ordering mode (RF-46) — one category, no search, status All: the whole category in one page,
 * with up/down moves that save its whole product order.
 */
export function ProductsTab({ onCreate }: { onCreate: () => void }) {
  const list = useListParams(['search', 'categoryId', 'isActive'] as const);
  const { page } = list;
  const { search, categoryId } = list.filters;
  const status = list.filters.isActive === 'true' || list.filters.isActive === 'false' ? list.filters.isActive : 'all';

  // Ordering mode: the table holds exactly the category's whole product set, as the PUT requires.
  const ordering = Boolean(categoryId) && !search && status === 'all';
  const orderKey = [...PRODUCTS, { categoryId, pageSize: 100 }];

  // Same key shape as the store-side /catalog: equal filters share one cache entry.
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ordering ? orderKey : [...PRODUCTS, { page, search, categoryId, isActive: status }],
    queryFn: () => {
      if (ordering) return api.get<Page<Product>>(`/products?${new URLSearchParams({ categoryId, pageSize: '100' })}`);
      const query = new URLSearchParams({ page: String(page) });
      if (search) query.set('search', search);
      if (categoryId) query.set('categoryId', categoryId);
      if (status !== 'all') query.set('isActive', status);
      return api.get<Page<Product>>(`/products?${query}`);
    },
  });
  const categories = useQuery({ queryKey: CATEGORY_OPTIONS, queryFn: fetchCategories });
  // `seq` remounts the edit modal on every opening, so it always starts from the row's current product.
  const [editing, setEditing] = useState<(Opened<Product> & { seq: number }) | null>(null);
  const [toggling, setToggling] = useState<Opened<Product>>(null);
  const reorder = useReorderProducts(categoryId, orderKey);

  const orderColumn: Column<Product> = {
    header: 'Order',
    cell: (product) => {
      const index = data!.items.indexOf(product);
      return (
        <span className="inline-flex">
          <RowAction
            icon="expand_less"
            label={`Move ${product.name} up`}
            disabled={index === 0 || reorder.isPending}
            onClick={() => reorder.move(data!.items, index, index - 1)}
          />
          <RowAction
            icon="expand_more"
            label={`Move ${product.name} down`}
            disabled={index === data!.items.length - 1 || reorder.isPending}
            onClick={() => reorder.move(data!.items, index, index + 1)}
          />
        </span>
      );
    },
  };

  const columns: Column<Product>[] = [
    ...(ordering ? [orderColumn] : []),
    {
      header: 'Product',
      cell: (product) => (
        <span className="flex items-center gap-[12px]">
          <ProductThumb name={product.name} imageUrl={product.imageUrl} />
          <span className="text-body-medium">{product.name}</span>
        </span>
      ),
    },
    {
      header: 'Sizes',
      cell: (product) => (
        <span className="font-mono text-caption text-text-secondary">
          {product.sizes.length} {product.sizes.length === 1 ? 'size' : 'sizes'}
        </span>
      ),
    },
    { header: 'Category', cell: (product) => product.categoryName },
    { header: 'Status', cell: (product) => (product.isActive ? 'Active' : <InactiveBadge />) },
    {
      header: '',
      align: 'right',
      cell: (product) => (
        <span className="inline-flex">
          <RowAction
            icon="edit"
            label={`Edit ${product.name}`}
            onClick={() => setEditing({ value: product, open: true, seq: ++openings })}
          />
          <RowAction
            icon={product.isActive ? 'block' : 'restart_alt'}
            label={`${product.isActive ? 'Retire' : 'Reactivate'} ${product.name}`}
            onClick={() => setToggling({ value: product, open: true })}
          />
        </span>
      ),
    },
  ];

  return (
    <>
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
          onChange={(e) => list.setFilter('isActive', e.target.value === 'all' ? '' : e.target.value)}
          className={`${filterControlClass} tablet:min-w-[160px]`}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </FilterBand>
      {!ordering && (
        <p className="text-caption text-text-secondary">
          To change the order of products, select a category (with no search and status All).
        </p>
      )}
      {isPending ? (
        <LoadingState columns={columns.length} />
      ) : isError ? (
        <ErrorState message={error.message} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        list.hasFilters ? (
          <EmptyState icon="search" title="No results" action={{ label: 'Clear filters', onClick: list.clearFilters }} />
        ) : (
          <EmptyState icon="inventory_2" title="No products yet" action={{ label: 'New product', onClick: onCreate }} />
        )
      ) : (
        <>
          <DataTable label="Products" columns={columns} rows={data.items} rowKey={(product) => product.id} />
          {!ordering && <Pagination data={data} onPageChange={list.setPage} />}
        </>
      )}
      {editing && (
        <ProductEditModal
          key={editing.seq}
          product={editing.value}
          open={editing.open}
          onClose={() => setEditing({ ...editing, open: false })}
        />
      )}
      {toggling && (
        <ProductActivationConfirm
          product={toggling.value}
          open={toggling.open}
          onClose={() => setToggling({ ...toggling, open: false })}
        />
      )}
    </>
  );
}

/**
 * RF-46 — as the Categories tab's RF-45 moves: the table reorders at once and the whole category
 * order is saved; a failure restores the previous order with an error toast (a 409 says the
 * products changed). Every products query is then re-read (`/catalog`, the picker).
 */
function useReorderProducts(categoryId: string, key: readonly unknown[]) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: (ordered: Product[]) =>
      api.put<void>(`/categories/${categoryId}/products/order`, { ids: ordered.map((p) => p.id) }),
    onMutate: async (ordered) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Page<Product>>(key);
      if (previous) queryClient.setQueryData<Page<Product>>(key, { ...previous, items: ordered });
      return { previous };
    },
    onError: (err, _ordered, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      toast.error(err);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: PRODUCTS }),
  });
  return {
    isPending: mutation.isPending,
    move: (items: Product[], from: number, to: number) => {
      const ordered = [...items];
      const [moved] = ordered.splice(from, 1);
      ordered.splice(to, 0, moved!);
      mutation.mutate(ordered);
    },
  };
}

/**
 * platform-catalog.md §Flows · Retire / reactivate product (RN-08, RF-16): a confirm stating the
 * effect → `PATCH /products/:id { isActive }`. Success or failure, every products query is re-read
 * (the platform table and the store-side picker/catalog); a failure is a toast.
 */
function ProductActivationConfirm({ product, open, onClose }: { product: Product; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const retiring = product.isActive;

  const toggle = useMutation({
    mutationFn: () => api.patch<Product>(`/products/${product.id}`, { isActive: !retiring }),
    onSuccess: () => toast.success(retiring ? 'Product retired' : 'Product reactivated'),
    onError: (err) => toast.error(err),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: PRODUCTS });
      onClose();
    },
  });

  return (
    <ConfirmModal
      open={open}
      onClose={onClose}
      title={retiring ? 'Retire product' : 'Reactivate product'}
      message={
        retiring
          ? `Retire the product “${product.name}”? It can no longer be added to assortments; existing entries and history are unaffected.`
          : `Reactivate the product “${product.name}”? It can be added to assortments again.`
      }
      confirmLabel={retiring ? 'Retire product' : 'Reactivate product'}
      pendingLabel={retiring ? 'Retiring…' : 'Reactivating…'}
      tone={retiring ? 'danger' : 'primary'}
      pending={toggle.isPending}
      onConfirm={() => toggle.mutate()}
    />
  );
}

type Field = 'name' | 'description' | 'categoryId' | 'sizes';
type SizeField = 'label' | 'sku';

/** One editable size row; `key` identifies it across adds/removals (errors follow their row). */
interface SizeRow {
  key: number;
  label: string;
  sku: string;
}

interface FormErrors {
  fields: Partial<Record<Field, string>>;
  rows: Record<number, Partial<Record<SizeField, string>>>;
}

const NO_ERRORS: FormErrors = { fields: {}, rows: {} };
const BLANK = { name: '', description: '', categoryId: '' };

let rowKeys = 0;
const newRow = (label = ''): SizeRow => ({ key: ++rowKeys, label, sku: '' });

/**
 * Turns issue/detail paths (`name`, `sizes`, `sizes.N.sku` — Zod's arrays or the API's dotted
 * strings) into field and row errors; the first message per target wins. Unknown paths are ignored.
 */
function toErrors(issues: { path: readonly PropertyKey[] | string; message: string }[], rows: SizeRow[]) {
  const errors: FormErrors = { fields: {}, rows: {} };
  let found = false;
  for (const issue of issues) {
    const path = typeof issue.path === 'string' ? issue.path.split('.') : issue.path.map(String);
    const [head, index, field] = path;
    const row = head === 'sizes' && index !== undefined ? rows[Number(index)] : undefined;
    if (row && (field === 'label' || field === 'sku')) {
      (errors.rows[row.key] ??= {})[field] ??= issue.message;
      found = true;
    } else if (path.length === 1 && (head === 'name' || head === 'description' || head === 'categoryId' || head === 'sizes')) {
      errors.fields[head] ??= issue.message;
      found = true;
    }
  }
  return { errors, found };
}

/**
 * platform-catalog.md §Flows · Create product (create-then-upload): product fields, a sizes editor
 * (preset prefill, free rows) and an optional image. Validated with the shared `createProductBody`
 * (≥1 size, labels unique); positions follow the row order. `POST /products`, then — when an image
 * was chosen — `POST /products/:id/image`. An upload failure keeps the product (never re-posted):
 * the modal closes with the partial-failure toast. 409 SKU details land on their rows, 400 details
 * on their fields; anything else is a toast with the modal open.
 */
export function ProductCreateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const categories = useQuery({ queryKey: CATEGORY_OPTIONS, queryFn: fetchCategories, enabled: open });

  const [values, setValues] = useState(BLANK);
  const [rows, setRows] = useState<SizeRow[]>([]);
  const [image, setImage] = useState<File | null>(null);
  const [imageError, setImageError] = useState<string>();
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS);
  // Validate on submit, then on blur (components.md §Forms).
  const [submitted, setSubmitted] = useState(false);
  const [uploading, setUploading] = useState(false);
  // A preset waiting for the overwrite confirm (rows already have content).
  const [pendingPreset, setPendingPreset] = useState<{ name: string; labels: readonly string[] } | null>(null);

  const check = (v = values, r = rows) => {
    const result = createProductBody.safeParse({
      ...v,
      sizes: r.map(({ label, sku }, position) => ({ label, sku, position })),
    });
    const { errors: found } = toErrors(result.error?.issues ?? [], r);
    if (found.fields.categoryId && v.categoryId === '') found.fields.categoryId = 'Select a category';
    return { body: result.data, found };
  };

  const create = useMutation({
    mutationFn: async ({ body, file }: { body: NonNullable<ReturnType<typeof check>['body']>; file: File | null }) => {
      const created = await api.post<Product>('/products', body);
      if (!file) return { uploaded: true };
      setUploading(true);
      try {
        await uploadProductImage(created.id, file);
        return { uploaded: true };
      } catch {
        return { uploaded: false };
      }
    },
    onSuccess: ({ uploaded }) => {
      if (uploaded) toast.success('Product created');
      else toast.error(PARTIAL_FAILURE);
      void queryClient.invalidateQueries({ queryKey: PRODUCTS });
      close();
    },
    onError: (err) => {
      if (err instanceof ApiError && (err.status === 400 || err.status === 409) && Array.isArray(err.details)) {
        const mapped = toErrors(err.details as { path: string; message: string }[], rows);
        if (mapped.found) return setErrors(mapped.errors);
      }
      toast.error(err);
    },
    onSettled: () => setUploading(false),
  });

  const close = () => {
    onClose();
    setValues(BLANK);
    setRows([]);
    setImage(null);
    setImageError(undefined);
    setErrors(NO_ERRORS);
    setSubmitted(false);
    setPendingPreset(null);
  };

  const submit = () => {
    setSubmitted(true);
    const { body, found } = check();
    setErrors(found);
    if (body && !imageError) create.mutate({ body, file: image });
  };

  const revalidate = () => submitted && setErrors(check().found);

  // Adding/removing rows doesn't re-validate (a fresh row isn't an error yet); row errors follow
  // their row by key, and a sizes-level error goes once a row exists.
  const updateRows = (next: SizeRow[]) => {
    setRows(next);
    if (next.length > 0 && errors.fields.sizes) setErrors({ ...errors, fields: { ...errors.fields, sizes: undefined } });
  };

  const applyPreset = (labels: readonly string[]) => {
    setRows(labels.map((label) => newRow(label)));
    setErrors({ fields: { ...errors.fields, sizes: undefined }, rows: {} });
  };

  const choosePreset = (preset: { name: string; labels: readonly string[] }) => {
    if (rows.some((row) => row.label.trim() !== '' || row.sku.trim() !== '')) setPendingPreset(preset);
    else applyPreset(preset.labels);
  };

  const control = (field: 'name' | 'description' | 'categoryId') => ({
    id: `new-product-${field}`,
    value: values[field],
    onChange: (e: { target: { value: string } }) => setValues({ ...values, [field]: e.target.value }),
    onBlur: revalidate,
    'aria-invalid': errors.fields[field] ? true : undefined,
    'aria-describedby': errors.fields[field] ? `new-product-${field}-error` : undefined,
  });

  return (
    <FormModal
      open={open}
      onClose={close}
      title="New product"
      submitLabel="Create product"
      pendingLabel={uploading ? 'Uploading image…' : 'Creating…'}
      pending={create.isPending}
      onSubmit={submit}
    >
      <FormField id="new-product-name" label="Name" error={errors.fields.name}>
        <input type="text" maxLength={120} autoComplete="off" className={textInputClass} {...control('name')} />
      </FormField>
      <FormField id="new-product-categoryId" label="Category" error={errors.fields.categoryId}>
        <select className={textInputClass} {...control('categoryId')}>
          <option value="">Select a category</option>
          {categories.data?.items.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </FormField>
      <FormField id="new-product-description" label="Description (optional)" error={errors.fields.description}>
        <textarea maxLength={2000} className={textAreaClass} {...control('description')} />
      </FormField>
      <ImageField
        id="new-product-image"
        error={imageError}
        hint={uploading ? 'Uploading…' : (image?.name ?? 'JPEG or PNG, up to 5 MB')}
        onPick={(file, problem) => {
          setImage(problem ? null : file);
          setImageError(problem);
        }}
      />
      <SizesEditor
        rows={rows}
        errors={errors}
        onPreset={choosePreset}
        onChange={(key, field, value) => setRows(rows.map((row) => (row.key === key ? { ...row, [field]: value } : row)))}
        onBlur={revalidate}
        onAdd={() => updateRows([...rows, newRow()])}
        onRemove={(key) => updateRows(rows.filter((row) => row.key !== key))}
      />
      <ConfirmModal
        open={pendingPreset !== null}
        onClose={() => setPendingPreset(null)}
        title="Replace sizes?"
        message={`Replace the current sizes with the ${pendingPreset?.name ?? ''} preset? The labels and SKUs entered so far will be lost.`}
        confirmLabel="Replace sizes"
        pendingLabel="Replacing…"
        onConfirm={() => {
          if (pendingPreset) applyPreset(pendingPreset.labels);
          setPendingPreset(null);
        }}
      />
    </FormModal>
  );
}

/**
 * The create modal's sizes editor (platform-catalog.md §Create modal): preset buttons that prefill
 * rows from the shared `SIZE_PRESETS` (prefill only — labels stay free), then one row per size
 * (label + SKU, order = position) that can be added and removed until creation.
 */
function SizesEditor({
  rows,
  errors,
  onPreset,
  onChange,
  onBlur,
  onAdd,
  onRemove,
}: {
  rows: SizeRow[];
  errors: FormErrors;
  onPreset: (preset: { name: string; labels: readonly string[] }) => void;
  onChange: (key: number, field: SizeField, value: string) => void;
  onBlur: () => void;
  onAdd: () => void;
  onRemove: (key: number) => void;
}) {
  const sizesError = errors.fields.sizes;
  return (
    <fieldset className="flex flex-col gap-sm" aria-describedby={sizesError ? 'new-product-sizes-error' : undefined}>
      <legend className="text-label text-text">Sizes</legend>
      <div role="group" aria-label="Size presets" className="flex flex-wrap items-center gap-sm pt-xs">
        {Object.values(SIZE_PRESETS).map((preset) => (
          <button key={preset.name} type="button" className={secondaryButtonClass} onClick={() => onPreset(preset)}>
            {preset.name}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <span className="text-caption text-text-secondary">Pick a preset or add sizes one by one.</span>
      ) : (
        <ol className="flex flex-col gap-sm">
          {rows.map((row, index) => {
            const rowErrors = errors.rows[row.key] ?? {};
            const input = (field: SizeField, name: string) => {
              const id = `new-product-size-${row.key}-${field}`;
              return (
                <div className="flex min-w-0 flex-1 flex-col gap-xs">
                  <input
                    id={id}
                    type="text"
                    aria-label={`Size ${index + 1} ${name}`}
                    placeholder={name === 'label' ? 'Size' : 'SKU'}
                    maxLength={field === 'label' ? 40 : 64}
                    autoComplete="off"
                    value={row[field]}
                    onChange={(e) => onChange(row.key, field, e.target.value)}
                    onBlur={onBlur}
                    aria-invalid={rowErrors[field] ? true : undefined}
                    aria-describedby={rowErrors[field] ? `${id}-error` : undefined}
                    className={`${textInputClass} ${field === 'sku' ? 'font-mono' : ''}`}
                  />
                  {rowErrors[field] && (
                    <span id={`${id}-error`} className="text-caption text-alert">
                      {rowErrors[field]}
                    </span>
                  )}
                </div>
              );
            };
            return (
              <li key={row.key} className="flex items-start gap-sm">
                {input('label', 'label')}
                {input('sku', 'SKU')}
                <RowAction icon="close" label={`Remove size ${index + 1}`} onClick={() => onRemove(row.key)} />
              </li>
            );
          })}
        </ol>
      )}
      {sizesError && (
        <span id="new-product-sizes-error" className="text-caption text-alert">
          {sizesError}
        </span>
      )}
      <div>
        <button type="button" className={textButtonClass} onClick={onAdd}>
          Add size
        </button>
      </div>
    </fieldset>
  );
}
