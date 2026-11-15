import { Link } from 'react-router';
import type { AvailabilitySize } from 'shared';
import { AGING_FIGURE_CLASS, aging } from '../../lib/aging';
import { InactiveBadge } from '../InactiveBadge';
import { Tooltip } from '../Tooltip';

/**
 * DESIGN.md `out-of-stock-mark` — the ONE mark for every missing size at any
 * age (§Out of stock): transparent fill, 1px dashed `border-strong`, a 6px
 * `alert` dot before the label. Run tiles and `badge-out-of-stock` (with its
 * own pill radius) consume it.
 */
export const OUT_OF_STOCK_MARK = 'border border-dashed border-border-strong bg-transparent';

export function OutOfStockDot() {
  return <span aria-hidden className="size-[6px] flex-none rounded-full bg-alert" />;
}

/** The DP-07 elapsed figure of an outage started at `since`, weight-graded by band; recomputed on every render. */
export function AgingFigure({ since }: { since: string }) {
  const { figure, band } = aging(since);
  return <span className={`font-mono text-data ${AGING_FIGURE_CLASS[band]}`}>{figure}</span>;
}

interface SizeRunProps {
  /** The product's run in `position` order (AD-22). */
  sizes: AvailabilitySize[];
  /** Accessible name of the run, e.g. "Runner Sneaker sizes". */
  label: string;
  /** Tile destination; with it every tile is a link, without it a plain span (read-only run). */
  href?: (size: AvailabilitySize) => string;
  /** Router state carried by every tile link (e.g. the list's URL state for the detail's back action). */
  linkState?: unknown;
  /**
   * Selection mode (the ProductPicker): with it every tile is a button that calls it. Button
   * tiles never render the out-of-stock mark or its age — availability is not a selection
   * criterion (product-picker.md §Accessibility, DP-06/DP-07).
   */
  onSelect?: (size: AvailabilitySize) => void;
  /** Selection mode: the chosen size (`run-tile-selected`, `aria-pressed`), by `sizeId`. */
  selectedSizeId?: string | null;
  /** Selection mode: sizes that can't be chosen (`run-tile-disabled`), by `sizeId` — e.g. already on the list (RN-04). */
  disabledSizeIds?: ReadonlySet<string>;
  /** Selection mode: why a disabled tile is disabled, e.g. "Already on the list" (tooltip + accessible name). */
  disabledLabel?: string;
}

/**
 * components.md §`<SizeRun>`: one 44×44px tile per size (visual = hit area,
 * 8px gap), wrapping, never scrolling. Out-of-stock tiles all wear the same
 * mark — age is never in the tile (DP-07); it lives in the tooltip and in the
 * consumer's line figure. Owns no navigation or mutation: the consumer passes
 * the destination (link tiles) or the selection callback (button tiles).
 */
export function SizeRun({
  sizes,
  label,
  href,
  linkState,
  onSelect,
  selectedSizeId,
  disabledSizeIds,
  disabledLabel = 'Unavailable',
}: SizeRunProps) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-sm">
      {sizes.map((size) =>
        onSelect ? (
          <SelectTile
            key={size.id}
            size={size}
            selected={size.sizeId === selectedSizeId}
            disabledLabel={disabledSizeIds?.has(size.sizeId) ? disabledLabel : null}
            onSelect={onSelect}
          />
        ) : (
          <SizeTile key={size.id} size={size} to={href?.(size)} linkState={linkState} />
        ),
      )}
    </div>
  );
}

const tileBase =
  'inline-flex h-[44px] min-w-[44px] items-center justify-center gap-[2px] rounded-sm font-mono text-data transition-colors ';

/**
 * A selection tile: `run-tile-available` / `-selected` (accent-bright 2px outline on accent-soft,
 * `aria-pressed`) / `-disabled` (`text-disabled`, not clickable). An inactive size stays
 * selectable with a muted label — whether it may be chosen is the consumer's call (RN-12/RN-08).
 */
function SelectTile({
  size,
  selected,
  disabledLabel,
  onSelect,
}: {
  size: AvailabilitySize;
  selected: boolean;
  disabledLabel: string | null;
  onSelect: (size: AvailabilitySize) => void;
}) {
  const className =
    tileBase +
    (disabledLabel
      ? 'cursor-not-allowed bg-surface-raised px-[14px] text-text-disabled'
      : selected
        ? 'border-2 border-accent-bright bg-accent-soft px-[12px] text-text'
        : `bg-surface-raised px-[14px] hover:text-accent-bright ${size.isActive ? 'text-text' : 'text-text-secondary'}`);
  return (
    <Tooltip
      placement="top"
      className="inline-flex"
      content={
        <span className="inline-flex items-center gap-sm">
          {[size.label, size.sku, disabledLabel].filter(Boolean).join(' · ')}
          {!size.isActive && <InactiveBadge />}
        </span>
      }
    >
      <button
        type="button"
        className={className}
        aria-pressed={selected}
        disabled={disabledLabel !== null}
        onClick={() => onSelect(size)}
      >
        {size.label}
        <span className="sr-only">
          {!size.isActive && ', inactive'}
          {disabledLabel && `, ${disabledLabel.toLowerCase()}`}
        </span>
      </button>
    </Tooltip>
  );
}

function SizeTile({ size, to, linkState }: { size: AvailabilitySize; to?: string; linkState?: unknown }) {
  const out = !size.isAvailable;
  const age = out && size.latestEventAt ? aging(size.latestEventAt) : null;
  const state = out ? `Out of stock${age ? ` ${age.figure}` : ''}` : 'Available';

  const className =
    tileBase +
    (out ? `${OUT_OF_STOCK_MARK} px-[12px] ` : 'bg-surface-raised px-[14px] ') +
    (size.isActive ? 'text-text' : 'text-text-secondary') +
    (to ? ` hover:text-accent-bright ${out ? 'hover:border-accent-bright' : ''}` : '');
  const content = (
    <>
      {out && <OutOfStockDot />}
      {size.label}
      <span className="sr-only">
        {`, ${state.toLowerCase()}`}
        {!size.isActive && ', inactive'}
      </span>
    </>
  );

  return (
    <Tooltip
      placement="top"
      className="inline-flex"
      content={
        <span className="inline-flex items-center gap-sm">
          {`${size.label} · ${size.sku} · ${state}`}
          {!size.isActive && <InactiveBadge />}
        </span>
      }
    >
      {to ? (
        <Link to={to} state={linkState} className={className}>
          {content}
        </Link>
      ) : (
        <span className={className}>{content}</span>
      )}
    </Tooltip>
  );
}
