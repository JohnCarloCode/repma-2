import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { AvailabilityItem, AvailabilityItemEvent, Page } from 'shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';
import { formatDate } from '../lib/format';
import { SELECTED_STORE_KEY } from '../tenant/activeStore';
import { authMe, renderAt, sessionFor } from '../test/renderApp';
import { server } from '../test/server';

const NOW = new Date('2026-11-15T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const H = 3_600_000;
const D = 24 * H;
const STORE_A = sessionFor('employee').store!.id;

const outItem: AvailabilityItem = {
  id: 'item-42',
  sizeId: 'size-42',
  label: '42',
  sku: 'RS-42',
  isAvailable: false,
  isActive: true,
  latestEventAt: ago(9 * D),
  product: { id: 'p-runner', name: 'Runner Sneaker', imageUrl: null, categoryName: 'Footwear', isActive: true },
};
const availableItem: AvailabilityItem = { ...outItem, isAvailable: true, latestEventAt: ago(2 * D) };

const history: AvailabilityItemEvent[] = [
  { id: 'e2', type: 'out_of_stock', createdAt: ago(9 * D), authorName: 'Ana Ruiz' },
  { id: 'e1', type: 'restock', createdAt: ago(20 * D), authorName: null },
];

const envelope = <T,>(items: T[], page = 1, total = items.length): Page<T> => ({ items, page, pageSize: 20, total });

/**
 * The detail's endpoints: `GET /availability/item-42` answers `item()` (so a test
 * can change the server state mid-flow), `GET …/events` answers `events`, and
 * `POST …/events` answers `post(type)`. Every request is recorded.
 */
function detail({
  item = () => HttpResponse.json(outItem) as Response,
  events = () => HttpResponse.json(envelope(history)) as Response,
  post = (type: string) =>
    HttpResponse.json({ ...outItem, isAvailable: type === 'restock', latestEventAt: NOW.toISOString() }, { status: 201 }) as Response,
}: {
  item?: () => Response;
  events?: (url: URL) => Response;
  post?: (type: string) => Response | Promise<Response>;
} = {}) {
  const itemRequests: Request[] = [];
  const eventRequests: Request[] = [];
  const posts: { body: unknown; tenant: string | null }[] = [];
  server.use(
    http.get('*/api/v1/availability/item-42', ({ request }) => {
      itemRequests.push(request);
      return item();
    }),
    http.get('*/api/v1/availability/item-42/events', ({ request }) => {
      eventRequests.push(request);
      return events(new URL(request.url));
    }),
    http.post('*/api/v1/availability/item-42/events', async ({ request }) => {
      const body = (await request.json()) as { type: string };
      posts.push({ body, tenant: request.headers.get('x-tenant-id') });
      return post(body.type);
    }),
  );
  return { itemRequests, eventRequests, posts };
}

const location = () => screen.getByTestId('location').textContent;
const summary = () => screen.getByRole('region', { name: 'Item summary' });
const toasts = () => screen.getByRole('region', { name: 'Notifications' });

function renderDetail(
  path: Parameters<typeof renderAt>[0] = '/availability/item-42',
  role: 'manager' | 'employee' | 'platform_admin' = 'employee',
) {
  server.use(authMe(sessionFor(role)));
  return renderAt(path, <AppRoutes />);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('/availability/:id — summary and history (availability-detail.md)', () => {
  it('an out-of-stock size: h1, SKU, badge with its elapsed figure, since-line, category, thumb', async () => {
    const { itemRequests, eventRequests } = detail();
    renderDetail();

    expect(await screen.findByRole('heading', { level: 1, name: 'Runner Sneaker — 42' })).toBeInTheDocument();
    const card = summary();
    expect(within(card).getByText('RS-42')).toBeInTheDocument();
    expect(within(card).getByText('Out of stock').closest('span')).toHaveTextContent(/^Out of stock9 d$/);
    expect(within(card).getByText(`since ${formatDate(outItem.latestEventAt!)}`)).toBeInTheDocument();
    expect(within(card).getByText('Footwear')).toBeInTheDocument();
    expect(within(card).getByText('RS')).toBeInTheDocument(); // placeholder thumb
    expect(within(card).queryByText('Inactive')).not.toBeInTheDocument();

    expect(itemRequests[0]!.headers.get('x-tenant-id')).toBeNull();
    expect(new URL(itemRequests[0]!.url).search).toBe('');
    expect(new URL(eventRequests[0]!.url).search).toBe('?page=1');
  });

  it('renders the history newest first: Date, Event, User ("—" for a deleted author)', async () => {
    detail();
    renderDetail();

    const table = await screen.findByRole('table', { name: 'Event history' });
    const rows = within(table).getAllByRole('row');
    expect(within(rows[0]!).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Date', 'Event', 'User']);
    expect(rows.slice(1).map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent))).toEqual([
      [formatDate(history[0]!.createdAt), 'Out of stock', 'Ana Ruiz'],
      [formatDate(history[1]!.createdAt), 'Restocked', '—'],
    ]);
    // Immutable history: no row actions, no row destinations.
    expect(within(table).queryByRole('button')).not.toBeInTheDocument();
    expect(rows[1]).not.toHaveAttribute('tabindex');
  });

  it('an available size reads plain "Available" with "Mark out of stock"; inactive size gets the badge', async () => {
    detail({ item: () => HttpResponse.json({ ...availableItem, isActive: false }) });
    renderDetail();

    await screen.findByRole('heading', { level: 1, name: 'Runner Sneaker — 42' });
    const card = summary();
    expect(within(card).getByText('Available')).toBeInTheDocument();
    expect(within(card).queryByText('Out of stock')).not.toBeInTheDocument();
    expect(within(card).getByText('Inactive')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark out of stock' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Mark restocked' })).not.toBeInTheDocument();
  });

  it('empty history: "no events recorded", the empty state and its "Mark out of stock"', async () => {
    detail({
      item: () => HttpResponse.json({ ...availableItem, latestEventAt: null }),
      events: () => HttpResponse.json(envelope([])),
    });
    renderDetail();

    expect(await screen.findByText('No events yet. The item is available.')).toBeInTheDocument();
    expect(within(summary()).getByText('no events recorded')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Mark out of stock' })).toHaveLength(2);
    // The employee lacks `assortment:manage`: no removal even with an empty history (RF-44).
    expect(screen.queryByRole('button', { name: 'Remove from assortment' })).not.toBeInTheDocument();
  });

  it('never renders a quantity', async () => {
    detail();
    renderDetail();
    await screen.findByRole('table', { name: 'Event history' });
    expect(screen.queryByText(/quantity|units|in stock:/i)).not.toBeInTheDocument();
  });

  it('history page lives in the URL', async () => {
    const user = userEvent.setup();
    const { eventRequests } = detail({
      events: (url) => HttpResponse.json(envelope(history, Number(url.searchParams.get('page')), 45)),
    });
    renderDetail('/availability/item-42?page=2');

    await screen.findByText('Page 2 of 3');
    expect(new URL(eventRequests[0]!.url).search).toBe('?page=2');
    await user.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(location()).toBe('/availability/item-42?page=3'));
    await waitFor(() => expect(new URL(eventRequests.at(-1)!.url).search).toBe('?page=3'));
  });

  it('404 (unknown or another store\'s item): "Item not found" + "Back to availability"', async () => {
    detail({
      item: () => HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'Item not found' } }, { status: 404 }),
      events: () => HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'Item not found' } }, { status: 404 }),
    });
    renderDetail();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Item not found');
    expect(within(alert).getByRole('link', { name: 'Back to availability' })).toHaveAttribute('href', '/availability');
    expect(screen.queryByRole('button', { name: /Mark/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Event history' })).not.toBeInTheDocument();
  });

  it('back returns to the list with its URL state; plain /availability on a deep link', async () => {
    detail();
    renderDetail({ pathname: '/availability/item-42', state: { listSearch: '?search=run&page=2' } });
    expect(await screen.findByRole('link', { name: 'Back to availability' })).toHaveAttribute(
      'href',
      '/availability?search=run&page=2',
    );
  });

  it('a deep link (no router state) goes back to plain /availability', async () => {
    detail();
    renderDetail();
    expect(await screen.findByRole('link', { name: 'Back to availability' })).toHaveAttribute('href', '/availability');
  });

  it('the platform admin reads and flags the selected store (X-Tenant-Id)', async () => {
    const user = userEvent.setup();
    localStorage.setItem(SELECTED_STORE_KEY, JSON.stringify({ id: 'store-b', name: 'Store B' }));
    const { itemRequests, eventRequests, posts } = detail();
    renderDetail('/availability/item-42', 'platform_admin');

    await user.click(await screen.findByRole('button', { name: 'Mark restocked' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.tenant).toBe('store-b');
    expect(itemRequests[0]!.headers.get('x-tenant-id')).toBe('store-b');
    expect(eventRequests[0]!.headers.get('x-tenant-id')).toBe('store-b');
  });
});

describe('/availability/:id — flag flows', () => {
  it('Mark out of stock: optimistic flip, pending action, toast, then item/history/list/feed refetch', async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let serverItem: AvailabilityItem = availableItem;
    const { itemRequests, eventRequests, posts } = detail({
      item: () => HttpResponse.json(serverItem),
      post: async () => {
        await gate;
        serverItem = { ...availableItem, isAvailable: false, latestEventAt: NOW.toISOString() };
        return HttpResponse.json(serverItem, { status: 201 });
      },
    });
    const { queryClient } = renderDetail();
    // A cached list page and feed page, to watch the invalidation reach them.
    const listKey = ['store', STORE_A, 'availability', 'list', { page: 1 }];
    const feedKey = ['store', STORE_A, 'activity', { page: 1 }];
    // …and Home's summary (home.md §Flows · Open a size from the evidence block).
    const homeKey = ['store', STORE_A, 'home', 'summary'];
    queryClient.setQueryData(listKey, envelope([]));
    queryClient.setQueryData(feedKey, envelope([]));
    queryClient.setQueryData(homeKey, { openLists: 0, pendingItems: 0, outOfStock: 0 });

    await user.click(await screen.findByRole('button', { name: 'Mark out of stock' }));

    // Optimistic: the badge reads "Out of stock" at 0 elapsed, the action swapped and pending.
    expect(await within(summary()).findByText('Out of stock')).toBeInTheDocument();
    expect(within(summary()).getByText('<1 h')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark restocked' })).toBeDisabled();
    expect(posts).toEqual([{ body: { type: 'out_of_stock' }, tenant: null }]);

    const itemReads = itemRequests.length;
    const eventReads = eventRequests.length;
    release();

    expect(await within(toasts()).findByText('Marked as out of stock')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mark restocked' })).toBeEnabled());
    await waitFor(() => expect(itemRequests.length).toBeGreaterThan(itemReads));
    await waitFor(() => expect(eventRequests.length).toBeGreaterThan(eventReads));
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(feedKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(homeKey)?.isInvalidated).toBe(true);
    expect(within(summary()).getByText('Out of stock')).toBeInTheDocument();
  });

  it('Mark restocked: the mirror flow', async () => {
    const user = userEvent.setup();
    let serverItem: AvailabilityItem = outItem;
    const { posts } = detail({
      item: () => HttpResponse.json(serverItem),
      post: () => {
        serverItem = { ...outItem, isAvailable: true, latestEventAt: NOW.toISOString() };
        return HttpResponse.json(serverItem, { status: 201 });
      },
    });
    renderDetail();

    await user.click(await screen.findByRole('button', { name: 'Mark restocked' }));
    expect(await within(summary()).findByText('Available')).toBeInTheDocument();
    expect(await within(toasts()).findByText('Marked as restocked')).toBeInTheDocument();
    expect(posts.map((p) => p.body)).toEqual([{ type: 'restock' }]);
    expect(await screen.findByRole('button', { name: 'Mark out of stock' })).toBeEnabled();
  });

  it('an error reverts the optimistic flip and toasts the API message', async () => {
    const user = userEvent.setup();
    // The POST is held until the optimistic state has been asserted, so the check never races the response.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    detail({
      item: () => HttpResponse.json(availableItem),
      post: async () => {
        await gate;
        return HttpResponse.json({ error: { code: 'FORBIDDEN', message: 'Not allowed here' } }, { status: 403 });
      },
    });
    renderDetail();

    await user.click(await screen.findByRole('button', { name: 'Mark out of stock' }));
    expect(await within(summary()).findByText('Out of stock')).toBeInTheDocument(); // optimistic
    release();

    expect(await screen.findByRole('alert')).toHaveTextContent('Not allowed here');
    expect(within(summary()).getByText('Available')).toBeInTheDocument();
    expect(within(summary()).queryByText('Out of stock')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark out of stock' })).toBeEnabled();
  });

  it('409 (RN-14 — another user flagged first): revert, API message toast, refetch settles on the server state', async () => {
    const user = userEvent.setup();
    // This client still shows "Available"; meanwhile someone else flagged the size out.
    let serverItem: AvailabilityItem = availableItem;
    const { itemRequests } = detail({
      item: () => HttpResponse.json(serverItem),
      post: () => {
        serverItem = { ...outItem, latestEventAt: ago(5 * 60_000) };
        return HttpResponse.json(
          { error: { code: 'CONFLICT', message: 'This size is already out of stock' } },
          { status: 409 },
        );
      },
    });
    renderDetail();

    await user.click(await screen.findByRole('button', { name: 'Mark out of stock' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This size is already out of stock');
    await waitFor(() => expect(itemRequests.length).toBeGreaterThan(1));
    // Settled on the winner's event: out of stock since 5 min ago, the next action is "Mark restocked".
    expect(await within(summary()).findByText('since 5 min ago')).toBeInTheDocument();
    expect(within(summary()).getByText('Out of stock')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Mark restocked' })).toBeEnabled();
    expect(within(toasts()).queryByText('Marked as out of stock')).not.toBeInTheDocument();
  });
});

describe('/availability/:id — remove from assortment (RF-44, RN-13)', () => {
  const freshItem: AvailabilityItem = { ...availableItem, latestEventAt: null };
  const noHistory = () => HttpResponse.json(envelope<AvailabilityItemEvent>([])) as Response;
  const removeButton = () => screen.queryByRole('button', { name: 'Remove from assortment' });

  /** `DELETE /availability/item-42` answers `respond()`; each call's X-Tenant-Id is recorded. */
  function onDelete(respond: () => Response | Promise<Response>) {
    const deletes: (string | null)[] = [];
    server.use(
      http.delete('*/api/v1/availability/item-42', ({ request }) => {
        deletes.push(request.headers.get('x-tenant-id'));
        return respond();
      }),
    );
    return deletes;
  }

  it('a manager sees the ghost action only while the history is empty', async () => {
    detail({ item: () => HttpResponse.json(freshItem), events: noHistory });
    renderDetail('/availability/item-42', 'manager');
    expect(await screen.findByRole('button', { name: 'Remove from assortment' })).toBeEnabled();
  });

  it('a manager on an item with history: no removal', async () => {
    detail();
    renderDetail('/availability/item-42', 'manager');
    await screen.findByRole('table', { name: 'Event history' });
    expect(removeButton()).not.toBeInTheDocument();
  });

  it('confirm → DELETE → toast, back to the list (its URL state kept), availability queries invalidated, Home untouched', async () => {
    const user = userEvent.setup();
    detail({ item: () => HttpResponse.json(freshItem), events: noHistory });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const deletes = onDelete(async () => {
      await gate;
      return new HttpResponse(null, { status: 204 });
    });
    const { queryClient } = renderDetail(
      { pathname: '/availability/item-42', state: { listSearch: '?search=run' } },
      'manager',
    );
    const listKey = ['store', STORE_A, 'availability', 'list', { page: 1 }];
    const homeKey = ['store', STORE_A, 'home', 'summary'];
    queryClient.setQueryData(listKey, envelope([]));
    queryClient.setQueryData(homeKey, { openLists: 0, pendingItems: 0, outOfStock: 0 });

    await user.click(await screen.findByRole('button', { name: 'Remove from assortment' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove from assortment' });
    expect(dialog).toHaveTextContent('Remove “Runner Sneaker — 42” from the assortment?');
    expect(deletes).toHaveLength(0); // nothing happens before the confirm
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));

    expect(await within(dialog).findByRole('button', { name: 'Removing…' })).toBeDisabled();
    release();

    expect(await within(toasts()).findByText('Removed from assortment')).toBeInTheDocument();
    await waitFor(() => expect(location()).toBe('/availability?search=run'));
    expect(deletes).toEqual([null]);
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(homeKey)?.isInvalidated).toBe(false);
  });

  it('cancel closes the modal without a request', async () => {
    const user = userEvent.setup();
    detail({ item: () => HttpResponse.json(freshItem), events: noHistory });
    const deletes = onDelete(() => new HttpResponse(null, { status: 204 }));
    renderDetail('/availability/item-42', 'manager');

    await user.click(await screen.findByRole('button', { name: 'Remove from assortment' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(deletes).toHaveLength(0);
    expect(location()).toBe('/availability/item-42');
  });

  it('409 (an event appeared meanwhile): API message toast, item + history refetched, the action disappears', async () => {
    const user = userEvent.setup();
    let serverItem: AvailabilityItem = freshItem;
    let serverEvents: AvailabilityItemEvent[] = [];
    const { itemRequests, eventRequests } = detail({
      item: () => HttpResponse.json(serverItem),
      events: () => HttpResponse.json(envelope(serverEvents)),
    });
    onDelete(() => {
      serverItem = { ...outItem, latestEventAt: ago(5 * 60_000) };
      serverEvents = [{ id: 'e9', type: 'out_of_stock', createdAt: ago(5 * 60_000), authorName: 'Ana Ruiz' }];
      return HttpResponse.json(
        { error: { code: 'CONFLICT', message: 'This size has availability history and cannot be removed' } },
        { status: 409 },
      );
    });
    renderDetail('/availability/item-42', 'manager');

    await user.click(await screen.findByRole('button', { name: 'Remove from assortment' }));
    const itemReads = itemRequests.length;
    const eventReads = eventRequests.length;
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This size has availability history and cannot be removed');
    await waitFor(() => expect(itemRequests.length).toBeGreaterThan(itemReads));
    await waitFor(() => expect(eventRequests.length).toBeGreaterThan(eventReads));
    expect(await screen.findByRole('table', { name: 'Event history' })).toBeInTheDocument();
    expect(removeButton()).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(location()).toBe('/availability/item-42');
  });

  it('409 (size on a replenishment list): toast, the item stays and so does the action', async () => {
    const user = userEvent.setup();
    detail({ item: () => HttpResponse.json(freshItem), events: noHistory });
    onDelete(() =>
      HttpResponse.json(
        { error: { code: 'CONFLICT', message: 'This size is on a replenishment list and cannot be removed' } },
        { status: 409 },
      ),
    );
    renderDetail('/availability/item-42', 'manager');

    await user.click(await screen.findByRole('button', { name: 'Remove from assortment' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This size is on a replenishment list and cannot be removed',
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(removeButton()).toBeInTheDocument();
    expect(location()).toBe('/availability/item-42');
  });

  it('404 (already removed elsewhere): toast, the refetch lands on "Item not found"', async () => {
    const user = userEvent.setup();
    let gone = false;
    const notFound = () =>
      HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'Item not found' } }, { status: 404 }) as Response;
    detail({
      item: () => (gone ? notFound() : HttpResponse.json(freshItem)),
      events: () => (gone ? notFound() : noHistory()),
    });
    onDelete(() => {
      gone = true;
      return notFound();
    });
    renderDetail('/availability/item-42', 'manager');

    await user.click(await screen.findByRole('button', { name: 'Remove from assortment' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }));

    expect(await within(toasts()).findByText('Item not found')).toBeInTheDocument();
    // The page's own 404 state: its "Back to availability" joins the header's back link.
    await waitFor(() => expect(screen.getAllByRole('link', { name: 'Back to availability' })).toHaveLength(2));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Event history' })).not.toBeInTheDocument());
    expect(removeButton()).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mark/ })).not.toBeInTheDocument();
  });

  it('the platform admin removes from the selected store (X-Tenant-Id)', async () => {
    const user = userEvent.setup();
    localStorage.setItem(SELECTED_STORE_KEY, JSON.stringify({ id: 'store-b', name: 'Store B' }));
    detail({ item: () => HttpResponse.json(freshItem), events: noHistory });
    const deletes = onDelete(() => new HttpResponse(null, { status: 204 }));
    renderDetail('/availability/item-42', 'platform_admin');

    await user.click(await screen.findByRole('button', { name: 'Remove from assortment' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(location()).toBe('/availability'));
    expect(deletes).toEqual(['store-b']);
  });
});
