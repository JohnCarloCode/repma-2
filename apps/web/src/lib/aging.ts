import type { AvailabilitySize } from 'shared';

// DP-07 — out-of-stock aging, computed at render from the outage start
// (`latestEventAt` while a size is out of stock, RN-14); never stored, never
// fetched. Figure scale: DESIGN.md §Out of stock; bands: DP-07.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type AgingBand = 'fresh' | 'attention' | 'escalated';

export interface Aging {
  /** Compact elapsed figure, one unit, never compound: `<1 h`, `5 h`, `9 d`, `3 w`. */
  figure: string;
  band: AgingBand;
}

/** Whole units, floored (like `formatDate`): hours under a day, days under three weeks, then weeks. */
export function elapsedFigure(ms: number): string {
  if (ms < HOUR) return '<1 h';
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h`;
  const days = Math.floor(ms / DAY);
  return days < 21 ? `${days} d` : `${Math.floor(days / 7)} w`;
}

/** DP-07 bands, read in the figure's whole days so one figure never shows two weights ("7 d" is attention, "8 d" escalated). */
export function agingBand(ms: number): AgingBand {
  const days = Math.floor(ms / DAY);
  if (days < 1) return 'fresh';
  return days <= 7 ? 'attention' : 'escalated';
}

/** Aging of an outage that started at `since` (ISO). Clock skew never yields a negative age. */
export function aging(since: string, now = Date.now()): Aging {
  const ms = Math.max(0, now - new Date(since).getTime());
  return { figure: elapsedFigure(ms), band: agingBand(ms) };
}

/** A product line's figure origin: the earliest outage start among its out-of-stock sizes, or null when none is out. */
export function oldestOutage(sizes: Pick<AvailabilitySize, 'isAvailable' | 'latestEventAt'>[]): string | null {
  let oldest: string | null = null;
  for (const { isAvailable, latestEventAt } of sizes) {
    if (isAvailable || !latestEventAt) continue;
    if (oldest === null || new Date(latestEventAt) < new Date(oldest)) oldest = latestEventAt;
  }
  return oldest;
}

/** DESIGN.md `aging-figure-*`: the band changes the figure's weight (and the escalated hue), nothing else. */
export const AGING_FIGURE_CLASS: Record<AgingBand, string> = {
  fresh: 'font-normal text-text-secondary',
  attention: 'font-semibold text-text',
  escalated: 'font-bold text-alert',
};
