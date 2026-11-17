import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { Category, Page } from 'shared';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from '../App';
import { authMe, renderAt, sessionFor } from '../test/renderApp';
import { server } from '../test/server';

const category = (id: string, name: string, description: string | null = null): Category => ({
  id,
  name,
  slug: name.toLowerCase().replace(/\s+/g, '-'),
  description,
});

const footwear = category('c-footwear', 'Footwear', 'Shoes and trainers');
const outerwear = category('c-outerwear', 'Outerwear');
const categories = [footwear, outerwear];

const envelope = <T,>(items: T[]): Page<T> => ({ items, page: 1, pageSize: 100, total: items.length });

const apiError = (status: number, code: string, message: string, details?: unknown) =>
  HttpResponse.json({ error: { code, message, ...(details ? { details } : {}) } }, { status });

type Respond = (body: unknown) => Response | Promise<Response>;

/** `GET/POST /categories`, `PATCH /categories/:id`, recording every request (and the write bodies). */
function categoriesApi({
  respondList = () => HttpResponse.json(envelope(categories)),
  respondPost = (body) => HttpResponse.json({ ...category('c-new', (body as { name: string }).name), ...(body as object) }, { status: 201 }),
  respondPatch = (body) => HttpResponse.json({ ...footwear, ...(body as Partial<Category>) }),
}: {
  respondList?: () => Response | Promise<Response>;
  respondPost?: Respond;
  respondPatch?: Respond;
} = {}) {
  const listRequests: Request[] = [];
  const posts: unknown[] = [];
  const patches: { id: string; body: unknown; tenantHeader: string | null }[] = [];
  server.use(
    http.get('*/api/v1/categories', ({ request }) => {
      listRequests.push(request);
      return respondList();
    }),
    http.post('*/api/v1/categories', async ({ request }) => {
      const body = await request.json();
      posts.push(body);
      return respondPost(body);
    }),
    http.patch('*/api/v1/categories/:id', async ({ request, params }) => {
      const body = await request.json();
      patches.push({ id: params.id as string, body, tenantHeader: request.headers.get('x-tenant-id') });
      return respondPatch(body);
    }),
  );
  return { listRequests, posts, patches };
}

const location = () => screen.getByTestId('location').textContent;

function renderCatalog(path = '/platform/catalog?tab=categories', role: 'manager' | 'employee' | 'platform_admin' = 'platform_admin') {
  server.use(authMe(sessionFor(role)));
  return renderAt(path, <AppRoutes />);
}

const tabs = () => screen.getByRole('navigation', { name: 'Catalog sections' });
const table = () => screen.findByRole('table', { name: 'Categories' });
const rowOf = (name: string) => screen.getByRole('cell', { name }).closest('tr')!;
const nameField = () => screen.getByRole('textbox', { name: 'Name' });
const descriptionField = () => screen.getByRole('textbox', { name: 'Description (optional)' });

async function openCreate() {
  await table();
  await userEvent.click(screen.getByRole('button', { name: 'New category' }));
  return screen.findByRole('dialog', { name: 'New category' });
}

async function openEdit(name: string) {
  await table();
  await userEvent.click(within(rowOf(name)).getByRole('button', { name: `Edit ${name}` }));
  return screen.findByRole('dialog', { name: 'Edit category' });
}

describe('/platform/catalog guard and nav (platform-catalog.md)', () => {
  it.each(['manager', 'employee'] as const)('%s: no Catalog admin item, the URL lands on /unauthorized', async (role) => {
    renderCatalog('/platform/catalog', role);
    expect(await screen.findByRole('heading', { name: 'Unauthorized access' })).toBeInTheDocument();
    expect(location()).toBe('/unauthorized');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).queryByRole('link', { name: 'Catalog admin' })).toBeNull();
  });

  it('platform admin: Catalog admin nav item, active on the route — no store needed', async () => {
    categoriesApi();
    renderCatalog('/platform/catalog');
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Catalog admin' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByRole('heading', { level: 1, name: 'Catalog admin' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Select a store to continue' })).not.toBeInTheDocument();
  });
});

describe('/platform/catalog tabs (URL-held)', () => {
  it('defaults to Products when the URL has no (or an unknown) tab', async () => {
    categoriesApi();
    renderCatalog('/platform/catalog?tab=nope');
    await screen.findByRole('heading', { level: 1, name: 'Catalog admin' });
    expect(within(tabs()).getByRole('link', { name: 'Products' })).toHaveAttribute('aria-current', 'page');
    expect(within(tabs()).getByRole('link', { name: 'Categories' })).not.toHaveAttribute('aria-current');
    expect(screen.queryByRole('table', { name: 'Categories' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New category' })).not.toBeInTheDocument();
  });

  it('switching writes the tab to the URL (dropping the other tab’s params); the header action follows', async () => {
    categoriesApi();
    renderCatalog('/platform/catalog?search=boot&page=2');
    await screen.findByRole('heading', { level: 1, name: 'Catalog admin' });

    await userEvent.click(within(tabs()).getByRole('link', { name: 'Categories' }));
    expect(await table()).toBeInTheDocument();
    expect(location()).toBe('/platform/catalog?tab=categories');
    expect(within(tabs()).getByRole('link', { name: 'Categories' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'New category' })).toBeInTheDocument();

    await userEvent.click(within(tabs()).getByRole('link', { name: 'Products' }));
    await waitFor(() => expect(location()).toBe('/platform/catalog'));
    expect(screen.queryByRole('table', { name: 'Categories' })).not.toBeInTheDocument();
  });

  it('a reload (fresh render) on ?tab=categories opens the Categories tab', async () => {
    categoriesApi();
    renderCatalog('/platform/catalog?tab=categories');
    expect(await table()).toBeInTheDocument();
    expect(within(tabs()).getByRole('link', { name: 'Categories' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('/platform/catalog categories table', () => {
  it('lists every category (unpaginated) with slug and description ("—" when empty); no X-Tenant-Id; no delete', async () => {
    const { listRequests } = categoriesApi();
    renderCatalog();
    await table();

    // Cell 0 holds the order buttons (RF-45).
    expect(within(rowOf('Footwear')).getAllByRole('cell').slice(1, 4).map((c) => c.textContent)).toEqual([
      'Footwear',
      'footwear',
      'Shoes and trainers',
    ]);
    expect(within(rowOf('Outerwear')).getAllByRole('cell')[3]).toHaveTextContent('—');

    const request = listRequests[0]!;
    expect(new URL(request.url).searchParams.get('pageSize')).toBe('100');
    expect(request.headers.get('x-tenant-id')).toBeNull();
    expect(screen.queryByRole('navigation', { name: /pagination/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /next/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('no categories: "No categories yet" with the New category action', async () => {
    categoriesApi({ respondList: () => HttpResponse.json(envelope([])) });
    renderCatalog();
    expect(await screen.findByText('No categories yet')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'New category' }).at(-1)!);
    expect(await screen.findByRole('dialog', { name: 'New category' })).toBeInTheDocument();
  });

  it('a failed read renders the error state with Retry', async () => {
    categoriesApi({ respondList: () => apiError(403, 'FORBIDDEN', 'Forbidden') });
    renderCatalog();
    expect(await screen.findByText('Data could not be loaded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('/platform/catalog category order (RF-45)', () => {
  const kits = category('c-kits', 'Kits');
  const three = [footwear, outerwear, kits];
  const names = () => within(screen.getByRole('table', { name: 'Categories' })).getAllByRole('row').slice(1).map((r) => (r as HTMLTableRowElement).cells[1]!.textContent);

  /** `PUT /categories/order`, recording each body; the list answers with the last saved order. */
  function orderApi(respond: () => Response | Promise<Response> = () => new HttpResponse(null, { status: 204 })) {
    const puts: string[][] = [];
    let current = three;
    categoriesApi({ respondList: () => HttpResponse.json(envelope(current)) });
    server.use(
      http.put('*/api/v1/categories/order', async ({ request }) => {
        const { ids } = (await request.json()) as { ids: string[] };
        puts.push(ids);
        const res = await respond();
        if (res.status === 204) current = ids.map((id) => three.find((c) => c.id === id)!);
        return res;
      }),
    );
    return puts;
  }

  it('the first row cannot move up, the last cannot move down', async () => {
    orderApi();
    renderCatalog();
    await table();
    expect(screen.getByRole('button', { name: 'Move Footwear up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Footwear down' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Move Kits down' })).toBeDisabled();
  });

  it('moving a category sends the whole new order and the table follows', async () => {
    const puts = orderApi();
    renderCatalog();
    await table();
    await userEvent.click(screen.getByRole('button', { name: 'Move Kits up' }));

    await waitFor(() => expect(puts).toEqual([['c-footwear', 'c-kits', 'c-outerwear']]));
    await waitFor(() => expect(names()).toEqual(['Footwear', 'Kits', 'Outerwear']));
  });

  it('a failed save restores the previous order and toasts the API message', async () => {
    orderApi(() => apiError(409, 'CONFLICT', 'The categories changed since you loaded them; reload and try again'));
    renderCatalog();
    await table();
    await userEvent.click(screen.getByRole('button', { name: 'Move Footwear down' }));

    expect(await screen.findByText('The categories changed since you loaded them; reload and try again')).toBeInTheDocument();
    await waitFor(() => expect(names()).toEqual(['Footwear', 'Outerwear', 'Kits']));
  });
});

describe('/platform/catalog create category', () => {
  it('name + description → POST (trimmed); toast, modal closes, every categories query is refetched', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const api = categoriesApi({
      respondPost: async (body) => {
        await gate;
        return HttpResponse.json({ ...category('c-bags', 'Bags'), ...(body as object) }, { status: 201 });
      },
    });
    const { queryClient } = renderCatalog();
    // A store-side filter's option source (e.g. under another key of the `categories` family).
    queryClient.setQueryData(['categories', { other: true }], envelope(categories));
    const dialog = await openCreate();

    // The slug is never an input on create (RN-10).
    expect(within(dialog).queryByLabelText('Slug')).not.toBeInTheDocument();
    await userEvent.type(nameField(), '  Bags  ');
    await userEvent.type(descriptionField(), ' Totes and backpacks ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create category' }));
    expect(await within(dialog).findByRole('button', { name: 'Creating…' })).toBeDisabled();
    const before = api.listRequests.length;

    release();
    expect(await screen.findByText('Category created')).toBeInTheDocument();
    expect(api.posts).toEqual([{ name: 'Bags', description: 'Totes and backpacks' }]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(api.listRequests.length).toBeGreaterThan(before));
    expect(queryClient.getQueryState(['categories', { other: true }])?.isInvalidated).toBe(true);
  });

  it('an empty description is sent as null', async () => {
    const api = categoriesApi();
    renderCatalog();
    const dialog = await openCreate();
    await userEvent.type(nameField(), 'Bags');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create category' }));
    expect(await screen.findByText('Category created')).toBeInTheDocument();
    expect(api.posts).toEqual([{ name: 'Bags', description: null }]);
  });

  it('client validation: an empty name is an inline error and nothing is posted', async () => {
    const api = categoriesApi();
    renderCatalog();
    const dialog = await openCreate();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create category' }));
    expect(await within(dialog).findByText('Name is required')).toBeInTheDocument();
    expect(nameField()).toHaveAttribute('aria-invalid', 'true');
    expect(api.posts).toEqual([]);
  });

  it('409 (equivalent slug): inline on Name, the modal stays open', async () => {
    categoriesApi({
      respondPost: () => apiError(409, 'CONFLICT', 'A category with an equivalent name already exists'),
    });
    renderCatalog();
    const dialog = await openCreate();
    await userEvent.type(nameField(), 'foot wear');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create category' }));

    expect(await within(dialog).findByText('A category with an equivalent name already exists')).toBeInTheDocument();
    expect(nameField()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('dialog', { name: 'New category' })).toBeInTheDocument();
  });

  it('400 on name (no letters or digits): inline on Name', async () => {
    categoriesApi({
      respondPost: () =>
        apiError(400, 'VALIDATION_ERROR', 'Invalid request', [
          { path: 'name', message: 'Name must contain letters or numbers' },
        ]),
    });
    renderCatalog();
    const dialog = await openCreate();
    await userEvent.type(nameField(), '!!!');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create category' }));
    expect(await within(dialog).findByText('Name must contain letters or numbers')).toBeInTheDocument();
    expect(nameField()).toHaveAttribute('aria-invalid', 'true');
  });

  it('any other failure: error toast, the modal stays open', async () => {
    categoriesApi({ respondPost: () => apiError(403, 'FORBIDDEN', 'You do not have permission') });
    renderCatalog();
    const dialog = await openCreate();
    await userEvent.type(nameField(), 'Bags');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create category' }));
    expect(await screen.findByText('You do not have permission')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'New category' })).toBeInTheDocument();
  });
});

describe('/platform/catalog edit category', () => {
  it('prefilled fields, read-only slug → PATCH { name, description }; toast, list and product rows refetched', async () => {
    const api = categoriesApi();
    const { queryClient } = renderCatalog();
    // Product rows carry the category name.
    queryClient.setQueryData(['products', { page: 1 }], envelope([]));
    const dialog = await openEdit('Footwear');

    expect(nameField()).toHaveValue('Footwear');
    expect(descriptionField()).toHaveValue('Shoes and trainers');
    const slug = within(dialog).getByLabelText('Slug');
    expect(slug).toHaveValue('footwear');
    expect(slug).toHaveAttribute('readonly');

    await userEvent.clear(nameField());
    await userEvent.type(nameField(), 'Shoes');
    await userEvent.clear(descriptionField());
    const before = api.listRequests.length;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Category updated')).toBeInTheDocument();
    expect(api.patches).toEqual([{ id: footwear.id, body: { name: 'Shoes', description: null }, tenantHeader: null }]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(api.listRequests.length).toBeGreaterThan(before));
    expect(queryClient.getQueryState(['products', { page: 1 }])?.isInvalidated).toBe(true);
  });

  it('400 on name: inline, the modal stays open', async () => {
    categoriesApi({
      respondPatch: () =>
        apiError(400, 'VALIDATION_ERROR', 'Invalid request', [
          { path: 'name', message: 'Name must contain letters or numbers' },
        ]),
    });
    renderCatalog();
    const dialog = await openEdit('Footwear');
    await userEvent.clear(nameField());
    await userEvent.type(nameField(), '***');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await within(dialog).findByText('Name must contain letters or numbers')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Edit category' })).toBeInTheDocument();
  });

  it('reopening after a cancelled edit starts from the row’s current values', async () => {
    categoriesApi();
    renderCatalog();
    const dialog = await openEdit('Footwear');
    await userEvent.clear(nameField());
    await userEvent.type(nameField(), 'Draft');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await openEdit('Footwear');
    expect(nameField()).toHaveValue('Footwear');
  });
});
