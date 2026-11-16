import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes, useLocation } from 'react-router';
import type { AvailabilityProduct, AvailabilitySize, Category, Page, Product } from 'shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';
import { RouteGuard } from '../auth/guards';
import { SELECTED_STORE_KEY } from '../tenant/activeStore';
import { authMe, renderAt, sessionFor } from '../test/renderApp';
import { server } from '../test/server';
import { AvailabilityPage } from './AvailabilityPage';

const NOW = new Date('2026-11-15T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const H = 3_600_000;
const D = 24 * H;

const size = (label: string, over: Partial<AvailabilitySize> = {}): AvailabilitySize => ({
  id: `item-${label}`,
  sizeId: `size-${label}`,
  label,
  sku: `SKU-${label}`,
  isAvailable: true,
  isActive: true,
  latestEventAt: null,
  ...over,
});

const runner: AvailabilityProduct = {
  id: 'p-runner',
  name: 'Runner Sneaker',
  imageUrl: null,
  categoryName: 'Footwear',
  isActive: true,
  sizes: [
    size('38'),
    size('39', { isAvailable: false, latestEventAt: ago(2 * H) }),
    size('40', { isAvailable: false, latestEventAt: ago(9 * D) }),
  ],
};
const tote: AvailabilityProduct = {
  id: 'p-tote',
  name: 'Canvas Tote',
  imageUrl: 'https://img.test/tote.png',
  categoryName: 'Bags',
  isActive: false,
  sizes: [size('One size', { id: 'item-tote', latestEventAt: ago(3 * D) })],
};

const envelope = <T,>(items: T[], page = 1, total = items.length): Page<T> => ({ items, page, pageSize: 20, total });

const categories: Category[] = [
  { id: '00000000-0000-4000-8000-0000000000c1', name: 'Bags', slug: 'bags', description: null },
  { id: '00000000-0000-4000-8000-0000000000c2', name: 'Footwear', slug: 'footwear', description: null },
];

/** `GET /availability` (and `GET /categories`), recording every request. */
function stock(respond: (url: URL) => Response | Promise<Response> = () => HttpResponse.json(envelope([runner, tote]))) {
  const requests: Request[] = [];
  const categoryRequests: Request[] = [];
  server.use(
    http.get('*/api/v1/availability', ({ request }) => {
      requests.push(request);
      return respond(new URL(request.url));
    }),
    http.get('*/api/v1/categories', ({ request }) => {
      categoryRequests.push(request);
      return HttpResponse.json({ ...envelope(categories), pageSize: 100 });
    }),
  );
  const lastUrl = () => new URL(requests.at(-1)!.url);
  return { requests, categoryRequests, lastUrl };
}

const location = () => screen.getByTestId('location').textContent;

function renderAvailability(path = '/availability', role: 'manager' | 'employee' | 'platform_admin' = 'employee') {
  server.use(authMe(sessionFor(role)));
  renderAt(path, <AppRoutes />);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('/availability — product lines (availability.md)', () => {
  it('renders one line per product in API order: identity, run, oldest outage figure', async () => {
    const { requests, categoryRequests } = stock();
    renderAvailability();

    const list = await screen.findByRole('list', { name: 'Products' });
    const lines = within(list).getAllByRole('listitem');
    expect(lines).toHaveLength(2);

    const [first, second] = lines as [HTMLElement, HTMLElement];
    expect(first).toHaveTextContent('Runner Sneaker');
    expect(first).toHaveTextContent('Footwear');
    const run = within(first).getByRole('group', { name: 'Runner Sneaker sizes' });
    expect(within(run).getAllByRole('link').map((tile) => tile.textContent)).toEqual([
      '38, available',
      '39, out of stock 2 h',
      '40, out of stock 9 d',
    ]);
    // The line figure is the oldest outage in the run, not the newest.
    expect(first.lastElementChild).toHaveTextContent(/^9 d$/);
    expect(within(first).getByText('RS')).toBeInTheDocument(); // placeholder thumb (no image)

    expect(second.lastElementChild).toHaveTextContent(/^—$/); // nothing out of stock
    expect(within(second).getByText('Inactive')).toBeInTheDocument();
    expect(second.querySelector('img')).toHaveAttribute('src', 'https://img.test/tote.png');

    expect(screen.getByText('Store A · 2 products')).toBeInTheDocument();
    expect(new URL(requests[0]!.url).search).toBe('?page=1');
    expect(requests[0]!.headers.get('x-tenant-id')).toBeNull();
    expect(new URL(categoryRequests[0]!.url).search).toBe('?pageSize=100');
  });

  it('the platform admin reads the selected store (X-Tenant-Id); categories are global (no header)', async () => {
    localStorage.setItem(SELECTED_STORE_KEY, JSON.stringify({ id: 'store-b', name: 'Store B' }));
    const { requests, categoryRequests } = stock(() => HttpResponse.json(envelope([runner], 1, 1)));
    renderAvailability('/availability', 'platform_admin');

    expect(await screen.findByText('Store B · 1 product')).toBeInTheDocument();
    expect(requests[0]!.headers.get('x-tenant-id')).toBe('store-b');
    await waitFor(() => expect(categoryRequests).toHaveLength(1));
    expect(categoryRequests[0]!.headers.get('x-tenant-id')).toBeNull();
  });

  it('a tile opens /availability/:id carrying the list URL state for the back action', async () => {
    const user = userEvent.setup();
    stock();
    server.use(authMe(sessionFor('employee')));
    function Detail() {
      return <div data-testid="detail">{JSON.stringify(useLocation().state)}</div>;
    }
    renderAt(
      '/availability?search=run&page=2',
      <Routes>
        <Route element={<RouteGuard permission="availability:read" store />}>
          <Route path="/availability" element={<AvailabilityPage />} />
          <Route path="/availability/:id" element={<Detail />} />
        </Route>
      </Routes>,
    );

    await user.click(await screen.findByRole('link', { name: /^40/ }));
    expect(location()).toBe('/availability/item-40');
    expect(JSON.parse(screen.getByTestId('detail').textContent!)).toEqual({ listSearch: '?search=run&page=2' });
  });

  it('the Availability nav item has shipped and is active on its route', async () => {
    stock();
    renderAvailability();
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Availability' })).toHaveAttribute('aria-current', 'page');
  });

});

describe('/availability — filters', () => {
  it('sends the URL filters together', async () => {
    const { lastUrl } = stock();
    const categoryId = categories[1]!.id;
    renderAvailability(`/availability?search=run&categoryId=${categoryId}&outOfStock=true`);
    await screen.findByRole('list', { name: 'Products' });

    expect(Object.fromEntries(lastUrl().searchParams)).toEqual({
      page: '1',
      search: 'run',
      categoryId,
      outOfStock: 'true',
    });
    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveValue('run');
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Category' })).toHaveValue(categoryId));
    expect(screen.getByRole('checkbox', { name: 'Only out of stock' })).toBeChecked();
  });

  it('search is debounced into the URL and resets to page 1', async () => {
    const user = userEvent.setup();
    const { lastUrl } = stock();
    renderAvailability('/availability?page=2');
    await screen.findByRole('list', { name: 'Products' });

    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'SKU-40');
    await waitFor(() => expect(location()).toBe('/availability?search=SKU-40'));
    await waitFor(() => expect(lastUrl().searchParams.get('search')).toBe('SKU-40'));
    expect(lastUrl().searchParams.get('page')).toBe('1');
  });

  it('the category select lists GET /categories and filters by id', async () => {
    const user = userEvent.setup();
    const { lastUrl } = stock();
    renderAvailability();
    const select = await screen.findByRole('combobox', { name: 'Category' });
    await screen.findByRole('option', { name: 'Footwear' });
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'All categories',
      'Bags',
      'Footwear',
    ]);

    await user.selectOptions(select, 'Footwear');
    expect(location()).toBe(`/availability?categoryId=${categories[1]!.id}`);
    await waitFor(() => expect(lastUrl().searchParams.get('categoryId')).toBe(categories[1]!.id));

    await user.selectOptions(select, 'All categories');
    expect(location()).toBe('/availability');
  });

  it('"Only out of stock" sends outOfStock=true, and omits the param when off', async () => {
    const user = userEvent.setup();
    const { lastUrl } = stock();
    renderAvailability();
    await screen.findByRole('list', { name: 'Products' });
    const toggle = screen.getByRole('checkbox', { name: 'Only out of stock' });

    await user.click(toggle);
    expect(location()).toBe('/availability?outOfStock=true');
    await waitFor(() => expect(lastUrl().searchParams.get('outOfStock')).toBe('true'));

    await user.click(toggle);
    expect(location()).toBe('/availability');
    await waitFor(() => expect(lastUrl().searchParams.has('outOfStock')).toBe(false));
  });
});

describe('/availability — states and pagination', () => {
  it('shows skeleton lines with 44px tile blocks while loading, and no subtitle yet', async () => {
    let resolve!: () => void;
    const answered = new Promise<void>((r) => (resolve = r));
    stock(async () => {
      await answered;
      return HttpResponse.json(envelope([runner]));
    });
    renderAvailability();

    // Each skeleton line reserves a run of 44px tile blocks.
    await waitFor(() => expect(document.querySelectorAll('[role="status"] .size-\\[44px\\]')).toHaveLength(36));
    expect(screen.queryByText(/products?$/)).toBeNull();
    resolve();
    expect(await screen.findByRole('list', { name: 'Products' })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull();
  });

  it('no products and no filters: "No items in the assortment yet."', async () => {
    stock(() => HttpResponse.json(envelope([])));
    renderAvailability();
    expect(await screen.findByText('No items in the assortment yet.')).toBeInTheDocument();
    expect(screen.getByText('Store A · 0 products')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
  });

  it('no results for filters: message + "Clear filters" back to the full list', async () => {
    const user = userEvent.setup();
    stock((url) => HttpResponse.json(envelope(url.searchParams.has('search') ? [] : [runner])));
    renderAvailability('/availability?search=zzz&outOfStock=true&page=2');

    expect(await screen.findByText('No results for these filters.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(location()).toBe('/availability');
    expect(await screen.findByRole('list', { name: 'Products' })).toBeInTheDocument();
  });

  it('"Only out of stock" alone with no results is good news: "No out-of-stock items."', async () => {
    stock(() => HttpResponse.json(envelope([])));
    renderAvailability('/availability?outOfStock=true');
    expect(await screen.findByText('No out-of-stock items.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });

  it('an API error shows the message and retries', async () => {
    const user = userEvent.setup();
    let calls = 0;
    stock(() => {
      calls += 1;
      return calls === 1
        ? HttpResponse.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }, { status: 429 })
        : HttpResponse.json(envelope([runner]));
    });
    renderAvailability();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Too many requests');
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('list', { name: 'Products' })).toBeInTheDocument();
  });

  it('paginates from the envelope (pages of products), keeping the filters', async () => {
    const user = userEvent.setup();
    const { lastUrl } = stock((url) => HttpResponse.json(envelope([runner], Number(url.searchParams.get('page')), 45)));
    renderAvailability('/availability?outOfStock=true');
    await screen.findByText('Page 1 of 3');

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(location()).toBe('/availability?outOfStock=true&page=2');
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
    expect(lastUrl().searchParams.get('page')).toBe('2');
    expect(lastUrl().searchParams.get('outOfStock')).toBe('true');
  });

  it('a page past the end recovers to the last page with products', async () => {
    stock((url) => {
      const page = Number(url.searchParams.get('page'));
      return HttpResponse.json(envelope(page > 1 ? [] : [runner], page, 1));
    });
    renderAvailability('/availability?page=5');
    await waitFor(() => expect(location()).toBe('/availability'));
    expect(await screen.findByRole('list', { name: 'Products' })).toBeInTheDocument();
  });
});

// ——— "Add to assortment" (6.3, availability.md §Flows · Add size to assortment) ———

const boot: Product = {
  id: 'p-boot',
  name: 'Trail Boot',
  description: null,
  imageUrl: null,
  categoryId: 'c-foot',
  categoryName: 'Footwear',
  isActive: true,
  sizes: [
    { id: 'size-b40', label: '40', sku: 'BOOT-40', position: 1, isActive: true },
    { id: 'size-b41', label: '41', sku: 'BOOT-41', position: 2, isActive: true },
  ],
};

/**
 * The page's list (`GET /availability` without `productId`), the picker's catalog and its
 * cross-reference (`?productId=`, answering the sizes in `assorted`), and `POST /availability`
 * answering `post(body)`; every request recorded.
 */
function assortmentApi(post: (body: { sizeId: string }) => Response = () => HttpResponse.json({}, { status: 201 })) {
  const list: Request[] = [];
  const cross: Request[] = [];
  const posts: { request: Request; body: { sizeId: string } }[] = [];
  const assorted: string[] = [];
  server.use(
    http.get('*/api/v1/availability', ({ request }) => {
      const ids = new URL(request.url).searchParams.get('productId');
      if (!ids) {
        list.push(request);
        return HttpResponse.json(envelope([runner]));
      }
      cross.push(request);
      const sizes = boot.sizes
        .filter((s) => assorted.includes(s.id))
        .map((s) => size(s.label, { id: `item-${s.id}`, sizeId: s.id }));
      const items = sizes.length ? [{ ...runner, id: boot.id, name: boot.name, sizes }] : [];
      return HttpResponse.json({ items, page: 1, pageSize: 1, total: items.length });
    }),
    http.get('*/api/v1/products', () => HttpResponse.json({ items: [boot], page: 1, pageSize: 24, total: 1 })),
    http.post('*/api/v1/availability', async ({ request }) => {
      const body = (await request.clone().json()) as { sizeId: string };
      posts.push({ request, body });
      return post(body);
    }),
  );
  return { list, cross, posts, assorted };
}

const addButton = () => screen.findByRole('button', { name: 'Add to assortment' });
const pickerDialog = () => screen.findByRole('dialog', { name: 'Add to assortment' });
const runTile = (label: string) =>
  within(screen.getByRole('group', { name: 'Trail Boot sizes' })).getByRole('button', { name: new RegExp(`^${label}\\b`) });

async function pickBoot(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(await addButton());
  const dialog = await pickerDialog();
  await user.click(await within(dialog).findByRole('button', { name: /Trail Boot/ }));
  await user.click(runTile(label));
  await user.click(within(dialog).getByRole('button', { name: 'Add to assortment' }));
  return dialog;
}

describe('/availability — "Add to assortment"', () => {
  it('is the header primary for a manager (assortment:manage)', async () => {
    stock();
    renderAvailability('/availability', 'manager');
    await screen.findByRole('list', { name: 'Products' });
    expect(await addButton()).toHaveClass('bg-accent'); // the primary
  });

  it('is not offered to an employee', async () => {
    stock();
    renderAvailability('/availability', 'employee');
    await screen.findByRole('list', { name: 'Products' });
    expect(screen.queryByRole('button', { name: /add to assortment/i })).toBeNull();
  });

  it('the empty assortment offers it too, for a manager only', async () => {
    stock(() => HttpResponse.json(envelope([])));
    renderAvailability('/availability', 'manager');
    await screen.findByText('No items in the assortment yet.');
    expect(screen.getAllByRole('button', { name: 'Add to assortment' })).toHaveLength(2);
  });

  it('opens the picker on the catalog; confirm POSTs { sizeId }, toasts, closes and refreshes the list', async () => {
    const user = userEvent.setup();
    const api = assortmentApi();
    renderAvailability('/availability', 'manager');
    await screen.findByRole('list', { name: 'Products' });
    const listReads = api.list.length;

    await pickBoot(user, '41');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.posts).toHaveLength(1);
    expect(api.posts[0]!.body).toEqual({ sizeId: 'size-b41' });
    expect(api.posts[0]!.request.headers.get('X-Tenant-Id')).toBeNull();
    expect(await screen.findByText('Added to assortment')).toBeInTheDocument();
    await waitFor(() => expect(api.list.length).toBeGreaterThan(listReads)); // availability family invalidated
  });

  it('the platform admin posts to the selected store (X-Tenant-Id)', async () => {
    localStorage.setItem(SELECTED_STORE_KEY, JSON.stringify({ id: 'store-b', name: 'Store B' }));
    const user = userEvent.setup();
    const api = assortmentApi();
    renderAvailability('/availability', 'platform_admin');
    await screen.findByRole('list', { name: 'Products' });
    await pickBoot(user, '40');
    await waitFor(() => expect(api.posts).toHaveLength(1));
    expect(api.posts[0]!.request.headers.get('X-Tenant-Id')).toBe('store-b');
  });

  it('409 (RN-04): inline on the size step, picker open, the tile flips to disabled after the refetch', async () => {
    const user = userEvent.setup();
    // Another user added it between the picker's load and the submit.
    const api = assortmentApi(({ sizeId }) => {
      api.assorted.push(sizeId);
      return HttpResponse.json({ error: { code: 'CONFLICT', message: 'raw' } }, { status: 409 });
    });
    renderAvailability('/availability', 'manager');
    await screen.findByRole('list', { name: 'Products' });
    const dialog = await pickBoot(user, '40');

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This size is already in the assortment');
    await waitFor(() => expect(runTile('40')).toBeDisabled());
    expect(screen.getByRole('dialog', { name: 'Add to assortment' })).toBeInTheDocument();
    expect(screen.queryByText('Added to assortment')).toBeNull();
  });

  it('400 on sizeId (RN-08, deactivated meanwhile): the API message inline, picker open', async () => {
    const user = userEvent.setup();
    assortmentApi(() =>
      HttpResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request',
            details: [{ path: 'sizeId', message: 'This size is inactive' }],
          },
        },
        { status: 400 },
      ),
    );
    renderAvailability('/availability', 'manager');
    await screen.findByRole('list', { name: 'Products' });
    const dialog = await pickBoot(user, '40');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This size is inactive');
    expect(screen.getByRole('dialog', { name: 'Add to assortment' })).toBeInTheDocument();
  });

  it('any other error toasts and keeps the selection', async () => {
    const user = userEvent.setup();
    assortmentApi(() => HttpResponse.json({ error: { code: 'FORBIDDEN', message: 'Forbidden' } }, { status: 403 }));
    renderAvailability('/availability', 'manager');
    await screen.findByRole('list', { name: 'Products' });
    const dialog = await pickBoot(user, '40');
    const toast = await screen.findByRole('alert');
    expect(toast).toHaveTextContent('Forbidden');
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(runTile('40')).toHaveAttribute('aria-pressed', 'true');
  });
});
