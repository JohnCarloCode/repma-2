import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { AvailabilityProduct, Category, Page, Product, ProductSize } from 'shared';
import { afterEach, describe, expect, it } from 'vitest';
import { AppRoutes } from '../App';
import { SELECTED_STORE_KEY } from '../tenant/activeStore';
import { authMe, renderAt, sessionFor } from '../test/renderApp';
import { server } from '../test/server';

const productSize = (id: string, label: string, over: Partial<ProductSize> = {}): ProductSize => ({
  id,
  label,
  sku: `SKU-${id}`,
  position: 0,
  isActive: true,
  ...over,
});

const product = (id: string, name: string, over: Partial<Product> = {}): Product => ({
  id,
  name,
  description: null,
  imageUrl: null,
  categoryId: 'cat-footwear',
  categoryName: 'Footwear',
  isActive: true,
  sizes: [productSize(`${id}-38`, '38'), productSize(`${id}-39`, '39'), productSize(`${id}-40`, '40')],
  ...over,
});

// Fully in (3 of 3), partially in (1 of 3), not in, and an inactive single-size product.
const runner = product('p-runner', 'Runner Sneaker');
const boot = product('p-boot', 'Trail Boot');
const sandal = product('p-sandal', 'Beach Sandal');
const tote = product('p-tote', 'Canvas Tote', {
  imageUrl: 'https://img.test/tote.png',
  categoryId: 'cat-bags',
  categoryName: 'Bags',
  isActive: false,
  sizes: [productSize('p-tote-one', 'One size')],
});
const products = [runner, boot, sandal, tote];

/** The store's assortment runs for the cross-reference (only products with ≥1 size in it come back). */
const run = (p: Product, count: number): AvailabilityProduct => ({
  id: p.id,
  name: p.name,
  imageUrl: p.imageUrl,
  categoryName: p.categoryName,
  isActive: p.isActive,
  sizes: p.sizes.slice(0, count).map((s) => ({
    id: `item-${s.id}`,
    sizeId: s.id,
    label: s.label,
    sku: s.sku,
    isAvailable: true,
    isActive: s.isActive,
    latestEventAt: null,
  })),
});
const assortment = [run(runner, 3), run(boot, 1)];

const envelope = <T,>(items: T[], over: Partial<Page<T>> = {}): Page<T> => ({
  items,
  page: 1,
  pageSize: 20,
  total: items.length,
  ...over,
});

const categories: Category[] = [
  { id: 'cat-bags', name: 'Bags' },
  { id: 'cat-footwear', name: 'Footwear' },
];

/** `GET /products`, `GET /availability` (cross-reference) and `GET /categories`, recording requests. */
function catalog({
  respondProducts = () => HttpResponse.json(envelope(products, { total: 42 })),
  respondAssortment = () => HttpResponse.json(envelope(assortment, { pageSize: 4 })),
}: {
  respondProducts?: (url: URL) => Response | Promise<Response>;
  respondAssortment?: (url: URL) => Response | Promise<Response>;
} = {}) {
  const productRequests: Request[] = [];
  const assortmentRequests: Request[] = [];
  server.use(
    http.get('*/api/v1/products', ({ request }) => {
      productRequests.push(request);
      return respondProducts(new URL(request.url));
    }),
    http.get('*/api/v1/availability', ({ request }) => {
      assortmentRequests.push(request);
      return respondAssortment(new URL(request.url));
    }),
    http.get('*/api/v1/categories', () => HttpResponse.json(envelope(categories, { pageSize: 100 }))),
  );
  const lastProductsUrl = () => new URL(productRequests.at(-1)!.url);
  return { productRequests, assortmentRequests, lastProductsUrl };
}

const location = () => screen.getByTestId('location').textContent;

function renderCatalog(path = '/catalog', role: 'manager' | 'employee' | 'platform_admin' = 'manager') {
  server.use(authMe(sessionFor(role)));
  renderAt(path, <AppRoutes />);
}

const table = () => screen.findByRole('table', { name: 'Products' });
const rowOf = (name: string) => screen.getByRole('cell', { name: new RegExp(name) }).closest('tr')!;
const cellsOf = (name: string) => within(rowOf(name)).getAllByRole('cell');

afterEach(() => localStorage.clear());

describe('/catalog guard and nav (catalog.md, RF-35)', () => {
  it('employee: no Catalog nav item, and the direct URL lands on /unauthorized', async () => {
    renderCatalog('/catalog', 'employee');
    expect(await screen.findByRole('heading', { name: 'Unauthorized access' })).toBeInTheDocument();
    expect(location()).toBe('/unauthorized');
    expect(within(screen.getByRole('navigation', { name: 'Main' })).queryByRole('link', { name: 'Catalog' })).toBeNull();
  });

  it('manager: the Catalog nav item is shown and active on /catalog', async () => {
    catalog();
    renderCatalog();
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Catalog' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByRole('heading', { name: 'Catalog' })).toBeInTheDocument();
  });

  it('platform admin without a selected store: the picker state, no catalog request', async () => {
    const api = catalog();
    renderCatalog('/catalog', 'platform_admin');
    expect(await screen.findByRole('heading', { name: 'Select a store to continue' })).toBeInTheDocument();
    expect(api.productRequests).toHaveLength(0);
  });
});

describe('/catalog products table', () => {
  it('header subtitle from the envelope total, no primary action', async () => {
    catalog();
    renderCatalog();
    expect(await screen.findByText('42 products in the global catalog')).toBeInTheDocument();
    expect(within(screen.getByRole('main')).queryByRole('button', { name: /add/i })).toBeNull();
  });

  it('columns: product (thumb + name), size count, category, status, in assortment', async () => {
    catalog();
    renderCatalog();
    await table();
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Product',
      'Sizes',
      'Category',
      'Status',
      'In assortment',
    ]);
    await screen.findAllByText('In assortment', { selector: 'td *' });

    const [name, sizes, category, status, inAssortment] = cellsOf('Runner Sneaker');
    expect(name).toHaveTextContent('RSRunner Sneaker'); // initials placeholder + name
    expect(sizes).toHaveTextContent('3 sizes');
    expect(category).toHaveTextContent('Footwear');
    expect(status).toBeEmptyDOMElement();
    expect(inAssortment).toHaveTextContent(/^checkIn assortment$/); // check glyph (ligature) + label, no caption

    expect(cellsOf('Trail Boot')[4]).toHaveTextContent('In assortment1 of 3 sizes');
    expect(cellsOf('Beach Sandal')[4]).toHaveTextContent(/^—$/);

    const tote = cellsOf('Canvas Tote');
    expect(tote[0]!.querySelector('img')).toHaveAttribute('src', 'https://img.test/tote.png');
    expect(tote[1]).toHaveTextContent('1 size');
    expect(tote[2]).toHaveTextContent('Bags');
    expect(tote[3]).toHaveTextContent('Inactive');
    expect(tote[4]).toHaveTextContent(/^—$/);
  });

  it('first load asks for active products only (default Active), page 1, global: no X-Tenant-Id', async () => {
    const api = catalog();
    renderCatalog();
    await table();
    const url = api.lastProductsUrl();
    expect(url.searchParams.get('isActive')).toBe('true');
    expect(url.searchParams.get('page')).toBe('1');
    expect(api.productRequests[0]!.headers.get('X-Tenant-Id')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('true');
    expect(location()).toBe('/catalog');
  });
});

describe('/catalog assortment cross-reference', () => {
  it('one GET /availability with productId = the rendered ids and pageSize = their count', async () => {
    const api = catalog();
    renderCatalog();
    await table();
    await waitFor(() => expect(api.assortmentRequests).toHaveLength(1));
    const url = new URL(api.assortmentRequests[0]!.url);
    expect(url.searchParams.get('productId')).toBe('p-runner,p-boot,p-sandal,p-tote');
    expect(url.searchParams.get('pageSize')).toBe('4');
  });

  it('while pending the column shows no verdict; the table is already there', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    catalog({
      respondAssortment: async () => {
        await gate;
        return HttpResponse.json(envelope(assortment));
      },
    });
    renderCatalog();
    await table();
    expect(cellsOf('Beach Sandal')[4]).not.toHaveTextContent('—');
    expect(cellsOf('Runner Sneaker')[4]).not.toHaveTextContent('In assortment');
    release();
    await waitFor(() => expect(cellsOf('Runner Sneaker')[4]).toHaveTextContent('In assortment'));
  });

  it('failure degrades to "—" with a non-blocking retry; retry refetches only the cross-reference', async () => {
    let fail = true;
    const api = catalog({
      respondAssortment: () =>
        fail
          ? HttpResponse.json({ error: { code: 'FORBIDDEN', message: 'Forbidden' } }, { status: 403 })
          : HttpResponse.json(envelope(assortment)),
    });
    renderCatalog();
    await table();
    // A 4xx: the query client retries only network/5xx failures.
    const notice = await screen.findByRole('alert');
    expect(notice).toHaveTextContent('Assortment status could not be loaded.');
    for (const name of ['Runner Sneaker', 'Trail Boot', 'Beach Sandal', 'Canvas Tote']) {
      expect(cellsOf(name)[4]).toHaveTextContent(/^—$/);
    }
    const productCalls = api.productRequests.length;

    fail = false;
    await userEvent.click(within(notice).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(cellsOf('Runner Sneaker')[4]).toHaveTextContent('In assortment'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(api.productRequests).toHaveLength(productCalls);
  });

  it('the platform admin cross-references the selected store (X-Tenant-Id); products stay global', async () => {
    localStorage.setItem(SELECTED_STORE_KEY, JSON.stringify({ id: 'store-b', name: 'Store B' }));
    const api = catalog();
    renderCatalog('/catalog', 'platform_admin');
    await table();
    await waitFor(() => expect(api.assortmentRequests).toHaveLength(1));
    expect(api.assortmentRequests[0]!.headers.get('X-Tenant-Id')).toBe('store-b');
    expect(api.productRequests[0]!.headers.get('X-Tenant-Id')).toBeNull();
  });

  it('an empty page sends no cross-reference', async () => {
    const api = catalog({ respondProducts: () => HttpResponse.json(envelope([])) });
    renderCatalog();
    expect(await screen.findByText('No active products in the catalog')).toBeInTheDocument();
    expect(api.assortmentRequests).toHaveLength(0);
  });
});

describe('/catalog filters and pagination (URL state)', () => {
  it('search (debounced) → ?search= and the request', async () => {
    const api = catalog();
    renderCatalog();
    await table();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), 'SKU-1');
    await waitFor(() => expect(location()).toBe('/catalog?search=SKU-1'));
    await waitFor(() => expect(api.lastProductsUrl().searchParams.get('search')).toBe('SKU-1'));
  });

  it('category → ?categoryId=', async () => {
    const api = catalog();
    renderCatalog();
    await table();
    const select = screen.getByRole('combobox', { name: 'Category' });
    await within(select).findByRole('option', { name: 'Bags' });
    await userEvent.selectOptions(select, 'Bags');
    expect(location()).toBe('/catalog?categoryId=cat-bags');
    await waitFor(() => expect(api.lastProductsUrl().searchParams.get('categoryId')).toBe('cat-bags'));
  });

  it('status: Inactive → isActive=false; All → ?isActive=all and no isActive sent; Active → param dropped', async () => {
    const api = catalog();
    renderCatalog();
    await table();
    const status = screen.getByRole('combobox', { name: 'Status' });
    expect(within(status).getAllByRole('option').map((o) => o.textContent)).toEqual(['All', 'Active', 'Inactive']);

    await userEvent.selectOptions(status, 'Inactive');
    expect(location()).toBe('/catalog?isActive=false');
    await waitFor(() => expect(api.lastProductsUrl().searchParams.get('isActive')).toBe('false'));

    await userEvent.selectOptions(status, 'All');
    expect(location()).toBe('/catalog?isActive=all');
    await waitFor(() => expect(api.lastProductsUrl().searchParams.has('isActive')).toBe(false));

    await userEvent.selectOptions(status, 'Active');
    expect(location()).toBe('/catalog');
  });

  it('reads filters and page from the URL on load', async () => {
    const api = catalog();
    renderCatalog('/catalog?search=boot&categoryId=cat-footwear&isActive=all&page=3');
    await table();
    const url = api.lastProductsUrl();
    expect(url.searchParams.get('search')).toBe('boot');
    expect(url.searchParams.get('categoryId')).toBe('cat-footwear');
    expect(url.searchParams.has('isActive')).toBe(false);
    expect(url.searchParams.get('page')).toBe('3');
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('all');
  });

  it('pagination: Next → ?page=2 and the request', async () => {
    const api = catalog({
      respondProducts: (url) => HttpResponse.json(envelope(products, { page: Number(url.searchParams.get('page')), total: 42 })),
    });
    renderCatalog();
    await table();
    await userEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(location()).toBe('/catalog?page=2');
    await waitFor(() => expect(api.lastProductsUrl().searchParams.get('page')).toBe('2'));
  });

  it('filtered empty: "No results for these filters" + "Clear filters" back to the default', async () => {
    catalog({ respondProducts: () => HttpResponse.json(envelope([])) });
    renderCatalog('/catalog?search=zzz&isActive=all');
    expect(await screen.findByText('No results for these filters')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(location()).toBe('/catalog');
  });

  it('products failing: the error state with Retry', async () => {
    catalog({
      // A 4xx: the query client retries only network/5xx failures.
      respondProducts: () => HttpResponse.json({ error: { code: 'FORBIDDEN', message: 'Forbidden' } }, { status: 403 }),
    });
    renderCatalog();
    expect(await screen.findByText('Data could not be loaded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('/catalog product detail slide-over (catalog.md §Product detail)', () => {
  /**
   * The cross-reference answers from a mutable assortment (catalog size ids), so a test can
   * change it and see the sheet follow the refetch. Starts as Runner 3/3 and Boot 38 only.
   */
  function detailApi({
    post = () => HttpResponse.json({}, { status: 201 }),
    respondAssortment,
    respondProducts,
  }: {
    post?: (body: { sizeId: string }) => Response | Promise<Response>;
    respondAssortment?: (url: URL) => Response | Promise<Response>;
    respondProducts?: (url: URL) => Response | Promise<Response>;
  } = {}) {
    const assorted = new Set(['p-runner-38', 'p-runner-39', 'p-runner-40', 'p-boot-38']);
    const fromAssorted = () =>
      HttpResponse.json(
        envelope(
          products
            .map((p) => ({ ...run(p, p.sizes.length), sizes: run(p, p.sizes.length).sizes.filter((s) => assorted.has(s.sizeId)) }))
            .filter((p) => p.sizes.length > 0),
        ),
      );
    const api = catalog({ respondAssortment: respondAssortment ?? fromAssorted, respondProducts });
    const posts: { request: Request; body: { sizeId: string } }[] = [];
    server.use(
      http.post('*/api/v1/availability', async ({ request }) => {
        const body = (await request.clone().json()) as { sizeId: string };
        posts.push({ request, body });
        return post(body);
      }),
    );
    return { ...api, posts, assorted };
  }

  const openRow = async (name: string) => {
    await table();
    await userEvent.click(rowOf(name));
    return screen.findByRole('dialog', { name });
  };
  const sizeRow = (dialog: HTMLElement, label: string) =>
    within(within(dialog).getByRole('list', { name: 'Sizes' })).getByText(label, { selector: 'span' }).closest('li')!;

  it('a row click opens the sheet from the row data: image, category, description, aggregate status, size list', async () => {
    const api = detailApi({
      respondProducts: () =>
        HttpResponse.json(envelope([runner, { ...boot, description: 'Waterproof leather boot.' }, sandal, tote])),
    });
    renderCatalog();
    const dialog = await openRow('Trail Boot');
    expect(location()).toBe('/catalog'); // not a route
    expect(api.productRequests).toHaveLength(1); // no extra fetch
    expect(within(dialog).getByText('Footwear')).toBeInTheDocument();
    expect(within(dialog).getByText('Waterproof leather boot.')).toBeInTheDocument();
    expect(await within(dialog).findByText('1 of 3 sizes')).toBeInTheDocument();

    const sizes = within(within(dialog).getByRole('list', { name: 'Sizes' })).getAllByRole('listitem');
    expect(sizes).toHaveLength(3);
    expect(sizes[0]).toHaveTextContent('SKU-p-boot-38');
    expect(within(sizeRow(dialog, '38')).getByRole('link', { name: /In assortment/ })).toHaveAttribute(
      'href',
      '/availability/item-p-boot-38',
    );
    for (const label of ['39', '40']) {
      expect(within(sizeRow(dialog, label)).getByRole('button', { name: 'Add to assortment' })).toBeEnabled();
    }
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('keyboard: Enter on a focused row opens it; Escape closes and focus returns to the row', async () => {
    detailApi();
    renderCatalog();
    await table();
    const row = rowOf('Beach Sandal');
    row.focus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('dialog', { name: 'Beach Sandal' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(row).toHaveFocus();
  });

  it('"Close" closes the sheet', async () => {
    detailApi();
    renderCatalog();
    const dialog = await openRow('Beach Sandal');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('add: POST { sizeId } (no X-Tenant-Id for a manager), pending per size, toast, the size flips after the refetch', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const api = detailApi({
      post: async ({ sizeId }) => {
        await gate;
        api.assorted.add(sizeId);
        return HttpResponse.json({}, { status: 201 });
      },
    });
    renderCatalog();
    const dialog = await openRow('Trail Boot');
    await userEvent.click(await within(sizeRow(dialog, '39')).findByRole('button', { name: 'Add to assortment' }));

    expect(within(sizeRow(dialog, '39')).getByRole('button', { name: 'Adding…' })).toBeDisabled();
    expect(within(sizeRow(dialog, '40')).getByRole('button', { name: 'Add to assortment' })).toBeEnabled(); // per size
    expect(api.posts).toHaveLength(1);
    expect(api.posts[0]!.body).toEqual({ sizeId: 'p-boot-39' });
    expect(api.posts[0]!.request.headers.get('X-Tenant-Id')).toBeNull();

    release();
    expect(await screen.findByText('Added to assortment')).toBeInTheDocument();
    expect(await within(sizeRow(dialog, '39')).findByRole('link', { name: /In assortment/ })).toHaveAttribute(
      'href',
      '/availability/item-p-boot-39',
    );
    expect(within(dialog).getByText('2 of 3 sizes')).toBeInTheDocument();
    expect(cellsOf('Trail Boot')[4]).toHaveTextContent('2 of 3 sizes'); // the row updates too
  });

  it('the platform admin adds to the selected store (X-Tenant-Id)', async () => {
    localStorage.setItem(SELECTED_STORE_KEY, JSON.stringify({ id: 'store-b', name: 'Store B' }));
    const api = detailApi();
    renderCatalog('/catalog', 'platform_admin');
    const dialog = await openRow('Beach Sandal');
    await userEvent.click(await within(sizeRow(dialog, '40')).findByRole('button', { name: 'Add to assortment' }));
    await waitFor(() => expect(api.posts).toHaveLength(1));
    expect(api.posts[0]!.request.headers.get('X-Tenant-Id')).toBe('store-b');
  });

  it('409 (RN-04, added elsewhere): error toast with the API message; the size corrects itself', async () => {
    const api = detailApi({
      post: ({ sizeId }) => {
        api.assorted.add(sizeId);
        return HttpResponse.json(
          { error: { code: 'CONFLICT', message: 'This size is already in the assortment' } },
          { status: 409 },
        );
      },
    });
    renderCatalog();
    const dialog = await openRow('Beach Sandal');
    await userEvent.click(await within(sizeRow(dialog, '38')).findByRole('button', { name: 'Add to assortment' }));
    expect(await screen.findByText('This size is already in the assortment')).toBeInTheDocument();
    expect(await within(sizeRow(dialog, '38')).findByRole('link', { name: /In assortment/ })).toBeInTheDocument();
    expect(screen.queryByText('Added to assortment')).toBeNull();
  });

  it('400 on sizeId (RN-08, deactivated meanwhile): toast with the API message; products refetched, the action goes', async () => {
    let sizeInactive = false;
    const api = detailApi({
      post: () => {
        sizeInactive = true;
        return HttpResponse.json(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid request',
              details: [{ path: 'sizeId', message: 'This size is inactive' }],
            },
          },
          { status: 400 },
        );
      },
      respondProducts: () => {
        const current = sizeInactive
          ? { ...sandal, sizes: sandal.sizes.map((s) => (s.label === '40' ? { ...s, isActive: false } : s)) }
          : sandal;
        return HttpResponse.json(envelope([runner, boot, current, tote]));
      },
    });
    renderCatalog();
    const dialog = await openRow('Beach Sandal');
    const reads = api.productRequests.length;
    await userEvent.click(await within(sizeRow(dialog, '40')).findByRole('button', { name: 'Add to assortment' }));
    expect(await screen.findByText('This size is inactive')).toBeInTheDocument();
    await waitFor(() => expect(api.productRequests.length).toBeGreaterThan(reads));
    await waitFor(() => expect(within(sizeRow(dialog, '40')).queryByRole('button')).toBeNull());
    expect(sizeRow(dialog, '40')).toHaveTextContent('Inactive');
  });

  it('any other error: toast, and the size can be retried', async () => {
    detailApi({ post: () => HttpResponse.json({ error: { code: 'FORBIDDEN', message: 'Forbidden' } }, { status: 403 }) });
    renderCatalog();
    const dialog = await openRow('Beach Sandal');
    await userEvent.click(await within(sizeRow(dialog, '39')).findByRole('button', { name: 'Add to assortment' }));
    expect(await screen.findByText('Forbidden')).toBeInTheDocument();
    expect(within(sizeRow(dialog, '39')).getByRole('button', { name: 'Add to assortment' })).toBeEnabled();
  });

  it('inactive product (RN-08): listed with its badge, no add action', async () => {
    detailApi();
    renderCatalog();
    const dialog = await openRow('Canvas Tote');
    expect(within(dialog).getByText('Inactive')).toBeInTheDocument();
    expect(dialog.querySelector('img')).toHaveAttribute('src', 'https://img.test/tote.png');
    await waitFor(() => expect(sizeRow(dialog, 'One size')).toHaveTextContent('—'));
    expect(within(dialog).queryByRole('button', { name: 'Add to assortment' })).toBeNull();
  });

  it('inactive size inside an active product: its own badge, no add action', async () => {
    const withInactive = { ...sandal, sizes: sandal.sizes.map((s) => (s.label === '40' ? { ...s, isActive: false } : s)) };
    detailApi({ respondProducts: () => HttpResponse.json(envelope([runner, boot, withInactive, tote])) });
    renderCatalog();
    const dialog = await openRow('Beach Sandal');
    await within(sizeRow(dialog, '38')).findByRole('button', { name: 'Add to assortment' });
    expect(sizeRow(dialog, '40')).toHaveTextContent('Inactive');
    expect(within(sizeRow(dialog, '40')).queryByRole('button')).toBeNull();
  });

  it('cross-reference failure: an alert with Retry in the sheet, statuses "—", no add actions until it loads', async () => {
    let fail = true;
    detailApi({
      respondAssortment: () =>
        fail
          ? HttpResponse.json({ error: { code: 'FORBIDDEN', message: 'Forbidden' } }, { status: 403 })
          : HttpResponse.json(envelope([run(boot, 1)])),
    });
    renderCatalog();
    const dialog = await openRow('Trail Boot');
    const notice = await within(dialog).findByRole('alert');
    expect(notice).toHaveTextContent('Assortment status could not be loaded.');
    for (const label of ['38', '39', '40']) expect(sizeRow(dialog, label)).toHaveTextContent('—');
    expect(within(dialog).queryByRole('button', { name: 'Add to assortment' })).toBeNull();

    fail = false;
    await userEvent.click(within(notice).getByRole('button', { name: 'Retry' }));
    expect(await within(sizeRow(dialog, '38')).findByRole('link', { name: /In assortment/ })).toBeInTheDocument();
    expect(within(sizeRow(dialog, '39')).getByRole('button', { name: 'Add to assortment' })).toBeEnabled();
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });
});
