import { useQuery } from '@tanstack/react-query';
import type { AvailabilityFeedEvent, Page } from 'shared';
import { DataTable, type Column } from '../components/list/DataTable';
import { DateField, dayBounds, orderedRange } from '../components/list/DateField';
import { FilterBand } from '../components/list/FilterBand';
import { PageHeader } from '../components/list/PageHeader';
import { Pagination } from '../components/list/Pagination';
import { EmptyState, ErrorState, LoadingState } from '../components/list/states';
import { useEmptyPageRecovery, useListParams } from '../components/list/useListParams';
import { api } from '../lib/apiClient';
import { EVENT_LABEL, formatDate, sizeName } from '../lib/format';
import { useStoreScope } from '../tenant/activeStore';

const columns: Column<AvailabilityFeedEvent>[] = [
  { header: 'Product', cell: (event) => sizeName(event.item.productName, event.item.sizeLabel) },
  { header: 'Event', cell: (event) => EVENT_LABEL[event.type] },
  { header: 'User', cell: (event) => event.authorName ?? '—' },
  { header: 'Date', cell: (event) => <span className="font-mono">{formatDate(event.createdAt)}</span> },
];

/**
 * activity.md — the store-wide availability-events feed (RF-42/RF-23).
 * A row opens its item's detail (`/availability/:id`).
 */
export function ActivityPage() {
  const scope = useStoreScope();
  const list = useListParams(['from', 'to'] as const);
  const { page } = list;
  const range = orderedRange(list.filters.from, list.filters.to);

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: scope.key('activity', { page, ...range }),
    queryFn: () => {
      // Local calendar days: "From" = start of day, "To" = end of day, both inclusive.
      const query = new URLSearchParams({ page: String(page), ...dayBounds(range) });
      return api.get<Page<AvailabilityFeedEvent>>(`/availability/events?${query}`, scope.request);
    },
  });
  useEmptyPageRecovery(data, list.setPage);

  const setDay = (name: 'from' | 'to', value: string) => list.setFilters(orderedRange(
    name === 'from' ? value : list.filters.from,
    name === 'to' ? value : list.filters.to,
  ));

  return (
    <main className="flex flex-col gap-lg">
      <PageHeader
        title="Activity"
        subtitle={data && `${scope.store.name} · ${data.total} ${data.total === 1 ? 'event' : 'events'}`}
      />
      <FilterBand>
        <DateField label="From" value={list.filters.from} onChange={(value) => setDay('from', value)} />
        <DateField label="To" value={list.filters.to} onChange={(value) => setDay('to', value)} />
        {list.hasFilters && (
          <button
            type="button"
            onClick={list.clearFilters}
            className="h-[44px] px-sm text-body-medium text-on-accent hover:underline"
          >
            Clear
          </button>
        )}
      </FilterBand>
      {isPending ? (
        <LoadingState columns={columns.length} />
      ) : isError ? (
        <ErrorState message={error.message} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        list.hasFilters ? (
          <EmptyState icon="search" title="No events in this period" action={{ label: 'Clear', onClick: list.clearFilters }} />
        ) : (
          <EmptyState icon="history" title="No events yet" />
        )
      ) : (
        <>
          <DataTable label="Availability events" columns={columns} rows={data.items} rowKey={(event) => event.id}
            rowHref={(event) => `/availability/${event.item.id}`}
          />
          <Pagination data={data} onPageChange={list.setPage} />
        </>
      )}
    </main>
  );
}
