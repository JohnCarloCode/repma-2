import { describe, expect, it } from 'vitest';
import { describeService } from './server.js';

describe('api bootstrap', () => {
  it('resolves the shared package dependency', () => {
    expect(describeService()).toBe('api (depends on "shared")');
  });
});
