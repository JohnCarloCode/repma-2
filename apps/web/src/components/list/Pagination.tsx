import type { Page } from 'shared';

const buttonClass =
  'inline-flex h-[44px] items-center gap-xs rounded-sm border border-border-strong bg-surface px-[12px] text-body-medium text-text ' +
  'transition-colors hover:border-accent-bright hover:text-accent-bright disabled:pointer-events-none disabled:opacity-45';

/**
 * components.md §`<Pagination>`: driven by the list envelope
 * `{ items, page, pageSize, total }` — result count, Previous / "Page x of y" / Next.
 */
export function Pagination({ data, onPageChange }: { data: Page<unknown>; onPageChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-base">
      <span className="font-mono text-caption text-text-secondary">
        {data.total} {data.total === 1 ? 'result' : 'results'}
      </span>
      <div className="flex items-center gap-sm">
        <button
          type="button"
          className={buttonClass}
          disabled={data.page <= 1}
          onClick={() => onPageChange(data.page - 1)}
        >
          <span className="icon" aria-hidden>
            chevron_left
          </span>
          Previous
        </button>
        <span className="min-w-[96px] text-center font-mono text-caption text-text-secondary">
          Page {data.page} of {pages}
        </span>
        <button
          type="button"
          className={buttonClass}
          disabled={data.page >= pages}
          onClick={() => onPageChange(data.page + 1)}
        >
          Next
          <span className="icon" aria-hidden>
            chevron_right
          </span>
        </button>
      </div>
    </nav>
  );
}
