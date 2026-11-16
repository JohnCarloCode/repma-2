import { describe, expect, it } from 'vitest';
import { slugify } from './slug.js';

// RN-10 — the single place where names become slugs (stores now, categories in 8.1).
describe('slugify', () => {
  it.each([
    ['Downtown Store', 'downtown-store'],
    ['  North   Store  ', 'north-store'],
    ['Café Màlaga Ñandú', 'cafe-malaga-nandu'],
    ['Store #1 — Main/Street', 'store-1-main-street'],
    ['--Already-Slugged--', 'already-slugged'],
    ['T-Shirts & Polos', 't-shirts-polos'],
    ['ÆON straße', 'aeon-strasse'],
    ['123', '123'],
  ])('%j → %j', (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });

  it('names differing only in case, accents or punctuation share a slug', () => {
    expect(slugify('Downtown store')).toBe(slugify('DOWNTOWN — Stóre'));
    expect(slugify('Málaga')).toBe(slugify('malaga!'));
  });

  it('a name without letters or digits yields an empty slug', () => {
    expect(slugify('!!! ---')).toBe('');
    expect(slugify('🙂')).toBe('');
  });
});
