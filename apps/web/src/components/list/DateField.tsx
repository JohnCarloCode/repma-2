import { useState } from 'react';
import { filterControlClass } from './FilterBand';

// Calendar-day filters held in the URL as `yyyy-mm-dd` and sent to the API as
// local-midnight ISO bounds (components.md §Filter band · Date ranges).

/** A `yyyy-mm-dd` from the URL (anything else is ignored) as [year, monthIndex, day]. */
export function parseDay(value: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? [Number(match[1]), Number(match[2]) - 1, Number(match[3])] : null;
}

/** The range in order: "From" later than "To" is swapped, never queried as an empty range. */
export const orderedRange = (from: string, to: string) => (from && to && from > to ? { from: to, to: from } : { from, to });

/** Local calendar days as API bounds: "From" = start of its day, "To" = end of its day, both inclusive. */
export function dayBounds(range: { from: string; to: string }): { from?: string; to?: string } {
  const from = parseDay(range.from);
  const to = parseDay(range.to);
  return {
    ...(from && { from: new Date(...from).toISOString() }),
    ...(to && { to: new Date(...to, 23, 59, 59, 999).toISOString() }),
  };
}

/** Empty (cleared) or a full date: typing a year makes the native input report `0002-…` first. */
const isComplete = (value: string) => value === '' || (parseDay(value)?.[0] ?? 0) >= 1000;

/**
 * A date input in a control-styled box, so its label never sits on the accent band.
 * Keyboard entry is held locally until the year is complete; blur discards an unfinished one.
 */
export function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const committed = parseDay(value) ? value : '';
  // Only an unfinished entry lives here; otherwise the field shows the URL (Clear, swap, Back).
  const [pending, setPending] = useState<string | null>(null);

  return (
    <label
      className={`${filterControlClass} flex items-center gap-sm focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent-bright`}
    >
      <span className="text-label text-text-secondary">{label}</span>
      <input
        type="date"
        value={pending ?? committed}
        onChange={(e) => {
          const next = e.target.value;
          if (!isComplete(next)) return setPending(next);
          setPending(null);
          if (next !== committed) onChange(next);
        }}
        onBlur={() => setPending(null)}
        className="h-full min-w-0 flex-1 bg-transparent text-text outline-none"
      />
    </label>
  );
}
