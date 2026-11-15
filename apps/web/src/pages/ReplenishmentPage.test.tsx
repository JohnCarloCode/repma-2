import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router';
import type { Page, ReplenishmentList, ReplenishmentListSummary } from 'shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';
import { SELECTED_STORE_KEY } from '../tenant/activeStore';
import { ReplenishmentPage } from './ReplenishmentPage';
import { authMe, renderAt, sessionFor } from '../test/renderApp';
import { server } from '../test/server';

const HOUR = 3_600_000;

const lists: ReplenishmentListSummary[] = [
  {
    id: 'l1',
    name: 'Weekly replenishment',
    status: 'processing',
    createdAt: new Date(Date.now() - 4 * HOUR).toISOString(),
    creatorName: 'Ana Ruiz',
    itemCount: 14,
    productCount: 8,
    doneCount: 6,
  },
  {
    id: 'l2',
    name: 'Saturday restock',
    status: 'draft',
    createdAt: new Date(2026, 9, 3, 9, 5).toISOString(),
    creatorName: null,
    itemCount: 1,
    productCount: 1,
    doneCount: 0,
  },
  {
    id: 'l3',
    name: 'Empty draft',
    status: 'draft',
    createdAt: new Date(2026, 9, 2, 8, 0).toISOString(),
    creatorName: 'Leo Martín',
    itemCount: 0,
    productCount: 0,
    doneCount: 0,
  },
  {
    id: 'l4',
    name: 'Finished run',
    status: 'done',
    createdAt: new Date(2026, 9, 1, 18, 30).toISOString(),
    creatorName: 'Ana Ruiz',
    itemCount: 5,
    productCount: 2,
    doneCount: 5,
  },
];

const envelope = (items: ReplenishmentListSummary[], page = 1, total = items.length): Page<ReplenishmentListSummary> => ({
  items,
  page,
  pageSize: 20,
  total,
});

/** The lists endpoint, answering `respond(url)` and recording every request. */
function endpoint(respond: (url: URL) => Response | Promise<Response> = () => HttpResponse.json(envelope(lists))) {
  const requests: Request[] = [];
  server.use(
    http.get('*/api/v1/replenishment-lists', ({ request }) => {
      requests.push(request);
      return respond(new URL(request.url));
    }),
  );
  const lastParams = () => new URL(requests.at(-1)!.url).searchParams;
  return { requests, lastParams };
}

const location = () => screen.getByTestId('location').textContent;
const grid = () => screen.findByRole('list', { name: 'Replenishment lists' });
const card = (name: string) => screen.getByRole('link', { name }).closest('li')!;
const dateSelect = () => screen.getByRole('combobox', { name: 'Date' });
const statusButton = () => screen.getByRole('button', { name: /Status/ });

function renderPage(path = '/replenishment', role: 'manager' | 'employee' | 'platform_admin' = 'employee') {
  server.use(authMe(sessionFor(role)));
  renderAt(path, <AppRoutes />);
}

afterEach(() => vi.useRealTimers());

describe('/replenishment — cards (replenishment.md §Content)', () => {
  it('renders one card per list with badge, name, size line, progress and provenance', async () => {
    const { requests } = endpoint();
    renderPage();
    const cards = within(await grid()).getAllByRole('listitem');
    expect(cards).toHaveLength(4);

    const weekly = card('Weekly replenishment');
    expect(within(weekly).getByText('In progress')).toBeInTheDocument();
    expect(within(weekly).getByRole('heading', { level: 2, name: 'Weekly replenishment' })).toBeInTheDocument();
    expect(within(weekly).getByText('8 products · 14 sizes')).toBeInTheDocument();
    expect(within(weekly).getByText('6/14')).toBeInTheDocument();
    expect(within(weekly).getByText('Ana Ruiz')).toBeInTheDocument();
    expect(within(weekly).getByText('4 h ago')).toBeInTheDocument();

    const saturday = card('Saturday restock');
    expect(within(saturday).getByText('Draft')).toBeInTheDocument();
    expect(within(saturday).getByText('1 product · 1 size')).toBeInTheDocument();
    expect(within(saturday).getByText('0/1')).toBeInTheDocument();
    expect(within(saturday).getByText('—')).toBeInTheDocument(); // deleted creator (RN-09)
    expect(within(saturday).getByText('03/10/2026 09:05')).toBeInTheDocument();

    expect(screen.getByText('Store A · 4 lists')).toBeInTheDocument();
    expect(new URL(requests[0]!.url).search).toBe('?page=1');
    expect(requests[0]!.headers.get('x-tenant-id')).toBeNull();
  });

  it('an empty list reads "Empty" with no fraction; a done list shows no fraction', async () => {
    endpoint();
    renderPage();
    await grid();

    const empty = card('Empty draft');
    expect(within(empty).getByText('Empty')).toBeInTheDocument();
    expect(within(empty).queryByText(/^\d+\/\d+$/)).toBeNull();

    const done = card('Finished run');
    expect(within(done).getByText('Done')).toBeInTheDocument();
    expect(within(done).getByText('2 products · 5 sizes')).toBeInTheDocument();
    expect(within(done).queryByText('5/5')).toBeNull();
  });

  it('the card is one link named by the list, holding the chevron; it opens /replenishment/:id and back keeps the filters', async () => {
    endpoint();
    server.use(
      http.get('*/api/v1/replenishment-lists/l1', () =>
        HttpResponse.json({ ...lists[0]!, notes: null, items: [] } satisfies ReplenishmentList),
      ),
    );
    renderPage('/replenishment?status=processing');
    await grid();

    const link = screen.getByRole('link', { name: 'Weekly replenishment' });
    expect(link).toHaveAttribute('href', '/replenishment/l1');
    expect(within(link).getByText('chevron_right')).toBeInTheDocument();
    // The chevron is a signpost, not a second control.
    expect(within(card('Weekly replenishment')).getAllByRole('link')).toHaveLength(1);
    expect(within(link).queryByRole('button')).toBeNull();

    await userEvent.click(link);
    expect(await screen.findByRole('heading', { level: 1, name: 'Weekly replenishment' })).toBeInTheDocument();
    expect(location()).toBe('/replenishment/l1');

    await userEvent.click(screen.getByRole('link', { name: 'Back to replenishment' }));
    await waitFor(() => expect(location()).toBe('/replenishment?status=processing'));
  });

  it('the delete button is a separate target beside the link: it opens the confirm, never the list', async () => {
    endpoint();
    renderPage();
    await grid();

    const remove = within(card('Weekly replenishment')).getByRole('button', { name: 'Delete list “Weekly replenishment”' });
    expect(screen.getByRole('link', { name: 'Weekly replenishment' })).not.toContainElement(remove);
    await userEvent.click(remove);
    expect(await screen.findByRole('dialog', { name: 'Delete list' })).toBeInTheDocument();
    expect(location()).toBe('/replenishment');
  });

  it('the platform admin reads the selected store: its name in the header, X-Tenant-Id on the call', async () => {
    localStorage.setItem(SELECTED_STORE_KEY, JSON.stringify({ id: 'store-b', name: 'Store B' }));
    const { requests } = endpoint(() => HttpResponse.json(envelope(lists.slice(0, 1), 1, 1)));
    renderPage('/replenishment', 'platform_admin');

    expect(await screen.findByText('Store B · 1 list')).toBeInTheDocument();
    expect(requests[0]!.headers.get('x-tenant-id')).toBe('store-b');
  });

  it('the nav item is active on the page', async () => {
    endpoint();
    renderPage('/replenishment', 'manager');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Replenishment' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('/replenishment — filters', () => {
  it('URL filters are sent together on one request', async () => {
    const { lastParams } = endpoint();
    renderPage('/replenishment?search=week&status=processing,draft&page=2');
    await grid();
    expect(Object.fromEntries(lastParams())).toEqual({ page: '2', status: 'draft,processing', search: 'week' });
    expect(statusButton()).toHaveTextContent('Draft, In progress');
  });

  it('search is debounced and resets to page 1', async () => {
    const { lastParams } = endpoint();
    renderPage('/replenishment?page=2');
    await grid();

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), 'sat');
    await waitFor(() => expect(location()).toBe('/replenishment?search=sat'));
    await waitFor(() => expect(lastParams().get('search')).toBe('sat'));
    expect(lastParams().get('page')).toBe('1');
  });

  it('status is a multi-select: picks accumulate, "All" clears, all three collapse to "All"', async () => {
    const user = userEvent.setup();
    const { lastParams } = endpoint();
    renderPage();
    await grid();
    expect(statusButton()).toHaveTextContent('All statuses');

    await user.click(statusButton());
    await user.click(screen.getByRole('option', { name: 'In progress' }));
    await waitFor(() => expect(location()).toBe('/replenishment?status=processing'));
    await user.click(screen.getByRole('option', { name: 'Draft' }));
    await waitFor(() => expect(location()).toBe('/replenishment?status=draft%2Cprocessing'));
    await waitFor(() => expect(lastParams().get('status')).toBe('draft,processing'));
    expect(screen.getByRole('option', { name: 'All' })).toHaveAttribute('aria-selected', 'false');

    await user.click(screen.getByRole('option', { name: 'All' }));
    await waitFor(() => expect(location()).toBe('/replenishment'));
    await waitFor(() => expect(lastParams().has('status')).toBe(false));
    expect(screen.getByRole('option', { name: 'All' })).toHaveAttribute('aria-selected', 'true');

    for (const name of ['Draft', 'In progress', 'Done']) await user.click(screen.getByRole('option', { name }));
    await waitFor(() => expect(location()).toBe('/replenishment'));
  });

  it('unknown statuses in the URL are ignored, never sent', async () => {
    const { lastParams } = endpoint();
    renderPage('/replenishment?status=archived,done');
    await grid();
    expect(lastParams().get('status')).toBe('done');
  });

  it('date presets resolve to local midnight at fetch time and send only `from`', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 15, 13, 45));
    const { lastParams } = endpoint();
    renderPage();
    await grid();

    fireEvent.change(dateSelect(), { target: { value: 'today' } });
    await waitFor(() => expect(location()).toBe('/replenishment?date=today'));
    await waitFor(() => expect(lastParams().get('from')).toBe(new Date(2026, 10, 15).toISOString()));
    expect(lastParams().has('to')).toBe(false);

    fireEvent.change(dateSelect(), { target: { value: '7d' } });
    await waitFor(() => expect(lastParams().get('from')).toBe(new Date(2026, 10, 9).toISOString()));

    fireEvent.change(dateSelect(), { target: { value: '30d' } });
    await waitFor(() => expect(lastParams().get('from')).toBe(new Date(2026, 9, 17).toISOString()));

    fireEvent.change(dateSelect(), { target: { value: '' } });
    await waitFor(() => expect(location()).toBe('/replenishment'));
    await waitFor(() => expect(lastParams().has('from')).toBe(false));
  });

  it('"Custom…" reveals From/To, which send local-day bounds and swap when inverted', async () => {
    const { lastParams } = endpoint();
    renderPage();
    await grid();
    expect(screen.queryByLabelText('From')).toBeNull();

    fireEvent.change(dateSelect(), { target: { value: 'custom' } });
    await waitFor(() => expect(location()).toBe('/replenishment?date=custom'));
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-03' } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-10' } });

    await waitFor(() => expect(location()).toBe('/replenishment?date=custom&to=2026-11-10&from=2026-11-03'));
    expect(screen.getByLabelText('From')).toHaveValue('2026-11-03');
    await waitFor(() => expect(lastParams().get('from')).toBe(new Date(2026, 10, 3).toISOString()));
    expect(lastParams().get('to')).toBe(new Date(2026, 10, 10, 23, 59, 59, 999).toISOString());

    // A preset replaces the custom days.
    fireEvent.change(dateSelect(), { target: { value: 'today' } });
    await waitFor(() => expect(location()).toBe('/replenishment?date=today'));
    expect(screen.queryByLabelText('From')).toBeNull();
  });

  it('an inverted custom range in a shared URL is queried in order; days without "custom" are ignored', async () => {
    const { lastParams } = endpoint();
    renderPage('/replenishment?date=custom&from=2026-11-10&to=2026-11-03');
    await grid();
    expect(dateSelect()).toHaveValue('custom');
    expect(lastParams().get('from')).toBe(new Date(2026, 10, 3).toISOString());
    expect(lastParams().get('to')).toBe(new Date(2026, 10, 10, 23, 59, 59, 999).toISOString());
  });
});

describe('/replenishment — states and pagination', () => {
  it('shows skeleton cards while loading, and no subtitle yet', async () => {
    let resolve!: () => void;
    const answered = new Promise<void>((r) => (resolve = r));
    endpoint(async () => {
      await answered;
      return HttpResponse.json(envelope(lists));
    });
    renderPage();

    await screen.findByRole('heading', { name: 'Replenishment' });
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.queryByText(/lists$/)).toBeNull();
    resolve();
    expect(await grid()).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull();
  });

  it('no lists and no filters: "No replenishment lists yet"', async () => {
    endpoint(() => HttpResponse.json(envelope([])));
    renderPage();
    expect(await screen.findByText('No replenishment lists yet')).toBeInTheDocument();
    expect(screen.getByText('Store A · 0 lists')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
  });

  it('filters matching nothing: "No results for these filters" + "Clear filters"', async () => {
    endpoint(() => HttpResponse.json(envelope([])));
    renderPage('/replenishment?status=done&date=7d&page=2');

    expect(await screen.findByText('No results for these filters')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(location()).toBe('/replenishment');
    expect(await screen.findByText('No replenishment lists yet')).toBeInTheDocument();
  });

  it('an API error shows the message and retries', async () => {
    let calls = 0;
    endpoint(() => {
      calls += 1;
      return calls === 1
        ? HttpResponse.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }, { status: 429 })
        : HttpResponse.json(envelope(lists));
    });
    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Too many requests');
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await grid()).toBeInTheDocument();
  });

  it('paginates from the envelope, keeping the filters', async () => {
    const { lastParams } = endpoint((url) => HttpResponse.json(envelope(lists, Number(url.searchParams.get('page')), 45)));
    renderPage('/replenishment?status=draft');
    await screen.findByText('Page 1 of 3');

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(location()).toBe('/replenishment?status=draft&page=2');
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
    expect(lastParams().get('page')).toBe('2');
    expect(lastParams().get('status')).toBe('draft');
  });

  it('a page past the end recovers to the last page with lists', async () => {
    endpoint((url) => {
      const page = Number(url.searchParams.get('page'));
      return HttpResponse.json(envelope(page > 1 ? [] : lists, page, 4));
    });
    renderPage('/replenishment?page=5');
    await waitFor(() => expect(location()).toBe('/replenishment'));
    expect(await grid()).toBeInTheDocument();
  });
});

const created: ReplenishmentList = {
  id: 'new-list',
  name: 'Monday run',
  status: 'draft',
  createdAt: new Date().toISOString(),
  creatorName: 'Test User',
  notes: null,
  items: [],
};

/** `POST /replenishment-lists`, answering `respond(body)` and recording every body sent. */
function createEndpoint(respond: () => Response = () => HttpResponse.json(created, { status: 201 })) {
  const bodies: unknown[] = [];
  server.use(
    http.post('*/api/v1/replenishment-lists', async ({ request }) => {
      bodies.push(await request.json());
      return respond();
    }),
  );
  return bodies;
}

/** The page plus a stand-in for the detail route, so the post-create navigation is observable without the detail's own fetch. */
function renderWithDetail() {
  server.use(authMe(sessionFor('employee')));
  renderAt(
    '/replenishment',
    <Routes>
      <Route path="/replenishment" element={<ReplenishmentPage />} />
      <Route path="/replenishment/:id" element={<p>Detail stub</p>} />
    </Routes>,
  );
}

const toasts = () => screen.getByRole('region', { name: 'Notifications' });

async function openNewList() {
  await userEvent.click(await screen.findByRole('button', { name: 'New list' }));
  return screen.findByRole('dialog', { name: 'New list' });
}

describe('/replenishment — create (replenishment.md §Flows · Create manually)', () => {
  it('"New list" opens the form; a valid submit posts, toasts and lands on the new list', async () => {
    endpoint();
    const bodies = createEndpoint();
    renderWithDetail();
    await grid();

    const dialog = await openNewList();
    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    expect(name).toHaveFocus();
    await userEvent.type(name, '  Monday run ');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Notes/ }), 'Back wall first');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create list' }));

    await waitFor(() => expect(location()).toBe('/replenishment/new-list'));
    expect(screen.getByText('Detail stub')).toBeInTheDocument();
    expect(bodies).toEqual([{ name: 'Monday run', notes: 'Back wall first' }]);
    expect(within(toasts()).getByText('List created')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('validates on submit with the shared schema, then per field on blur; blank notes are sent as null', async () => {
    endpoint();
    const bodies = createEndpoint();
    renderWithDetail();
    await grid();

    const dialog = await openNewList();
    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    await userEvent.type(name, '   ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create list' }));
    expect(within(dialog).getByText('Name is required')).toBeInTheDocument();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(bodies).toHaveLength(0);

    await userEvent.type(name, 'Monday run');
    await userEvent.tab();
    expect(within(dialog).queryByText('Name is required')).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create list' }));
    await waitFor(() => expect(location()).toBe('/replenishment/new-list'));
    expect(bodies).toEqual([{ name: 'Monday run', notes: null }]);
  });

  it('a 400 maps its details onto the fields and keeps the modal open, with no toast', async () => {
    endpoint();
    createEndpoint(() =>
      HttpResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: [{ path: 'name', message: 'Name is too long' }] } },
        { status: 400 },
      ),
    );
    renderWithDetail();
    await grid();

    const dialog = await openNewList();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Monday run');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create list' }));

    expect(await within(dialog).findByText('Name is too long')).toBeInTheDocument();
    expect(within(toasts()).queryByRole('alert')).toBeNull();
    expect(location()).toBe('/replenishment');
  });

  it('any other error toasts the API message and keeps the modal open with its values', async () => {
    endpoint();
    createEndpoint(() => HttpResponse.json({ error: { code: 'FORBIDDEN', message: 'Not allowed here' } }, { status: 403 }));
    renderWithDetail();
    await grid();

    const dialog = await openNewList();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Monday run');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create list' }));

    expect(await within(toasts()).findByRole('alert')).toHaveTextContent('Not allowed here');
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveValue('Monday run');
    expect(within(dialog).getByRole('button', { name: 'Create list' })).toBeEnabled();
  });

  it('shows "Creating…" while pending; Cancel clears the form for the next opening', async () => {
    endpoint();
    let resolve!: () => void;
    const answered = new Promise<void>((r) => (resolve = r));
    server.use(
      http.post('*/api/v1/replenishment-lists', async () => {
        await answered;
        return HttpResponse.json(created, { status: 201 });
      }),
    );
    renderWithDetail();
    await grid();

    let dialog = await openNewList();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Draft name');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    dialog = await openNewList();
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveValue('');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Monday run');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create list' }));
    expect(await within(dialog).findByRole('button', { name: 'Creating…' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    resolve();
    await waitFor(() => expect(location()).toBe('/replenishment/new-list'));
  });

  it('the no-lists state offers "New list" too', async () => {
    endpoint(() => HttpResponse.json(envelope([])));
    renderPage();
    await screen.findByText('No replenishment lists yet');

    const buttons = screen.getAllByRole('button', { name: 'New list' });
    expect(buttons).toHaveLength(2); // header + empty state
    await userEvent.click(buttons[1]!);
    expect(await screen.findByRole('dialog', { name: 'New list' })).toBeInTheDocument();
  });

  it('the platform admin creates in the selected store (X-Tenant-Id)', async () => {
    localStorage.setItem(SELECTED_STORE_KEY, JSON.stringify({ id: 'store-b', name: 'Store B' }));
    endpoint();
    const headers: (string | null)[] = [];
    server.use(
      http.post('*/api/v1/replenishment-lists', ({ request }) => {
        headers.push(request.headers.get('x-tenant-id'));
        return HttpResponse.json(created, { status: 201 });
      }),
    );
    renderPage('/replenishment', 'platform_admin');
    await grid();

    const dialog = await openNewList();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Monday run');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create list' }));
    await within(toasts()).findByText('List created');
    expect(headers).toEqual(['store-b']);
  });
});

/** `DELETE /replenishment-lists/:id`, answering `respond()` and recording the ids. */
function deleteEndpoint(respond: () => Response = () => new HttpResponse(null, { status: 204 })) {
  const ids: string[] = [];
  server.use(
    http.delete('*/api/v1/replenishment-lists/:id', ({ params }) => {
      ids.push(String(params.id));
      return respond();
    }),
  );
  return ids;
}

describe('/replenishment — delete (replenishment.md §Flows · Delete)', () => {
  it('confirms naming the list with the cascade copy, deletes, toasts and refetches', async () => {
    let deleted = false;
    const { requests } = endpoint(() => HttpResponse.json(envelope(deleted ? lists.slice(1) : lists)));
    const ids = deleteEndpoint(() => {
      deleted = true;
      return new HttpResponse(null, { status: 204 });
    });
    renderPage();
    await grid();

    await userEvent.click(screen.getByRole('button', { name: 'Delete list “Weekly replenishment”' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete list' });
    expect(dialog).toHaveTextContent('Delete the list “Weekly replenishment”? Its items will be deleted too.');
    // Focus starts on Cancel, never on the destructive button.
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete list' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(ids).toEqual(['l1']);
    expect(within(toasts()).getByText('List deleted')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Weekly replenishment' })).toBeNull());
    expect(requests).toHaveLength(2);
    expect(location()).toBe('/replenishment');
  });

  it('Cancel closes the confirm without deleting', async () => {
    endpoint();
    const ids = deleteEndpoint();
    renderPage();
    await grid();

    await userEvent.click(screen.getByRole('button', { name: 'Delete list “Saturday restock”' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete list' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(ids).toEqual([]);
  });

  it('a 404 (deleted elsewhere) toasts the API message and refetches the stale page', async () => {
    let deleted = false;
    const { requests } = endpoint(() => HttpResponse.json(envelope(deleted ? lists.slice(1) : lists)));
    deleteEndpoint(() => {
      deleted = true;
      return HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'List not found' } }, { status: 404 });
    });
    renderPage();
    await grid();

    await userEvent.click(screen.getByRole('button', { name: 'Delete list “Weekly replenishment”' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete list' }));

    expect(await within(toasts()).findByRole('alert')).toHaveTextContent('List not found');
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Weekly replenishment' })).toBeNull());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(requests).toHaveLength(2);
  });

  it('deleting the only list of the last page recovers to the previous page (RF-36), keeping the filters', async () => {
    let deleted = false;
    const { requests } = endpoint((url) => {
      const page = Number(url.searchParams.get('page'));
      if (page === 1) return HttpResponse.json(envelope(lists, 1, deleted ? 20 : 21));
      return HttpResponse.json(deleted ? envelope([], 2, 20) : envelope([lists[3]!], 2, 21));
    });
    deleteEndpoint(() => {
      deleted = true;
      return new HttpResponse(null, { status: 204 });
    });
    renderPage('/replenishment?status=done&page=2');
    await grid();
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Delete list “Finished run”' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete list' }));

    await waitFor(() => expect(location()).toBe('/replenishment?status=done'));
    expect(await screen.findByRole('link', { name: 'Weekly replenishment' })).toBeInTheDocument();
    expect(new URL(requests.at(-1)!.url).searchParams.get('page')).toBe('1');
    expect(screen.queryByText('No results for these filters')).toBeNull();
  });
});
