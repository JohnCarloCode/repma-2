import { randomUUID } from 'node:crypto';
import type {
  Category,
  CreateCategoryBody,
  CreateProductBody,
  CreateProductSizeBody,
  Page,
  Pagination,
  Product,
  ProductListQuery,
  UpdateCategoryBody,
  UpdateProductBody,
  UpdateProductSizeBody,
} from 'shared';
import { AppError } from '../../core/errors.js';
import { toPage } from '../../core/http/pagination.js';
import { slugify } from '../../core/slug.js';
import { productImagesBaseUrl, putProductImage, removeProductImage } from '../../lib/supabase.js';
import { detectImageType, IMAGE_FIELD } from './imageUpload.js';
import {
  insertCategory,
  insertProduct,
  insertSize,
  type SizeConflict,
  listCategories as listCategoryRows,
  listProducts as listProductRows,
  productExists,
  setProductImage,
  updateCategory as updateCategoryRow,
  updateProduct as updateProductRow,
  updateSize as updateSizeRow,
} from './repository.js';

// RF-13
export async function listCategories(query: Pagination): Promise<Page<Category>> {
  const { items, total } = await listCategoryRows(query);
  return toPage(items, total, query);
}

// RF-14 — the slug is generated from the name (RN-10), as for stores: a name
// with nothing to build one from is a 400 on `name`; a slug another category
// already holds is a 409 (platform-catalog.md shows it inline on Name).
export async function createCategory(body: CreateCategoryBody): Promise<Category> {
  const slug = slugify(body.name);
  if (!slug) {
    const message = 'Name must contain letters or numbers';
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', [{ path: 'name', message }]);
  }
  const result = await insertCategory(body.name, slug, body.description ?? null);
  if (result === 'duplicate') throw new AppError(409, 'CONFLICT', 'A category with an equivalent name already exists');
  return result;
}

// RF-14 — the slug is stable (never regenerated on rename), so there is no 409.
export async function updateCategory(id: string, body: UpdateCategoryBody): Promise<Category> {
  const category = await updateCategoryRow(id, body);
  if (!category) throw new AppError(404, 'NOT_FOUND', 'Category not found');
  return category;
}

// RF-15
export async function listProducts(query: ProductListQuery): Promise<Page<Product>> {
  const { items, total } = await listProductRows(query);
  return toPage(items, total, query);
}

const unknownCategory = () =>
  new AppError(400, 'VALIDATION_ERROR', 'Invalid request', [{ path: 'categoryId', message: 'Category not found' }]);

// RF-16 / RN-11 — create a product with its sizes (≥1, enforced by the shared
// schema). An unknown category is a 400 on `categoryId`; a SKU already held
// by another size, or repeated in the body, is a 409 naming each offending
// row (`sizes.N.sku`) so the sizes editor can mark it; nothing is written.
export async function createProduct(body: CreateProductBody): Promise<Product> {
  const result = await insertProduct(body);
  if (result === 'category_not_found') throw unknownCategory();
  if ('conflicts' in result) {
    const details = result.conflicts.map(({ index, sku, reason }) => ({
      path: `sizes.${index}.sku`,
      message: reason === 'taken' ? `SKU ${sku} is already in use` : `SKU ${sku} is repeated in this product`,
    }));
    throw new AppError(409, 'CONFLICT', details[0]!.message, details);
  }
  return result;
}

// RF-16 / RN-08 — edit fields and/or retire (`isActive: false`) / reactivate.
export async function updateProduct(id: string, body: UpdateProductBody): Promise<Product> {
  const result = await updateProductRow(id, body);
  if (result === 'not_found') throw new AppError(404, 'NOT_FOUND', 'Product not found');
  if (result === 'category_not_found') throw unknownCategory();
  return result;
}

// RF-37 — a label the product already has, or a SKU any size holds, is a 409
// on that field (the form marks it inline; the message is what it shows).
function sizeConflictError({ field }: SizeConflict, sku: string | undefined): AppError {
  const message = field === 'label' ? 'This label is already used' : `SKU ${sku} is already in use`;
  return new AppError(409, 'CONFLICT', message, [{ path: field, message }]);
}

// RF-37 — add a size to a product; answers the whole product so the client
// replaces it in one go.
export async function addSize(productId: string, body: CreateProductSizeBody): Promise<Product> {
  const result = await insertSize(productId, body);
  if (result === 'not_found') throw new AppError(404, 'NOT_FOUND', 'Product not found');
  if ('field' in result) throw sizeConflictError(result, body.sku);
  return result;
}

// RF-37 / RN-08 — edit a size (label, SKU, position) and/or deactivate /
// reactivate it; a size of another product is not found. No delete.
export async function updateSize(productId: string, sizeId: string, body: UpdateProductSizeBody): Promise<Product> {
  const result = await updateSizeRow(productId, sizeId, body);
  if (result === 'not_found') throw new AppError(404, 'NOT_FOUND', 'Size not found');
  if ('field' in result) throw sizeConflictError(result, body.sku);
  return result;
}

// RF-17 — store a product's image (already parsed, ≤5 MB) in the public bucket
// and persist its URL. The type comes from the content (JPEG/PNG). Object key
// `<productId>/<uuid>.<ext>`: a new key per upload, so a replacement is a new
// URL (no stale browser/CDN cache, so objects are cached for a year)
// and the folder groups a product's objects. After the URL is saved, the
// replaced object is deleted if it is this product's own upload; best effort
// (an orphan is harmless, a failed delete never fails the upload). An object
// whose product vanished mid-upload is removed again.
export async function uploadProductImage(id: string, content: Buffer): Promise<Product> {
  const type = detectImageType(content);
  if (!type) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', [
      { path: IMAGE_FIELD, message: 'The image must be a JPEG or PNG file' },
    ]);
  }
  if (!(await productExists(id))) throw new AppError(404, 'NOT_FOUND', 'Product not found');

  const key = `${id}/${randomUUID()}.${type.extension}`;
  const result = await setProductImage(id, await putProductImage(key, content, type.contentType));
  if (!result) {
    await removeProductImage(key);
    throw new AppError(404, 'NOT_FOUND', 'Product not found');
  }
  if (result.previous?.startsWith(`${productImagesBaseUrl}${id}/`)) {
    await removeProductImage(result.previous.slice(productImagesBaseUrl.length));
  }
  return result.product;
}
