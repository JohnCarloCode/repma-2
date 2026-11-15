import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { AvailabilityFeedEvent, Page } from 'shared';
import { DataTable, type Column } from '../components/list/DataTable';
import { FilterBand, filterControlClass } from '../components/list/FilterBand';
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

/** A `yyyy-mm-dd` from the URL (anything else is ignored) as [year, monthIndex, day]. */
function parseDay(value: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? [Number(match[1]), Number(match[2]) - 1, Number(match[3])] : null;
}

/** The range in order: "From" later than "To" is swapped, never queried as an empty range (activity.md). */
const ordered = (from: string, to: string) => (from && to && from > to ? { from: to, to: from } : { from, to });

/**
 * activity.md — the store-wide availability-events feed (RF-42/RF-23).
 * Interim until 3.7: rows have no destination (`/availability/:id` ships there).
 */
export function ActivityPage() {
  const scope = useStoreScope();
  const list = useListParams(['from', 'to'] as const);
  const { page } = list;
  const range = ordered(list.filters.from, list.filters.to);

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: scope.key('activity', { page, ...range }),
    queryFn: () => {
      const query = new URLSearchParams({ page: String(page) });
      // Local calendar days: "From" = start of day, "To" = end of day, both inclusive.
      const from = parseDay(range.from);
      const to = parseDay(range.to);
      if (from) query.set('from', new Date(...from).toISOString());
      if (to) query.set('to', new Date(...to, 23, 59, 59, 999).toISOString());
      return api.get<Page<AvailabilityFeedEvent>>(`/availability/events?${query}`, scope.request);
    },
  });
  useEmptyPageRecovery(data, list.setPage);

  const setDay = (name: 'from' | 'to', value: string) => list.setFilters(ordered(
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
          <DataTable label="Availability events" columns={columns} rows={data.items} rowKey={(event) => event.id} />
          <Pagination data={data} onPageChange={list.setPage} />
        </>
      )}
    </main>
  );
}

/** Empty (cleared) or a full date: typing a year makes the native input report `0002-…` first. */
const isComplete = (value: string) => value === '' || (parseDay(value)?.[0] ?? 0) >= 1000;

/**
 * A date input in a control-styled box, so its label never sits on the accent band.
 * Keyboard entry is held locally until the year is complete; blur discards an unfinished one.
 */
function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
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
