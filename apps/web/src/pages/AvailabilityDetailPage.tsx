import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'react-router';
import { hasPermission, type AvailabilityEventType, type AvailabilityItem, type AvailabilityItemEvent, type Page } from 'shared';
import { useSession } from '../auth/AuthContext';
import { InactiveBadge } from '../components/InactiveBadge';
import { ProductThumb } from '../components/availability/ProductThumb';
import { AgingFigure, OUT_OF_STOCK_MARK, OutOfStockDot } from '../components/availability/SizeRun';
import { DataTable, type Column } from '../components/list/DataTable';
import { Pagination } from '../components/list/Pagination';
import { primaryButtonClass, secondaryButtonClass } from '../components/buttons';
import { EmptyState, ErrorState, LoadingState } from '../components/list/states';
import { useEmptyPageRecovery, useListParams } from '../components/list/useListParams';
import { ApiError, api } from '../lib/apiClient';
import { EVENT_LABEL, formatDate, sizeName } from '../lib/format';
import { useToast } from '../lib/toast';
import { useStoreScope } from '../tenant/activeStore';
import type { AvailabilityLinkState } from './AvailabilityPage';

const columns: Column<AvailabilityItemEvent>[] = [
  { header: 'Date', cell: (event) => <span className="font-mono">{formatDate(event.createdAt)}</span> },
  { header: 'Event', cell: (event) => EVENT_LABEL[event.type] },
  { header: 'User', cell: (event) => event.authorName ?? '—' },
];

const FLAG = {
  out_of_stock: { label: 'Mark out of stock', icon: 'block', done: 'Marked as out of stock' },
  restock: { label: 'Mark restocked', icon: 'restart_alt', done: 'Marked as restocked' },
} as const satisfies Record<AvailabilityEventType, { label: string; icon: string; done: string }>;

const cardClass = 'rounded-md border border-border bg-surface';

/**
 * availability-detail.md — one size of the store's assortment: its state
 * (exactly the latest event, RN-05), the immutable history behind it, and the
 * app's only flagging surface (RF-20). Never a quantity.
 * Interim until 6.4: no "Remove from assortment" action.
 */
export function AvailabilityDetailPage() {
  const { id = '' } = useParams();
  const scope = useStoreScope();
  const session = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const listSearch = (useLocation().state as AvailabilityLinkState | null)?.listSearch ?? '';
  const history = useListParams([] as const);
  const { page } = history;

  const itemKey = scope.key('availability', 'item', id);
  const item = useQuery({
    queryKey: itemKey,
    queryFn: () => api.get<AvailabilityItem>(`/availability/${id}`, scope.request),
  });
  const events = useQuery({
    queryKey: scope.key('availability', 'events', id, { page }),
    queryFn: () =>
      api.get<Page<AvailabilityItemEvent>>(`/availability/${id}/events?page=${page}`, scope.request),
  });
  useEmptyPageRecovery(events.data, history.setPage);

  // One tap → one event (RN-06). The flip is optimistic; the server answer —
  // or, on any error (RN-14's 409 included), the refetch — reconciles it.
  const flag = useMutation({
    mutationFn: (type: AvailabilityEventType) =>
      api.post<AvailabilityItem>(`/availability/${id}/events`, { type }, scope.request),
    onMutate: async (type) => {
      await queryClient.cancelQueries({ queryKey: itemKey });
      const previous = queryClient.getQueryData<AvailabilityItem>(itemKey);
      if (previous) {
        // A fresh outage reads 0 elapsed (DP-07); the server's timestamp replaces it on 201.
        queryClient.setQueryData<AvailabilityItem>(itemKey, {
          ...previous,
          isAvailable: type === 'restock',
          latestEventAt: new Date().toISOString(),
        });
      }
      return { previous };
    },
    onSuccess: (updated, type) => {
      queryClient.setQueryData(itemKey, updated);
      toast.success(FLAG[type].done);
    },
    onError: (error, _type, context) => {
      if (context?.previous) queryClient.setQueryData(itemKey, context.previous);
      toast.error(error);
    },
    // Item, history and list (one prefix), the store feed and the Home summary — on error
    // too, so a 409's loser settles on the state the winner recorded.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: scope.key('availability') });
      void queryClient.invalidateQueries({ queryKey: scope.key('activity') });
      void queryClient.invalidateQueries({ queryKey: scope.key('home') });
    },
  });

  const canFlag = !!session && hasPermission(session, 'availability:flag');
  const next: AvailabilityEventType | null = item.data ? (item.data.isAvailable ? 'out_of_stock' : 'restock') : null;

  const backLink = (
    <Link
      to={`/availability${listSearch}`}
      aria-label="Back to availability"
      className="group inline-flex size-[44px] flex-none items-center justify-center rounded-sm"
    >
      <span className="inline-flex size-[32px] items-center justify-center rounded-sm bg-surface-raised text-text transition-colors group-hover:bg-surface-hover group-hover:text-accent-bright">
        <span className="icon" aria-hidden>
          arrow_back
        </span>
      </span>
    </Link>
  );

  const notFound = item.error instanceof ApiError && item.error.status === 404;

  return (
    <main className="flex flex-col gap-lg">
      <header className="flex flex-wrap items-center justify-between gap-base">
        {backLink}
        {canFlag && next && (
          <button
            type="button"
            onClick={() => flag.mutate(next)}
            disabled={flag.isPending}
            aria-busy={flag.isPending}
            className={primaryButtonClass}
          >
            <span className="icon" aria-hidden>
              {FLAG[next].icon}
            </span>
            {FLAG[next].label}
          </button>
        )}
      </header>

      {item.isPending ? (
        <SummarySkeleton />
      ) : notFound ? (
        <ErrorState
          title="Item not found"
          action={
            <Link to={`/availability${listSearch}`} className={secondaryButtonClass}>
              Back to availability
            </Link>
          }
        />
      ) : item.isError ? (
        <ErrorState message={item.error.message} onRetry={() => void item.refetch()} />
      ) : (
        <SummaryCard item={item.data} />
      )}

      {!item.isError && (
        <section aria-labelledby="history-heading" className="flex flex-col gap-base">
          <h2 id="history-heading" className="text-h2">
            Event history
          </h2>
          {events.isPending ? (
            <LoadingState columns={columns.length} />
          ) : events.isError ? (
            <ErrorState message={events.error.message} onRetry={() => void events.refetch()} />
          ) : events.data.items.length === 0 ? (
            <EmptyState
              icon="history"
              title="No events yet. The item is available."
              action={
                canFlag && item.data?.isAvailable && !flag.isPending
                  ? { label: FLAG.out_of_stock.label, onClick: () => flag.mutate('out_of_stock') }
                  : undefined
              }
            />
          ) : (
            <>
              <DataTable label="Event history" columns={columns} rows={events.data.items} rowKey={(e) => e.id} />
              <Pagination data={events.data} onPageChange={history.setPage} />
            </>
          )}
        </section>
      )}
    </main>
  );
}

/** Identity, state (a lone badge — the one place without a run to carry it), since-line, category; thumb right. */
function SummaryCard({ item }: { item: AvailabilityItem }) {
  const { product } = item;
  return (
    <section aria-label="Item summary" className={`${cardClass} flex items-start gap-base p-card tablet:gap-xl`}>
      <div className="flex min-w-0 flex-1 flex-col gap-base">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-sm">
            <h1 className="text-display">{sizeName(product.name, item.label)}</h1>
            {(!product.isActive || !item.isActive) && <InactiveBadge />}
          </div>
          <p className="mt-xs font-mono text-caption text-text-secondary">{item.sku}</p>
        </div>
        <div>
          {item.isAvailable ? (
            <p className="text-body-medium text-text">Available</p>
          ) : (
            <span
              className={`${OUT_OF_STOCK_MARK} inline-flex items-center gap-xs rounded-full px-[10px] py-[2px] text-label text-text`}
            >
              <OutOfStockDot />
              Out of stock
              {item.latestEventAt && <AgingFigure since={item.latestEventAt} />}
            </span>
          )}
          <p className="mt-sm text-caption text-text-secondary">
            {item.latestEventAt ? `since ${formatDate(item.latestEventAt)}` : 'no events recorded'}
          </p>
        </div>
        <div>
          <p className="text-caption text-text-secondary">Category</p>
          <p className="mt-xs text-body text-text">{product.categoryName}</p>
        </div>
      </div>
      <ProductThumb name={product.name} imageUrl={product.imageUrl} sizeClass="size-[72px]" />
    </section>
  );
}

/** Loading: the summary card's geometry in static blocks (components.md §Async states — skeleton cards for detail). */
function SummarySkeleton() {
  return (
    <div role="status" aria-label="Loading" className={`${cardClass} flex items-start gap-base p-card tablet:gap-xl`}>
      <div className="flex flex-1 flex-col gap-base">
        <div className="h-[24px] w-2/3 max-w-[320px] rounded-sm bg-surface-raised" />
        <div className="h-[14px] w-[120px] rounded-sm bg-surface-raised" />
        <div className="h-[14px] w-[160px] rounded-sm bg-surface-raised" />
      </div>
      <div className="size-[72px] flex-none rounded-sm bg-surface-raised" />
    </div>
  );
}
