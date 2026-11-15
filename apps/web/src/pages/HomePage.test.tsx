import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type {
  AuthSession,
  AvailabilityFeedEvent,
  AvailabilityProduct,
  AvailabilitySize,
  HomeSummary,
  Page,
  Permission,
  ReplenishmentListSummary,
} from 'shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';
import { SELECTED_STORE_KEY } from '../tenant/activeStore';
import { authMe, renderAt, sessionFor } from '../test/renderApp';
import { server } from '../test/server';

type Role = 'manager' | 'employee' | 'platform_admin';

// Every store role holds all of Home's permissions (spec §2): the only way to reach a gated-off
// block is narrowing the shared matrix for this file.
const matrix = vi.hoisted(() => ({ deny: new Set<string>() }));
vi.mock('shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('shared')>();
  return {
    ...actual,
    hasPermission: (subject: Parameters<typeof actual.hasPermission>[0], permission: Permission) =>
      !matrix.deny.has(permission) && actual.hasPermission(subject, permission),
  };
});
afterEach(() => matrix.deny.clear());

/** `GET /home/summary`, answering `respond()` and recording every request. */
function summary(respond: () => Response | Promise<Response> = () => HttpResponse.json(figures())) {
  const requests: Request[] = [];
  server.use(
    http.get('*/api/v1/home/summary', ({ request }) => {
      requests.push(request);
      return respond();
    }),
  );
  return { requests };
}

const figures = (over: Partial<HomeSummary> = {}): HomeSummary => ({
  openLists: 3,
  pendingItems: 14,
  outOfStock: 10,
  ...over,
});

function named(role: Role, fullName: string): AuthSession {
  const session = sessionFor(role);
  return { ...session, user: { ...session.user, fullName } };
}

function renderHome(role: Role = 'employee', fullName = 'Marta Vidal') {
  server.use(authMe(named(role, fullName)));
  return renderAt('/home', <AppRoutes />);
}

/** The greeting header's "New list" (the open-work empty state may carry a second one). */
const headerNewList = () => within(screen.getByRole('heading', { level: 1 }).closest('header')!).getByRole('button', { name: 'New list' });

const strip = () => screen.findByRole('region', { name: 'Store summary' });

/** The strip's figures as [value, label] pairs, in reading order. */
const readFigures = (region: HTMLElement) =>
  Array.from(region.children).map((figure) => Array.from(figure.children).map((part) => part.textContent));

describe('/home — greeting header (home.md §The greeting header)', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));
  afterEach(() => vi.useRealTimers());

  it.each([
    [new Date(2026, 7, 20, 11, 59), 'Good morning, Marta', 'Store A · Thursday, August 20'],
    [new Date(2026, 7, 21, 12, 0), 'Good afternoon, Marta', 'Store A · Friday, August 21'],
    [new Date(2026, 7, 21, 18, 59), 'Good afternoon, Marta', 'Store A · Friday, August 21'],
    [new Date(2026, 7, 22, 19, 0), 'Good evening, Marta', 'Store A · Saturday, August 22'],
  ])('at %s: "%s" over the store · date line', async (now, title, line) => {
    vi.setSystemTime(now);
    summary();
    renderHome();
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByText(line)).toBeInTheDocument();
  });

  it('a platform admin greets in the selected store, sent as X-Tenant-Id', async () => {
    vi.setSystemTime(new Date(2026, 7, 21, 9, 0));
    localStorage.setItem(SELECTED_STORE_KEY, JSON.stringify({ id: 'store-b', name: 'Store B' }));
    const { requests } = summary();
    renderHome('platform_admin', 'Ada Lovelace');
    expect(await screen.findByRole('heading', { level: 1, name: 'Good morning, Ada' })).toBeInTheDocument();
    expect(screen.getByText('Store B · Friday, August 21')).toBeInTheDocument();
    await strip();
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]!.headers.get('x-tenant-id')).toBe('store-b');
  });
});

describe('/home — "New list" (replenishment:manage)', () => {
  it.each(['manager', 'employee'] as const)('%s: the primary opens the create modal', async (role) => {
    summary();
    renderHome(role);
    await screen.findByRole('heading', { level: 1 });
    await userEvent.click(headerNewList());
    expect(await screen.findByRole('dialog', { name: 'New list' })).toBeInTheDocument();
  });

  it('creating a list invalidates the Home summary and lands on the new list', async () => {
    const { requests } = summary();
    server.use(
      http.post('*/api/v1/replenishment-lists', () =>
        HttpResponse.json({ id: 'l1', name: 'Weekly', notes: null, status: 'draft' }, { status: 201 }),
      ),
      http.get('*/api/v1/replenishment-lists/l1', () =>
        HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'List not found' } }, { status: 404 }),
      ),
    );
    const { queryClient } = renderHome('manager');
    await strip();
    await waitFor(() => expect(requests).toHaveLength(1));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await userEvent.click(headerNewList());
    await userEvent.type(await screen.findByLabelText('Name'), 'Weekly');
    await userEvent.click(screen.getByRole('button', { name: 'Create list' }));

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/replenishment/l1'));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['store', sessionFor('manager').store!.id, 'home'] });
  });
});

describe('/home — KPI strip (home.md §The KPI strip, RF-41)', () => {
  it('three figures in reading order, counts with sentence-case labels; only out-of-stock is highlighted', async () => {
    const { requests } = summary();
    renderHome();
    const region = await strip();
    await waitFor(() => expect(readFigures(region)[0]![0]).toBe('3'));
    expect(readFigures(region)).toEqual([
      ['3', 'Open lists'],
      ['14', 'Items to replenish'],
      ['10', 'Sizes out of stock'],
    ]);
    expect(within(region).getByText('10')).toHaveClass('font-mono', 'text-kpi', 'text-accent-bright');
    expect(within(region).getByText('3')).not.toHaveClass('text-accent-bright');
    expect(within(region).getByText('14')).not.toHaveClass('text-accent-bright');
    expect(new URL(requests[0]!.url).search).toBe('');
    expect(requests[0]!.headers.get('x-tenant-id')).toBeNull();
  });

  it('honest zeros: every figure renders "0", none hidden', async () => {
    summary(() => HttpResponse.json(figures({ openLists: 0, pendingItems: 0, outOfStock: 0 })));
    renderHome();
    const region = await strip();
    await waitFor(() => expect(within(region).getAllByText('0')).toHaveLength(3));
  });

  it('pending: one skeleton per figure, never a placeholder "0"', async () => {
    summary(() => new Promise<Response>(() => {}));
    renderHome();
    const region = await strip();
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(within(region).getAllByTestId('kpi-skeleton')).toHaveLength(3);
    expect(within(region).queryByText('0')).not.toBeInTheDocument();
    expect(within(region).getByText('Sizes out of stock')).toBeInTheDocument();
  });

  it('failed: one muted line + Retry in its place, the rest of the page still renders; Retry refetches', async () => {
    let fail = true;
    const { requests } = summary(() =>
      fail
        ? HttpResponse.json({ error: { code: 'FORBIDDEN', message: 'Forbidden' } }, { status: 403 })
        : HttpResponse.json(figures()),
    );
    renderHome();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load the store summary');
    expect(screen.queryByRole('region', { name: 'Store summary' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: /Marta/ })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Open replenishment work' })).toBeInTheDocument();

    fail = false;
    const before = requests.length;
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    const region = await strip();
    await waitFor(() => expect(within(region).getByText('14')).toBeInTheDocument());
    expect(requests.length).toBeGreaterThan(before);
  });
});

const NOW = new Date('2026-11-15T12:00:00.000Z');
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();
const page = <T,>(items: T[], total = items.length, pageSize = 20): Page<T> => ({ items, page: 1, pageSize, total });

/** A GET handler answering `respond()` and recording every request's URL. */
function reads(path: string, respond: () => Response | Promise<Response>) {
  const urls: URL[] = [];
  server.use(
    http.get(`*/api/v1${path}`, ({ request }) => {
      urls.push(new URL(request.url));
      return respond();
    }),
  );
  return { urls };
}
/** The destination's reads never answer: the test only watches the navigation. */
const stall = (...paths: string[]) =>
  server.use(...paths.map((path) => http.get(`*/api/v1${path}`, () => new Promise<Response>(() => {}))));
const forbidden = () => HttpResponse.json({ error: { code: 'FORBIDDEN', message: 'Forbidden' } }, { status: 403 });

const list = (id: string, over: Partial<ReplenishmentListSummary> = {}): ReplenishmentListSummary => ({
  id,
  name: `List ${id}`,
  status: 'processing',
  createdAt: ago(5),
  creatorName: 'Marta Vidal',
  itemCount: 8,
  productCount: 3,
  doneCount: 3,
  ...over,
});

const size = (id: string, label: string, outFor: number | null = null): AvailabilitySize => ({
  id,
  sizeId: `size-${id}`,
  label,
  sku: `SKU-${id}`,
  isAvailable: outFor === null,
  isActive: true,
  latestEventAt: outFor === null ? null : ago(outFor),
});

const product = (id: string, name: string, sizes: AvailabilitySize[]): AvailabilityProduct => ({
  id,
  name,
  imageUrl: 'https://img.example/p.png',
  categoryName: 'Footwear',
  isActive: true,
  sizes,
});

const event = (id: string, over: Partial<AvailabilityFeedEvent> = {}): AvailabilityFeedEvent => ({
  id,
  type: 'out_of_stock',
  createdAt: ago(2),
  authorName: 'Marta Vidal',
  item: { id: `item-${id}`, productName: 'Runner Sneaker', sizeLabel: '42' },
  ...over,
});

const block = (name: string) => screen.findByRole('region', { name });
const rowsOf = (table: HTMLElement) => within(table).getAllByRole('row').slice(1);

describe('/home — open replenishment work (home.md §Open replenishment work)', () => {
  it('up to 7 open lists: name, status badge, done/total fraction ("—" when empty), no bars; rows open the list', async () => {
    summary(() => HttpResponse.json(figures({ openLists: 9 })));
    const { urls } = reads('/replenishment-lists', () =>
      HttpResponse.json(
        page([list('l1', { name: 'Weekly replenishment' }), list('l2', { name: 'Backroom sweep', status: 'draft', itemCount: 0, doneCount: 0 })], 9, 7),
      ),
    );
    renderHome();
    const region = await block('Open replenishment work');
    const table = await within(region).findByRole('table', { name: 'Open replenishment lists' });

    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['List', 'Status', 'Progress', '']);
    const [first, second] = rowsOf(table);
    expect(within(first!).getByText('Weekly replenishment')).toBeInTheDocument();
    expect(within(first!).getByText('In progress')).toBeInTheDocument();
    expect(within(first!).getByText('3/8')).toBeInTheDocument();
    expect(within(second!).getByText('Draft')).toBeInTheDocument();
    expect(within(second!).getByText('—')).toBeInTheDocument();
    expect(within(region).queryByRole('progressbar')).not.toBeInTheDocument();
    // The chevron lives inside the row link: hidden from assistive tech, not a second target.
    const chevron = within(first!).getByText('chevron_right').parentElement!;
    expect(chevron).toHaveAttribute('aria-hidden', 'true');
    expect(within(first!).queryByRole('button')).not.toBeInTheDocument();

    expect(urls[0]!.searchParams.get('status')).toBe('draft,processing');
    expect(urls[0]!.searchParams.get('pageSize')).toBe('7');
    const viewAll = within(region).getByRole('link', { name: 'View all (9)' });
    expect(viewAll).toHaveAttribute('href', '/replenishment');

    stall('/replenishment-lists/l1');
    await userEvent.click(first!);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/replenishment/l1'));
  });

  it('exactly 7 open lists: "View all" states no count', async () => {
    summary(() => HttpResponse.json(figures({ openLists: 7 })));
    reads('/replenishment-lists', () =>
      HttpResponse.json(page(Array.from({ length: 7 }, (_, i) => list(`l${i}`)), 7, 7)),
    );
    renderHome();
    const region = await block('Open replenishment work');
    expect(await within(region).findByRole('link', { name: 'View all' })).toBeInTheDocument();
    expect(rowsOf(within(region).getByRole('table'))).toHaveLength(7);
  });

  it('pending: skeleton rows at the block\'s bound', async () => {
    summary();
    reads('/replenishment-lists', () => new Promise<Response>(() => {}));
    renderHome();
    const region = await block('Open replenishment work');
    expect(within(region).getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });

  it('no open work: the empty state replaces the whole table, with "New list" for a manager', async () => {
    summary();
    renderHome('manager');
    const region = await block('Open replenishment work');
    expect(await within(region).findByText('No open replenishment work.')).toBeInTheDocument();
    expect(within(region).queryByRole('table')).not.toBeInTheDocument();
    expect(within(region).queryByRole('link', { name: /View all/ })).not.toBeInTheDocument();
    await userEvent.click(within(region).getByRole('button', { name: 'New list' }));
    expect(await screen.findByRole('dialog', { name: 'New list' })).toBeInTheDocument();
  });

  it('without replenishment:manage the empty state carries no action (nor does the header)', async () => {
    matrix.deny.add('replenishment:manage');
    summary();
    renderHome('manager');
    const region = await block('Open replenishment work');
    expect(await within(region).findByText('No open replenishment work.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New list' })).not.toBeInTheDocument();
  });

  it('without replenishment:read neither the block nor its query render', async () => {
    matrix.deny.add('replenishment:read');
    summary();
    const { urls } = reads('/replenishment-lists', () => HttpResponse.json(page([])));
    renderHome();
    await block('Recent activity');
    expect(screen.queryByRole('region', { name: 'Open replenishment work' })).not.toBeInTheDocument();
    expect(urls).toHaveLength(0);
  });

  it('failed: one muted line + Retry, the other blocks still render; Retry refetches', async () => {
    summary();
    let fail = true;
    reads('/replenishment-lists', () => (fail ? forbidden() : HttpResponse.json(page([list('l1')]))));
    renderHome();
    const region = await block('Open replenishment work');
    const alert = await within(region).findByRole('alert');
    expect(alert).toHaveTextContent('Could not load open replenishment work');
    expect(await screen.findByText('Nothing out of stock')).toBeInTheDocument();

    fail = false;
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await within(region).findByText('List l1')).toBeInTheDocument();
  });
});

describe('/home — out-of-stock evidence (home.md §Out-of-stock evidence)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('10 products in aging order: name, intact run of link tiles, Waiting figure; "View all (N)" from the product total', async () => {
    // The strip counts sizes (outOfStock 10) — never the source of the block's N.
    summary(() => HttpResponse.json(figures({ outOfStock: 10 })));
    const { urls } = reads('/availability', () =>
      HttpResponse.json(
        page(
          [
            product('p1', 'Runner Sneaker', [size('a1', '41'), size('a2', '42', 9 * 24), size('a3', '43', 30)]),
            product('p2', 'Trail Jacket', [size('b1', 'S', 6 * 24), size('b2', 'M')]),
          ],
          14,
          10,
        ),
      ),
    );
    renderHome();
    const region = await block('Out of stock');
    const table = await within(region).findByRole('table', { name: 'Out-of-stock products' });

    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Product', 'Sizes', 'Waiting']);
    const [first, second] = rowsOf(table);
    expect(within(first!).getByText('Runner Sneaker')).toBeInTheDocument();
    const run = within(first!).getByRole('group', { name: 'Runner Sneaker sizes' });
    expect(within(run).getAllByRole('link').map((tile) => tile.getAttribute('href'))).toEqual([
      '/availability/a1',
      '/availability/a2',
      '/availability/a3',
    ]);
    expect(within(first!).getByText('9 d')).toBeInTheDocument();
    expect(within(second!).getByText('6 d')).toBeInTheDocument();
    expect(within(region).queryByRole('img')).not.toBeInTheDocument();

    expect(urls[0]!.searchParams.get('outOfStock')).toBe('true');
    expect(urls[0]!.searchParams.get('pageSize')).toBe('10');
    expect(within(region).getByRole('link', { name: 'View all (14)' })).toHaveAttribute(
      'href',
      '/availability?outOfStock=true',
    );
  });

  it('a tile opens its own size\'s detail', async () => {
    summary();
    reads('/availability', () => HttpResponse.json(page([product('p1', 'Runner Sneaker', [size('a2', '42', 5)])])));
    stall('/availability/a2', '/availability/a2/events');
    renderHome();
    const region = await block('Out of stock');
    await userEvent.click(await within(region).findByRole('link', { name: /^42/ }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/availability/a2'));
  });

  it('empty: the positive "Nothing out of stock" in place of the table', async () => {
    summary();
    renderHome();
    const region = await block('Out of stock');
    expect(await within(region).findByText('Nothing out of stock')).toBeInTheDocument();
    expect(within(region).queryByRole('table')).not.toBeInTheDocument();
  });

  it('failed: one muted line + Retry, the page keeps rendering', async () => {
    summary();
    reads('/availability', forbidden);
    renderHome();
    const region = await block('Out of stock');
    expect(await within(region).findByRole('alert')).toHaveTextContent('Could not load out-of-stock products');
    expect(await within(await block('Recent activity')).findByText('No events yet')).toBeInTheDocument();
  });
});

describe('/home — recent activity (home.md §Recent activity)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('the 4 latest events as sentences ("—" for a deleted author, RN-09), relative time; countless "View all"', async () => {
    summary();
    const { urls } = reads('/availability/events', () =>
      HttpResponse.json(
        page(
          [
            event('e1'),
            event('e2', { type: 'restock', authorName: null, item: { id: 'item-e2', productName: 'Trail Jacket', sizeLabel: 'M' } }),
            event('e3', { type: 'restock', authorName: 'Luis Gil', item: { id: 'item-e3', productName: 'Tote Bag', sizeLabel: 'One size' } }),
          ],
          120,
          4,
        ),
      ),
    );
    renderHome();
    const region = await block('Recent activity');
    const table = await within(region).findByRole('table', { name: 'Recent availability events' });

    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Event', 'When']);
    expect(rowsOf(table).map((row) => Array.from(row.children).map((cell) => cell.textContent))).toEqual([
      ['Marta Vidal flagged Runner Sneaker · 42 out of stock', '2 h ago'],
      ['— restocked Trail Jacket · M', '2 h ago'],
      ['Luis Gil restocked Tote Bag', '2 h ago'],
    ]);
    expect(urls[0]!.searchParams.get('pageSize')).toBe('4');
    expect(within(region).getByRole('link', { name: 'View all' })).toHaveAttribute('href', '/activity');

    stall('/availability/item-e1', '/availability/item-e1/events');
    await userEvent.click(rowsOf(table)[0]!);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/availability/item-e1'));
  });

  it('empty: "No events yet"', async () => {
    summary();
    renderHome();
    expect(await within(await block('Recent activity')).findByText('No events yet')).toBeInTheDocument();
  });

  it('failed: one muted line, the block never blocks the page', async () => {
    summary();
    reads('/availability/events', forbidden);
    renderHome();
    const region = await block('Recent activity');
    expect(await within(region).findByRole('alert')).toHaveTextContent('Could not load recent activity');
    expect(await screen.findByText('Nothing out of stock')).toBeInTheDocument();
  });

  it('without activity:read neither the block nor its query render', async () => {
    matrix.deny.add('activity:read');
    summary();
    const { urls } = reads('/availability/events', () => HttpResponse.json(page([])));
    renderHome();
    await block('Out of stock');
    expect(screen.queryByRole('region', { name: 'Recent activity' })).not.toBeInTheDocument();
    expect(urls).toHaveLength(0);
  });
});

describe('/home — blocks & route', () => {
  it('the three blocks stack in order after the strip', async () => {    summary();
    renderHome();
    await strip();
    const blocks = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(blocks).toEqual(['Open replenishment work', 'Out of stock', 'Recent activity']);
  });

  it('the nav\'s "Home" item is active on /home', async () => {
    summary();
    renderHome();
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page');
  });

  it('platform admin without a store: the picker state, no summary request', async () => {
    const { requests } = summary();
    server.use(authMe(sessionFor('platform_admin')));
    renderAt('/home', <AppRoutes />);
    expect(await screen.findByRole('heading', { name: 'Select a store to continue' })).toBeInTheDocument();
    expect(requests).toHaveLength(0);
  });
});
