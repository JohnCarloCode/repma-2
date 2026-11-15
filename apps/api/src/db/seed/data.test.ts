import { describe, expect, it } from 'vitest';
import { slugify } from '../../core/slug.js';
import { CATEGORIES, STORES } from './data.js';

describe('seed data', () => {
  it('store and category slugs are the ones the API would generate from the name (RN-10)', () => {
    for (const { name, slug } of [...Object.values(STORES), ...CATEGORIES]) expect(slug).toBe(slugify(name));
  });
});
