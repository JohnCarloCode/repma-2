import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import type { Page } from 'shared';

/**
 * components.md §Filter band: a list screen's filter and page state lives in
 * the URL query string (shareable, survives refresh and back navigation).
 * `page` is the page param; every other param is one of the page's named
 * filters. An empty filter and page 1 are absent from the URL.
 */
export function useListParams<const Name extends string>(filterNames: readonly Name[]) {
  const [params, setParams] = useSearchParams();

  const raw = Number(params.get('page'));
  const page = Number.isInteger(raw) && raw > 1 ? raw : 1;
  const filters = Object.fromEntries(filterNames.map((name) => [name, params.get(name) ?? ''])) as Record<Name, string>;

  /** Sets several filters in one URL update; any filter change resets to page 1. */
  const setFilters = (values: Partial<Record<Name, string>>) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [name, value] of Object.entries(values) as [Name, string][]) {
        if (value === '') next.delete(name);
        else next.set(name, value);
      }
      next.delete('page');
      return next;
    });

  return {
    page,
    filters,
    hasFilters: filterNames.some((name) => filters[name] !== ''),
    setFilter: (name: Name, value: string) => setFilters({ [name]: value } as Partial<Record<Name, string>>),
    /** Several filters at once (e.g. a date range swapped as a whole). */
    setFilters,
    setPage(nextPage: number, options?: { replace?: boolean }) {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        if (nextPage > 1) next.set('page', String(nextPage));
        else next.delete('page');
        return next;
      }, options);
    },
    /** "Clear filters": drops every named filter and the page. */
    clearFilters() {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        for (const name of filterNames) next.delete(name);
        next.delete('page');
        return next;
      });
    },
  };
}

/**
 * RF-36 empty-page recovery: when a page past the first comes back empty (the
 * last row of the last page was deleted, or a stale/shared URL points past the
 * end), move to the last page that holds rows — `page - 1` after a delete —
 * replacing the history entry so Back does not return to the empty page.
 */
export function useEmptyPageRecovery(
  data: Page<unknown> | undefined,
  setPage: (page: number, options: { replace: boolean }) => void,
) {
  const target =
    data && data.items.length === 0 && data.page > 1
      ? Math.max(1, Math.min(data.page - 1, Math.ceil(data.total / data.pageSize)))
      : null;
  // Keyed on the target alone: `setPage` is a fresh function every render, and
  // re-firing while the recovered page loads would navigate again.
  useEffect(() => {
    if (target !== null) setPage(target, { replace: true });
  }, [target]);
}
