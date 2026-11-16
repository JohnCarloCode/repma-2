import { describe, expect, it } from 'vitest';
import {
  createCategoryBody,
  createProductBody,
  ONE_SIZE_LABEL,
  SIZE_PRESETS,
  updateCategoryBody,
  updateProductBody,
  updateProductSizeBody,
} from './catalog.js';

describe('SIZE_PRESETS (RF-38, AD-21)', () => {
  it('lists Clothing, Footwear and One size, in button order, with their labels in size order', () => {
    expect(Object.values(SIZE_PRESETS)).toEqual([
      { name: 'Clothing', labels: ['XS', 'S', 'M', 'L', 'XL', '2XL'] },
      { name: 'Footwear', labels: ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45'] },
      { name: 'One size', labels: ['One size'] },
    ]);
  });

  it('the One size preset is the single ONE_SIZE_LABEL entry', () => {
    expect(ONE_SIZE_LABEL).toBe('One size');
    expect(SIZE_PRESETS.oneSize).toEqual({ name: ONE_SIZE_LABEL, labels: [ONE_SIZE_LABEL] });
  });

  it('labels are unique within each preset (a product cannot repeat a label — database.md §4.5)', () => {
    for (const { labels } of Object.values(SIZE_PRESETS)) expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('createCategoryBody (RF-14)', () => {
  it('trims the name; description is optional, trimmed, blank → null', () => {
    expect(createCategoryBody.parse({ name: '  Socks ' })).toEqual({ name: 'Socks' });
    expect(createCategoryBody.parse({ name: 'Socks', description: '  Warm  ' })).toEqual({
      name: 'Socks',
      description: 'Warm',
    });
    expect(createCategoryBody.parse({ name: 'Socks', description: '   ' })).toEqual({ name: 'Socks', description: null });
    expect(createCategoryBody.parse({ name: 'Socks', description: null })).toEqual({ name: 'Socks', description: null });
  });

  it('rejects a blank/over-long name, an over-long description and unknown keys (slug is generated)', () => {
    expect(createCategoryBody.safeParse({ name: '  ' }).error?.issues[0]?.message).toBe('Name is required');
    expect(createCategoryBody.safeParse({ name: 'x'.repeat(121) }).success).toBe(false);
    expect(createCategoryBody.safeParse({ name: 'x', description: 'x'.repeat(501) }).success).toBe(false);
    expect(createCategoryBody.strict().safeParse({ name: 'x', slug: 'x' }).success).toBe(false);
  });
});

describe('updateCategoryBody (RF-14)', () => {
  it('accepts name and/or description; null or blank clears the description', () => {
    expect(updateCategoryBody.parse({ name: ' Bags ' })).toEqual({ name: 'Bags' });
    expect(updateCategoryBody.parse({ description: '' })).toEqual({ description: null });
    expect(updateCategoryBody.parse({ description: null })).toEqual({ description: null });
  });

  it('rejects an empty body', () => {
    expect(updateCategoryBody.safeParse({}).error?.issues[0]?.message).toBe('At least one field is required');
  });
});

describe('createProductBody (RF-16, RN-11)', () => {
  const categoryId = '00000000-0000-4000-8000-000000000001';
  const size = { label: 'M', sku: 'SKU-M' };

  it('trims name, labels and SKUs; description blank → null; position optional', () => {
    expect(
      createProductBody.parse({
        name: ' Tee ',
        description: ' ',
        categoryId,
        sizes: [{ label: ' M ', sku: ' SKU-M ' }, { label: 'L', sku: 'SKU-L', position: 3 }],
      }),
    ).toEqual({
      name: 'Tee',
      description: null,
      categoryId,
      sizes: [{ label: 'M', sku: 'SKU-M' }, { label: 'L', sku: 'SKU-L', position: 3 }],
    });
  });

  it('requires at least one size (RN-11)', () => {
    const missing = createProductBody.safeParse({ name: 'Tee', categoryId });
    expect(missing.error?.issues[0]?.path).toEqual(['sizes']);
    const empty = createProductBody.safeParse({ name: 'Tee', categoryId, sizes: [] });
    expect(empty.error?.issues[0]).toMatchObject({ path: ['sizes'], message: 'Add at least one size' });
  });

  it('rejects a repeated label on the repeating row', () => {
    const result = createProductBody.safeParse({
      name: 'Tee',
      categoryId,
      sizes: [size, { label: 'L', sku: 'SKU-L' }, { label: ' M', sku: 'SKU-M2' }],
    });
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: ['sizes', 2, 'label'], message: 'This label is already used' }),
    ]);
  });

  it('rejects blank labels/SKUs, bad positions and unknown size keys', () => {
    for (const bad of [
      { label: ' ', sku: 'X' },
      { label: 'M', sku: '' },
      { label: 'M', sku: 'X', position: -1 },
      { label: 'M', sku: 'X', position: 1.5 },
      { label: 'M', sku: 'X', isActive: false },
    ]) {
      expect(createProductBody.safeParse({ name: 'Tee', categoryId, sizes: [bad] }).success).toBe(false);
    }
  });
});

describe('updateProductBody (RF-16, RN-08)', () => {
  it('accepts any of name, description, categoryId, isActive', () => {
    expect(updateProductBody.parse({ isActive: false })).toEqual({ isActive: false });
    expect(updateProductBody.parse({ name: ' Tee ', description: '' })).toEqual({ name: 'Tee', description: null });
  });

  it('rejects an empty body', () => {
    expect(updateProductBody.safeParse({}).error?.issues[0]?.message).toBe('At least one field is required');
  });
});

describe('updateProductSizeBody (RF-37, RN-08)', () => {
  it('accepts any of label, sku, position, isActive (trimmed)', () => {
    expect(updateProductSizeBody.parse({ label: ' XL ', sku: ' SKU-XL ' })).toEqual({ label: 'XL', sku: 'SKU-XL' });
    expect(updateProductSizeBody.parse({ position: 0, isActive: false })).toEqual({ position: 0, isActive: false });
  });

  it('rejects an empty body, blank label/SKU and a bad position', () => {
    expect(updateProductSizeBody.safeParse({}).error?.issues[0]?.message).toBe('At least one field is required');
    for (const bad of [{ label: ' ' }, { sku: '' }, { position: -1 }, { position: 10_000 }]) {
      expect(updateProductSizeBody.safeParse(bad).success).toBe(false);
    }
  });
});
