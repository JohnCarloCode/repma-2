import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type KeyboardEvent } from 'react';
import {
  createProductSizeBody,
  updateProductBody,
  updateProductSizeBody,
  type Product,
  type ProductSize,
  type UpdateProductBody,
  type UpdateProductSizeBody,
} from 'shared';
import { FormField } from '../components/FormField';
import { InactiveBadge } from '../components/InactiveBadge';
import { ConfirmModal, FormModal } from '../components/Modal';
import { textButtonClass } from '../components/buttons';
import { textAreaClass, textInputClass } from '../components/form';
import { RowAction } from '../components/list/DataTable';
import { ApiError, api } from '../lib/apiClient';
import { useToast } from '../lib/toast';
import { CATEGORY_OPTIONS, ImageField, PRODUCTS, fetchCategories, uploadProductImage } from './platformProductCommon';

type Field = 'name' | 'description' | 'categoryId';
type SizeField = 'label' | 'sku' | 'position';
type SizeErrors = Partial<Record<SizeField, string>>;

/** An upload that failed after the fields (if any) were saved — its errors belong to the Image field. */
class UploadFailed extends Error {
  readonly reason: unknown;
  constructor(reason: unknown) {
    super('Image upload failed');
    this.reason = reason;
  }
}

const POSITION_ERROR = 'Enter a whole number from 0 to 9999';

/** 400/409 `details` → messages per known path (first wins); `undefined` when none matched. */
function detailErrors<K extends string>(err: unknown, paths: readonly K[]): Partial<Record<K, string>> | undefined {
  if (!(err instanceof ApiError) || ![400, 409, 413].includes(err.status) || !Array.isArray(err.details)) return undefined;
  const found: Partial<Record<K, string>> = {};
  for (const d of err.details as { path: string; message: string }[]) {
    if ((paths as readonly string[]).includes(d.path)) found[d.path as K] ??= d.message;
  }
  return Object.keys(found).length > 0 ? found : undefined;
}

const isNotFound = (err: unknown) => err instanceof ApiError && err.status === 404;

/** Enter in a size row saves that row — never the surrounding product form. */
const enterSaves = (save: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    save();
  }
};

/**
 * platform-catalog.md §Edit modal + §Flows · Edit product. The product fields (`PATCH /products/:id`
 * with the changed fields only, then — when a new image was picked — `POST /products/:id/image`) and
 * an expandable Sizes section whose rows are their own mutations (saved per row, independent of
 * "Save changes"). The modal keeps the latest `Product` any write answered, so later diffs and the
 * sizes list follow the server; every write also invalidates the `products` family. A 404 (the
 * product or size is gone) closes the modal with a toast and re-reads the list.
 */
export function ProductEditModal({ product: initial, open, onClose }: { product: Product; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const categories = useQuery({ queryKey: CATEGORY_OPTIONS, queryFn: fetchCategories, enabled: open });

  const [product, setProduct] = useState(initial);
  const [values, setValues] = useState({
    name: initial.name,
    description: initial.description ?? '',
    categoryId: initial.categoryId,
  });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [image, setImage] = useState<File | null>(null);
  const [imageError, setImageError] = useState<string>();
  const [uploading, setUploading] = useState(false);

  const saved = (next: Product) => {
    setProduct(next);
    void queryClient.invalidateQueries({ queryKey: PRODUCTS });
  };

  const gone = (err: unknown) => {
    toast.error(err);
    void queryClient.invalidateQueries({ queryKey: PRODUCTS });
    onClose();
  };

  /** Validates every field; the body carries only what differs from the latest saved product. */
  const check = (v = values) => {
    const result = updateProductBody.safeParse(v);
    const found: Partial<Record<Field, string>> = {};
    for (const issue of result.error?.issues ?? []) found[issue.path[0] as Field] ??= issue.message;
    if (!result.data) return { found };
    const body: UpdateProductBody = {};
    if (result.data.name !== product.name) body.name = result.data.name;
    if (result.data.description !== product.description) body.description = result.data.description;
    if (result.data.categoryId !== product.categoryId) body.categoryId = result.data.categoryId;
    return { found, body };
  };

  const save = useMutation({
    mutationFn: async ({ body, file }: { body: UpdateProductBody; file: File | null }) => {
      if (Object.keys(body).length > 0) saved(await api.patch<Product>(`/products/${product.id}`, body));
      if (!file) return;
      setUploading(true);
      try {
        saved(await uploadProductImage(product.id, file));
      } catch (err) {
        throw new UploadFailed(err);
      }
    },
    onSuccess: () => {
      toast.success('Product updated');
      onClose();
    },
    onError: (failure) => {
      const err = failure instanceof UploadFailed ? failure.reason : failure;
      if (isNotFound(err)) return gone(err);
      if (failure instanceof UploadFailed) {
        const inline = detailErrors(err, ['image'] as const);
        if (inline) return setImageError(inline.image);
      } else {
        const inline = detailErrors(err, ['name', 'description', 'categoryId'] as const);
        if (inline) return setErrors(inline);
      }
      toast.error(err);
    },
    onSettled: () => setUploading(false),
  });

  const submit = () => {
    setSubmitted(true);
    const { found, body } = check();
    setErrors(found);
    if (!body || imageError) return;
    if (Object.keys(body).length === 0 && !image) return onClose();
    save.mutate({ body, file: image });
  };

  const control = (field: Field) => ({
    id: `edit-product-${field}`,
    value: values[field],
    onChange: (e: { target: { value: string } }) => setValues({ ...values, [field]: e.target.value }),
    onBlur: () => submitted && setErrors(check().found),
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': errors[field] ? `edit-product-${field}-error` : undefined,
  });

  // Until the options load, the current category is the only one (the select never shows blank).
  const categoryOptions = categories.data?.items ?? [{ id: product.categoryId, name: product.categoryName }];
  const imageHint = uploading
    ? 'Uploading…'
    : (image?.name ?? (product.imageUrl ? 'JPEG or PNG, up to 5 MB — replaces the current image' : 'JPEG or PNG, up to 5 MB'));

  return (
    <FormModal
      open={open}
      onClose={onClose}
      title="Edit product"
      submitLabel="Save changes"
      pendingLabel={uploading ? 'Uploading image…' : 'Saving…'}
      pending={save.isPending}
      onSubmit={submit}
    >
      <FormField id="edit-product-name" label="Name" error={errors.name}>
        <input type="text" maxLength={120} autoComplete="off" className={textInputClass} {...control('name')} />
      </FormField>
      <FormField id="edit-product-categoryId" label="Category" error={errors.categoryId}>
        <select className={textInputClass} {...control('categoryId')}>
          {categoryOptions.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </FormField>
      <FormField id="edit-product-description" label="Description (optional)" error={errors.description}>
        <textarea maxLength={2000} className={textAreaClass} {...control('description')} />
      </FormField>
      <ImageField
        id="edit-product-image"
        error={imageError}
        hint={imageHint}
        onPick={(file, problem) => {
          setImage(problem ? null : file);
          setImageError(problem);
        }}
      />
      <SizesSection product={product} onSaved={saved} onGone={gone} />
    </FormModal>
  );
}

/**
 * platform-catalog.md §Edit modal · Sizes: an expandable list of every size (inactive ones flagged)
 * — each row edits label / SKU / position and saves on its own (`PATCH …/sizes/:sizeId`), and
 * deactivates/reactivates through a confirm (RN-08); "Add size" opens one new row
 * (`POST …/sizes`, appended after the last size). No delete. Both routes answer the whole product.
 */
function SizesSection({
  product,
  onSaved,
  onGone,
}: {
  product: Product;
  onSaved: (product: Product) => void;
  onGone: (err: unknown) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [toggling, setToggling] = useState<{ size: ProductSize; open: boolean } | null>(null);

  return (
    <section className="flex flex-col gap-sm">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls="edit-product-sizes"
        onClick={() => setExpanded(!expanded)}
        className="flex min-h-[44px] items-center justify-between rounded-sm text-label text-text hover:text-accent-bright"
      >
        Sizes ({product.sizes.length})
        <span className="icon" aria-hidden>
          {expanded ? 'expand_less' : 'expand_more'}
        </span>
      </button>
      {expanded && (
        <div id="edit-product-sizes" className="flex flex-col gap-sm">
          <ol aria-label="Sizes" className="flex flex-col gap-sm">
            {product.sizes.map((size) => (
              // Keyed by the saved values: a saved row restarts from the server's answer; activation
              // isn't in the key, so a toggle keeps an unsaved draft.
              <SizeRow
                key={`${size.id}:${size.label}:${size.sku}:${size.position}`}
                productId={product.id}
                size={size}
                onSaved={onSaved}
                onGone={onGone}
                onToggle={() => setToggling({ size, open: true })}
              />
            ))}
          </ol>
          {adding ? (
            <NewSizeRow
              productId={product.id}
              onSaved={(next) => {
                onSaved(next);
                setAdding(false);
              }}
              onGone={onGone}
              onDiscard={() => setAdding(false)}
            />
          ) : (
            <div>
              <button type="button" className={textButtonClass} onClick={() => setAdding(true)}>
                Add size
              </button>
            </div>
          )}
        </div>
      )}
      {toggling && (
        <SizeActivationConfirm
          product={product}
          size={toggling.size}
          open={toggling.open}
          onClose={() => setToggling({ ...toggling, open: false })}
          onSaved={onSaved}
          onGone={onGone}
        />
      )}
    </section>
  );
}

/** A size-row text/number input with its inline error caption beneath. */
function RowInput({
  id,
  label,
  error,
  className = '',
  ...input
}: {
  id: string;
  label: string;
  error?: string;
  className?: string;
  type?: 'text' | 'number';
  value: string;
  maxLength?: number;
  placeholder?: string;
  onChange: (value: string) => void;
  onEnter: (e: KeyboardEvent) => void;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-xs ${className}`}>
      <input
        id={id}
        type={input.type ?? 'text'}
        aria-label={label}
        placeholder={input.placeholder}
        maxLength={input.maxLength}
        min={input.type === 'number' ? 0 : undefined}
        max={input.type === 'number' ? 9999 : undefined}
        autoComplete="off"
        value={input.value}
        onChange={(e) => input.onChange(e.target.value)}
        onKeyDown={input.onEnter}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`${textInputClass} ${label.endsWith('SKU') ? 'font-mono' : ''}`}
      />
      {error && (
        <span id={`${id}-error`} className="text-caption text-alert">
          {error}
        </span>
      )}
    </div>
  );
}

/** Size-write errors: 404 → `onGone`; 400/409 details on a row field → inline; else a toast. */
function useSizeErrorHandler(onGone: (err: unknown) => void, setErrors: (errors: SizeErrors) => void) {
  const toast = useToast();
  return (err: unknown) => {
    if (isNotFound(err)) return onGone(err);
    const inline = detailErrors(err, ['label', 'sku', 'position'] as const);
    if (inline) return setErrors(inline);
    toast.error(err);
  };
}

/** One existing size: label / SKU / position saved per row (changed fields only), plus its activation toggle. */
function SizeRow({
  productId,
  size,
  onSaved,
  onGone,
  onToggle,
}: {
  productId: string;
  size: ProductSize;
  onSaved: (product: Product) => void;
  onGone: (err: unknown) => void;
  onToggle: () => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState({ label: size.label, sku: size.sku, position: String(size.position) });
  const [errors, setErrors] = useState<SizeErrors>({});
  const onError = useSizeErrorHandler(onGone, setErrors);
  const dirty = draft.label !== size.label || draft.sku !== size.sku || draft.position !== String(size.position);

  const patch = useMutation({
    mutationFn: (body: UpdateProductSizeBody) => api.patch<Product>(`/products/${productId}/sizes/${size.id}`, body),
    onSuccess: (product) => {
      toast.success('Size updated');
      onSaved(product);
    },
    onError,
  });

  const save = () => {
    if (!dirty || patch.isPending) return;
    const found: SizeErrors = {};
    const position = draft.position.trim() === '' ? NaN : Number(draft.position);
    if (!Number.isInteger(position) || position < 0 || position > 9999) found.position = POSITION_ERROR;
    const result = updateProductSizeBody.safeParse({ label: draft.label, sku: draft.sku });
    for (const issue of result.error?.issues ?? []) found[issue.path[0] as SizeField] ??= issue.message;
    setErrors(found);
    if (!result.data || found.position) return;

    const body: UpdateProductSizeBody = {};
    if (result.data.label !== size.label) body.label = result.data.label;
    if (result.data.sku !== size.sku) body.sku = result.data.sku;
    if (position !== size.position) body.position = position;
    // Only whitespace changed: nothing to send — show the saved values again.
    if (Object.keys(body).length === 0) return setDraft({ label: size.label, sku: size.sku, position: String(size.position) });
    patch.mutate(body);
  };

  const input = (field: SizeField, name: string) => ({
    id: `edit-size-${size.id}-${field}`,
    label: `Size ${size.label} ${name}`,
    error: errors[field],
    value: draft[field],
    onChange: (value: string) => setDraft({ ...draft, [field]: value }),
    onEnter: enterSaves(save),
  });

  return (
    <li className="flex flex-wrap items-start gap-sm">
      <RowInput {...input('label', 'label')} placeholder="Size" maxLength={40} className="min-w-[96px] flex-1" />
      <RowInput {...input('sku', 'SKU')} placeholder="SKU" maxLength={64} className="min-w-[120px] flex-[2]" />
      <RowInput {...input('position', 'position')} type="number" className="w-[88px]" />
      <div className="flex min-h-[44px] items-center gap-sm">
        {!size.isActive && <InactiveBadge />}
        <button
          type="button"
          aria-label={`Save size ${size.label}`}
          className={`${textButtonClass} disabled:text-text-secondary disabled:no-underline`}
          disabled={!dirty || patch.isPending}
          onClick={save}
        >
          {patch.isPending ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          aria-label={`${size.isActive ? 'Deactivate' : 'Reactivate'} size ${size.label}`}
          className={textButtonClass}
          onClick={onToggle}
        >
          {size.isActive ? 'Deactivate' : 'Reactivate'}
        </button>
      </div>
    </li>
  );
}

/** "Add size": one new row (label + SKU) → `POST /products/:id/sizes`, position left to the API (after the last size). */
function NewSizeRow({
  productId,
  onSaved,
  onGone,
  onDiscard,
}: {
  productId: string;
  onSaved: (product: Product) => void;
  onGone: (err: unknown) => void;
  onDiscard: () => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState({ label: '', sku: '' });
  const [errors, setErrors] = useState<SizeErrors>({});
  const onError = useSizeErrorHandler(onGone, setErrors);

  const create = useMutation({
    mutationFn: (body: { label: string; sku: string }) => api.post<Product>(`/products/${productId}/sizes`, body),
    onSuccess: (product) => {
      toast.success('Size added');
      onSaved(product);
    },
    onError,
  });

  const save = () => {
    if (create.isPending) return;
    const result = createProductSizeBody.safeParse(draft);
    const found: SizeErrors = {};
    for (const issue of result.error?.issues ?? []) found[issue.path[0] as SizeField] ??= issue.message;
    setErrors(found);
    if (result.data) create.mutate({ label: result.data.label, sku: result.data.sku });
  };

  const input = (field: 'label' | 'sku', name: string) => ({
    id: `new-size-${field}`,
    label: `New size ${name}`,
    error: errors[field],
    value: draft[field],
    onChange: (value: string) => setDraft({ ...draft, [field]: value }),
    onEnter: enterSaves(save),
  });

  return (
    <div className="flex flex-wrap items-start gap-sm">
      <RowInput {...input('label', 'label')} placeholder="Size" maxLength={40} className="min-w-[96px] flex-1" />
      <RowInput {...input('sku', 'SKU')} placeholder="SKU" maxLength={64} className="min-w-[120px] flex-[2]" />
      <div className="flex min-h-[44px] items-center gap-sm">
        <button
          type="button"
          aria-label="Save new size"
          className={`${textButtonClass} disabled:text-text-secondary disabled:no-underline`}
          disabled={create.isPending}
          onClick={save}
        >
          {create.isPending ? 'Adding…' : 'Save'}
        </button>
        <RowAction icon="close" label="Discard new size" onClick={onDiscard} />
      </div>
    </div>
  );
}

/**
 * platform-catalog.md §Flows · Deactivate / reactivate size (RN-08): a confirm stating the effect →
 * `PATCH …/sizes/:sizeId { isActive }`. A failure is a toast (404 closes the edit modal).
 */
function SizeActivationConfirm({
  product,
  size,
  open,
  onClose,
  onSaved,
  onGone,
}: {
  product: Product;
  size: ProductSize;
  open: boolean;
  onClose: () => void;
  onSaved: (product: Product) => void;
  onGone: (err: unknown) => void;
}) {
  const toast = useToast();
  const deactivating = size.isActive;

  const toggle = useMutation({
    mutationFn: () => api.patch<Product>(`/products/${product.id}/sizes/${size.id}`, { isActive: !deactivating }),
    onSuccess: (next) => {
      toast.success(deactivating ? 'Size deactivated' : 'Size reactivated');
      onSaved(next);
    },
    onError: (err) => (isNotFound(err) ? onGone(err) : toast.error(err)),
    onSettled: onClose,
  });

  return (
    <ConfirmModal
      open={open}
      onClose={onClose}
      title={deactivating ? 'Deactivate size' : 'Reactivate size'}
      message={
        deactivating
          ? `Deactivate size “${size.label}” of “${product.name}”? It can no longer be added to assortments or lists; existing entries and history are unaffected.`
          : `Reactivate size “${size.label}” of “${product.name}”? It can be added to assortments and lists again.`
      }
      confirmLabel={deactivating ? 'Deactivate size' : 'Reactivate size'}
      pendingLabel={deactivating ? 'Deactivating…' : 'Reactivating…'}
      tone={deactivating ? 'danger' : 'primary'}
      pending={toggle.isPending}
      onConfirm={() => toggle.mutate()}
    />
  );
}
