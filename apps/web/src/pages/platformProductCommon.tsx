import type { ChangeEvent } from 'react';
import type { Category, Page, Product } from 'shared';
import { secondaryButtonClass } from '../components/buttons';
import { FormField } from '../components/FormField';
import { api } from '../lib/apiClient';

/**
 * Shared by the products tab and its create/edit modals (platform-catalog.md §Tab "Products").
 * Every products query shares this prefix — the platform table and the store-side picker/catalog —
 * so one invalidation after a write refreshes them all.
 */
export const PRODUCTS = ['products'] as const;
/** The same options source as the Categories tab, the store-side filter and the picker rail. */
export const CATEGORY_OPTIONS = ['categories', { pageSize: 100 }] as const;

export const fetchCategories = () => api.get<Page<Category>>('/categories?pageSize=100');

/** RF-17 / RNF-06 — mirrors the API's upload checks (`POST /products/:id/image`). */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png'];

/** The client-side check of a picked image, with the API's own messages; `undefined` = acceptable. */
export function imageProblem(file: File): string | undefined {
  if (!IMAGE_TYPES.includes(file.type)) return 'The image must be a JPEG or PNG file';
  if (file.size > IMAGE_MAX_BYTES) return 'The image cannot exceed 5 MB';
  return undefined;
}

/** `POST /products/:id/image` — multipart, one file in the field `image`; answers the whole product. */
export function uploadProductImage(productId: string, file: File) {
  const form = new FormData();
  form.append('image', file);
  return api.post<Product>(`/products/${productId}/image`, form);
}

/**
 * The optional image input of the product modals: JPEG/PNG only; `onPick` gets the file (null when
 * cleared) and its client-side problem, if any. `hint` is the caller's (file name, "Uploading…").
 */
export function ImageField({
  id,
  error,
  hint,
  onPick,
}: {
  id: string;
  error?: string;
  hint: string;
  onPick: (file: File | null, problem: string | undefined) => void;
}) {
  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    onPick(file, file ? imageProblem(file) : undefined);
  };
  // The native file control writes its button and status text in the browser's language (RNF-19: the
  // UI is English), so it stays in the DOM visually hidden and a second label acts as its button.
  return (
    <FormField id={id} label="Image (optional)" error={error} hint={hint}>
      <div className="flex">
        <input
          id={id}
          type="file"
          accept={IMAGE_TYPES.join(',')}
          onChange={pick}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="peer sr-only"
        />
        <label
          htmlFor={id}
          className={`${secondaryButtonClass} shrink-0 cursor-pointer peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent-bright`}
        >
          Choose image
        </label>
      </div>
    </FormField>
  );
}
