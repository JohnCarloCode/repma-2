import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { ROLES, type AuthSession, type Role } from 'shared';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from '../../App';
import { authMeKey } from '../../auth/session';
import { authMe, renderAt, sessionFor } from '../../test/renderApp';
import { server } from '../../test/server';
import { NAV, navSections } from './nav';

const location = () => screen.getByTestId('location');
const mainNav = () => screen.findByRole('navigation', { name: 'Main' });

const withName = (role: Role, fullName: string): AuthSession => {
  const session = sessionFor(role);
  return { ...session, user: { ...session.user, fullName } };
};

describe('nav visibility matrix (layout.md §Navigation, full registry)', () => {
  const visible = (role: Role) =>
    navSections({ role }, NAV).map((section) => ({ title: section.title, items: section.items.map((i) => i.label) }));

  it('employee: the four store items, no Catalog, no Platform section', () => {
    expect(visible('employee')).toEqual([{ items: ['Home', 'Replenishment', 'Availability', 'Activity'] }]);
  });

  it('manager: the store items with Catalog last, no Platform section', () => {
    expect(visible('manager')).toEqual([{ items: ['Home', 'Replenishment', 'Availability', 'Activity', 'Catalog'] }]);
  });

  it('platform admin: every store item plus the Platform section', () => {
    expect(visible('platform_admin')).toEqual([
      { items: ['Home', 'Replenishment', 'Availability', 'Activity', 'Catalog'] },
      { title: 'Platform', items: ['Stores', 'Users', 'Global catalog'] },
    ]);
  });
});

describe('shell', () => {
  it.each(ROLES)('%s: wordmark, the shipped nav item active on its route, name and role label', async (role) => {
    server.use(authMe(withName(role, 'Ada Lovelace')));
    renderAt('/activity', <AppRoutes />);

    const nav = await mainNav();
    // Shipped routes only (interim registry), in layout.md's order.
    expect(within(nav).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/replenishment',
      '/availability',
      '/activity',
    ]);
    expect(within(nav).getByRole('link', { name: 'Replenishment' })).not.toHaveAttribute('aria-current');
    expect(within(nav).getByRole('link', { name: 'Availability' })).not.toHaveAttribute('aria-current');
    expect(within(nav).getByRole('link', { name: 'Activity' })).toHaveAttribute('aria-current', 'page');
    // No platform item has shipped yet, so its header never renders (no empty section).
    expect(within(nav).queryByRole('heading', { name: 'Platform' })).not.toBeInTheDocument();
    expect(screen.getByText('REPMA')).toBeInTheDocument();

    const label = { platform_admin: 'Platform Admin', manager: 'Manager', employee: 'Employee' }[role];
    const trigger = screen.getByRole('button', { name: new RegExp(`Ada Lovelace\\s*${label}`) });
    expect(within(trigger).getByText('AL')).toBeInTheDocument();
  });

  it('platform admin without a store: the picker state renders inside the shell', async () => {
    server.use(authMe(sessionFor('platform_admin')));
    renderAt('/activity', <AppRoutes />);
    expect(await mainNav()).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Select a store to continue' })).toBeInTheDocument();
  });

  it('/unauthorized keeps the shell with a session', async () => {
    server.use(authMe(sessionFor('employee')));
    renderAt('/unauthorized', <AppRoutes />);
    expect(await screen.findByRole('heading', { name: 'Unauthorized access' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  it('/unauthorized renders bare without a session, as does /login', async () => {
    server.use(authMe(null));
    renderAt('/unauthorized', <AppRoutes />);
    expect(await screen.findByRole('heading', { name: 'Unauthorized access' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});

describe('logout', () => {
  it('POST /auth/logout → /login (guard rule 1), other cached data dropped, no session refetch', async () => {
    let meCalls = 0;
    let logoutCalls = 0;
    server.use(
      http.get('*/api/v1/auth/me', () => {
        meCalls += 1;
        return HttpResponse.json(sessionFor('manager'));
      }),
      http.post('*/api/v1/auth/logout', () => {
        logoutCalls += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const { queryClient } = renderAt('/activity?page=2', <AppRoutes />);
    queryClient.setQueryData(['store-data'], ['cached']);
    await mainNav();

    await userEvent.click(screen.getByRole('button', { name: /Test User/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Log out' }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(location()).toHaveTextContent(/^\/login$/);
    expect(location()).toHaveAttribute('data-state', JSON.stringify({ from: '/activity?page=2' }));
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(logoutCalls).toBe(1);
    expect(queryClient.getQueryData(['store-data'])).toBeUndefined();
    expect(queryClient.getQueryData(authMeKey)).toBeNull();
    expect(meCalls).toBe(1);
  });

  it('a failed logout keeps the user signed in (the cookie was not cleared)', async () => {
    server.use(
      authMe(sessionFor('employee')),
      http.post('*/api/v1/auth/logout', () =>
        HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Boom' } }, { status: 500 }),
      ),
    );

    renderAt('/activity', <AppRoutes />);
    await mainNav();
    await userEvent.click(screen.getByRole('button', { name: /Test User/ }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Log out' }));

    await waitFor(() => expect(location()).toHaveTextContent('/activity'));
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });
});
