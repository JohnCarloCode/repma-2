import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import type { Page } from 'shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilterBand, SEARCH_DEBOUNCE_MS, SearchField, filterControlClass } from './FilterBand';
import { useEmptyPageRecovery, useListParams } from './useListParams';

function Probe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <div data-testid="location">{location.pathname + location.search}</div>
      <button type="button" onClick={() => navigate(-1)}>
        Back
      </button>
    </>
  );
}

function FilteredList() {
  const list = useListParams(['search', 'status']);
  return (
    <>
      <FilterBand>
        <SearchField label="Search" value={list.filters.search} onChange={(v) => list.setFilter('search', v)} />
        <select
          aria-label="Status"
          className={filterControlClass}
          value={list.filters.status}
          onChange={(e) => list.setFilter('status', e.target.value)}
        >
          <option value="">All</option>
          <option value="done">Done</option>
        </select>
      </FilterBand>
      <output data-testid="page">{list.page}</output>
      <output data-testid="has-filters">{String(list.hasFilters)}</output>
      <button type="button" onClick={() => list.setPage(3)}>
        Page 3
      </button>
      <button type="button" onClick={list.clearFilters}>
        Clear filters
      </button>
    </>
  );
}

function renderList(entries: string[], ui = <FilteredList />) {
  render(
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      {ui}
      <Probe />
    </MemoryRouter>,
  );
}

const location = () => screen.getByTestId('location').textContent;
const search = () => screen.getByRole('searchbox', { name: 'Search' });

afterEach(() => vi.useRealTimers());

describe('filter band — URL-held state (components.md §Filter band)', () => {
  it('reads filters and page from the URL', () => {
    renderList(['/items?search=nike&status=done&page=2']);
    expect(search()).toHaveValue('nike');
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('done');
    expect(screen.getByTestId('page')).toHaveTextContent('2');
    expect(screen.getByTestId('has-filters')).toHaveTextContent('true');
  });

  it('treats a missing or invalid page as page 1', () => {
    renderList(['/items?page=abc']);
    expect(screen.getByTestId('page')).toHaveTextContent('1');
    expect(screen.getByTestId('has-filters')).toHaveTextContent('false');
  });

  it('commits the search 300ms after the last keystroke and resets to page 1', () => {
    vi.useFakeTimers();
    renderList(['/items?page=3']);

    fireEvent.change(search(), { target: { value: 'nik' } });
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1));
    expect(location()).toBe('/items?page=3');

    act(() => vi.advanceTimersByTime(1));
    expect(location()).toBe('/items?search=nik');
  });

  it('restarts the debounce on every keystroke and trims, without clobbering what is typed', () => {
    vi.useFakeTimers();
    renderList(['/items']);

    fireEvent.change(search(), { target: { value: 'ni' } });
    act(() => vi.advanceTimersByTime(200));
    fireEvent.change(search(), { target: { value: 'nike ' } });
    act(() => vi.advanceTimersByTime(200));
    expect(location()).toBe('/items');

    act(() => vi.advanceTimersByTime(100));
    expect(location()).toBe('/items?search=nike');
    expect(search()).toHaveValue('nike ');
  });

  it('a select change resets to page 1 and keeps the other filters', async () => {
    const user = userEvent.setup();
    renderList(['/items?search=nike&page=4']);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'done');
    expect(location()).toBe('/items?search=nike&status=done');
  });

  it('page changes keep the filters; Clear filters drops filters and page', async () => {
    const user = userEvent.setup();
    renderList(['/items?search=nike&status=done']);
    await user.click(screen.getByRole('button', { name: 'Page 3' }));
    expect(location()).toBe('/items?search=nike&status=done&page=3');

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(location()).toBe('/items');
    expect(search()).toHaveValue('');
  });

  it('back navigation restores the previous filters into the controls', async () => {
    const user = userEvent.setup();
    renderList(['/items?search=old', '/items?search=new']);
    expect(search()).toHaveValue('new');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(location()).toBe('/items?search=old');
    expect(search()).toHaveValue('old');
  });

  it('is a labelled search landmark', () => {
    renderList(['/items']);
    expect(screen.getByRole('search')).toContainElement(search());
  });
});

function Recovering({ data }: { data: Page<unknown> }) {
  const list = useListParams([]);
  useEmptyPageRecovery(data, list.setPage);
  return null;
}

const page = (page: number, total: number, items: unknown[] = []): Page<unknown> => ({ items, page, pageSize: 20, total });

describe('empty-page recovery (RF-36)', () => {
  it('an empty page after a delete moves to page - 1, replacing the history entry', async () => {
    const user = userEvent.setup();
    renderList(['/items', '/items?page=3'], <Recovering data={page(3, 40)} />);
    expect(location()).toBe('/items?page=2');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(location()).toBe('/items');
  });

  it('a stale page far past the end lands on the last page in one step', () => {
    renderList(['/items?page=9'], <Recovering data={page(9, 25)} />);
    expect(location()).toBe('/items?page=2');
  });

  it('an emptied set falls back to page 1', () => {
    renderList(['/items?page=4'], <Recovering data={page(4, 0)} />);
    expect(location()).toBe('/items');
  });

  it('leaves page 1 alone', () => {
    renderList(['/items'], <Recovering data={page(1, 0)} />);
    expect(location()).toBe('/items');
  });

  it('leaves a page with rows alone', () => {
    renderList(['/items?page=2'], <Recovering data={page(2, 25, [{}])} />);
    expect(location()).toBe('/items?page=2');
  });
});
