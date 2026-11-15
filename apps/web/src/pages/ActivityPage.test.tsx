import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { AvailabilityFeedEvent, Page } from 'shared';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from '../App';
import { SELECTED_STORE_KEY } from '../tenant/activeStore';
import { authMe, renderAt, sessionFor } from '../test/renderApp';
import { server } from '../test/server';

const events: AvailabilityFeedEvent[] = [
  {
    id: 'e1',
    type: 'out_of_stock',
    createdAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    authorName: 'Ana Ruiz',
    item: { id: 'i1', productName: 'Nike Air Max', sizeLabel: '42' },
  },
  {
    id: 'e2',
    type: 'restock',
    createdAt: new Date(2026, 9, 3, 9, 5).toISOString(),
    authorName: null,
    item: { id: 'i2', productName: 'Tote bag', sizeLabel: 'One size' },
  },
];

const envelope = (items: AvailabilityFeedEvent[], page = 1, total = items.length): Page<AvailabilityFeedEvent> => ({
  items,
  page,
  pageSize: 20,
  total,
});

/** The feed endpoint, answering `respond(url)` and recording every request. */
function feed(respond: (url: URL) => Response | Promise<Response> = () => HttpResponse.json(envelope(events))) {
  const requests: Request[] = [];
  server.use(
    http.get('*/api/v1/availability/events', ({ request }) => {
      requests.push(request);
      return respond(new URL(request.url));
    }),
  );
  const lastUrl = () => new URL(requests.at(-1)!.url);
  return { requests, lastUrl };
}

const location = () => screen.getByTestId('location').textContent;
const fromInput = () => screen.getByLabelText('From');
const toInput = () => screen.getByLabelText('To');

function renderActivity(path = '/activity', role: 'manager' | 'employee' | 'platform_admin' = 'employee') {
  server.use(authMe(sessionFor(role)));
  renderAt(path, <AppRoutes />);
}

describe('/activity — feed (activity.md)', () => {
  it('renders the events newest-first as the API returns them, with the data conventions', async () => {
    const { requests } = feed();
    renderActivity();

    const table = await screen.findByRole('table', { name: 'Availability events' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent))).toEqual([
      ['Nike Air Max — 42', 'Out of stock', 'Ana Ruiz', '2 h ago'],
      ['Tote bag', 'Restocked', '—', '03/10/2026 09:05'],
    ]);
    expect(screen.getByText('Store A · 2 events')).toBeInTheDocument();
    expect(new URL(requests[0]!.url).search).toBe('?page=1');
    expect(requests[0]!.headers.get('x-tenant-id')).toBeNull();
  });

  it("a row opens its item's detail (/availability/:id)", async () => {
    // The detail's own reads (registered first: `feed()` must win for `/availability/events`).
    const notFound = () =>
      HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'Item not found' } }, { status: 404 });
    server.use(http.get('*/api/v1/availability/:id', notFound), http.get('*/api/v1/availability/:id/events', notFound));
    feed();
    renderActivity();
    const cell = await screen.findByRole('cell', { name: 'Nike Air Max — 42' });
    await userEvent.click(cell);
    expect(location()).toBe('/availability/i1');
    expect(await screen.findByText('Item not found')).toBeInTheDocument();
  });

  it('a manager sees the same store feed and header', async () => {
    feed(() => HttpResponse.json(envelope(events.slice(0, 1))));
    renderActivity('/activity', 'manager');
    expect(await screen.findByText('Store A · 1 event')).toBeInTheDocument();
  });

  it('the platform admin reads the selected store: its name in the header, X-Tenant-Id on the call', async () => {
    localStorage.setItem(SELECTED_STORE_KEY, JSON.stringify({ id: 'store-b', name: 'Store B' }));
    const { requests } = feed(() => HttpResponse.json(envelope(events, 1, 42)));
    renderActivity('/activity', 'platform_admin');

    expect(await screen.findByText('Store B · 42 events')).toBeInTheDocument();
    expect(requests[0]!.headers.get('x-tenant-id')).toBe('store-b');
  });
});

describe('/activity — date filters', () => {
  it('sends the URL days as local-midnight bounds: From = start of day, To = end of day', async () => {
    const { lastUrl } = feed();
    renderActivity('/activity?from=2026-11-01&to=2026-11-03');
    await screen.findByRole('table');

    expect(fromInput()).toHaveValue('2026-11-01');
    expect(toInput()).toHaveValue('2026-11-03');
    const from = new Date(lastUrl().searchParams.get('from')!);
    const to = new Date(lastUrl().searchParams.get('to')!);
    expect([from.getFullYear(), from.getMonth(), from.getDate(), from.getHours(), from.getMinutes()]).toEqual([
      2026, 10, 1, 0, 0,
    ]);
    expect([to.getDate(), to.getHours(), to.getMinutes(), to.getSeconds(), to.getMilliseconds()]).toEqual([
      3, 23, 59, 59, 999,
    ]);
    expect(lastUrl().searchParams.get('from')).toBe(new Date(2026, 10, 1).toISOString());
  });

  it('a single bound sends only that param', async () => {
    const { lastUrl } = feed();
    renderActivity('/activity?to=2026-11-03');
    await screen.findByRole('table');
    expect(lastUrl().searchParams.has('from')).toBe(false);
    expect(lastUrl().searchParams.get('to')).toBe(new Date(2026, 10, 3, 23, 59, 59, 999).toISOString());
  });

  it('changing a date refetches page 1 with the new bound, held in the URL', async () => {
    const { lastUrl } = feed();
    renderActivity('/activity?page=2');
    await screen.findByRole('table');

    fireEvent.change(fromInput(), { target: { value: '2026-11-05' } });
    await waitFor(() => expect(location()).toBe('/activity?from=2026-11-05'));
    await waitFor(() => expect(lastUrl().searchParams.get('page')).toBe('1'));
    expect(lastUrl().searchParams.get('from')).toBe(new Date(2026, 10, 5).toISOString());
  });

  it('typing the year digit by digit filters only once the year is complete', async () => {
    const { requests, lastUrl } = feed();
    renderActivity();
    await screen.findByRole('table');
    const before = requests.length;

    // What the native input reports while the year is typed by keyboard.
    for (const year of ['0002', '0020', '0202']) {
      fireEvent.change(fromInput(), { target: { value: `${year}-11-12` } });
      expect(fromInput()).toHaveValue(`${year}-11-12`);
    }
    expect(location()).toBe('/activity');
    expect(requests).toHaveLength(before);

    fireEvent.change(fromInput(), { target: { value: '2026-11-12' } });
    await waitFor(() => expect(location()).toBe('/activity?from=2026-11-12'));
    await waitFor(() => expect(lastUrl().searchParams.get('from')).toBe(new Date(2026, 10, 12).toISOString()));
  });

  it('leaving the field with an unfinished year restores the applied date', async () => {
    feed();
    renderActivity('/activity?from=2026-11-01');
    await screen.findByRole('table');

    fireEvent.change(fromInput(), { target: { value: '0002-11-12' } });
    fireEvent.blur(fromInput());
    expect(fromInput()).toHaveValue('2026-11-01');
    expect(location()).toBe('/activity?from=2026-11-01');
  });

  it('"Clear" right after typing a date empties that field too (blur and clear in one click)', async () => {
    const user = userEvent.setup();
    feed();
    renderActivity();
    await screen.findByRole('table');

    await user.click(toInput());
    fireEvent.change(toInput(), { target: { value: '2026-11-06' } });
    await waitFor(() => expect(location()).toBe('/activity?to=2026-11-06'));
    await user.click(within(screen.getByRole('search')).getByRole('button', { name: 'Clear' }));

    expect(location()).toBe('/activity');
    expect(toInput()).toHaveValue('');
  });

  it('"From" later than "To" swaps them instead of querying an empty range', async () => {
    const { lastUrl } = feed();
    renderActivity('/activity?to=2026-11-03');
    await screen.findByRole('table');

    fireEvent.change(fromInput(), { target: { value: '2026-11-10' } });
    await waitFor(() => expect(location()).toBe('/activity?to=2026-11-10&from=2026-11-03'));
    expect(fromInput()).toHaveValue('2026-11-03');
    expect(toInput()).toHaveValue('2026-11-10');
    await waitFor(() => expect(lastUrl().searchParams.get('from')).toBe(new Date(2026, 10, 3).toISOString()));
    expect(lastUrl().searchParams.get('to')).toBe(new Date(2026, 10, 10, 23, 59, 59, 999).toISOString());
  });

  it('an inverted range in a shared URL is queried in order', async () => {
    const { lastUrl } = feed();
    renderActivity('/activity?from=2026-11-10&to=2026-11-03');
    await screen.findByRole('table');
    expect(lastUrl().searchParams.get('from')).toBe(new Date(2026, 10, 3).toISOString());
    expect(lastUrl().searchParams.get('to')).toBe(new Date(2026, 10, 10, 23, 59, 59, 999).toISOString());
  });

  it('a malformed day in the URL is ignored, never sent', async () => {
    const { lastUrl } = feed();
    renderActivity('/activity?from=yesterday');
    await screen.findByRole('table');
    expect(lastUrl().search).toBe('?page=1');
    expect(fromInput()).toHaveValue('');
  });

  it('"Clear" resets both dates and the page; it shows only with a filter set', async () => {
    const user = userEvent.setup();
    feed();
    renderActivity('/activity?from=2026-11-01&to=2026-11-03&page=2');
    const band = await screen.findByRole('search');

    await user.click(within(band).getByRole('button', { name: 'Clear' }));
    expect(location()).toBe('/activity');
    expect(fromInput()).toHaveValue('');
    expect(within(band).queryByRole('button', { name: 'Clear' })).toBeNull();
  });
});

describe('/activity — states and pagination', () => {
  it('shows the skeleton while the feed loads, and no subtitle yet', async () => {
    let resolve!: () => void;
    const answered = new Promise<void>((r) => (resolve = r));
    feed(async () => {
      await answered;
      return HttpResponse.json(envelope(events));
    });
    renderActivity();

    await screen.findByRole('heading', { name: 'Activity' });
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.queryByText(/events$/)).toBeNull();
    resolve();
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull();
  });

  it('no events and no filters: "No events yet"', async () => {
    feed(() => HttpResponse.json(envelope([])));
    renderActivity();
    expect(await screen.findByText('No events yet')).toBeInTheDocument();
    expect(screen.getByText('Store A · 0 events')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
  });

  it('no events in the filtered period: "No events in this period" with a Clear action', async () => {
    const user = userEvent.setup();
    feed(() => HttpResponse.json(envelope([])));
    renderActivity('/activity?from=2026-11-01');

    expect(await screen.findByText('No events in this period')).toBeInTheDocument();
    const clears = screen.getAllByRole('button', { name: 'Clear' });
    await user.click(clears.at(-1)!);
    expect(location()).toBe('/activity');
    expect(await screen.findByText('No events yet')).toBeInTheDocument();
  });

  it('an API error shows the message and retries', async () => {
    const user = userEvent.setup();
    let calls = 0;
    feed(() => {
      calls += 1;
      return calls === 1
        ? HttpResponse.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }, { status: 429 })
        : HttpResponse.json(envelope(events));
    });
    renderActivity();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Too many requests');
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('paginates from the envelope, keeping the filters', async () => {
    const user = userEvent.setup();
    const { lastUrl } = feed((url) => HttpResponse.json(envelope(events, Number(url.searchParams.get('page')), 45)));
    renderActivity('/activity?from=2026-11-01');
    await screen.findByText('Page 1 of 3');

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(location()).toBe('/activity?from=2026-11-01&page=2');
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
    expect(lastUrl().searchParams.get('page')).toBe('2');
    expect(lastUrl().searchParams.has('from')).toBe(true);
  });

  it('a page past the end recovers to the last page with events', async () => {
    feed((url) => {
      const page = Number(url.searchParams.get('page'));
      return HttpResponse.json(envelope(page > 1 ? [] : events, page, 2));
    });
    renderActivity('/activity?page=5');
    await waitFor(() => expect(location()).toBe('/activity'));
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });
});
