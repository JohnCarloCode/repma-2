import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { authMe, renderAt, sessionFor } from '../test/renderApp';
import { server } from '../test/server';
import { RequirePermission, RouteGuard } from './guards';

// No shipped route needs a permission a role lacks yet (/catalog arrives in
// 6.5), so rule 2 is exercised on a test route guarded by `assortment:manage`.
const routes = (
  <Routes>
    <Route element={<RouteGuard permission="assortment:manage" />}>
      <Route path="/manager-only" element={<h1>Manager page</h1>} />
    </Route>
    <Route element={<RouteGuard permission="tenant:manage" />}>
      <Route path="/platform-only" element={<h1>Platform page</h1>} />
    </Route>
    <Route path="/unauthorized" element={<h1>Unauthorized</h1>} />
  </Routes>
);

describe('RouteGuard rule 2 (permission, never role)', () => {
  it.each([
    ['manager', '/manager-only', 'Manager page'],
    ['platform_admin', '/manager-only', 'Manager page'],
    ['platform_admin', '/platform-only', 'Platform page'],
  ] as const)('%s with the permission reaches %s', async (role, path, heading) => {
    server.use(authMe(sessionFor(role)));
    renderAt(path, routes);
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
  });

  it.each([
    ['employee', '/manager-only'],
    ['manager', '/platform-only'],
    ['employee', '/platform-only'],
  ] as const)('%s without the permission on %s → /unauthorized', async (role, path) => {
    server.use(authMe(sessionFor(role)));
    renderAt(path, routes);
    expect(await screen.findByRole('heading', { name: 'Unauthorized' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/unauthorized');
  });
});

describe('<RequirePermission>', () => {
  const ui = (
    <RequirePermission permission="assortment:manage" fallback={<p>Read only</p>}>
      <button type="button">Add to assortment</button>
    </RequirePermission>
  );

  it('renders the children when the session holds the permission', async () => {
    server.use(authMe(sessionFor('manager')));
    renderAt('/', ui);
    expect(await screen.findByRole('button', { name: 'Add to assortment' })).toBeInTheDocument();
  });

  it('renders the fallback otherwise', async () => {
    server.use(authMe(sessionFor('employee')));
    renderAt('/', ui);
    expect(await screen.findByText('Read only')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders the fallback without a session', async () => {
    server.use(authMe(null));
    renderAt('/', ui);
    expect(await screen.findByText('Read only')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
