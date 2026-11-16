import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { Category, Page, Product, ProductSize } from 'shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';
import { authMe, renderAt, sessionFor } from '../test/renderApp';
import { server } from '../test/server';

// platform-catalog.md §Edit modal + §Flows · Edit product / Deactivate-reactivate size /
// Retire-reactivate product (plan 8.7).

const FOOTWEAR_ID = '00000000-0000-4000-8000-0000000000f1';
const BAGS_ID = '00000000-0000-4000-8000-0000000000f2';
const categories: Category[] = [
  { id: FOOTWEAR_ID, name: 'Footwear', slug: 'footwear', description: null },
  { id: BAGS_ID, name: 'Bags', slug: 'bags', description: null },
];

const size = (id: string, label: string, position: number, isActive = true): ProductSize => ({
  id,
  label,
  sku: `SKU-${label}`,
  position,
  isActive,
});

const runner: Product = {
  id: 'p-runner',
  name: 'Trail Runner',
  description: 'Grippy',
  imageUrl: 'https://cdn.test/runner.png',
  categoryId: FOOTWEAR_ID,
  categoryName: 'Footwear',
  isActive: true,
  sizes: [size('r1', '40', 0), size('r2', '41', 1), size('r3', '42', 2, false)],
};
const tote: Product = {
  ...runner,
  id: 'p-tote',
  name: 'Canvas Tote',
  description: null,
  imageUrl: null,
  categoryId: BAGS_ID,
  categoryName: 'Bags',
  isActive: false,
  sizes: [size('t1', 'One size', 0)],
};

const envelope = <T,>(items: T[], extra: Partial<Page<T>> = {}): Page<T> => ({
  items,
  page: 1,
  pageSize: 20,
  total: items.length,
  ...extra,
});

const apiError = (status: number, code: string, message: string, details?: unknown) =>
  HttpResponse.json({ error: { code, message, ...(details ? { details } : {}) } }, { status });

type Respond = (body: unknown, params: Record<string, string>) => Response | Promise<Response>;

/** Every catalog write the edit flows make, recorded in order (`calls`) with their bodies. */
function catalogApi({
  respondPatch = (body, { id }) => HttpResponse.json({ ...(id === tote.id ? tote : runner), ...(body as object) }),
  respondSizePatch = (body, { sizeId }) =>
    HttpResponse.json({
      ...runner,
      sizes: runner.sizes.map((s) => (s.id === sizeId ? { ...s, ...(body as object) } : s)),
    }),
  respondSizePost = (body) =>
    HttpResponse.json({ ...runner, sizes: [...runner.sizes, { id: 'r4', position: 3, isActive: true, ...(body as object) }] }, {
      status: 201,
    }),
  respondImage = () => HttpResponse.json({ ...runner, imageUrl: 'https://cdn.test/new.png' }),
}: {
  respondPatch?: Respond;
  respondSizePatch?: Respond;
  respondSizePost?: Respond;
  respondImage?: () => Response | Promise<Response>;
} = {}) {
  const calls: { call: string; body?: unknown }[] = [];
  const imageRequests: Request[] = [];
  let lists = 0;
  server.use(
    http.get('*/api/v1/categories', () => HttpResponse.json(envelope(categories, { pageSize: 100 }))),
    http.get('*/api/v1/products', () => {
      lists += 1;
      return HttpResponse.json(envelope([runner, tote]));
    }),
    http.patch('*/api/v1/products/:id', async ({ request, params }) => {
      const body = await request.json();
      calls.push({ call: `PATCH /products/${params.id as string}`, body });
      return respondPatch(body, params as Record<string, string>);
    }),
    http.patch('*/api/v1/products/:id/sizes/:sizeId', async ({ request, params }) => {
      const body = await request.json();
      calls.push({ call: `PATCH /products/${params.id as string}/sizes/${params.sizeId as string}`, body });
      return respondSizePatch(body, params as Record<string, string>);
    }),
    http.post('*/api/v1/products/:id/sizes', async ({ request, params }) => {
      const body = await request.json();
      calls.push({ call: `POST /products/${params.id as string}/sizes`, body });
      return respondSizePost(body, params as Record<string, string>);
    }),
    // jsdom's File can't be streamed by Node's fetch: the field is asserted via a FormData.append spy.
    http.post('*/api/v1/products/:id/image', ({ request, params }) => {
      imageRequests.push(request);
      calls.push({ call: `POST /products/${params.id as string}/image` });
      return respondImage();
    }),
  );
  return { calls, imageRequests, lists: () => lists };
}

const gated = () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  return { gate, release };
};

/** A store-side products query (picker) — every write must invalidate the shared family. */
const PICKER_KEY = ['products', { isActive: true, page: 1, pageSize: 24 }];

function renderProducts() {
  server.use(authMe(sessionFor('platform_admin')));
  const result = renderAt('/platform/catalog', <AppRoutes />);
  result.queryClient.setQueryData(PICKER_KEY, envelope([]));
  return result;
}

const table = () => screen.findByRole('table', { name: 'Products' });
const pickerInvalidated = (queryClient: ReturnType<typeof renderProducts>['queryClient']) =>
  queryClient.getQueryState(PICKER_KEY)?.isInvalidated;

async function openEdit(name = 'Trail Runner') {
  await table();
  await userEvent.click(screen.getByRole('button', { name: `Edit ${name}` }));
  const dialog = await screen.findByRole('dialog', { name: 'Edit product' });
  await within(within(dialog).getByRole('combobox', { name: 'Category' })).findByRole('option', { name: 'Bags' });
  return dialog;
}

async function openSizes(dialog: HTMLElement) {
  await userEvent.click(within(dialog).getByRole('button', { name: /^Sizes/ }));
  return within(dialog).getByRole('list', { name: 'Sizes' });
}

const save = (dialog: HTMLElement) => userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
const closed = () => waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

afterEach(() => vi.restoreAllMocks());

describe('/platform/catalog products — row actions, retire / reactivate', () => {
  it('Edit on every row; Retire on active products, Reactivate on retired ones; no delete', async () => {
    catalogApi();
    renderProducts();
    await table();
    expect(screen.getByRole('button', { name: 'Edit Trail Runner' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retire Trail Runner' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Canvas Tote' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reactivate Canvas Tote' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Delete/ })).not.toBeInTheDocument();
  });

  it('retire: RN-08 confirm → PATCH { isActive: false } (pending), toast, every products query refetched', async () => {
    const { gate, release } = gated();
    const api = catalogApi({
      respondPatch: async (body) => {
        await gate;
        return HttpResponse.json({ ...runner, ...(body as object) });
      },
    });
    const { queryClient } = renderProducts();
    await table();
    await userEvent.click(screen.getByRole('button', { name: 'Retire Trail Runner' }));
    const dialog = await screen.findByRole('dialog', { name: 'Retire product' });
    expect(dialog).toHaveTextContent(
      'Retire the product “Trail Runner”? It can no longer be added to assortments; existing entries and history are unaffected.',
    );
    const before = api.lists();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retire product' }));
    expect(await within(dialog).findByRole('button', { name: 'Retiring…' })).toBeDisabled();

    release();
    expect(await screen.findByText('Product retired')).toBeInTheDocument();
    expect(api.calls).toEqual([{ call: 'PATCH /products/p-runner', body: { isActive: false } }]);
    await closed();
    await waitFor(() => expect(api.lists()).toBeGreaterThan(before));
    expect(pickerInvalidated(queryClient)).toBe(true);
  });

  it('reactivate: confirm copy → PATCH { isActive: true }, toast', async () => {
    const api = catalogApi();
    renderProducts();
    await table();
    await userEvent.click(screen.getByRole('button', { name: 'Reactivate Canvas Tote' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reactivate product' });
    expect(dialog).toHaveTextContent('Reactivate the product “Canvas Tote”? It can be added to assortments again.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reactivate product' }));
    expect(await screen.findByText('Product reactivated')).toBeInTheDocument();
    expect(api.calls).toEqual([{ call: 'PATCH /products/p-tote', body: { isActive: true } }]);
  });

  it('a failed retire: error toast, the confirm closes, the list is re-read', async () => {
    const api = catalogApi({ respondPatch: () => apiError(403, 'FORBIDDEN', 'You do not have permission') });
    renderProducts();
    await table();
    const before = api.lists();
    await userEvent.click(screen.getByRole('button', { name: 'Retire Trail Runner' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Retire product' }));
    expect(await screen.findByText('You do not have permission')).toBeInTheDocument();
    await closed();
    await waitFor(() => expect(api.lists()).toBeGreaterThan(before));
  });
});

describe('/platform/catalog edit product — fields and image', () => {
  it('prefilled; only the changed fields are sent (pending); toast, closes, every products query refetched', async () => {
    const { gate, release } = gated();
    const api = catalogApi({
      respondPatch: async (body) => {
        await gate;
        return HttpResponse.json({ ...runner, ...(body as object) });
      },
    });
    const { queryClient } = renderProducts();
    const dialog = await openEdit();
    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    expect(name).toHaveValue('Trail Runner');
    expect(within(dialog).getByRole('combobox', { name: 'Category' })).toHaveValue(FOOTWEAR_ID);
    expect(within(dialog).getByRole('textbox', { name: 'Description (optional)' })).toHaveValue('Grippy');

    await userEvent.clear(name);
    await userEvent.type(name, '  Trail Runner II ');
    const before = api.lists();
    await save(dialog);
    expect(await within(dialog).findByRole('button', { name: 'Saving…' })).toBeDisabled();
    release();
    expect(await screen.findByText('Product updated')).toBeInTheDocument();
    expect(api.calls).toEqual([{ call: 'PATCH /products/p-runner', body: { name: 'Trail Runner II' } }]);
    await closed();
    await waitFor(() => expect(api.lists()).toBeGreaterThan(before));
    expect(pickerInvalidated(queryClient)).toBe(true);
  });

  it('a cleared description is sent as null; a new category as categoryId', async () => {
    const api = catalogApi();
    renderProducts();
    const dialog = await openEdit();
    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'Description (optional)' }));
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Category' }), 'Bags');
    await save(dialog);
    expect(await screen.findByText('Product updated')).toBeInTheDocument();
    expect(api.calls).toEqual([{ call: 'PATCH /products/p-runner', body: { description: null, categoryId: BAGS_ID } }]);
  });

  it('nothing changed: closes without a request', async () => {
    const api = catalogApi();
    renderProducts();
    const dialog = await openEdit();
    await save(dialog);
    await closed();
    expect(api.calls).toEqual([]);
    expect(screen.queryByText('Product updated')).not.toBeInTheDocument();
  });

  it('client validation: an emptied name is inline, nothing sent', async () => {
    const api = catalogApi();
    renderProducts();
    const dialog = await openEdit();
    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'Name' }));
    await save(dialog);
    expect(within(dialog).getByText('Name is required')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveAttribute('aria-invalid', 'true');
    expect(api.calls).toEqual([]);
  });

  it('400 details inline on their field; the modal stays open', async () => {
    catalogApi({
      respondPatch: () =>
        apiError(400, 'VALIDATION_ERROR', 'Invalid request', [{ path: 'categoryId', message: 'Category not found' }]),
    });
    renderProducts();
    const dialog = await openEdit();
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Category' }), 'Bags');
    await save(dialog);
    expect(await within(dialog).findByText('Category not found')).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: 'Category' })).toHaveAttribute('aria-invalid', 'true');
  });

  it('404 (gone in another tab): toast, the modal closes, the list is re-read', async () => {
    const api = catalogApi({ respondPatch: () => apiError(404, 'NOT_FOUND', 'Product not found') });
    renderProducts();
    const dialog = await openEdit();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), ' X');
    const before = api.lists();
    await save(dialog);
    expect(await screen.findByText('Product not found')).toBeInTheDocument();
    await closed();
    await waitFor(() => expect(api.lists()).toBeGreaterThan(before));
  });

  it('image only: no PATCH, POST /products/:id/image (multipart "image", uploading state); toast, closes', async () => {
    const { gate, release } = gated();
    const api = catalogApi({
      respondImage: async () => {
        await gate;
        return HttpResponse.json({ ...runner, imageUrl: 'https://cdn.test/new.png' });
      },
    });
    const append = vi.spyOn(FormData.prototype, 'append');
    const { queryClient } = renderProducts();
    const dialog = await openEdit();
    expect(within(dialog).getByText('JPEG or PNG, up to 5 MB — replaces the current image')).toBeInTheDocument();
    const file = new File(['png'], 'new.png', { type: 'image/png' });
    await userEvent.upload(within(dialog).getByLabelText('Image (optional)'), file);
    await save(dialog);
    expect(await within(dialog).findByRole('button', { name: 'Uploading image…' })).toBeDisabled();
    release();
    expect(await screen.findByText('Product updated')).toBeInTheDocument();
    expect(api.calls).toEqual([{ call: 'POST /products/p-runner/image' }]);
    expect(api.imageRequests[0]!.headers.get('content-type')).toMatch(/^multipart\/form-data/);
    expect(append).toHaveBeenCalledWith('image', file);
    await closed();
    expect(pickerInvalidated(queryClient)).toBe(true);
  });

  it('fields + image: PATCH first, then the upload', async () => {
    const api = catalogApi();
    renderProducts();
    const dialog = await openEdit();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), ' 2');
    await userEvent.upload(within(dialog).getByLabelText('Image (optional)'), new File(['j'], 'a.jpg', { type: 'image/jpeg' }));
    await save(dialog);
    expect(await screen.findByText('Product updated')).toBeInTheDocument();
    expect(api.calls.map((c) => c.call)).toEqual(['PATCH /products/p-runner', 'POST /products/p-runner/image']);
  });

  it('upload rejected (413): inline under Image, the modal stays open; the retry only re-uploads (fields already saved)', async () => {
    let uploads = 0;
    const api = catalogApi({
      respondImage: () =>
        ++uploads === 1
          ? apiError(413, 'PAYLOAD_TOO_LARGE', 'The image cannot exceed 5 MB', [
              { path: 'image', message: 'The image cannot exceed 5 MB' },
            ])
          : HttpResponse.json(runner),
    });
    renderProducts();
    const dialog = await openEdit();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), ' 2');
    await userEvent.upload(within(dialog).getByLabelText('Image (optional)'), new File(['p'], 'a.png', { type: 'image/png' }));
    await save(dialog);
    expect(await within(dialog).findByText('The image cannot exceed 5 MB')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Image (optional)')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('dialog', { name: 'Edit product' })).toBeInTheDocument();

    await userEvent.upload(within(dialog).getByLabelText('Image (optional)'), new File(['p'], 'b.png', { type: 'image/png' }));
    await save(dialog);
    expect(await screen.findByText('Product updated')).toBeInTheDocument();
    expect(api.calls.map((c) => c.call)).toEqual([
      'PATCH /products/p-runner',
      'POST /products/p-runner/image',
      'POST /products/p-runner/image',
    ]);
  });

  it('any other upload failure: error toast, the modal stays open', async () => {
    catalogApi({ respondImage: () => apiError(403, 'FORBIDDEN', 'You do not have permission') });
    renderProducts();
    const dialog = await openEdit();
    await userEvent.upload(within(dialog).getByLabelText('Image (optional)'), new File(['p'], 'a.png', { type: 'image/png' }));
    await save(dialog);
    expect(await screen.findByText('You do not have permission')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Edit product' })).toBeInTheDocument();
  });

  it('client image check: a GIF is rejected inline and never sent', async () => {
    const api = catalogApi();
    renderProducts();
    const dialog = await openEdit();
    const user = userEvent.setup({ applyAccept: false });
    await user.upload(within(dialog).getByLabelText('Image (optional)'), new File(['g'], 'a.gif', { type: 'image/gif' }));
    expect(within(dialog).getByText('The image must be a JPEG or PNG file')).toBeInTheDocument();
    await save(dialog);
    expect(api.calls).toEqual([]);
    expect(screen.getByRole('dialog', { name: 'Edit product' })).toBeInTheDocument();
  });
});

describe('/platform/catalog edit product — sizes section', () => {
  it('collapsed by default; expanded it lists every size (inactive flagged) with label, SKU and position; no delete', async () => {
    catalogApi();
    renderProducts();
    const dialog = await openEdit();
    const toggle = within(dialog).getByRole('button', { name: 'Sizes (3)' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const list = await openSizes(dialog);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(within(list).getByRole('textbox', { name: 'Size 40 label' })).toHaveValue('40');
    expect(within(list).getByRole('textbox', { name: 'Size 40 SKU' })).toHaveValue('SKU-40');
    expect(within(list).getByRole('spinbutton', { name: 'Size 41 position' })).toHaveValue(1);
    expect(within(items[2]!).getByText('Inactive')).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'Deactivate size 40' })).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'Reactivate size 42' })).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'Save size 40' })).toBeDisabled();
    expect(within(dialog).queryByRole('button', { name: /delete|remove/i })).not.toBeInTheDocument();
  });

  it('edit a size: PATCH with the changed fields only (pending), toast, the row shows the answer, the modal stays open', async () => {
    const { gate, release } = gated();
    const api = catalogApi({
      respondSizePatch: async (body, { sizeId }) => {
        await gate;
        return HttpResponse.json({
          ...runner,
          sizes: runner.sizes.map((s) => (s.id === sizeId ? { ...s, ...(body as object) } : s)),
        });
      },
    });
    const { queryClient } = renderProducts();
    const dialog = await openEdit();
    const list = await openSizes(dialog);
    const sku = within(list).getByRole('textbox', { name: 'Size 40 SKU' });
    await userEvent.clear(sku);
    await userEvent.type(sku, ' TR-40 ');
    await userEvent.clear(within(list).getByRole('spinbutton', { name: 'Size 40 position' }));
    await userEvent.type(within(list).getByRole('spinbutton', { name: 'Size 40 position' }), '5');
    await userEvent.click(within(list).getByRole('button', { name: 'Save size 40' }));
    await waitFor(() => expect(within(list).getByRole('button', { name: 'Save size 40' })).toHaveTextContent('Saving…'));
    expect(within(list).getByRole('button', { name: 'Save size 40' })).toBeDisabled();
    release();

    expect(await screen.findByText('Size updated')).toBeInTheDocument();
    expect(api.calls).toEqual([{ call: 'PATCH /products/p-runner/sizes/r1', body: { sku: 'TR-40', position: 5 } }]);
    expect(within(list).getByRole('textbox', { name: 'Size 40 SKU' })).toHaveValue('TR-40');
    expect(within(list).getByRole('button', { name: 'Save size 40' })).toBeDisabled();
    expect(screen.getByRole('dialog', { name: 'Edit product' })).toBeInTheDocument();
    expect(pickerInvalidated(queryClient)).toBe(true);
  });

  it('Enter in a size field saves that size, never the product form', async () => {
    const api = catalogApi();
    renderProducts();
    const dialog = await openEdit();
    const list = await openSizes(dialog);
    await userEvent.type(within(list).getByRole('textbox', { name: 'Size 41 label' }), '.5{Enter}');
    expect(await screen.findByText('Size updated')).toBeInTheDocument();
    expect(api.calls).toEqual([{ call: 'PATCH /products/p-runner/sizes/r2', body: { label: '41.5' } }]);
    expect(screen.getByRole('dialog', { name: 'Edit product' })).toBeInTheDocument();
  });

  it('client validation per row: empty label, bad position — inline, nothing sent', async () => {
    const api = catalogApi();
    renderProducts();
    const dialog = await openEdit();
    const list = await openSizes(dialog);
    await userEvent.clear(within(list).getByRole('textbox', { name: 'Size 40 label' }));
    await userEvent.click(within(list).getByRole('button', { name: 'Save size 40' }));
    expect(within(list).getByText('Label is required')).toBeInTheDocument();
    await userEvent.clear(within(list).getByRole('spinbutton', { name: 'Size 41 position' }));
    await userEvent.click(within(list).getByRole('button', { name: 'Save size 41' }));
    expect(within(list).getByText('Enter a whole number from 0 to 9999')).toBeInTheDocument();
    expect(api.calls).toEqual([]);
  });

  it('409 on SKU or label: inline on that row only', async () => {
    catalogApi({
      respondSizePatch: (body) =>
        'sku' in (body as object)
          ? apiError(409, 'CONFLICT', 'SKU SKU-41 is already in use', [{ path: 'sku', message: 'SKU SKU-41 is already in use' }])
          : apiError(409, 'CONFLICT', 'This label is already used', [{ path: 'label', message: 'This label is already used' }]),
    });
    renderProducts();
    const dialog = await openEdit();
    const list = await openSizes(dialog);
    const sku = within(list).getByRole('textbox', { name: 'Size 40 SKU' });
    await userEvent.clear(sku);
    await userEvent.type(sku, 'SKU-41');
    await userEvent.click(within(list).getByRole('button', { name: 'Save size 40' }));
    expect(await within(list).findByText('SKU SKU-41 is already in use')).toBeInTheDocument();
    expect(sku).toHaveAttribute('aria-invalid', 'true');
    expect(within(list).getByRole('textbox', { name: 'Size 41 SKU' })).not.toHaveAttribute('aria-invalid');

    const label = within(list).getByRole('textbox', { name: 'Size 41 label' });
    await userEvent.clear(label);
    await userEvent.type(label, '40');
    await userEvent.click(within(list).getByRole('button', { name: 'Save size 41' }));
    expect(await within(list).findByText('This label is already used')).toBeInTheDocument();
    expect(label).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('dialog', { name: 'Edit product' })).toBeInTheDocument();
  });

  it('404 on a size write: toast, the modal closes, the list is re-read', async () => {
    const api = catalogApi({ respondSizePatch: () => apiError(404, 'NOT_FOUND', 'Size not found') });
    renderProducts();
    const dialog = await openEdit();
    const list = await openSizes(dialog);
    await userEvent.type(within(list).getByRole('textbox', { name: 'Size 40 label' }), '.5');
    const before = api.lists();
    await userEvent.click(within(list).getByRole('button', { name: 'Save size 40' }));
    expect(await screen.findByText('Size not found')).toBeInTheDocument();
    await closed();
    await waitFor(() => expect(api.lists()).toBeGreaterThan(before));
  });

  it('add a size: client check, POST { label, sku } (no position — appended), toast, the new size is listed', async () => {
    const api = catalogApi();
    const { queryClient } = renderProducts();
    const dialog = await openEdit();
    const list = await openSizes(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add size' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save new size' }));
    expect(within(dialog).getByText('Label is required')).toBeInTheDocument();
    expect(api.calls).toEqual([]);

    await userEvent.type(within(dialog).getByRole('textbox', { name: 'New size label' }), ' 43 ');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'New size SKU' }), 'SKU-43');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save new size' }));
    expect(await screen.findByText('Size added')).toBeInTheDocument();
    expect(api.calls).toEqual([{ call: 'POST /products/p-runner/sizes', body: { label: '43', sku: 'SKU-43' } }]);
    expect(within(list).getByRole('textbox', { name: 'Size 43 label' })).toHaveValue('43');
    expect(within(dialog).queryByRole('textbox', { name: 'New size label' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Sizes (4)' })).toBeInTheDocument();
    expect(pickerInvalidated(queryClient)).toBe(true);
  });

  it('add a size: 409 on SKU inline on the new row, which stays open', async () => {
    catalogApi({
      respondSizePost: () =>
        apiError(409, 'CONFLICT', 'SKU SKU-40 is already in use', [{ path: 'sku', message: 'SKU SKU-40 is already in use' }]),
    });
    renderProducts();
    const dialog = await openEdit();
    await openSizes(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add size' }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'New size label' }), '43');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'New size SKU' }), 'SKU-40');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save new size' }));
    expect(await within(dialog).findByText('SKU SKU-40 is already in use')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'New size SKU' })).toHaveAttribute('aria-invalid', 'true');
  });

  it('deactivate a size: RN-08 confirm → PATCH { isActive: false }, toast, the row is flagged Inactive', async () => {
    const { gate, release } = gated();
    const api = catalogApi({
      respondSizePatch: async (body, { sizeId }) => {
        await gate;
        return HttpResponse.json({
          ...runner,
          sizes: runner.sizes.map((s) => (s.id === sizeId ? { ...s, ...(body as object) } : s)),
        });
      },
    });
    renderProducts();
    const dialog = await openEdit();
    const list = await openSizes(dialog);
    await userEvent.click(within(list).getByRole('button', { name: 'Deactivate size 40' }));
    const confirm = await screen.findByRole('dialog', { name: 'Deactivate size' });
    expect(confirm).toHaveTextContent(
      'Deactivate size “40” of “Trail Runner”? It can no longer be added to assortments or lists; existing entries and history are unaffected.',
    );
    await userEvent.click(within(confirm).getByRole('button', { name: 'Deactivate size' }));
    expect(await within(confirm).findByRole('button', { name: 'Deactivating…' })).toBeDisabled();
    release();
    expect(await screen.findByText('Size deactivated')).toBeInTheDocument();
    expect(api.calls).toEqual([{ call: 'PATCH /products/p-runner/sizes/r1', body: { isActive: false } }]);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Deactivate size' })).not.toBeInTheDocument());
    expect(within(list).getByRole('button', { name: 'Reactivate size 40' })).toBeInTheDocument();
    expect(within(within(list).getAllByRole('listitem')[0]!).getByText('Inactive')).toBeInTheDocument();
  });

  it('reactivate a size: confirm copy → PATCH { isActive: true }, toast', async () => {
    const api = catalogApi();
    renderProducts();
    const dialog = await openEdit();
    const list = await openSizes(dialog);
    await userEvent.click(within(list).getByRole('button', { name: 'Reactivate size 42' }));
    const confirm = await screen.findByRole('dialog', { name: 'Reactivate size' });
    expect(confirm).toHaveTextContent('Reactivate size “42” of “Trail Runner”? It can be added to assortments and lists again.');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Reactivate size' }));
    expect(await screen.findByText('Size reactivated')).toBeInTheDocument();
    expect(api.calls).toEqual([{ call: 'PATCH /products/p-runner/sizes/r3', body: { isActive: true } }]);
  });
});
