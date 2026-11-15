import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import type { Page } from 'shared';
import { describe, expect, it, vi } from 'vitest';
import { DataTable, RowAction, type Column } from './DataTable';
import { PageHeader } from './PageHeader';
import { Pagination } from './Pagination';
import { EmptyState, ErrorState, LoadingState } from './states';

interface Item {
  id: string;
  name: string;
  qty: number;
}

const items: Item[] = [
  { id: 'a', name: 'Nike Air Max — 42', qty: 3 },
  { id: 'b', name: 'Adidas Samba — 40', qty: 12 },
];

function Location() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderWithRouter(ui: React.ReactNode) {
  render(
    <MemoryRouter initialEntries={['/items']}>
      {ui}
      <Location />
    </MemoryRouter>,
  );
}

const location = () => screen.getByTestId('location').textContent;

function table(onDelete = vi.fn(), rowHref?: (row: Item) => string) {
  const columns: Column<Item>[] = [
    { header: 'Product', cell: (row) => row.name },
    { header: 'Quantity', cell: (row) => <span className="font-mono">{row.qty}</span>, align: 'right' },
    {
      header: 'Actions',
      cell: (row) => <RowAction icon="delete" label={`Delete ${row.name}`} onClick={() => onDelete(row.id)} />,
      align: 'right',
    },
  ];
  renderWithRouter(<DataTable label="Items" columns={columns} rows={items} rowKey={(row) => row.id} rowHref={rowHref} />);
  return { onDelete };
}

describe('<DataTable> (components.md §DataTable)', () => {
  it('renders column headers and one row per item, cells labelled for the stacked layout', () => {
    table();
    const grid = screen.getByRole('table', { name: 'Items' });
    expect(within(grid).getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'Product',
      'Quantity',
      'Actions',
    ]);
    const rows = within(grid).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    const cells = within(rows[0]!).getAllByRole('cell');
    expect(cells.map((td) => td.dataset.label)).toEqual(['Product', 'Quantity', 'Actions']);
    expect(cells[1]).toHaveClass('text-right');
    expect(cells[0]).toHaveClass('text-left');
  });

  it('navigates to the row destination on click', async () => {
    const user = userEvent.setup();
    table(undefined, (row) => `/items/${row.id}`);
    await user.click(screen.getByRole('cell', { name: 'Adidas Samba — 40' }));
    expect(location()).toBe('/items/b');
  });

  it('a row with a destination is focusable and opens on Enter', async () => {
    const user = userEvent.setup();
    table(undefined, (row) => `/items/${row.id}`);
    const row = screen.getByRole('cell', { name: 'Nike Air Max — 42' }).closest('tr')!;
    row.focus();
    await user.keyboard('{Enter}');
    expect(location()).toBe('/items/a');
  });

  it('row actions run their own handler and never navigate (click or keyboard)', async () => {
    const user = userEvent.setup();
    const { onDelete } = table(vi.fn(), (row) => `/items/${row.id}`);

    await user.click(screen.getByRole('button', { name: 'Delete Nike Air Max — 42' }));
    expect(onDelete).toHaveBeenCalledWith('a');
    expect(location()).toBe('/items');

    screen.getByRole('button', { name: 'Delete Adidas Samba — 40' }).focus();
    await user.keyboard('{Enter}');
    expect(onDelete).toHaveBeenLastCalledWith('b');
    expect(location()).toBe('/items');
  });

  it('rows without a destination are inert', async () => {
    const user = userEvent.setup();
    table();
    const row = screen.getByRole('cell', { name: 'Nike Air Max — 42' }).closest('tr')!;
    expect(row).not.toHaveAttribute('tabindex');
    await user.click(row);
    expect(location()).toBe('/items');
  });
});

describe('<Pagination> (components.md §Pagination)', () => {
  const envelope = (page: number, total: number): Page<unknown> => ({ items: [], page, pageSize: 20, total });

  it('shows the count and position from the envelope and moves by one page', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(<Pagination data={envelope(2, 45)} onPageChange={onPageChange} />);
    expect(screen.getByText('45 results')).toBeInTheDocument();
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Previous' }));
    expect(onPageChange).toHaveBeenLastCalledWith(1);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPageChange).toHaveBeenLastCalledWith(3);
  });

  it('disables the ends', () => {
    render(<Pagination data={envelope(1, 1)} onPageChange={vi.fn()} />);
    expect(screen.getByText('1 result')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });
});

describe('<PageHeader>', () => {
  it('renders the title, and the subtitle and action only when given', () => {
    const { rerender } = render(<PageHeader title="Activity" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Activity' })).toBeInTheDocument();
    expect(screen.getByRole('banner').querySelector('p')).toBeNull();

    rerender(<PageHeader title="Activity" subtitle="Store A · 42 events" action={<button type="button">New list</button>} />);
    expect(screen.getByText('Store A · 42 events')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New list' })).toBeInTheDocument();
  });
});

describe('async states (RF-36)', () => {
  it('<LoadingState> is a skeleton in the table geometry, announced as loading', () => {
    render(<LoadingState columns={4} />);
    const status = screen.getByRole('status', { name: 'Loading' });
    // header + 6 skeleton rows, each with one bar per column
    expect(status.children).toHaveLength(7);
    expect(status.children[1]!.children).toHaveLength(4);
  });

  it('<EmptyState> explains and offers its action only when given', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(<EmptyState icon="history" title="No events yet" />);
    expect(screen.getByText('No events yet')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();

    rerender(<EmptyState icon="search" title="No events in this period" action={{ label: 'Clear filters', onClick }} />);
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('<ErrorState> shows the message and retries', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ErrorState message="Too many requests" onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Data could not be loaded');
    expect(screen.getByRole('alert')).toHaveTextContent('Too many requests');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
