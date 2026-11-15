import { describe, expect, it } from 'vitest';
import { formatDate, sizeName } from './format';

describe('data conventions (components.md)', () => {
  const now = new Date(2026, 10, 15, 12, 0).getTime();

  it('dates are relative under 24h, absolute dd/mm/yyyy HH:mm beyond', () => {
    expect(formatDate(new Date(now - 10_000).toISOString(), now)).toBe('1 min ago');
    expect(formatDate(new Date(now - 14 * 60_000).toISOString(), now)).toBe('14 min ago');
    expect(formatDate(new Date(now - 2.5 * 3_600_000).toISOString(), now)).toBe('2 h ago');
    expect(formatDate(new Date(now - 23.9 * 3_600_000).toISOString(), now)).toBe('23 h ago');
    expect(formatDate(new Date(2026, 10, 3, 9, 5).toISOString(), now)).toBe('03/11/2026 09:05');
  });

  it('names a size "Product — size", omitting "One size"', () => {
    expect(sizeName('Nike Air Max', '42')).toBe('Nike Air Max — 42');
    expect(sizeName('Tote bag', 'One size')).toBe('Tote bag');
  });
});
