import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index.js';

describe('shared package', () => {
  it('exports a sanity constant', () => {
    expect(PACKAGE_NAME).toBe('shared');
  });
});
