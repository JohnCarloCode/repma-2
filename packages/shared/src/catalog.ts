import { z } from 'zod';
import { paginationQuery } from './pagination.js';

// RF-13 — `GET /categories` query: pagination only, in the admin's order
// (`position`, RF-45; then name). Its
// consumers (the `/availability` category filter, the ProductPicker rail)
// read the whole list in one page (`pageSize=100`).
export const categoryListQuery = paginationQuery;

// One category as every categories endpoint returns it (list items and the
// write responses alike): the `/availability` filter and the picker rail use
// `id`/`name`; the platform catalog's Categories tab renders all four.
export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
}

// A category name: trimmed, required, at most 120 characters (as a store
// name). The slug is derived from it by the API (RN-10) and is never part of
// a request body.
const categoryName = z.string().trim().min(1, 'Name is required').max(120);

// An optional description: trimmed, at most 500 characters; blank or null
// clears it (stored as NULL).
const categoryDescription = z
  .string()
  .trim()
  .max(500)
  .nullable()
  .transform((value) => value || null);

// RF-14 — `POST /categories` body: name + optional description. The slug is
// generated; strict validation makes any other key a 400.
export const createCategoryBody = z.object({
  name: categoryName,
  description: categoryDescription.optional(),
});

export type CreateCategoryBody = z.output<typeof createCategoryBody>;

// RF-14 — `PATCH /categories/:id` body: rename and/or edit the description.
// The slug is read-only and stable (as a store's — architecture.md §7). An
// empty body is a 400. There is no delete (RF-14).
export const updateCategoryBody = z
  .object({
    name: categoryName.optional(),
    description: categoryDescription.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'At least one field is required');

export type UpdateCategoryBody = z.output<typeof updateCategoryBody>;

// RF-45 — `PUT /categories/order` body: every category id, once each, in the
// new display order. The API answers 409 when the set is not exactly the
// stored categories (one was added meanwhile).
export const reorderCategoriesBody = z.object({
  ids: z
    .array(z.uuid())
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, 'Each category must appear once'),
});

export type ReorderCategoriesBody = z.output<typeof reorderCategoriesBody>;

// RF-38 / AD-21 — size presets for UI prefill (the sizes editor in the
// platform catalog's product modal); key order is button order
// (`Object.values`). Prefill only: the Platform Admin edits labels freely per
// product and nothing validates against these lists. The seed builds its size
// runs from them too.
export const ONE_SIZE_LABEL = 'One size';

export interface SizePreset {
  name: string;
  labels: readonly string[];
}

export const SIZE_PRESETS = {
  clothing: { name: 'Clothing', labels: ['XS', 'S', 'M', 'L', 'XL', '2XL'] },
  footwear: { name: 'Footwear', labels: ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45'] },
  oneSize: { name: ONE_SIZE_LABEL, labels: [ONE_SIZE_LABEL] },
} as const satisfies Record<string, SizePreset>;

// RF-15 — `GET /products` query: pagination plus optional filters,
// intersected. `search` matches the product name and the SKU of any of its
// sizes (blank after trimming = no filter); `isActive` is `true`/`false` on
// the product's own flag (absent = both). No sort param: ordered by name.
export const productListQuery = paginationQuery.extend({
  categoryId: z.uuid().optional(),
  search: z.string().trim().max(100).optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export type ProductListQuery = z.output<typeof productListQuery>;

// One catalog size (database.md §4.5): the sellable unit, SKU included.
// Inactive sizes are embedded and flagged; consumers that add to the
// assortment skip them (RN-08).
export interface ProductSize {
  id: string;
  label: string;
  sku: string;
  position: number;
  isActive: boolean;
}

// One page item of `GET /products` (RF-15): the product with every size
// embedded in `position` order — what the picker's assortment flow, the
// `/catalog` table + slide-over and the platform catalog render without an
// extra fetch.
export interface Product {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  categoryId: string;
  categoryName: string;
  isActive: boolean;
  sizes: ProductSize[];
}

// RF-16 / RN-11 — product and size write fields. A product name as a
// category's; a product description longer (up to 2000 characters, as a
// list's notes), blank or null stored as NULL.
const productName = z.string().trim().min(1, 'Name is required').max(120);
const productDescription = z
  .string()
  .trim()
  .max(2000)
  .nullable()
  .transform((value) => value || null);

// A size's label ("42", "M", "One size") and its business SKU (unique across
// every size — RN-11, checked by the API, a 409); `position` orders the run.
const sizeLabel = z.string().trim().min(1, 'Label is required').max(40);
const sizeSku = z.string().trim().min(1, 'SKU is required').max(64);
const sizePosition = z.number().int().min(0).max(9999);

// RF-37 — one new size: label + SKU, optional position. Strict, so nested
// unknown keys (`isActive`, `id`…) are 400s too — a new size starts active.
export const createProductSizeBody = z.strictObject({
  label: sizeLabel,
  sku: sizeSku,
  position: sizePosition.optional(),
});

export type CreateProductSizeBody = z.output<typeof createProductSizeBody>;

// RF-16 — `POST /products` body: no image (uploaded after creation, RF-17)
// and at least one size (RN-11 — "One size" comes from the preset, never
// from the API). Labels are unique within a product (database.md §4.5): a
// repeated one is a 400 on the repeating row's `sizes.N.label`. A SKU taken
// (by another product or repeated in this body) is the API's 409.
export const createProductBody = z
  .object({
    name: productName,
    description: productDescription.optional(),
    categoryId: z.uuid(),
    sizes: z.array(createProductSizeBody).min(1, 'Add at least one size').max(50),
  })
  .superRefine((body, ctx) => {
    const seen = new Set<string>();
    body.sizes.forEach(({ label }, index) => {
      if (seen.has(label)) {
        ctx.addIssue({ code: 'custom', path: ['sizes', index, 'label'], message: 'This label is already used' });
      }
      seen.add(label);
    });
  });

export type CreateProductBody = z.output<typeof createProductBody>;

// RF-16 / RN-08 — `PATCH /products/:id` body: any of name, description,
// category, and `isActive` (soft retire / reactivate). Sizes are edited
// through their own routes (RF-37); the image through its upload (RF-17).
// An empty body is a 400.
export const updateProductBody = z
  .object({
    name: productName.optional(),
    description: productDescription.optional(),
    categoryId: z.uuid().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'At least one field is required');

export type UpdateProductBody = z.output<typeof updateProductBody>;

// RF-37 — `PATCH /products/:id/sizes/:sizeId` body: any of label, SKU (both
// editable — nothing references a SKU by value; still globally unique, the
// API's 409), position and `isActive` (soft deactivate / reactivate, RN-08).
// There is no delete. An empty body is a 400.
export const updateProductSizeBody = z
  .object({
    label: sizeLabel.optional(),
    sku: sizeSku.optional(),
    position: sizePosition.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'At least one field is required');

export type UpdateProductSizeBody = z.output<typeof updateProductSizeBody>;
