import { useId } from 'react';

/**
 * components.md §`<ProgressBar>` — a labelled block, never a bare bar: "Progress" with the
 * strict `done/total` fraction on one line, the DESIGN.md `progress-bar` track (8px
 * `surface-raised` pill, `accent-bright` fill, animated width) beneath it. The fraction is
 * the information; the bar only echoes it. The consumer owns the container (a card), and
 * nothing renders for an empty set — `0/0` is noise, not progress.
 */
export function ProgressBar({ done, total }: { done: number; total: number }) {
  const labelId = useId();
  if (total === 0) return null;
  const fraction = `${done}/${total}`;
  return (
    <div className="flex flex-col gap-sm">
      <div className="flex items-baseline justify-between gap-sm">
        <span id={labelId} className="text-body-medium text-text">
          Progress
        </span>
        <span className="text-body text-text tabular-nums">{fraction}</span>
      </div>
      <div
        role="progressbar"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={fraction}
        className="h-[8px] overflow-hidden rounded-full bg-surface-raised"
      >
        <div
          className="h-full rounded-full bg-accent-bright transition-[width] duration-base"
          style={{ width: `${(done / total) * 100}%` }}
        />
      </div>
    </div>
  );
}
