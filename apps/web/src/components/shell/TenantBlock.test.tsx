import { useQuery } from '@tanstack/react-query';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router';
import type { Page, Tenant } from 'shared';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from '../../App';
import { RouteGuard } from '../../auth/guards';
import { api } from '../../lib/apiClient';
import { authMe, renderAt, sessionFor } from '../../test/renderApp';
import { server } from '../../test/server';
import { setViewportWidth } from '../../test/viewport';
import { SELECTED_STORE_KEY, STORE_SCOPE, useStoreScope } from '../../tenant/activeStore';
import { AppShell } from './AppShell';
import { SIDEBAR_COLLAPSED_KEY } from './useShellLayout';

const NORTH = { id: '00000000-0000-4000-8000-0000000000b1', name: 'North Store' };
const SOUTH = { id: '00000000-0000-4000-8000-0000000000b2', name: 'South Store' };
const CLOSED = { id: '00000000-0000-4000-8000-0000000000b3', name: 'Closed Store' };

const tenant = (store: { id: string; name: string }, isActive = true): Tenant => ({
  ...store,
  slug: store.name.toLowerCase().replace(' ', '-'),
  isActive,
  createdAt: '2026-01-01T00:00:00.000Z',
});

/** `GET /tenants` with an inactive store in the list; records every request it gets. */
function tenantsApi() {
  const requests: Request[] = [];
  const page: Page<Tenant> = {
    items: [tenant(CLOSED, false), tenant(NORTH), tenant(SOUTH)],
    page: 1,
    pageSize: 100,
    total: 3,
  };
  server.use(
    http.get('*/api/v1/tenants', ({ request }) => {
      requests.push(request);
      return HttpResponse.json(page);
    }),
  );
  return requests;
}

/** A tenant-scoped endpoint echoing the `X-Tenant-Id` it received. */
function probeApi() {
  const received: (string | null)[] = [];
  server.use(
    http.get('*/api/v1/probe', ({ request }) => {
      const header = request.headers.get('x-tenant-id');
      received.push(header);
      return HttpResponse.json({ tenant: header ?? 'none' });
    }),
  );
  return received;
}

/** A store page: one tenant-scoped query, keyed and sent the way every store page does it. */
function ProbePage() {
  const scope = useStoreScope();
  const probe = useQuery({
    queryKey: scope.key('probe'),
    queryFn: () => api.get<{ tenant: string }>('/probe', scope.request),
  });
  return <h1>{probe.data ? `Probe sent ${probe.data.tenant}` : 'Probe loading'}</h1>;
}

const probeRoutes = (
  <Routes>
    <Route element={<AppShell />}>
      <Route element={<RouteGuard permission="activity:read" store />}>
        <Route path="/probe" element={<ProbePage />} />
      </Route>
    </Route>
  </Routes>
);

const select = (store: { id: string; name: string } | null) =>
  localStorage.setItem(SELECTED_STORE_KEY, JSON.stringify(store));

const selectorButton = (name: string) => screen.findByRole('button', { name });
const storeOption = (name: string) => within(screen.getByRole('list', { name: 'Stores' })).getByRole('button', { name });

describe('manager / employee: static store name, no X-Tenant-Id', () => {
  it.each(['manager', 'employee'] as const)('%s sees the store as text — no selector, no store list request', async (role) => {
    const tenantsRequests = tenantsApi();
    server.use(authMe(sessionFor(role)));
    renderAt('/activity', <AppRoutes />);

    const sidebar = await screen.findByRole('complementary');
    expect(within(sidebar).getByText('Store A')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /store/i })).not.toBeInTheDocument();
    expect(tenantsRequests).toHaveLength(0);
  });

  it('tenant-scoped calls carry no X-Tenant-Id — even with a stale admin selection in storage', async () => {
    select(NORTH);
    const received = probeApi();
    server.use(authMe(sessionFor('employee')));
    renderAt('/probe', probeRoutes);

    expect(await screen.findByRole('heading', { name: 'Probe sent none' })).toBeInTheDocument();
    expect(received).toEqual([null]);
  });

  it('collapsed: a circular tile with the initial, the name as a tooltip on hover and focus', async () => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'true');
    server.use(authMe(sessionFor('manager')));
    renderAt('/activity', <AppRoutes />);

    const storeTile = await screen.findByRole('img', { name: 'Store: Store A' });
    expect(storeTile).toHaveTextContent('S');
    expect(storeTile).toHaveClass('rounded-full');
    await userEvent.hover(storeTile);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Store A');
    await userEvent.unhover(storeTile);
    storeTile.focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Store A');
  });
});

describe('platform admin: the store selector', () => {
  it('lists active stores only (GET /tenants, no X-Tenant-Id), searches, selects and persists', async () => {
    const tenantsRequests = tenantsApi();
    probeApi();
    server.use(authMe(sessionFor('platform_admin')));
    renderAt('/activity', <AppRoutes />);

    // Placeholder in the sidebar; the store route shows the picker state.
    const sidebar = await screen.findByRole('complementary');
    await userEvent.click(within(sidebar).getByRole('button', { name: 'Select a store' }));

    expect(await screen.findByRole('list', { name: 'Stores' })).toBeInTheDocument();
    expect(storeOption('North Store')).toBeInTheDocument();
    expect(storeOption('South Store')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Closed Store' })).not.toBeInTheDocument();
    expect(tenantsRequests).toHaveLength(1);
    expect(new URL(tenantsRequests[0]!.url).searchParams.get('pageSize')).toBe('100');
    expect(tenantsRequests[0]!.headers.get('x-tenant-id')).toBeNull();

    // The search field has focus when the panel opens.
    expect(screen.getByRole('textbox', { name: 'Search stores' })).toHaveFocus();
    await userEvent.keyboard('sOuTh');
    expect(screen.queryByRole('button', { name: 'North Store' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Control>}a{/Control}zzz');
    expect(screen.getByText('No results')).toBeInTheDocument();
    await userEvent.clear(screen.getByRole('textbox', { name: 'Search stores' }));

    await userEvent.click(storeOption('South Store'));
    expect(screen.queryByRole('list', { name: 'Stores' })).not.toBeInTheDocument();
    expect(within(sidebar).getByRole('button', { name: 'Store: South Store' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(SELECTED_STORE_KEY) ?? 'null')).toEqual(SOUTH);
    // The store route renders now.
    expect(await screen.findByRole('heading', { name: 'Activity' })).toBeInTheDocument();
  });

  it('a persisted selection is the active store on load and is sent as X-Tenant-Id', async () => {
    select(NORTH);
    const received = probeApi();
    server.use(authMe(sessionFor('platform_admin')));
    renderAt('/probe', probeRoutes);

    expect(await screen.findByRole('heading', { name: `Probe sent ${NORTH.id}` })).toBeInTheDocument();
    expect(received).toEqual([NORTH.id]);
    expect(screen.getByRole('button', { name: 'Store: North Store' })).toBeInTheDocument();
  });

  it('switching store drops every tenant-scoped query and refetches with the new X-Tenant-Id', async () => {
    select(NORTH);
    tenantsApi();
    const received = probeApi();
    server.use(authMe(sessionFor('platform_admin')));
    const { queryClient } = renderAt('/probe', probeRoutes);
    await screen.findByRole('heading', { name: `Probe sent ${NORTH.id}` });
    // Another tenant-scoped query of the previous store, not on screen.
    queryClient.setQueryData([STORE_SCOPE, NORTH.id, 'elsewhere'], { cached: true });
    queryClient.setQueryData(['global', 'thing'], { cached: true });

    await userEvent.click(screen.getByRole('button', { name: 'Store: North Store' }));
    await userEvent.click(await waitFor(() => storeOption('South Store')));

    expect(await screen.findByRole('heading', { name: `Probe sent ${SOUTH.id}` })).toBeInTheDocument();
    expect(received).toEqual([NORTH.id, SOUTH.id]);
    const storeKeys = queryClient
      .getQueryCache()
      .findAll({ queryKey: [STORE_SCOPE] })
      .map((query) => query.queryKey);
    expect(storeKeys).toEqual([[STORE_SCOPE, SOUTH.id, 'probe']]);
    // Global queries are not tenant data: they stay.
    expect(queryClient.getQueryData(['global', 'thing'])).toEqual({ cached: true });
  });

  it('"Clear selection" returns to the placeholder and the picker state', async () => {
    select(NORTH);
    tenantsApi();
    probeApi();
    server.use(authMe(sessionFor('platform_admin')));
    const { queryClient } = renderAt('/probe', probeRoutes);
    await screen.findByRole('heading', { name: `Probe sent ${NORTH.id}` });

    await userEvent.click(screen.getByRole('button', { name: 'Store: North Store' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Clear selection' }));

    expect(await screen.findByRole('heading', { name: 'Select a store to continue' })).toBeInTheDocument();
    expect(within(screen.getByRole('complementary')).getByRole('button', { name: 'Select a store' })).toBeInTheDocument();
    expect(localStorage.getItem(SELECTED_STORE_KEY)).toBeNull();
    expect(queryClient.getQueryCache().findAll({ queryKey: [STORE_SCOPE] })).toHaveLength(0);
  });

  it('picker state: the store route waits for a store, then picking one there renders it', async () => {
    tenantsApi();
    const received = probeApi();
    server.use(authMe(sessionFor('platform_admin')));
    renderAt('/probe', probeRoutes);

    const picker = await screen.findByRole('main');
    expect(within(picker).getByRole('heading', { name: 'Select a store to continue' })).toBeInTheDocument();
    expect(received).toHaveLength(0); // never a request without a store (no silent 400)

    await userEvent.click(within(picker).getByRole('button', { name: 'Select a store' }));
    await userEvent.click(await waitFor(() => storeOption('North Store')));

    expect(await screen.findByRole('heading', { name: `Probe sent ${NORTH.id}` })).toBeInTheDocument();
  });

  it('a stored store the API rejects (INVALID_TENANT) is cleared → picker state', async () => {
    select(NORTH);
    server.use(
      authMe(sessionFor('platform_admin')),
      http.get('*/api/v1/probe', () =>
        HttpResponse.json({ error: { code: 'INVALID_TENANT', message: 'Invalid tenant' } }, { status: 400 }),
      ),
    );
    renderAt('/probe', probeRoutes);

    expect(await screen.findByRole('heading', { name: 'Select a store to continue' })).toBeInTheDocument();
    expect(localStorage.getItem(SELECTED_STORE_KEY)).toBeNull();
  });

  it('collapsed: the circular tile shows a placeholder, then the initial; it opens the selector as a flyout', async () => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'true');
    tenantsApi();
    server.use(authMe(sessionFor('platform_admin')));
    renderAt('/activity', <AppRoutes />);

    const sidebar = await screen.findByRole('complementary');
    const tile = within(sidebar).getByRole('button', { name: 'Select a store' });
    expect(tile).toHaveClass('rounded-full');
    expect(tile).toHaveTextContent('storefront');
    await userEvent.hover(tile);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Select a store');

    await userEvent.click(tile);
    await userEvent.click(await waitFor(() => storeOption('South Store')));
    const selected = within(sidebar).getByRole('button', { name: 'Store: South Store' });
    expect(selected).toHaveTextContent(/^S$/);
  });

  it('mobile drawer: the selector works inside the drawer', async () => {
    setViewportWidth(375);
    tenantsApi();
    server.use(authMe(sessionFor('platform_admin')));
    renderAt('/activity', <AppRoutes />);

    await userEvent.click(await screen.findByRole('button', { name: 'Open menu' }));
    const drawer = await screen.findByRole('dialog', { name: 'Navigation' });
    await userEvent.click(within(drawer).getByRole('button', { name: 'Select a store' }));
    await userEvent.click(await waitFor(() => storeOption('North Store')));

    expect(within(drawer).getByRole('button', { name: 'Store: North Store' })).toBeInTheDocument();
    expect(await selectorButton('Store: North Store')).toBeInTheDocument();
  });
});
