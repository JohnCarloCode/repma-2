import type { AvailabilityEventType, ReplenishmentStatus } from 'shared';

// components.md §Data conventions — one formatter per convention, shared by
// every page that renders the same kind of value.

const HOUR = 3_600_000;
const pad = (n: number) => String(n).padStart(2, '0');

/** Relative under 24h ("5 min ago", "2 h ago"), else `dd/mm/yyyy HH:mm` — in the browser's timezone. */
export function formatDate(iso: string, now = Date.now()): string {
  const date = new Date(iso);
  const diff = now - date.getTime();
  if (diff < HOUR) return `${Math.max(1, Math.floor(diff / 60_000))} min ago`;
  if (diff < 24 * HOUR) return `${Math.floor(diff / HOUR)} h ago`;
  return (
    `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** A single size named as its subject: "Nike Air Max — 42"; a "One size" product is just its name. */
export const sizeName = (productName: string, sizeLabel: string) =>
  sizeLabel === 'One size' ? productName : `${productName} — ${sizeLabel}`;

export const EVENT_LABEL: Record<AvailabilityEventType, string> = {
  out_of_stock: 'Out of stock',
  restock: 'Restocked',
};

export const LIST_STATUS_LABEL: Record<ReplenishmentStatus, string> = {
  draft: 'Draft',
  processing: 'In progress',
  done: 'Done',
};
