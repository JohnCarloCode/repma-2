import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import {
  hasPermission,
  type AvailabilityFeedEvent,
  type AvailabilityProduct,
  type HomeSummary,
  type Page,
  type ReplenishmentListSummary,
} from 'shared';
import { RequirePermission } from '../auth/guards';
import { useSession } from '../auth/AuthContext';
import { InactiveBadge } from '../components/InactiveBadge';
import { ListStatusBadge } from '../components/ListStatusBadge';
import { AgingFigure, SizeRun } from '../components/availability/SizeRun';
import { primaryButtonClass, textButtonClass } from '../components/buttons';
import { DataTable, type Column } from '../components/list/DataTable';
import { PageHeader } from '../components/list/PageHeader';
import { EmptyState, LoadingState } from '../components/list/states';
import { NewListModal } from '../components/replenishment/NewListModal';
import { oldestOutage } from '../lib/aging';
import { api } from '../lib/apiClient';
import { formatDate } from '../lib/format';
import { useStoreScope } from '../tenant/activeStore';

/** home.md §The greeting header: banded by local time — morning before 12:00, afternoon until 19:00, evening after. */
function greeting(now: Date, fullName: string): string {
  const hour = now.getHours();
  const band = hour < 12 ? 'Good morning' : hour < 19 ? 'Good afternoon' : 'Good evening';
  const firstName = fullName.trim().split(/\s+/)[0];
  return firstName ? `${band}, ${firstName}` : band;
}

/** Today in long weekday format ("Thursday, August 21"), English like all UI text (RNF-19). */
const longDate = (now: Date) =>
  new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(now);

/**
 * home.md — the store landing (RF-25): greeting header → KPI strip (RF-41) → three bounded
 * blocks stacked full width. The header fires no query; the strip is one `GET /home/summary`
 * and fails on its own, never the page.
 */
export function HomePage() {
  const session = useSession()!;
  const scope = useStoreScope();
  const [creating, setCreating] = useState(false);
  const canCreate = hasPermission(session, 'replenishment:manage');
  // Computed at render, corrected by any re-render — never a timer of its own (home.md §Edge cases).
  const now = new Date();

  return (
    <main className="flex flex-col gap-lg">
      <PageHeader
        title={greeting(now, session.user.fullName)}
        subtitle={`${scope.store.name} · ${longDate(now)}`}
        action={
          canCreate && (
            <>
              <button type="button" className={primaryButtonClass} onClick={() => setCreating(true)}>
                <span className="icon" aria-hidden>
                  add
                </span>
                New list
              </button>
              <NewListModal open={creating} onClose={() => setCreating(false)} />
            </>
          )
        }
      />
      <KpiStrip />
      <RequirePermission permission="replenishment:read">
        <OpenWorkBlock onNewList={canCreate ? () => setCreating(true) : undefined} />
      </RequirePermission>
      <OutOfStockBlock />
      <RequirePermission permission="activity:read">
        <ActivityBlock />
      </RequirePermission>
    </main>
  );
}

/** One summary block: its `h2` title over a full-width bounded table (DESIGN §Screen Skeletons · Home). */
function HomeBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-[12px]">
      <h2 className="text-h2">{title}</h2>
      {children}
    </section>
  );
}

/** `GET /home/summary` (RF-41) — one cache entry shared by the KPI strip and the open-work "View all (N)". */
function useHomeSummary() {
  const scope = useStoreScope();
  return useQuery({
    queryKey: scope.key('home', 'summary'),
    queryFn: () => api.get<HomeSummary>('/home/summary', scope.request),
  });
}

/** The strip's figures in reading order (home.md §The KPI strip). Only the out-of-stock figure takes `accent-bright`. */
const FIGURES: readonly { key: keyof HomeSummary; label: string; highlight?: true }[] = [
  { key: 'openLists', label: 'Open lists' },
  { key: 'pendingItems', label: 'Items to replenish' },
  { key: 'outOfStock', label: 'Sizes out of stock', highlight: true },
];

/**
 * `{components.kpi-strip}`: one card, three figures separated by 1px rules — vertical from
 * tablet up, horizontal (stacked) below 744px. Counts only, never quantities (RN-05); a zero
 * renders "0". Pending: a value-sized skeleton per figure, never a placeholder "0". Failed: one
 * muted line + Retry in place of the strip, the rest of the page keeps rendering.
 */
function KpiStrip() {
  const { data, isError, refetch, isFetching } = useHomeSummary();

  if (isError) {
    return (
      <p role="alert" className="flex flex-wrap items-center gap-sm text-text-secondary">
        Could not load the store summary
        <button type="button" className={textButtonClass} disabled={isFetching} onClick={() => void refetch()}>
          Retry
        </button>
      </p>
    );
  }

  return (
    <section
      aria-label="Store summary"
      aria-busy={!data || undefined}
      className="flex divide-border rounded-md border border-border bg-surface p-[20px] max-tablet:flex-col max-tablet:divide-y tablet:divide-x"
    >
      {FIGURES.map(({ key, label, highlight }) => (
        <div
          key={key}
          className="flex min-w-0 flex-1 flex-col gap-[6px] px-lg first:pl-0 last:pr-0 max-tablet:px-0 max-tablet:py-base max-tablet:first:pt-0 max-tablet:last:pb-0"
        >
          {data ? (
            <span
              className={`font-mono text-kpi tabular-nums ${highlight ? 'text-accent-bright' : 'text-text'}`}
            >
              {data[key]}
            </span>
          ) : (
            <span data-testid="kpi-skeleton" className="h-[35px] w-[64px] rounded-sm bg-surface-raised" />
          )}
          <span className="text-caption text-text-secondary">
            {label}
          </span>
        </div>
      ))}
    </section>
  );
}

/**
 * A block's failure (home.md §States): one muted line + Retry in place of the table — the block
 * never blocks the page, the other blocks keep rendering on their own queries.
 */
function BlockError({ message, onRetry, retrying }: { message: string; onRetry: () => void; retrying: boolean }) {
  return (
    <p role="alert" className="flex flex-wrap items-center gap-sm text-text-secondary">
      {message}
      <button type="button" className={textButtonClass} disabled={retrying} onClick={onRetry}>
        Retry
      </button>
    </p>
  );
}

/** Row bounds of the three blocks (home.md §Layout). */
const OPEN_LISTS_SHOWN = 7;
const OUT_OF_STOCK_SHOWN = 10;
const EVENTS_SHOWN = 4;

const openWorkColumns: Column<ReplenishmentListSummary>[] = [
  { header: 'List', cell: (list) => <span className="text-body-medium text-text">{list.name}</span> },
  { header: 'Status', cell: (list) => <ListStatusBadge status={list.status} /> },
  {
    header: 'Progress',
    // The compact fraction only — Home carries no bars (home.md); zero of zero is "—".
    cell: (list) => (
      <span className="font-mono tabular-nums">{list.itemCount === 0 ? '—' : `${list.doneCount}/${list.itemCount}`}</span>
    ),
  },
  {
    header: '',
    align: 'right',
    // The destination affordance (components.md §DataTable): inside the row link — the row is the
    // one target, so the chevron is a non-interactive, aria-hidden `icon-button` look-alike.
    cell: () => (
      <span
        aria-hidden
        className="inline-flex size-[32px] items-center justify-center rounded-sm bg-surface-raised align-middle text-text transition-colors group-hover/row:text-accent-bright"
      >
        <span className="icon">chevron_right</span>
      </span>
    ),
  },
];

/**
 * home.md §Open replenishment work: up to 7 open lists (draft + processing), newest first, as a
 * bounded table; "View all (N)" from the summary's `openLists` when it truncates. Its key sits
 * under `replenishment/lists`, so every list mutation already refetches it.
 */
function OpenWorkBlock({ onNewList }: { onNewList?: () => void }) {
  const scope = useStoreScope();
  const query = { status: 'draft,processing', pageSize: OPEN_LISTS_SHOWN };
  const { data, isPending, isError, isFetching, refetch } = useQuery({
    queryKey: scope.key('replenishment', 'lists', query),
    queryFn: () =>
      api.get<Page<ReplenishmentListSummary>>(
        `/replenishment-lists?${new URLSearchParams({ status: query.status, pageSize: String(query.pageSize) })}`,
        scope.request,
      ),
  });
  // Same cache entry as the KPI strip: no extra request.
  const summary = useHomeSummary();

  return (
    <HomeBlock title="Open replenishment work">
      {isPending ? (
        <LoadingState columns={openWorkColumns.length} rows={OPEN_LISTS_SHOWN} />
      ) : isError ? (
        <BlockError message="Could not load open replenishment work" onRetry={() => void refetch()} retrying={isFetching} />
      ) : data.items.length === 0 ? (
        <EmptyState
          icon="checklist"
          title="No open replenishment work."
          action={onNewList && { label: 'New list', onClick: onNewList }}
        />
      ) : (
        <DataTable
          label="Open replenishment lists"
          columns={openWorkColumns}
          rows={data.items}
          rowKey={(list) => list.id}
          rowHref={(list) => `/replenishment/${list.id}`}
          // `openLists` (RF-41) and the envelope agree — both count open lists; the envelope is the fallback.
          viewAll={{ to: '/replenishment', total: summary.data?.openLists ?? data.total }}
        />
      )}
    </HomeBlock>
  );
}

const outOfStockColumns: Column<AvailabilityProduct>[] = [
  {
    header: 'Product',
    // Name only — no thumb on Home (no ornament); the inactive badge is data, not ornament (RN-08).
    cell: (product) => (
      <span className="flex flex-wrap items-center gap-sm">
        <span className="text-body-medium text-text">{product.name}</span>
        {!product.isActive && <InactiveBadge />}
      </span>
    ),
  },
  {
    header: 'Sizes',
    // The intact 44px run, same tiles and mark as /availability; a tile opens its own size.
    cell: (product) => (
      <SizeRun sizes={product.sizes} label={`${product.name} sizes`} href={(size) => `/availability/${size.id}`} />
    ),
  },
  {
    header: 'Waiting',
    align: 'right',
    cell: (product) => {
      const since = oldestOutage(product.sizes);
      return since ? <AgingFigure since={since} /> : <span className="font-mono text-data text-text-secondary">—</span>;
    },
  },
];

/**
 * home.md §Out-of-stock evidence: the first 10 products holding an out-of-stock size, in the
 * endpoint's aging order; "View all (N)" from the envelope's **product** total (never the
 * strip's `outOfStock`, which counts sizes). Key under `availability/list`: the flag flow's
 * `availability` invalidation already covers it. Home mutates nothing here.
 */
function OutOfStockBlock() {
  const scope = useStoreScope();
  const { data, isPending, isError, isFetching, refetch } = useQuery({
    queryKey: scope.key('availability', 'list', { outOfStock: true, pageSize: OUT_OF_STOCK_SHOWN }),
    queryFn: () =>
      api.get<Page<AvailabilityProduct>>(`/availability?outOfStock=true&pageSize=${OUT_OF_STOCK_SHOWN}`, scope.request),
  });

  return (
    <HomeBlock title="Out of stock">
      {isPending ? (
        <LoadingState columns={outOfStockColumns.length} rows={OUT_OF_STOCK_SHOWN} />
      ) : isError ? (
        <BlockError message="Could not load out-of-stock products" onRetry={() => void refetch()} retrying={isFetching} />
      ) : data.items.length === 0 ? (
        <EmptyState icon="check_circle" title="Nothing out of stock" />
      ) : (
        <DataTable
          label="Out-of-stock products"
          columns={outOfStockColumns}
          rows={data.items}
          rowKey={(product) => product.id}
          viewAll={{ to: '/availability?outOfStock=true', total: data.total }}
        />
      )}
    </HomeBlock>
  );
}

/** "Runner Sneaker · 42"; a "One size" product is just its name (home.md §Recent activity). */
const eventSubject = ({ productName, sizeLabel }: AvailabilityFeedEvent['item']) =>
  sizeLabel === 'One size' ? productName : `${productName} · ${sizeLabel}`;

const activityColumns: Column<AvailabilityFeedEvent>[] = [
  {
    header: 'Event',
    // Author (RN-09: "—" once deleted), verb, product · size — events carry no quantities (RN-06).
    cell: (event) =>
      event.type === 'out_of_stock'
        ? `${event.authorName ?? '—'} flagged ${eventSubject(event.item)} out of stock`
        : `${event.authorName ?? '—'} restocked ${eventSubject(event.item)}`,
  },
  {
    header: 'When',
    align: 'right',
    cell: (event) => <span className="font-mono text-text-secondary">{formatDate(event.createdAt)}</span>,
  },
];

/**
 * home.md §Recent activity: the feed's four latest events — a teaser of /activity, so its
 * "View all" carries no count. Key under `activity`: the flag flow already invalidates it.
 */
function ActivityBlock() {
  const scope = useStoreScope();
  const { data, isPending, isError, isFetching, refetch } = useQuery({
    queryKey: scope.key('activity', { pageSize: EVENTS_SHOWN }),
    queryFn: () => api.get<Page<AvailabilityFeedEvent>>(`/availability/events?pageSize=${EVENTS_SHOWN}`, scope.request),
  });

  return (
    <HomeBlock title="Recent activity">
      {isPending ? (
        <LoadingState columns={activityColumns.length} rows={EVENTS_SHOWN} />
      ) : isError ? (
        <BlockError message="Could not load recent activity" onRetry={() => void refetch()} retrying={isFetching} />
      ) : data.items.length === 0 ? (
        <EmptyState icon="history" title="No events yet" />
      ) : (
        <DataTable
          label="Recent availability events"
          columns={activityColumns}
          rows={data.items}
          rowKey={(event) => event.id}
          rowHref={(event) => `/availability/${event.item.id}`}
          viewAll={{ to: '/activity' }}
        />
      )}
    </HomeBlock>
  );
}
