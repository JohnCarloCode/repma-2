import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { Page, Tenant } from 'shared';
import { afterEach, describe, expect, it } from 'vitest';
import { AppRoutes } from '../App';
import { formatDate } from '../lib/format';
import { SELECTED_STORE_KEY } from '../tenant/activeStore';
import { authMe, renderAt, sessionFor } from '../test/renderApp';
import { server } from '../test/server';

const tenant = (id: string, name: string, over: Partial<Tenant> = {}): Tenant => ({
  id,
  name,
  slug: name.toLowerCase().replace(/\s+/g, '-'),
  isActive: true,
  createdAt: '2026-01-10T09:30:00.000Z',
  ...over,
});

const downtown = tenant('t-downtown', 'Downtown Store');
const north = tenant('t-north', 'North Store');
const closed = tenant('t-closed', 'Closed Store', { isActive: false });
const stores = [closed, downtown, north];

const envelope = <T,>(items: T[], over: Partial<Page<T>> = {}): Page<T> => ({
  items,
  page: 1,
  pageSize: 20,
  total: items.length,
  ...over,
});

const apiError = (status: number, code: string, message: string, details?: unknown) =>
  HttpResponse.json({ error: { code, message, ...(details ? { details } : {}) } }, { status });

type Respond = (body: unknown) => Response | Promise<Response>;

/** `GET/POST /tenants`, `PATCH /tenants/:id`, recording every request (and the write bodies). */
function tenantsApi({
  respondList = () => HttpResponse.json(envelope(stores)),
  respondPost = (body) => HttpResponse.json(tenant('t-new', (body as { name: string }).name), { status: 201 }),
  respondPatch = (body) => HttpResponse.json({ ...downtown, ...(body as Partial<Tenant>) }),
}: {
  respondList?: (url: URL) => Response | Promise<Response>;
  respondPost?: Respond;
  respondPatch?: Respond;
} = {}) {
  const listRequests: Request[] = [];
  const posts: unknown[] = [];
  const patches: { id: string; body: unknown; tenantHeader: string | null }[] = [];
  server.use(
    http.get('*/api/v1/tenants', ({ request }) => {
      listRequests.push(request);
      return respondList(new URL(request.url));
    }),
    http.post('*/api/v1/tenants', async ({ request }) => {
      const body = await request.json();
      posts.push(body);
      return respondPost(body);
    }),
    http.patch('*/api/v1/tenants/:id', async ({ request, params }) => {
      const body = await request.json();
      patches.push({ id: params.id as string, body, tenantHeader: request.headers.get('x-tenant-id') });
      return respondPatch(body);
    }),
  );
  const listCalls = () => listRequests.filter((r) => new URL(r.url).searchParams.get('pageSize') !== '100');
  return { listRequests, listCalls, posts, patches };
}

const location = () => screen.getByTestId('location').textContent;

function renderTenants(path = '/platform/tenants', role: 'manager' | 'employee' | 'platform_admin' = 'platform_admin') {
  server.use(authMe(sessionFor(role)));
  return renderAt(path, <AppRoutes />);
}

const table = () => screen.findByRole('table', { name: 'Stores' });
const rowOf = (name: string) => screen.getByRole('cell', { name }).closest('tr')!;
const nameField = () => screen.getByRole('textbox', { name: 'Name' });

/** Seeds the sidebar selector's source query so its invalidation can be observed. */
const seedSelector = (queryClient: ReturnType<typeof renderTenants>['queryClient']) =>
  queryClient.setQueryData(['tenants', 'selector'], envelope(stores, { pageSize: 100 }));
const selectorInvalidated = (queryClient: ReturnType<typeof renderTenants>['queryClient']) =>
  queryClient.getQueryState(['tenants', 'selector'])?.isInvalidated;

async function openEdit(name: string) {
  await table();
  await userEvent.click(within(rowOf(name)).getByRole('button', { name: `Edit ${name}` }));
  return screen.findByRole('dialog', { name: 'Edit store' });
}

afterEach(() => localStorage.clear());

describe('/platform/tenants guard, nav and role home (platform-tenants.md, login.md)', () => {
  it.each(['manager', 'employee'] as const)('%s: no Platform nav section, the URL lands on /unauthorized', async (role) => {
    renderTenants('/platform/tenants', role);
    expect(await screen.findByRole('heading', { name: 'Unauthorized access' })).toBeInTheDocument();
    expect(location()).toBe('/unauthorized');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).queryByRole('link', { name: 'Stores' })).toBeNull();
    expect(within(nav).queryByRole('heading', { name: 'Platform' })).toBeNull();
  });

  it('platform admin: the Platform section with Stores, active on the route — no store needed', async () => {
    tenantsApi();
    renderTenants();
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('heading', { name: 'Platform' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Stores' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByRole('heading', { level: 1, name: 'Stores' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Select a store to continue' })).not.toBeInTheDocument();
  });

  it('platform admin on /unauthorized: "Go to stores" leads to /platform/tenants', async () => {
    tenantsApi();
    renderTenants('/unauthorized');
    await userEvent.click(await screen.findByRole('link', { name: 'Go to stores' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Stores' })).toBeInTheDocument();
    expect(location()).toBe('/platform/tenants');
  });
});

describe('/platform/tenants table', () => {
  it('lists every store (inactive included) with slug, status and created date; no X-Tenant-Id; no delete anywhere', async () => {
    localStorage.setItem(SELECTED_STORE_KEY, JSON.stringify({ id: north.id, name: north.name }));
    const { listCalls } = tenantsApi({ respondList: () => HttpResponse.json(envelope(stores, { total: 3 })) });
    renderTenants();

    await table();
    expect(screen.getByText('3 stores on the platform')).toBeInTheDocument();
    const cells = within(rowOf('Downtown Store')).getAllByRole('cell');
    expect(cells.slice(0, 4).map((c) => c.textContent)).toEqual([
      'Downtown Store',
      'downtown-store',
      'Active',
      formatDate(downtown.createdAt),
    ]);
    expect(within(rowOf('Closed Store')).getByText('Inactive')).toBeInTheDocument();

    const request = listCalls()[0]!;
    expect(new URL(request.url).searchParams.get('page')).toBe('1');
    expect(request.headers.get('x-tenant-id')).toBeNull();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();

    await openEdit('Downtown Store');
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('search is debounced into the URL and the request; no match → "No results for this search" + Clear filters', async () => {
    const { listCalls } = tenantsApi({
      respondList: (url) => HttpResponse.json(envelope(url.searchParams.get('search') ? [] : stores)),
    });
    renderTenants();
    await table();

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), 'zzz');
    expect(await screen.findByText('No results for this search')).toBeInTheDocument();
    expect(location()).toBe('/platform/tenants?search=zzz');
    expect(new URL(listCalls().at(-1)!.url).searchParams.get('search')).toBe('zzz');

    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await table()).toBeInTheDocument();
    expect(location()).toBe('/platform/tenants');
  });

  it('no stores at all: "No stores yet" with the New store action', async () => {
    tenantsApi({ respondList: () => HttpResponse.json(envelope([])) });
    renderTenants();
    expect(await screen.findByText('No stores yet')).toBeInTheDocument();
    const actions = screen.getAllByRole('button', { name: 'New store' });
    await userEvent.click(actions.at(-1)!);
    expect(await screen.findByRole('dialog', { name: 'New store' })).toBeInTheDocument();
  });

  it('a failed read renders the error state with Retry', async () => {
    tenantsApi({ respondList: () => apiError(403, 'FORBIDDEN', 'Forbidden') });
    renderTenants();
    expect(await screen.findByText('Data could not be loaded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('pagination drives the page param', async () => {
    const { listCalls } = tenantsApi({
      respondList: (url) =>
        HttpResponse.json(envelope(stores, { page: Number(url.searchParams.get('page')), total: 45 })),
    });
    renderTenants();
    await table();
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(location()).toBe('/platform/tenants?page=2'));
    await waitFor(() => expect(new URL(listCalls().at(-1)!.url).searchParams.get('page')).toBe('2'));
  });
});

describe('/platform/tenants create', () => {
  const openCreate = async () => {
    await table();
    await userEvent.click(screen.getByRole('button', { name: 'New store' }));
    return screen.findByRole('dialog', { name: 'New store' });
  };

  it('name only → POST { name } (trimmed); toast, modal closes, the list and the selector source are refetched', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const api = tenantsApi({
      respondPost: async (body) => {
        await gate;
        return HttpResponse.json(tenant('t-south', (body as { name: string }).name), { status: 201 });
      },
    });
    const { queryClient } = renderTenants();
    seedSelector(queryClient);
    const dialog = await openCreate();

    // The slug is never an input (RN-10).
    expect(within(dialog).getAllByRole('textbox')).toHaveLength(1);
    await userEvent.type(nameField(), '  South Store  ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create store' }));
    expect(await within(dialog).findByRole('button', { name: 'Creating…' })).toBeDisabled();
    const before = api.listCalls().length;

    release();
    expect(await screen.findByText('Store created')).toBeInTheDocument();
    expect(api.posts).toEqual([{ name: 'South Store' }]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(api.listCalls().length).toBeGreaterThan(before));
    expect(selectorInvalidated(queryClient)).toBe(true);
  });

  it('client validation: an empty name is an inline error and nothing is posted', async () => {
    const api = tenantsApi();
    renderTenants();
    const dialog = await openCreate();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create store' }));
    expect(await within(dialog).findByText('Name is required')).toBeInTheDocument();
    expect(nameField()).toHaveAttribute('aria-invalid', 'true');
    expect(api.posts).toEqual([]);
  });

  it('409 (equivalent slug): inline on Name, the modal stays open', async () => {
    tenantsApi({
      respondPost: () => apiError(409, 'CONFLICT', 'A store with an equivalent name already exists'),
    });
    renderTenants();
    const dialog = await openCreate();
    await userEvent.type(nameField(), 'Downtown  store');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create store' }));

    expect(await within(dialog).findByText('A store with an equivalent name already exists')).toBeInTheDocument();
    expect(nameField()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('dialog', { name: 'New store' })).toBeInTheDocument();
  });

  it('400 on name (no letters or digits): inline on Name', async () => {
    tenantsApi({
      respondPost: () =>
        apiError(400, 'VALIDATION_ERROR', 'Invalid request', [
          { path: 'name', message: 'Name must contain letters or numbers' },
        ]),
    });
    renderTenants();
    const dialog = await openCreate();
    await userEvent.type(nameField(), '!!!');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create store' }));
    expect(await within(dialog).findByText('Name must contain letters or numbers')).toBeInTheDocument();
    expect(nameField()).toHaveAttribute('aria-invalid', 'true');
  });

  it('any other failure: error toast, the modal stays open', async () => {
    tenantsApi({ respondPost: () => apiError(403, 'FORBIDDEN', 'You do not have permission') });
    renderTenants();
    const dialog = await openCreate();
    await userEvent.type(nameField(), 'South Store');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create store' }));
    expect(await screen.findByText('You do not have permission')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'New store' })).toBeInTheDocument();
  });
});

describe('/platform/tenants edit', () => {
  it('prefilled name, read-only slug → PATCH { name }; toast, list + selector refetched', async () => {
    const api = tenantsApi();
    const { queryClient } = renderTenants();
    seedSelector(queryClient);
    const dialog = await openEdit('Downtown Store');

    expect(nameField()).toHaveValue('Downtown Store');
    const slug = within(dialog).getByLabelText('Slug');
    expect(slug).toHaveValue('downtown-store');
    expect(slug).toHaveAttribute('readonly');

    await userEvent.clear(nameField());
    await userEvent.type(nameField(), 'Downtown Flagship');
    const before = api.listCalls().length;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Store updated')).toBeInTheDocument();
    expect(api.patches).toEqual([{ id: downtown.id, body: { name: 'Downtown Flagship' }, tenantHeader: null }]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(api.listCalls().length).toBeGreaterThan(before));
    expect(selectorInvalidated(queryClient)).toBe(true);
  });

  it('400 on name: inline, the modal stays open', async () => {
    tenantsApi({
      respondPatch: () =>
        apiError(400, 'VALIDATION_ERROR', 'Invalid request', [
          { path: 'name', message: 'Name must contain letters or numbers' },
        ]),
    });
    renderTenants();
    const dialog = await openEdit('Downtown Store');
    await userEvent.clear(nameField());
    await userEvent.type(nameField(), '***');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await within(dialog).findByText('Name must contain letters or numbers')).toBeInTheDocument();
  });

  it('renaming the selected store updates the sidebar selector name', async () => {
    localStorage.setItem(SELECTED_STORE_KEY, JSON.stringify({ id: downtown.id, name: downtown.name }));
    tenantsApi();
    renderTenants();
    const dialog = await openEdit('Downtown Store');
    await userEvent.clear(nameField());
    await userEvent.type(nameField(), 'Downtown Flagship');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await screen.findByText('Store updated');
    const sidebar = screen.getByRole('complementary');
    expect(await within(sidebar).findByRole('button', { name: 'Store: Downtown Flagship' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(SELECTED_STORE_KEY)!)).toEqual({ id: downtown.id, name: 'Downtown Flagship' });
  });
});

describe('/platform/tenants deactivate / reactivate (PD-03, RF-05)', () => {
  it('deactivate: confirm with the consequence copy; Cancel sends nothing', async () => {
    const api = tenantsApi();
    renderTenants();
    const dialog = await openEdit('Downtown Store');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate store' }));

    const confirm = await screen.findByRole('dialog', { name: 'Deactivate store' });
    expect(confirm).toHaveTextContent(
      'Deactivate the store “Downtown Store”? Its users will not be able to operate while it is deactivated.',
    );
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.patches).toEqual([]);
  });

  it('confirm → PATCH { isActive: false } (pending label), toast, list + selector refetched', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const api = tenantsApi({
      respondPatch: async (body) => {
        await gate;
        return HttpResponse.json({ ...downtown, ...(body as Partial<Tenant>) });
      },
    });
    const { queryClient } = renderTenants();
    seedSelector(queryClient);
    const dialog = await openEdit('Downtown Store');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate store' }));
    const confirm = await screen.findByRole('dialog', { name: 'Deactivate store' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Deactivate store' }));
    expect(await within(confirm).findByRole('button', { name: 'Deactivating…' })).toBeDisabled();
    const before = api.listCalls().length;

    release();
    expect(await screen.findByText('Store deactivated')).toBeInTheDocument();
    expect(api.patches).toEqual([{ id: downtown.id, body: { isActive: false }, tenantHeader: null }]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(api.listCalls().length).toBeGreaterThan(before));
    expect(selectorInvalidated(queryClient)).toBe(true);
  });

  it('reactivate an inactive store: its own copy, PATCH { isActive: true }, toast', async () => {
    const api = tenantsApi({ respondPatch: (body) => HttpResponse.json({ ...closed, ...(body as Partial<Tenant>) }) });
    renderTenants();
    const dialog = await openEdit('Closed Store');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reactivate store' }));

    const confirm = await screen.findByRole('dialog', { name: 'Reactivate store' });
    expect(confirm).toHaveTextContent('Reactivate the store “Closed Store”? Its users will be able to operate again.');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Reactivate store' }));
    expect(await screen.findByText('Store reactivated')).toBeInTheDocument();
    expect(api.patches).toEqual([{ id: closed.id, body: { isActive: true }, tenantHeader: null }]);
  });

  it('a failure: error toast with the API message, the confirm closes, nothing else changes', async () => {
    tenantsApi({ respondPatch: () => apiError(404, 'NOT_FOUND', 'Store not found') });
    renderTenants();
    const dialog = await openEdit('Downtown Store');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate store' }));
    const confirm = await screen.findByRole('dialog', { name: 'Deactivate store' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Deactivate store' }));

    expect(await screen.findByText('Store not found')).toBeInTheDocument();
    expect(screen.queryByText('Store deactivated')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('deactivating the selected store clears the selection (layout.md: the selector lists active stores only)', async () => {
    localStorage.setItem(SELECTED_STORE_KEY, JSON.stringify({ id: downtown.id, name: downtown.name }));
    tenantsApi();
    renderTenants();
    const dialog = await openEdit('Downtown Store');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate store' }));
    const confirm = await screen.findByRole('dialog', { name: 'Deactivate store' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Deactivate store' }));

    await screen.findByText('Store deactivated');
    const sidebar = screen.getByRole('complementary');
    expect(await within(sidebar).findByRole('button', { name: 'Select a store' })).toBeInTheDocument();
    expect(localStorage.getItem(SELECTED_STORE_KEY)).toBeNull();
  });
});
