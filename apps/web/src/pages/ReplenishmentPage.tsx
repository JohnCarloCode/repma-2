import { Label, Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { REPLENISHMENT_STATUSES, type Page, type ReplenishmentListSummary, type ReplenishmentStatus } from 'shared';
import { RequirePermission } from '../auth/guards';
import { ListStatusBadge } from '../components/ListStatusBadge';
import { primaryButtonClass } from '../components/buttons';
import { DateField, dayBounds, orderedRange } from '../components/list/DateField';
import { FilterBand, SearchField, filterControlClass } from '../components/list/FilterBand';
import { PageHeader } from '../components/list/PageHeader';
import { Pagination } from '../components/list/Pagination';
import { EmptyState, ErrorState } from '../components/list/states';
import { useEmptyPageRecovery, useListParams } from '../components/list/useListParams';
import { DeleteListModal } from '../components/replenishment/DeleteListModal';
import { NewListModal } from '../components/replenishment/NewListModal';
import { api } from '../lib/apiClient';
import { formatDate, LIST_STATUS_LABEL } from '../lib/format';
import { useStoreScope } from '../tenant/activeStore';

/** The date select's presets (`date` URL param); "custom" reveals the From/To days (`from`/`to`). */
const DATE_OPTIONS = [
  { value: '', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom…' },
] as const;

/** Calendar days each preset spans, today included. */
const PRESET_DAYS: Record<string, number> = { today: 1, '7d': 7, '30d': 30 };

/** A preset's lower bound: local midnight of its first day, resolved now (never pinned in the URL). */
function presetFrom(days: number): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)).toISOString();
}

/** The URL's `status` as known statuses, in canonical order (anything else is ignored). */
const parseStatuses = (value: string) =>
  REPLENISHMENT_STATUSES.filter((status) => value.split(',').includes(status));

/** Router state a card hands to the detail, so its back arrow returns to this exact URL state. */
export interface ReplenishmentLinkState {
  listSearch: string;
}

const gridClass = 'grid grid-cols-1 gap-base tablet:grid-cols-2 min-[1200px]:grid-cols-3';
const cardClass = 'rounded-md border border-border bg-surface';

/**
 * replenishment.md — the store's replenishment lists as a grid of cards (RF-26),
 * one work item per card, each opening `/replenishment/:id`. "New list" (header and the
 * no-lists state) opens the create modal; a card's delete button opens the delete confirm.
 */
export function ReplenishmentPage() {
  const scope = useStoreScope();
  const linkState: ReplenishmentLinkState = { listSearch: useLocation().search };
  const list = useListParams(['search', 'status', 'date', 'from', 'to'] as const);
  const { page } = list;
  const { search, date } = list.filters;
  const statuses = parseStatuses(list.filters.status);
  const status = statuses.join(',');
  const custom = date === 'custom';
  const range = custom ? orderedRange(list.filters.from, list.filters.to) : { from: '', to: '' };

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: scope.key('replenishment', 'lists', { page, search, status, date, ...range }),
    queryFn: () => {
      const query = new URLSearchParams({ page: String(page) });
      if (status) query.set('status', status);
      if (search) query.set('search', search);
      // Presets resolve at fetch time, in the browser's timezone; Custom sends its days' bounds.
      const days = PRESET_DAYS[date];
      if (days) query.set('from', presetFrom(days));
      for (const [name, value] of Object.entries(dayBounds(range))) query.set(name, value);
      return api.get<Page<ReplenishmentListSummary>>(`/replenishment-lists?${query}`, scope.request);
    },
  });
  // A delete that empties a page > 1 lands on the previous one (RF-36).
  useEmptyPageRecovery(data, list.setPage);

  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ReplenishmentListSummary | null>(null);
  const newList = { label: 'New list', onClick: () => setCreating(true) };

  const setStatuses = (next: ReplenishmentStatus[]) =>
    // Every status selected is the same set as "All": the URL keeps the shorter form.
    list.setFilter('status', next.length === REPLENISHMENT_STATUSES.length ? '' : next.join(','));

  const setDate = (value: string) => list.setFilters({ date: value, from: '', to: '' });

  const setDay = (name: 'from' | 'to', value: string) =>
    list.setFilters(orderedRange(name === 'from' ? value : list.filters.from, name === 'to' ? value : list.filters.to));

  return (
    <main className="flex flex-col gap-lg">
      <PageHeader
        title="Replenishment"
        subtitle={data && `${scope.store.name} · ${data.total} ${data.total === 1 ? 'list' : 'lists'}`}
        action={
          <RequirePermission permission="replenishment:manage">
            <button type="button" className={primaryButtonClass} onClick={newList.onClick}>
              <span className="icon" aria-hidden>
                add
              </span>
              {newList.label}
            </button>
          </RequirePermission>
        }
      />
      <FilterBand>
        <SearchField
          label="Search"
          placeholder="Search by name…"
          value={search}
          onChange={(value) => list.setFilter('search', value)}
        />
        <StatusSelect value={statuses} onChange={setStatuses} />
        <select
          aria-label="Date"
          value={DATE_OPTIONS.some((option) => option.value === date) ? date : ''}
          onChange={(e) => setDate(e.target.value)}
          className={`${filterControlClass} tablet:min-w-[160px]`}
        >
          {DATE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {custom && (
          <>
            <DateField label="From" value={list.filters.from} onChange={(value) => setDay('from', value)} />
            <DateField label="To" value={list.filters.to} onChange={(value) => setDay('to', value)} />
          </>
        )}
      </FilterBand>
      {isPending ? (
        <CardSkeleton />
      ) : isError ? (
        <ErrorState message={error.message} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        list.hasFilters ? (
          <EmptyState
            icon="search"
            title="No results for these filters"
            action={{ label: 'Clear filters', onClick: list.clearFilters }}
          />
        ) : (
          <RequirePermission
            permission="replenishment:manage"
            fallback={<EmptyState icon="list_alt" title="No replenishment lists yet" />}
          >
            <EmptyState icon="list_alt" title="No replenishment lists yet" action={newList} />
          </RequirePermission>
        )
      ) : (
        <>
          <ul aria-label="Replenishment lists" className={gridClass}>
            {data.items.map((summary) => (
              <ListCard key={summary.id} list={summary} linkState={linkState} onDelete={setDeleting} />
            ))}
          </ul>
          <Pagination data={data} onPageChange={list.setPage} />
        </>
      )}
      <RequirePermission permission="replenishment:manage">
        <NewListModal open={creating} onClose={() => setCreating(false)} />
        <DeleteListModal list={deleting} onClose={() => setDeleting(null)} />
      </RequirePermission>
    </main>
  );
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * One list as a card (replenishment.md §Content): the whole card is one link
 * named by the list, carrying the destination chevron inside it; the delete
 * `icon-button` sits over the card as a sibling target, never inside the link.
 */
function ListCard({
  list,
  linkState,
  onDelete,
}: {
  list: ReplenishmentListSummary;
  linkState: ReplenishmentLinkState;
  onDelete: (list: ReplenishmentListSummary) => void;
}) {
  const open = list.status !== 'done';
  return (
    <li className="relative">
      <Link
        to={`/replenishment/${list.id}`}
        state={linkState}
        aria-label={list.name}
        className={`group flex h-full flex-col gap-sm p-base transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-bright ${cardClass}`}
      >
        {/* The badge row is as tall as the delete button's 32px square laid over its right end. */}
        <div className="flex min-h-[32px] items-center pr-[40px]">
          <ListStatusBadge status={list.status} />
        </div>
        <h2 className="line-clamp-2 text-h2 text-text decoration-accent-bright underline-offset-2 group-hover:underline">
          {list.name}
        </h2>
        <div className="flex flex-col text-caption text-text-secondary tabular-nums">
          <span>
            {list.itemCount === 0
              ? 'Empty'
              : `${plural(list.productCount, 'product', 'products')} · ${plural(list.itemCount, 'size', 'sizes')}`}
          </span>
          {open && list.itemCount > 0 && (
            <span>
              {list.doneCount}/{list.itemCount}
            </span>
          )}
        </div>
        <div className="mt-auto flex items-center justify-between gap-sm border-t border-border pt-sm">
          <span className="flex min-w-0 gap-xs text-caption text-text-secondary tabular-nums">
            <span className="truncate">{list.creatorName ?? '—'}</span>
            <span aria-hidden>·</span>
            <span className="flex-none">{formatDate(list.createdAt)}</span>
          </span>
          <span
            aria-hidden
            className="inline-flex size-[32px] flex-none items-center justify-center rounded-sm bg-surface-raised text-text transition-colors group-hover:text-accent-bright"
          >
            <span className="icon">chevron_right</span>
          </span>
        </div>
      </Link>
      <RequirePermission permission="replenishment:manage">
        <button
          type="button"
          aria-label={`Delete list “${list.name}”`}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(list);
          }}
          className="group/delete absolute top-[10px] right-[10px] inline-flex size-[44px] items-center justify-center rounded-sm"
        >
          <span className="inline-flex size-[32px] items-center justify-center rounded-sm bg-surface-raised text-text transition-colors group-hover/delete:bg-surface-hover">
            <span className="icon" aria-hidden>
              delete
            </span>
          </span>
        </button>
      </RequirePermission>
    </li>
  );
}

/** The band's status multi-select (Headless UI `Listbox`): "All" or any subset of the three statuses. */
function StatusSelect({
  value,
  onChange,
}: {
  value: ReplenishmentStatus[];
  onChange: (next: ReplenishmentStatus[]) => void;
}) {
  const all = value.length === 0;
  // "All" is its own option, selected exactly when no status is.
  const selected: string[] = all ? ['all'] : value;
  const handle = (next: string[]) => {
    const picked = REPLENISHMENT_STATUSES.filter((status) => next.includes(status));
    // Picking "All" while statuses are set clears them; un-picking it while it's the selection keeps it.
    onChange(!all && next.includes('all') ? [] : picked);
  };

  return (
    <Listbox value={selected} onChange={handle} multiple>
      <div className="relative">
        <Label className="sr-only">Status</Label>
        <ListboxButton
          className={`${filterControlClass} flex w-full items-center justify-between gap-sm text-left tablet:min-w-[180px]`}
        >
          <span className="truncate">{all ? 'All statuses' : value.map((status) => LIST_STATUS_LABEL[status]).join(', ')}</span>
          <span className="icon text-text-secondary" aria-hidden>
            expand_more
          </span>
        </ListboxButton>
        <ListboxOptions
          anchor={{ to: 'bottom start', gap: 4 }}
          className="z-popover w-(--button-width) rounded-sm border border-border-strong bg-surface-raised p-xs focus:outline-none"
        >
          {[{ value: 'all', label: 'All' }, ...REPLENISHMENT_STATUSES.map((s) => ({ value: s, label: LIST_STATUS_LABEL[s] }))].map(
            (option) => (
              <ListboxOption
                key={option.value}
                value={option.value}
                className="group flex h-[40px] cursor-pointer items-center gap-sm rounded-sm px-sm text-body text-text data-focus:bg-surface-hover"
              >
                <span className="icon invisible text-accent-bright group-data-selected:visible" aria-hidden>
                  check
                </span>
                {option.label}
              </ListboxOption>
            ),
          )}
        </ListboxOptions>
      </div>
    </Listbox>
  );
}

/** Loading: static skeleton cards on the same grid (replenishment.md §States), nothing jumps. */
function CardSkeleton() {
  return (
    <div role="status" aria-label="Loading" className={gridClass}>
      {Array.from({ length: 6 }, (_, card) => (
        <div key={card} className={`flex h-[176px] flex-col gap-sm p-base ${cardClass}`}>
          <div className="h-[20px] w-[72px] rounded-full bg-surface-raised" />
          <div className="mt-xs h-[18px] w-3/4 rounded-sm bg-surface-raised" />
          <div className="h-[12px] w-1/2 rounded-sm bg-surface-raised" />
          <div className="mt-auto h-[12px] w-2/3 rounded-sm bg-surface-raised" />
        </div>
      ))}
    </div>
  );
}
