import type { Request, Response } from 'express';
import {
  categoryListQuery,
  createCategoryBody,
  createProductBody,
  createProductSizeBody,
  emptyQuery,
  idParams,
  productListQuery,
  reorderCategoriesBody,
  sizeParams,
  updateCategoryBody,
  updateProductBody,
  updateProductSizeBody,
} from 'shared';
import { AppError } from '../../core/errors.js';
import { validate } from '../../core/http/validate.js';
import { IMAGE_FIELD } from './imageUpload.js';
import * as service from './service.js';

// RF-13
export async function listCategories(req: Request, res: Response): Promise<void> {
  res.json(await service.listCategories(validate(categoryListQuery, req.query)));
}

// RF-14 — 201 with the new category.
export async function createCategory(req: Request, res: Response): Promise<void> {
  validate(emptyQuery, req.query);
  res.status(201).json(await service.createCategory(validate(createCategoryBody, req.body)));
}

// RF-14 — 200 with the updated category.
export async function updateCategory(req: Request, res: Response): Promise<void> {
  const { id } = validate(idParams, req.params);
  validate(emptyQuery, req.query);
  res.json(await service.updateCategory(id, validate(updateCategoryBody, req.body)));
}

// RF-45 — 204: the client re-reads the list.
export async function reorderCategories(req: Request, res: Response): Promise<void> {
  validate(emptyQuery, req.query);
  await service.reorderCategories(validate(reorderCategoriesBody, req.body));
  res.status(204).end();
}

// RF-15
export async function listProducts(req: Request, res: Response): Promise<void> {
  res.json(await service.listProducts(validate(productListQuery, req.query)));
}

// RF-16 — 201 with the new product, sizes embedded (the `GET /products` item).
export async function createProduct(req: Request, res: Response): Promise<void> {
  validate(emptyQuery, req.query);
  res.status(201).json(await service.createProduct(validate(createProductBody, req.body)));
}

// RF-16 / RN-08 — 200 with the updated product.
export async function updateProduct(req: Request, res: Response): Promise<void> {
  const { id } = validate(idParams, req.params);
  validate(emptyQuery, req.query);
  res.json(await service.updateProduct(id, validate(updateProductBody, req.body)));
}

// RF-37 — 201 with the whole product, the new size embedded.
export async function addSize(req: Request, res: Response): Promise<void> {
  const { id } = validate(idParams, req.params);
  validate(emptyQuery, req.query);
  res.status(201).json(await service.addSize(id, validate(createProductSizeBody, req.body)));
}

// RF-37 / RN-08 — 200 with the whole product.
export async function updateSize(req: Request, res: Response): Promise<void> {
  const { id, sizeId } = validate(sizeParams, req.params);
  validate(emptyQuery, req.query);
  res.json(await service.updateSize(id, sizeId, validate(updateProductSizeBody, req.body)));
}

// RF-17 — 200 with the whole product, `imageUrl` pointing at the new image.
// `parseImage` ran first (multipart, ≤5 MB); any text part is an unknown field.
export async function uploadImage(req: Request, res: Response): Promise<void> {
  const { id } = validate(idParams, req.params);
  validate(emptyQuery, req.query);
  if (!req.file) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid request', [
      { path: IMAGE_FIELD, message: 'Select an image to upload' },
    ]);
  }
  validate(emptyQuery, { ...req.body });
  res.json(await service.uploadProductImage(id, req.file.buffer));
}
