import type { HomeSummary } from 'shared';
import { getSummary as getSummaryRow } from './repository.js';

// RF-41 — no rules beyond the counts themselves.
export function getSummary(): Promise<HomeSummary> {
  return getSummaryRow();
}
