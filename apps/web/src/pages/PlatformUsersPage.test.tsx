import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { Page, Tenant, User } from 'shared';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from '../App';
import { authMe, renderAt, sessionFor } from '../test/renderApp';
import { server } from '../test/server';

const ME = sessionFor('platform_admin').user.id;

const store = (id: string, name: string, isActive = true): Tenant => ({
  id,
  name,
  slug: name.toLowerCase().replace(/\s+/g, '-'),
  isActive,
  createdAt: '2026-01-10T09:30:00.000Z',
});
const downtown = store('11111111-1111-4111-8111-111111111111', 'Downtown Store');
const north = store('22222222-2222-4222-8222-222222222222', 'North Store');
const closed = store('33333333-3333-4333-8333-333333333333', 'Closed Store', false);

const user = (id: string, fullName: string, over: Partial<User> = {}): User => ({
  id,
  email: `${fullName.split(' ')[0]!.toLowerCase()}@repma.demo`,
  fullName,
  role: 'manager',
  isActive: true,
  tenant: { id: downtown.id, name: downtown.name, isActive: true },
  createdAt: '2026-01-10T09:30:00.000Z',
  ...over,
});
const me = user(ME, 'Ada Admin', { role: 'platform_admin', tenant: null });
const ana = user('u-ana', 'Ana García');
const bob = user('u-bob', 'Bob Stone', { role: 'employee', isActive: false, tenant: { id: closed.id, name: closed.name, isActive: false } });
const users = [me, ana, bob];

const envelope = <T,>(items: T[], over: Partial<Page<T>> = {}): Page<T> => ({
  items,
  page: 1,
  pageSize: 20,
  total: items.length,
  ...over,
});

const apiError = (status: number, code: string, message: string, details?: unknown) =>
  HttpResponse.json({ error: { code, message, ...(details ? { details } : {}) } }, { status });

/** `GET/POST /users` + the stores source `GET /tenants`, recording requests and bodies. */
function usersApi({
  respondList = () => HttpResponse.json(envelope(users)),
  respondPost = (body) => HttpResponse.json(user('u-new', (body as { fullName: string }).fullName), { status: 201 }),
}: {
  respondList?: (url: URL) => Response | Promise<Response>;
  respondPost?: (body: unknown) => Response | Promise<Response>;
} = {}) {
  const listRequests: Request[] = [];
  const posts: { body: unknown; tenantHeader: string | null }[] = [];
  server.use(
    http.get('*/api/v1/users', ({ request }) => {
      listRequests.push(request);
      return respondList(new URL(request.url));
    }),
    http.post('*/api/v1/users', async ({ request }) => {
      const body = await request.json();
      posts.push({ body, tenantHeader: request.headers.get('x-tenant-id') });
      return respondPost(body);
    }),
    http.get('*/api/v1/tenants', () => HttpResponse.json(envelope([closed, downtown, north], { pageSize: 100 }))),
  );
  return { listRequests, posts };
}

const location = () => screen.getByTestId('location').textContent;
const lastParams = (requests: Request[]) => new URL(requests.at(-1)!.url).searchParams;

function renderUsers(path = '/platform/users', role: 'manager' | 'employee' | 'platform_admin' = 'platform_admin') {
  server.use(authMe(sessionFor(role)));
  return renderAt(path, <AppRoutes />);
}

const table = () => screen.findByRole('table', { name: 'Users' });
const rowOf = (text: string) => screen.getByText(text).closest('tr')!;

describe('/platform/users guard and nav (platform-users.md)', () => {
  it.each(['manager', 'employee'] as const)('%s: no Users nav item, the URL lands on /unauthorized', async (role) => {
    renderUsers('/platform/users', role);
    expect(await screen.findByRole('heading', { name: 'Unauthorized access' })).toBeInTheDocument();
    expect(location()).toBe('/unauthorized');
    expect(within(screen.getByRole('navigation', { name: 'Main' })).queryByRole('link', { name: 'Users' })).toBeNull();
  });

  it('platform admin: Users in the Platform section, active on the route — no store needed', async () => {
    usersApi();
    renderUsers();
    const nav = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Users' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByRole('heading', { level: 1, name: 'Users' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Select a store to continue' })).not.toBeInTheDocument();
  });
});

describe('/platform/users table', () => {
  it('name (+ "(you)" on the own row), email, role label, store ("—" for an admin), status; no X-Tenant-Id', async () => {
    const { listRequests } = usersApi({ respondList: () => HttpResponse.json(envelope(users, { total: 3 })) });
    renderUsers();
    await table();

    expect(screen.getByText('3 users on the platform')).toBeInTheDocument();
    const cells = (name: string) =>
      within(rowOf(name))
        .getAllByRole('cell')
        .slice(0, 5)
        .map((c) => c.textContent);
    expect(cells('Ada Admin')).toEqual(['Ada Admin (you)', 'ada@repma.demo', 'Platform Admin', '—', 'Active']);
    expect(cells('Ana García')).toEqual(['Ana García', 'ana@repma.demo', 'Manager', 'Downtown Store', 'Active']);
    expect(cells('Bob Stone')).toEqual(['Bob Stone', 'bob@repma.demo', 'Employee', 'Closed Store', 'Inactive']);
    // An email is one unbreakable word: it may wrap anywhere so the row actions stay inside the card at tablet width.
    expect(screen.getByText('ana@repma.demo')).toHaveClass('[overflow-wrap:anywhere]');
    expect(lastParams(listRequests).get('page')).toBe('1');
    expect(listRequests[0]!.headers.get('x-tenant-id')).toBeNull();
  });

  it('search is debounced into the URL and the request; no match → "No results for this search" + Clear filters', async () => {
    const { listRequests } = usersApi({
      respondList: (url) => HttpResponse.json(envelope(url.searchParams.get('search') ? [] : users)),
    });
    renderUsers();
    await table();

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), 'zzz');
    expect(await screen.findByText('No results for this search')).toBeInTheDocument();
    expect(location()).toBe('/platform/users?search=zzz');
    expect(lastParams(listRequests).get('search')).toBe('zzz');

    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await table()).toBeInTheDocument();
    expect(location()).toBe('/platform/users');
  });

  it('store filter: every store (inactive flagged) → tenantId in the URL and request; empty → "This store has no users"', async () => {
    const { listRequests } = usersApi({
      respondList: (url) => HttpResponse.json(envelope(url.searchParams.get('tenantId') ? [] : users)),
    });
    renderUsers();
    await table();

    const filter = screen.getByRole('combobox', { name: 'Store' });
    await waitFor(() =>
      expect(within(filter).getAllByRole('option').map((o) => o.textContent)).toEqual([
        'All stores',
        'Closed Store (inactive)',
        'Downtown Store',
        'North Store',
      ]),
    );
    await userEvent.selectOptions(filter, north.id);
    expect(await screen.findByText('This store has no users')).toBeInTheDocument();
    expect(location()).toBe(`/platform/users?tenantId=${north.id}`);
    expect(lastParams(listRequests).get('tenantId')).toBe(north.id);

    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await table()).toBeInTheDocument();
    expect(location()).toBe('/platform/users');
  });

  it('a failed read renders the error state with Retry', async () => {
    usersApi({ respondList: () => apiError(403, 'FORBIDDEN', 'Forbidden') });
    renderUsers();
    expect(await screen.findByText('Data could not be loaded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('pagination drives the page param', async () => {
    const { listRequests } = usersApi({
      respondList: (url) => HttpResponse.json(envelope(users, { page: Number(url.searchParams.get('page')), total: 45 })),
    });
    renderUsers();
    await table();
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() => expect(location()).toBe('/platform/users?page=2'));
    await waitFor(() => expect(lastParams(listRequests).get('page')).toBe('2'));
  });
});

describe('/platform/users create (RF-10, RN-01)', () => {
  const openCreate = async () => {
    await table();
    await userEvent.click(screen.getByRole('button', { name: 'New user' }));
    return screen.findByRole('dialog', { name: 'New user' });
  };
  const field = (dialog: HTMLElement, label: string) => within(dialog).getByLabelText(label);
  const storeField = (dialog: HTMLElement) => within(dialog).queryByRole('combobox', { name: 'Store' });

  async function fill(dialog: HTMLElement, { role, storeId }: { role: string; storeId?: string }) {
    await userEvent.type(field(dialog, 'Email'), '  New.User@Repma.Demo ');
    await userEvent.type(field(dialog, 'Password'), 'secret123');
    await userEvent.type(field(dialog, 'Full name'), ' New User ');
    await userEvent.selectOptions(field(dialog, 'Role'), role);
    if (storeId) {
      await waitFor(() => expect(within(storeField(dialog)!).getAllByRole('option').length).toBeGreaterThan(1));
      await userEvent.selectOptions(storeField(dialog)!, storeId);
    }
  }

  it.each([
    ['manager', 'Manager'],
    ['employee', 'Employee'],
  ] as const)('%s with a store → POST (normalized); toast, modal closes, the list is refetched', async (role, label) => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const api = usersApi({
      respondPost: async (body) => {
        await gate;
        return HttpResponse.json(user('u-new', (body as { fullName: string }).fullName), { status: 201 });
      },
    });
    renderUsers();
    const dialog = await openCreate();

    expect(within(dialog).getByRole('option', { name: label })).toBeInTheDocument();
    await fill(dialog, { role, storeId: north.id });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create user' }));
    expect(await within(dialog).findByRole('button', { name: 'Creating…' })).toBeDisabled();
    const before = api.listRequests.length;

    release();
    expect(await screen.findByText('User created')).toBeInTheDocument();
    expect(api.posts).toEqual([
      {
        body: { email: 'new.user@repma.demo', password: 'secret123', fullName: 'New User', role, tenantId: north.id },
        tenantHeader: null,
      },
    ]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(api.listRequests.length).toBeGreaterThan(before));
  });

  it('the store select offers active stores only', async () => {
    usersApi();
    renderUsers();
    const dialog = await openCreate();
    await waitFor(() =>
      expect(within(storeField(dialog)!).getAllByRole('option').map((o) => o.textContent)).toEqual([
        'Select a store',
        'Downtown Store',
        'North Store',
      ]),
    );
  });

  it('Platform Admin: Store is hidden and cleared — tenantId is never sent', async () => {
    const api = usersApi();
    renderUsers();
    const dialog = await openCreate();
    await fill(dialog, { role: 'manager', storeId: downtown.id });

    await userEvent.selectOptions(field(dialog, 'Role'), 'platform_admin');
    expect(storeField(dialog)).toBeNull();
    // Back to a store role: the earlier store does not come back.
    await userEvent.selectOptions(field(dialog, 'Role'), 'employee');
    expect(storeField(dialog)).toHaveValue('');
    await userEvent.selectOptions(field(dialog, 'Role'), 'platform_admin');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Create user' }));
    expect(await screen.findByText('User created')).toBeInTheDocument();
    expect(api.posts.map((p) => p.body)).toEqual([
      { email: 'new.user@repma.demo', password: 'secret123', fullName: 'New User', role: 'platform_admin' },
    ]);
  });

  it('client validation: every missing field inline (store required for a store role); nothing posted; fixed on blur', async () => {
    const api = usersApi();
    renderUsers();
    const dialog = await openCreate();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create user' }));

    expect(await within(dialog).findByText('Enter a valid email address')).toBeInTheDocument();
    expect(within(dialog).getByText('Password must be at least 8 characters')).toBeInTheDocument();
    expect(within(dialog).getByText('Full name is required')).toBeInTheDocument();
    expect(within(dialog).getByText('Select a role', { selector: 'span' })).toBeInTheDocument();
    expect(field(dialog, 'Email')).toHaveAttribute('aria-invalid', 'true');

    await userEvent.selectOptions(field(dialog, 'Role'), 'manager');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create user' }));
    expect(await within(dialog).findByText('Select a store', { selector: 'span' })).toBeInTheDocument();
    expect(storeField(dialog)).toHaveAttribute('aria-invalid', 'true');

    await userEvent.type(field(dialog, 'Email'), 'ok@repma.demo');
    await userEvent.tab();
    expect(within(dialog).queryByText('Enter a valid email address')).not.toBeInTheDocument();
    expect(api.posts).toEqual([]);
  });

  it('password rule: 7 characters is rejected inline, never trimmed', async () => {
    const api = usersApi();
    renderUsers();
    const dialog = await openCreate();
    await userEvent.type(field(dialog, 'Email'), 'x@repma.demo');
    await userEvent.type(field(dialog, 'Password'), 'abc1234');
    await userEvent.type(field(dialog, 'Full name'), 'X');
    await userEvent.selectOptions(field(dialog, 'Role'), 'platform_admin');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create user' }));
    expect(await within(dialog).findByText('Password must be at least 8 characters')).toBeInTheDocument();
    expect(field(dialog, 'Password')).toHaveAttribute('aria-invalid', 'true');
    expect(api.posts).toEqual([]);
  });

  it('409 (email taken): inline on Email, the modal stays open', async () => {
    usersApi({ respondPost: () => apiError(409, 'CONFLICT', 'A user with this email already exists') });
    renderUsers();
    const dialog = await openCreate();
    await fill(dialog, { role: 'platform_admin' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create user' }));

    expect(await within(dialog).findByText('A user with this email already exists')).toBeInTheDocument();
    expect(field(dialog, 'Email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('dialog', { name: 'New user' })).toBeInTheDocument();
  });

  it('400 details map onto their fields (e.g. an inactive store, a weak password)', async () => {
    usersApi({
      respondPost: () =>
        apiError(400, 'VALIDATION_ERROR', 'Invalid request', [
          { path: 'tenantId', message: 'This store is inactive' },
          { path: 'password', message: 'Password is too weak' },
        ]),
    });
    renderUsers();
    const dialog = await openCreate();
    await fill(dialog, { role: 'employee', storeId: downtown.id });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create user' }));

    expect(await within(dialog).findByText('This store is inactive')).toBeInTheDocument();
    expect(within(dialog).getByText('Password is too weak')).toBeInTheDocument();
    expect(storeField(dialog)).toHaveAttribute('aria-invalid', 'true');
    expect(field(dialog, 'Password')).toHaveAttribute('aria-invalid', 'true');
  });

  it('any other failure: error toast, the modal stays open', async () => {
    usersApi({ respondPost: () => apiError(403, 'FORBIDDEN', 'You do not have permission') });
    renderUsers();
    const dialog = await openCreate();
    await fill(dialog, { role: 'platform_admin' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create user' }));
    expect(await screen.findByText('You do not have permission')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'New user' })).toBeInTheDocument();
  });

  it('Cancel resets the form for the next opening', async () => {
    usersApi();
    renderUsers();
    let dialog = await openCreate();
    await userEvent.type(field(dialog, 'Email'), 'draft@repma.demo');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    dialog = await openCreate();
    expect(field(dialog, 'Email')).toHaveValue('');
  });
});

/** `PATCH`/`DELETE /users/:id` on top of `usersApi`, recording bodies. */
function writeApi({
  respondPatch = (id, body) => HttpResponse.json({ ...users.find((u) => u.id === id)!, ...(body as object) }),
  respondDelete = () => new HttpResponse(null, { status: 204 }),
}: {
  respondPatch?: (id: string, body: unknown) => Response | Promise<Response>;
  respondDelete?: (id: string) => Response | Promise<Response>;
} = {}) {
  const patches: { id: string; body: unknown; tenantHeader: string | null }[] = [];
  const deletes: string[] = [];
  server.use(
    http.patch('*/api/v1/users/:id', async ({ request, params }) => {
      const body = await request.json();
      patches.push({ id: params.id as string, body, tenantHeader: request.headers.get('x-tenant-id') });
      return respondPatch(params.id as string, body);
    }),
    http.delete('*/api/v1/users/:id', ({ params }) => {
      deletes.push(params.id as string);
      return respondDelete(params.id as string);
    }),
  );
  return { patches, deletes };
}

/** Counts `GET /auth/me` — call after `renderUsers` so this handler wins over its `authMe`. */
function countAuthMe() {
  const me = { count: 0 };
  server.use(
    http.get('*/api/v1/auth/me', () => {
      me.count += 1;
      return HttpResponse.json(sessionFor('platform_admin'));
    }),
  );
  return me;
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((r) => (release = r));
  return { promise, release };
}

describe('/platform/users row actions (RF-11, RF-12)', () => {
  it('every row has Edit; Delete on every row but the admin\'s own', async () => {
    usersApi();
    renderUsers();
    await table();
    for (const name of ['Ada Admin', 'Ana García', 'Bob Stone']) {
      expect(within(rowOf(name)).getByRole('button', { name: `Edit ${name}` })).toBeInTheDocument();
    }
    expect(within(rowOf('Ana García')).getByRole('button', { name: 'Delete Ana García' })).toBeInTheDocument();
    expect(within(rowOf('Bob Stone')).getByRole('button', { name: 'Delete Bob Stone' })).toBeInTheDocument();
    expect(within(rowOf('Ada Admin')).queryByRole('button', { name: /^Delete/ })).toBeNull();
  });
});

describe('/platform/users edit (RF-11, RF-12, RN-01)', () => {
  const openEdit = async (name: string) => {
    await table();
    await userEvent.click(within(rowOf(name)).getByRole('button', { name: `Edit ${name}` }));
    return screen.findByRole('dialog', { name: 'Edit user' });
  };
  const field = (dialog: HTMLElement, label: string | RegExp) => within(dialog).getByLabelText(label);
  const save = (dialog: HTMLElement) => userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

  it('prefilled: email read-only, role manager ↔ employee, store read-only, status on, password empty', async () => {
    usersApi();
    writeApi();
    renderUsers();
    const dialog = await openEdit('Ana García');

    expect(field(dialog, 'Email')).toHaveValue('ana@repma.demo');
    expect(field(dialog, 'Email')).toHaveAttribute('readonly');
    expect(field(dialog, 'Full name')).toHaveValue('Ana García');
    const role = field(dialog, 'Role');
    expect(role).toHaveValue('manager');
    expect(role).toBeEnabled();
    expect(within(role).getAllByRole('option').map((o) => o.textContent)).toEqual(['Manager', 'Employee']);
    expect(within(dialog).getByTestId('edit-user-store')).toHaveTextContent(/^Downtown Store$/);
    expect(field(dialog, 'Active user')).toBeChecked();
    expect(field(dialog, 'Active user')).toBeEnabled();
    expect(field(dialog, 'Reset password (optional)')).toHaveValue('');
    expect(within(dialog).queryByRole('combobox', { name: 'Store' })).toBeNull();
  });

  it('name only → PATCH { fullName } (trimmed), "Saving…", toast, closes, list refetched; no X-Tenant-Id, no auth/me', async () => {
    const g = gate();
    const api = usersApi();
    const writes = writeApi({
      respondPatch: async (_id, body) => {
        await g.promise;
        return HttpResponse.json({ ...ana, ...(body as object) });
      },
    });
    renderUsers();
    const me = countAuthMe();
    const dialog = await openEdit('Ana García');

    await userEvent.clear(field(dialog, 'Full name'));
    await userEvent.type(field(dialog, 'Full name'), ' Ana Gómez ');
    await save(dialog);
    expect(await within(dialog).findByRole('button', { name: 'Saving…' })).toBeDisabled();
    const before = api.listRequests.length;

    g.release();
    expect(await screen.findByText('User updated')).toBeInTheDocument();
    expect(writes.patches).toEqual([{ id: ana.id, body: { fullName: 'Ana Gómez' }, tenantHeader: null }]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(api.listRequests.length).toBeGreaterThan(before));
    expect(me.count).toBe(0);
  });

  it('role, status and password → exactly those fields; never email or tenantId', async () => {
    usersApi();
    const writes = writeApi();
    renderUsers();
    const dialog = await openEdit('Ana García');

    await userEvent.selectOptions(field(dialog, 'Role'), 'employee');
    await userEvent.click(field(dialog, 'Active user'));
    await userEvent.type(field(dialog, 'Reset password (optional)'), 'newpass123');
    await save(dialog);

    expect(await screen.findByText('User updated')).toBeInTheDocument();
    expect(writes.patches.map((p) => p.body)).toEqual([{ role: 'employee', isActive: false, password: 'newpass123' }]);
  });

  it('nothing changed → no request, the modal just closes', async () => {
    usersApi();
    const writes = writeApi();
    renderUsers();
    const dialog = await openEdit('Ana García');
    await save(dialog);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(writes.patches).toEqual([]);
  });

  it('client validation: blank name and a short password inline; nothing sent; fixed on blur', async () => {
    usersApi();
    const writes = writeApi();
    renderUsers();
    const dialog = await openEdit('Ana García');

    await userEvent.clear(field(dialog, 'Full name'));
    await userEvent.type(field(dialog, 'Reset password (optional)'), 'abc1234');
    await save(dialog);
    expect(await within(dialog).findByText('Full name is required')).toBeInTheDocument();
    expect(within(dialog).getByText('Password must be at least 8 characters')).toBeInTheDocument();
    expect(field(dialog, 'Full name')).toHaveAttribute('aria-invalid', 'true');
    expect(field(dialog, 'Reset password (optional)')).toHaveAttribute('aria-invalid', 'true');

    await userEvent.type(field(dialog, 'Full name'), 'Ana');
    await userEvent.tab();
    expect(within(dialog).queryByText('Full name is required')).not.toBeInTheDocument();
    expect(writes.patches).toEqual([]);
  });

  it('own account (a Platform Admin): role fixed, store "—", status disabled; renaming refreshes the session', async () => {
    usersApi();
    const writes = writeApi();
    renderUsers();
    const me = countAuthMe();
    const dialog = await openEdit('Ada Admin');

    const role = field(dialog, 'Role');
    expect(role).toBeDisabled();
    expect(within(role).getAllByRole('option').map((o) => o.textContent)).toEqual(['Platform Admin']);
    expect(within(dialog).getByTestId('edit-user-store')).toHaveTextContent(/^—$/);
    expect(field(dialog, 'Active user')).toBeDisabled();
    expect(within(dialog).getByText('You cannot deactivate your own account.')).toBeInTheDocument();
    await userEvent.clear(field(dialog, 'Full name'));
    await userEvent.type(field(dialog, 'Full name'), 'Ada Lovelace');
    await save(dialog);
    expect(await screen.findByText('User updated')).toBeInTheDocument();
    expect(writes.patches.map((p) => p.body)).toEqual([{ fullName: 'Ada Lovelace' }]);
    await waitFor(() => expect(me.count).toBeGreaterThan(0));
  });

  it('a user of a deactivated store: store shown with the Inactive badge; reactivating the user sends { isActive: true }', async () => {
    usersApi();
    const writes = writeApi();
    renderUsers();
    const dialog = await openEdit('Bob Stone');

    const storeText = within(dialog).getByTestId('edit-user-store');
    expect(storeText).toHaveTextContent('Closed Store');
    expect(within(storeText).getByText('Inactive')).toBeInTheDocument();
    expect(field(dialog, 'Role')).toHaveValue('employee');
    expect(field(dialog, 'Active user')).not.toBeChecked();

    await userEvent.click(field(dialog, 'Active user'));
    await save(dialog);
    expect(await screen.findByText('User updated')).toBeInTheDocument();
    expect(writes.patches.map((p) => p.body)).toEqual([{ isActive: true }]);
  });

  it('400 details map onto their fields (role rule, weak password); the modal stays open', async () => {
    usersApi();
    writeApi({
      respondPatch: () =>
        apiError(400, 'VALIDATION_ERROR', 'Invalid request', [
          { path: 'role', message: 'A store user cannot become a Platform Admin' },
          { path: 'password', message: 'Password is too weak' },
        ]),
    });
    renderUsers();
    const dialog = await openEdit('Ana García');
    await userEvent.selectOptions(field(dialog, 'Role'), 'employee');
    await userEvent.type(field(dialog, 'Reset password (optional)'), 'password1');
    await save(dialog);

    expect(await within(dialog).findByText('A store user cannot become a Platform Admin')).toBeInTheDocument();
    expect(within(dialog).getByText('Password is too weak')).toBeInTheDocument();
    expect(field(dialog, 'Role')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('dialog', { name: 'Edit user' })).toBeInTheDocument();
  });

  it('409 (a self-rule from a stale UI): error toast with the API message, the modal stays open', async () => {
    usersApi();
    writeApi({ respondPatch: () => apiError(409, 'CONFLICT', 'You cannot deactivate your own account') });
    renderUsers();
    const dialog = await openEdit('Ana García');
    await userEvent.click(field(dialog, 'Active user'));
    await save(dialog);

    expect(await screen.findByRole('alert')).toHaveTextContent('You cannot deactivate your own account');
    expect(screen.getByRole('dialog', { name: 'Edit user' })).toBeInTheDocument();
  });

  it('404 (deleted meanwhile): error toast, the modal closes, the list is re-read', async () => {
    const api = usersApi();
    writeApi({ respondPatch: () => apiError(404, 'NOT_FOUND', 'User not found') });
    renderUsers();
    const dialog = await openEdit('Ana García');
    await userEvent.click(field(dialog, 'Active user'));
    const before = api.listRequests.length;
    await save(dialog);

    expect(await screen.findByText('User not found')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(api.listRequests.length).toBeGreaterThan(before));
  });
});

describe('/platform/users delete (RF-12, RN-09)', () => {
  const openDelete = async (name: string) => {
    await table();
    await userEvent.click(within(rowOf(name)).getByRole('button', { name: `Delete ${name}` }));
    return screen.findByRole('dialog', { name: 'Delete user' });
  };

  it('confirm with the RN-09 copy → DELETE; "Deleting…", toast, list re-read', async () => {
    const g = gate();
    const api = usersApi();
    const writes = writeApi({
      respondDelete: async () => {
        await g.promise;
        return new HttpResponse(null, { status: 204 });
      },
    });
    renderUsers();
    const dialog = await openDelete('Ana García');

    expect(dialog).toHaveTextContent(
      'Delete the user “Ana García”? They will permanently lose access. The availability events they recorded will be kept.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete user' }));
    expect(await within(dialog).findByRole('button', { name: 'Deleting…' })).toBeDisabled();
    const before = api.listRequests.length;

    g.release();
    expect(await screen.findByText('User deleted')).toBeInTheDocument();
    expect(writes.deletes).toEqual([ana.id]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(api.listRequests.length).toBeGreaterThan(before));
  });

  it.each([
    [404, 'NOT_FOUND', 'User not found'],
    [409, 'CONFLICT', 'You cannot delete your own account'],
  ] as const)('%i: error toast with the API message, the confirm closes, the list is re-read', async (status, code, message) => {
    const api = usersApi();
    writeApi({ respondDelete: () => apiError(status, code, message) });
    renderUsers();
    const dialog = await openDelete('Bob Stone');
    const before = api.listRequests.length;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete user' }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(api.listRequests.length).toBeGreaterThan(before));
  });

  it('deleting the last row of the last page lands on the previous page (RF-36)', async () => {
    let deleted = false;
    usersApi({
      respondList: (url) => {
        const page = Number(url.searchParams.get('page'));
        if (page === 2) return HttpResponse.json(envelope(deleted ? [] : [bob], { page: 2, total: deleted ? 20 : 21 }));
        return HttpResponse.json(envelope(users, { page: 1, total: deleted ? 20 : 21 }));
      },
    });
    writeApi({
      respondDelete: () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      },
    });
    renderUsers('/platform/users?page=2');
    const dialog = await openDelete('Bob Stone');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete user' }));

    expect(await screen.findByText('User deleted')).toBeInTheDocument();
    await waitFor(() => expect(location()).toBe('/platform/users'));
    expect(await screen.findByText('Ana García')).toBeInTheDocument();
  });
});
