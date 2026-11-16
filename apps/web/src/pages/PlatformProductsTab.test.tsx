import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { Category, Page, Product } from 'shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';
import { authMe, renderAt, sessionFor } from '../test/renderApp';
import { server } from '../test/server';

// platform-catalog.md §Tab "Products" + §Flows · Create product (plan 8.6).

const FOOTWEAR_ID = '00000000-0000-4000-8000-0000000000f1';
const BAGS_ID = '00000000-0000-4000-8000-0000000000f2';
const categories: Category[] = [
  { id: FOOTWEAR_ID, name: 'Footwear', slug: 'footwear', description: null },
  { id: BAGS_ID, name: 'Bags', slug: 'bags', description: null },
];

const size = (id: string, label: string, isActive = true) => ({ id, label, sku: `SKU-${id}`, position: 0, isActive });

const product = (id: string, name: string, overrides: Partial<Product> = {}): Product => ({
  id,
  name,
  description: null,
  imageUrl: null,
  categoryId: FOOTWEAR_ID,
  categoryName: 'Footwear',
  isActive: true,
  sizes: [size(`${id}-1`, '42')],
  ...overrides,
});

const runner = product('p-runner', 'Trail Runner', {
  imageUrl: 'https://cdn.test/runner.png',
  sizes: [size('r1', '40'), size('r2', '41'), size('r3', '42', false)],
});
const tote = product('p-tote', 'Canvas Tote', { categoryId: BAGS_ID, categoryName: 'Bags', isActive: false });
const products = [runner, tote];

const envelope = <T,>(items: T[], extra: Partial<Page<T>> = {}): Page<T> => ({
  items,
  page: 1,
  pageSize: 20,
  total: items.length,
  ...extra,
});

const apiError = (status: number, code: string, message: string, details?: unknown) =>
  HttpResponse.json({ error: { code, message, ...(details ? { details } : {}) } }, { status });

/** `GET/POST /products`, `POST /products/:id/image`, recording the calls in order. */
function productsApi({
  respondList = () => HttpResponse.json(envelope(products)),
  respondPost = (body) =>
    HttpResponse.json(product('p-new', (body as { name: string }).name), { status: 201 }),
  respondImage = () => HttpResponse.json({ ...product('p-new', 'New'), imageUrl: 'https://cdn.test/new.png' }),
}: {
  respondList?: (url: URL) => Response | Promise<Response>;
  respondPost?: (body: unknown) => Response | Promise<Response>;
  respondImage?: () => Response | Promise<Response>;
} = {}) {
  const listUrls: URL[] = [];
  const posts: unknown[] = [];
  const calls: string[] = [];
  const imageRequests: Request[] = [];
  server.use(
    http.get('*/api/v1/categories', () => HttpResponse.json(envelope(categories, { pageSize: 100 }))),
    http.get('*/api/v1/products', ({ request }) => {
      const url = new URL(request.url);
      listUrls.push(url);
      return respondList(url);
    }),
    http.post('*/api/v1/products', async ({ request }) => {
      const body = await request.json();
      posts.push(body);
      calls.push('POST /products');
      return respondPost(body);
    }),
    // jsdom's File can't be streamed by Node's fetch: the multipart body is not read back here
    // (the FormData field is asserted through a FormData.append spy instead).
    http.post('*/api/v1/products/:id/image', ({ request, params }) => {
      imageRequests.push(request);
      calls.push(`POST /products/${params.id as string}/image`);
      return respondImage();
    }),
  );
  return { listUrls, posts, calls, imageRequests, lastUrl: () => listUrls.at(-1)! };
}

const location = () => screen.getByTestId('location').textContent;

function renderProducts(path = '/platform/catalog') {
  server.use(authMe(sessionFor('platform_admin')));
  return renderAt(path, <AppRoutes />);
}

const table = () => screen.findByRole('table', { name: 'Products' });
const rowOf = (name: string) => screen.getByText(name).closest('tr')!;

async function openCreate() {
  await table();
  await userEvent.click(screen.getByRole('button', { name: 'New product' }));
  const dialog = await screen.findByRole('dialog', { name: 'New product' });
  // The category options load with the modal.
  await within(within(dialog).getByRole('combobox', { name: 'Category' })).findByRole('option', { name: 'Footwear' });
  return dialog;
}

/** Name + category (+ one size row, unless `sizes: false`) — a valid form. */
async function fillValid(dialog: HTMLElement, { sizes = true } = {}) {
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Court Classic');
  await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Category' }), 'Footwear');
  if (sizes) {
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add size' }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Size 1 label' }), '42');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Size 1 SKU' }), 'CC-42');
  }
}

const submit = (dialog: HTMLElement) => userEvent.click(within(dialog).getByRole('button', { name: 'Create product' }));
const labels = (dialog: HTMLElement) =>
  within(dialog)
    .queryAllByRole('textbox', { name: /^Size \d+ label$/ })
    .map((input) => (input as HTMLInputElement).value);

afterEach(() => vi.restoreAllMocks());

describe('/platform/catalog products table', () => {
  it('rows: thumb, name, size count, category, status ("Active" / Inactive badge); no X-Tenant-Id; "New product" in the header', async () => {
    const api = productsApi();
    renderProducts();
    await table();

    const cells = within(rowOf('Trail Runner')).getAllByRole('cell');
    // The last cell holds the row actions (icon buttons; covered in PlatformProductEditModal.test.tsx).
    expect(cells.slice(0, 4).map((c) => c.textContent)).toEqual(['Trail Runner', '3 sizes', 'Footwear', 'Active']);
    expect(within(cells[0]!).getByRole('presentation')).toHaveAttribute('src', 'https://cdn.test/runner.png');
    expect(within(rowOf('Canvas Tote')).getAllByRole('cell').slice(0, 4).map((c) => c.textContent)).toEqual([
      'CTCanvas Tote',
      '1 size',
      'Bags',
      'Inactive',
    ]);
    expect(screen.getByRole('button', { name: 'New product' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New category' })).not.toBeInTheDocument();
    // Default status filter: All (retired products stay listed) — no isActive sent.
    expect(api.lastUrl().searchParams.has('isActive')).toBe(false);
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('all');
  });

  it('search (debounced) → ?search= and the request', async () => {
    const api = productsApi();
    renderProducts();
    await table();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), 'SKU-1');
    await waitFor(() => expect(location()).toBe('/platform/catalog?search=SKU-1'));
    await waitFor(() => expect(api.lastUrl().searchParams.get('search')).toBe('SKU-1'));
  });

  it('category and status filters → URL params and the request', async () => {
    const api = productsApi();
    renderProducts();
    await table();
    const category = screen.getByRole('combobox', { name: 'Category' });
    await within(category).findByRole('option', { name: 'Bags' });
    await userEvent.selectOptions(category, 'Bags');
    expect(location()).toBe(`/platform/catalog?categoryId=${BAGS_ID}`);
    await waitFor(() => expect(api.lastUrl().searchParams.get('categoryId')).toBe(BAGS_ID));

    const status = screen.getByRole('combobox', { name: 'Status' });
    expect(within(status).getAllByRole('option').map((o) => o.textContent)).toEqual(['All', 'Active', 'Inactive']);
    await userEvent.selectOptions(status, 'Inactive');
    expect(location()).toBe(`/platform/catalog?categoryId=${BAGS_ID}&isActive=false`);
    await waitFor(() => expect(api.lastUrl().searchParams.get('isActive')).toBe('false'));
    await userEvent.selectOptions(status, 'Active');
    await waitFor(() => expect(api.lastUrl().searchParams.get('isActive')).toBe('true'));
    await userEvent.selectOptions(status, 'All');
    expect(location()).toBe(`/platform/catalog?categoryId=${BAGS_ID}`);
  });

  it('reads filters and page from the URL; pagination Next → ?page=', async () => {
    const api = productsApi({
      respondList: (url) => HttpResponse.json(envelope(products, { page: Number(url.searchParams.get('page')), total: 60 })),
    });
    renderProducts('/platform/catalog?search=boot&isActive=true&page=2');
    await table();
    expect(api.lastUrl().searchParams.get('search')).toBe('boot');
    expect(api.lastUrl().searchParams.get('isActive')).toBe('true');
    expect(api.lastUrl().searchParams.get('page')).toBe('2');
    await userEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(location()).toBe('/platform/catalog?search=boot&isActive=true&page=3');
    await waitFor(() => expect(api.lastUrl().searchParams.get('page')).toBe('3'));
  });

  it('empty: "No products yet" + New product; filtered: "No results" + Clear filters', async () => {
    productsApi({ respondList: () => HttpResponse.json(envelope([])) });
    renderProducts();
    expect(await screen.findByText('No products yet')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'New product' }).at(-1)!);
    expect(await screen.findByRole('dialog', { name: 'New product' })).toBeInTheDocument();
  });

  it('filtered empty: "No results" + "Clear filters" back to the bare URL', async () => {
    productsApi({ respondList: () => HttpResponse.json(envelope([])) });
    renderProducts('/platform/catalog?search=zzz&isActive=false');
    expect(await screen.findByText('No results')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(location()).toBe('/platform/catalog');
  });

  it('a failed read renders the error state with Retry', async () => {
    productsApi({ respondList: () => apiError(403, 'FORBIDDEN', 'Forbidden') });
    renderProducts();
    expect(await screen.findByText('Data could not be loaded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('/platform/catalog create product — sizes editor', () => {
  it('preset buttons prefill editable rows (empty SKUs); rows can be added and removed', async () => {
    productsApi();
    renderProducts();
    const dialog = await openCreate();
    const presets = within(dialog).getByRole('group', { name: 'Size presets' });
    expect(within(presets).getAllByRole('button').map((b) => b.textContent)).toEqual(['Clothing', 'Footwear', 'One size']);

    await userEvent.click(within(presets).getByRole('button', { name: 'Clothing' }));
    expect(labels(dialog)).toEqual(['XS', 'S', 'M', 'L', 'XL', '2XL']);
    expect(within(dialog).getByRole('textbox', { name: 'Size 1 SKU' })).toHaveValue('');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove size 2' }));
    expect(labels(dialog)).toEqual(['XS', 'M', 'L', 'XL', '2XL']);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add size' }));
    expect(labels(dialog)).toEqual(['XS', 'M', 'L', 'XL', '2XL', '']);
    // A label stays freely editable.
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Size 6 label' }), '3XL');
    expect(labels(dialog).at(-1)).toBe('3XL');
  });

  it('a preset over rows with content asks first: Cancel keeps them, Replace overwrites', async () => {
    productsApi();
    renderProducts();
    const dialog = await openCreate();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add size' }));
    // An empty row is not "content": no confirm.
    await userEvent.click(within(dialog).getByRole('button', { name: 'One size' }));
    expect(screen.queryByRole('dialog', { name: 'Replace sizes?' })).not.toBeInTheDocument();
    expect(labels(dialog)).toEqual(['One size']);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Footwear' }));
    const confirm = await screen.findByRole('dialog', { name: 'Replace sizes?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Replace sizes?' })).not.toBeInTheDocument());
    expect(labels(dialog)).toEqual(['One size']);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Footwear' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Replace sizes?' })).getByRole('button', { name: 'Replace sizes' }));
    expect(labels(dialog)).toEqual(['36', '37', '38', '39', '40', '41', '42', '43', '44', '45']);
    expect(screen.getByRole('dialog', { name: 'New product' })).toBeInTheDocument();
  });

  it('client validation: no sizes → "Add at least one size"; no category; empty row fields; nothing posted', async () => {
    const api = productsApi();
    renderProducts();
    const dialog = await openCreate();
    await submit(dialog);
    expect(await within(dialog).findByText('Add at least one size')).toBeInTheDocument();
    expect(within(dialog).getByText('Name is required')).toBeInTheDocument();
    expect(within(dialog).getByText('Select a category', { selector: 'span' })).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: 'Category' })).toHaveAttribute('aria-invalid', 'true');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Add size' }));
    await submit(dialog);
    expect(await within(dialog).findByText('Label is required')).toBeInTheDocument();
    expect(within(dialog).getByText('SKU is required')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Size 1 SKU' })).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).queryByText('Add at least one size')).not.toBeInTheDocument();
    expect(api.posts).toEqual([]);
  });
});

describe('/platform/catalog create product — submit', () => {
  it('without an image: POST (trimmed, positions by order), no upload; toast, closes, every products query refetched', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const api = productsApi({
      respondPost: async (body) => {
        await gate;
        return HttpResponse.json(product('p-new', (body as { name: string }).name), { status: 201 });
      },
    });
    const { queryClient } = renderProducts();
    // The store-side picker/catalog share the `products` family.
    queryClient.setQueryData(['products', { isActive: true, page: 1, pageSize: 24 }], envelope([]));
    const dialog = await openCreate();
    await fillValid(dialog);
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Description (optional)' }), '  Leather  ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add size' }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Size 2 label' }), ' 43 ');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Size 2 SKU' }), 'CC-43');
    await submit(dialog);
    expect(await within(dialog).findByRole('button', { name: 'Creating…' })).toBeDisabled();
    const before = api.listUrls.length;

    release();
    expect(await screen.findByText('Product created')).toBeInTheDocument();
    expect(api.posts).toEqual([
      {
        name: 'Court Classic',
        description: 'Leather',
        categoryId: FOOTWEAR_ID,
        sizes: [
          { label: '42', sku: 'CC-42', position: 0 },
          { label: '43', sku: 'CC-43', position: 1 },
        ],
      },
    ]);
    expect(api.calls).toEqual(['POST /products']);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(api.listUrls.length).toBeGreaterThan(before));
    expect(queryClient.getQueryState(['products', { isActive: true, page: 1, pageSize: 24 }])?.isInvalidated).toBe(true);
  });

  it('with an image: POST /products, then POST /products/:id/image (multipart field "image"); uploading state; one toast', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const api = productsApi({
      respondImage: async () => {
        await gate;
        return HttpResponse.json({ ...product('p-new', 'Court Classic'), imageUrl: 'https://cdn.test/new.png' });
      },
    });
    const append = vi.spyOn(FormData.prototype, 'append');
    renderProducts();
    const dialog = await openCreate();
    await fillValid(dialog);
    const file = new File(['png-bytes'], 'court.png', { type: 'image/png' });
    await userEvent.upload(within(dialog).getByLabelText('Image (optional)'), file);
    expect(within(dialog).getByText('court.png')).toBeInTheDocument();
    await submit(dialog);

    expect(await within(dialog).findByRole('button', { name: 'Uploading image…' })).toBeDisabled();
    expect(within(dialog).getByText('Uploading…')).toBeInTheDocument();
    release();
    expect(await screen.findByText('Product created')).toBeInTheDocument();
    expect(api.calls).toEqual(['POST /products', 'POST /products/p-new/image']);
    expect(api.imageRequests[0]!.headers.get('content-type')).toMatch(/^multipart\/form-data/);
    expect(api.imageRequests[0]!.headers.get('x-tenant-id')).toBeNull();
    expect(append).toHaveBeenCalledWith('image', file);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('upload failure: the product is kept (never re-posted) — partial-failure error toast, modal closes, list refetched', async () => {
    const api = productsApi({ respondImage: () => apiError(403, 'FORBIDDEN', 'Forbidden') });
    renderProducts();
    const dialog = await openCreate();
    await fillValid(dialog);
    await userEvent.upload(within(dialog).getByLabelText('Image (optional)'), new File(['x'], 'a.jpg', { type: 'image/jpeg' }));
    const before = api.listUrls.length;
    await submit(dialog);

    expect(
      await screen.findByText('The product was created, but the image upload failed. Try again from Edit.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Product created')).not.toBeInTheDocument();
    expect(api.calls).toEqual(['POST /products', 'POST /products/p-new/image']);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(api.listUrls.length).toBeGreaterThan(before));
  });

  it('the image picker speaks English whatever the browser locale: a "Choose image" button, the chosen file name in the hint', async () => {
    productsApi();
    renderProducts();
    const dialog = await openCreate();
    const input = within(dialog).getByLabelText('Image (optional)');
    // The native control renders its own button text in the browser's language (RNF-19), so it is visually hidden.
    expect(input).toHaveClass('sr-only');
    expect(within(dialog).getByText('Choose image')).toBeInTheDocument();
    await userEvent.upload(input, new File(['x'], 'shoe.png', { type: 'image/png' }));
    expect(within(dialog).getByText('shoe.png')).toBeInTheDocument();
  });

  it('client image checks: a non JPEG/PNG file or one over 5 MB is rejected inline, never sent', async () => {
    const api = productsApi();
    renderProducts();
    const dialog = await openCreate();
    await fillValid(dialog);
    const input = within(dialog).getByLabelText('Image (optional)');

    const user = userEvent.setup({ applyAccept: false });
    await user.upload(input, new File(['gif'], 'a.gif', { type: 'image/gif' }));
    expect(within(dialog).getByText('The image must be a JPEG or PNG file')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');

    await user.upload(input, new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }));
    expect(within(dialog).getByText('The image cannot exceed 5 MB')).toBeInTheDocument();
    await submit(dialog);
    expect(api.posts).toEqual([]);

    // Exactly 5 MB is fine.
    await user.upload(input, new File([new Uint8Array(5 * 1024 * 1024)], 'ok.png', { type: 'image/png' }));
    expect(within(dialog).queryByText('The image cannot exceed 5 MB')).not.toBeInTheDocument();
    await submit(dialog);
    expect(await screen.findByText('Product created')).toBeInTheDocument();
    expect(api.calls).toEqual(['POST /products', 'POST /products/p-new/image']);
  });

  it('409 SKU: inline on each offending row; nothing uploaded, the modal stays open', async () => {
    const api = productsApi({
      respondPost: () =>
        apiError(409, 'CONFLICT', 'A SKU is already in use', [
          { path: 'sizes.0.sku', message: 'SKU CC-42 is already in use' },
          { path: 'sizes.1.sku', message: 'SKU CC-42 is repeated in this product' },
        ]),
    });
    renderProducts();
    const dialog = await openCreate();
    await fillValid(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add size' }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Size 2 label' }), '43');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Size 2 SKU' }), 'CC-42');
    await userEvent.upload(within(dialog).getByLabelText('Image (optional)'), new File(['x'], 'a.png', { type: 'image/png' }));
    await submit(dialog);

    expect(await within(dialog).findByText('SKU CC-42 is already in use')).toBeInTheDocument();
    expect(within(dialog).getByText('SKU CC-42 is repeated in this product')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Size 1 SKU' })).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByRole('textbox', { name: 'Size 2 SKU' })).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByRole('textbox', { name: 'Size 1 label' })).not.toHaveAttribute('aria-invalid');
    expect(api.calls).toEqual(['POST /products']);
    expect(screen.getByRole('dialog', { name: 'New product' })).toBeInTheDocument();
  });

  it('409 errors follow their row when an earlier row is removed', async () => {
    productsApi({
      respondPost: () =>
        apiError(409, 'CONFLICT', 'A SKU is already in use', [{ path: 'sizes.1.sku', message: 'SKU B is already in use' }]),
    });
    renderProducts();
    const dialog = await openCreate();
    await fillValid(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add size' }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Size 2 label' }), '43');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Size 2 SKU' }), 'B');
    await submit(dialog);
    await within(dialog).findByText('SKU B is already in use');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove size 1' }));
    expect(within(dialog).getByRole('textbox', { name: 'Size 1 SKU' })).toHaveValue('B');
    expect(within(dialog).getByRole('textbox', { name: 'Size 1 SKU' })).toHaveAttribute('aria-invalid', 'true');
  });

  it('400 details: inline on name, category, sizes and a row label', async () => {
    productsApi({
      respondPost: () =>
        apiError(400, 'VALIDATION_ERROR', 'Invalid request', [
          { path: 'name', message: 'Name is too long' },
          { path: 'categoryId', message: 'Category not found' },
          { path: 'sizes.0.label', message: 'This label is already used' },
          { path: 'sizes', message: 'Too many sizes' },
        ]),
    });
    renderProducts();
    const dialog = await openCreate();
    await fillValid(dialog);
    await submit(dialog);

    expect(await within(dialog).findByText('Category not found')).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: 'Category' })).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByText('Name is too long')).toBeInTheDocument();
    expect(within(dialog).getByText('This label is already used')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Size 1 label' })).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByText('Too many sizes')).toBeInTheDocument();
  });

  it('any other failure: error toast, the modal stays open, nothing uploaded', async () => {
    const api = productsApi({ respondPost: () => apiError(403, 'FORBIDDEN', 'You do not have permission') });
    renderProducts();
    const dialog = await openCreate();
    await fillValid(dialog);
    await userEvent.upload(within(dialog).getByLabelText('Image (optional)'), new File(['x'], 'a.png', { type: 'image/png' }));
    await submit(dialog);
    expect(await screen.findByText('You do not have permission')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'New product' })).toBeInTheDocument();
    expect(api.calls).toEqual(['POST /products']);
  });

  it('reopening after a cancel starts blank', async () => {
    productsApi();
    renderProducts();
    let dialog = await openCreate();
    await fillValid(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    dialog = await openCreate();
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveValue('');
    expect(labels(dialog)).toEqual([]);
  });
});
