import { describe, expect, it } from 'vitest';
import { aging, agingBand, elapsedFigure, oldestOutage } from './aging';

const H = 3_600_000;
const D = 24 * H;

describe('elapsed figure — one unit, never compound (DESIGN §Out of stock)', () => {
  it.each([
    [0, '<1 h'],
    [59 * 60_000, '<1 h'],
    [H, '1 h'],
    [5.9 * H, '5 h'],
    [23.99 * H, '23 h'],
    [D, '1 d'],
    [9.5 * D, '9 d'],
    [20.9 * D, '20 d'],
    [21 * D, '3 w'],
    [27 * D, '3 w'],
    [100 * D, '14 w'],
  ])('%d ms → %s', (ms, figure) => {
    expect(elapsedFigure(ms)).toBe(figure);
  });
});

describe('DP-07 bands', () => {
  it.each([
    [0, 'fresh'],
    [23.99 * H, 'fresh'],
    [D, 'attention'],
    [7 * D, 'attention'],
    [7.99 * D, 'attention'], // still reads "7 d": one figure, one weight
    [8 * D, 'escalated'],
    [60 * D, 'escalated'],
  ])('%d ms → %s', (ms, band) => {
    expect(agingBand(ms)).toBe(band);
  });
});

describe('aging()', () => {
  const now = Date.UTC(2026, 10, 15, 12);

  it('derives figure and band from the outage start at render time', () => {
    expect(aging(new Date(now - 5 * H).toISOString(), now)).toEqual({ figure: '5 h', band: 'fresh' });
    expect(aging(new Date(now - 3 * D).toISOString(), now)).toEqual({ figure: '3 d', band: 'attention' });
    expect(aging(new Date(now - 9 * D).toISOString(), now)).toEqual({ figure: '9 d', band: 'escalated' });
  });

  it('never goes negative on clock skew', () => {
    expect(aging(new Date(now + 10 * 60_000).toISOString(), now)).toEqual({ figure: '<1 h', band: 'fresh' });
  });
});

describe('oldestOutage() — a product line figure origin', () => {
  it('is the earliest outage start among out-of-stock sizes', () => {
    expect(
      oldestOutage([
        { isAvailable: false, latestEventAt: '2026-11-10T10:00:00.000Z' },
        { isAvailable: true, latestEventAt: '2026-10-01T10:00:00.000Z' }, // restocked: not an outage
        { isAvailable: false, latestEventAt: '2026-11-03T08:00:00+01:00' },
        { isAvailable: true, latestEventAt: null },
      ]),
    ).toBe('2026-11-03T08:00:00+01:00');
  });

  it('is null when nothing in the run is out of stock', () => {
    expect(oldestOutage([{ isAvailable: true, latestEventAt: null }])).toBeNull();
    expect(oldestOutage([])).toBeNull();
  });
});
