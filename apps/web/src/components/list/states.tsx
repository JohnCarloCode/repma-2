import type { ReactNode } from 'react';

// components.md §Async states — one component each, used everywhere. Each
// replaces the table card (DESIGN §Alerts & feedback: centered in the card,
// gray text, one action).

const cardClass = 'rounded-md border border-border bg-surface';
const centeredClass = `${cardClass} flex flex-col items-center gap-[12px] px-lg py-xxl text-center`;

/** Query pending: static `surface-raised` skeleton rows in the table's geometry (no spinner, nothing loops — DESIGN §Motion). */
export function LoadingState({ columns }: { columns: number }) {
  const cells = Array.from({ length: columns }, (_, i) => i);
  return (
    <div role="status" aria-label="Loading" className={`${cardClass} overflow-hidden`}>
      <div className="flex gap-lg border-b border-border px-base py-[14px]">
        {cells.map((i) => (
          <div key={i} className="h-[10px] flex-1 rounded-sm bg-surface-raised" />
        ))}
      </div>
      {Array.from({ length: 6 }, (_, row) => (
        <div key={row} className="flex h-[44px] items-center gap-lg border-b border-border px-base last:border-b-0">
          {cells.map((i) => (
            <div key={i} className="h-[14px] flex-1 rounded-sm bg-surface-raised" />
          ))}
        </div>
      ))}
    </div>
  );
}

export interface StateAction {
  label: string;
  onClick: () => void;
}

const primaryButtonClass =
  'h-[44px] rounded-sm bg-accent px-base text-body-medium text-on-accent transition-colors hover:bg-accent-hover active:bg-accent-active';

/**
 * Success with 0 items. The page tells "no data yet" (its primary action, if
 * the user may take it) from "no results for these filters" ("Clear filters").
 */
export function EmptyState({ icon, title, action }: { icon: string; title: string; action?: StateAction }) {
  return (
    <div className={centeredClass}>
      <span className="icon text-text-secondary" aria-hidden>
        {icon}
      </span>
      <p className="text-text-secondary">{title}</p>
      {action && (
        <button type="button" className={`mt-xs ${primaryButtonClass}`} onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}

/**
 * Query error: inline card with the API message and "Retry" (refetches) — never a blank screen.
 * A page can name the failure (`title`) and swap Retry for its own way out (`action`), e.g. a
 * detail's 404 "Item not found" + a link back to its list.
 */
export function ErrorState({
  title = 'Data could not be loaded',
  message,
  onRetry,
  action,
}: {
  title?: string;
  message?: ReactNode;
  onRetry?: () => void;
  action?: ReactNode;
}) {
  return (
    <div role="alert" className={centeredClass}>
      <span className="icon text-alert" aria-hidden>
        error
      </span>
      <div>
        <p className="text-body-medium text-text">{title}</p>
        {message && <p className="mt-xs text-text-secondary">{message}</p>}
      </div>
      {action ??
        (onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className={secondaryButtonClass}
          >
            <span className="icon" aria-hidden>
              refresh
            </span>
            Retry
          </button>
        ))}
    </div>
  );
}

/** `button-secondary` geometry, shared by Retry and a page's own error action. */
export const secondaryButtonClass =
  'inline-flex h-[44px] items-center gap-sm rounded-sm border border-border-strong px-base text-body-medium text-text transition-colors hover:bg-surface-hover';
