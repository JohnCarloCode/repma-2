import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from './App';
import { api } from './lib/apiClient';
import { authMe, renderAt, sessionFor } from './test/renderApp';
import { server } from './test/server';

const location = () => screen.getByTestId('location');

describe('session bootstrap', () => {
  it('shows only a neutral full-page state until GET /auth/me resolves', async () => {
    let resolve!: () => void;
    const answered = new Promise<void>((r) => (resolve = r));
    server.use(
      http.get('*/api/v1/auth/me', async () => {
        await answered;
        return HttpResponse.json(sessionFor('manager'));
      }),
    );

    renderAt('/activity', <AppRoutes />);
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();

    resolve();
    expect(await screen.findByRole('heading', { name: 'Activity' })).toBeInTheDocument();
    // The page's own feed skeleton may flash; nothing stays loading.
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument());
  });

  it('offers a retry when the session cannot be loaded (network/5xx)', async () => {
    let calls = 0;
    server.use(
      http.get('*/api/v1/auth/me', () => {
        calls += 1;
        return calls <= 2 // the first try and its one retry
          ? HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Boom' } }, { status: 500 })
          : HttpResponse.json(sessionFor('employee'));
      }),
    );

    renderAt('/activity', <AppRoutes />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Try again' }, { timeout: 3000 }),
    );
    expect(await screen.findByRole('heading', { name: 'Activity' })).toBeInTheDocument();
  });

  it('a 401 from any later API call clears the session and lands on /login with the URL preserved', async () => {
    server.use(
      authMe(sessionFor('manager')),
      http.get('*/api/v1/things', () =>
        HttpResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Session expired' } }, { status: 401 }),
      ),
    );

    const { queryClient } = renderAt('/activity?from=2026-11-01', <AppRoutes />);
    await screen.findByRole('heading', { name: 'Activity' });

    await queryClient.fetchQuery({ queryKey: ['things'], queryFn: () => api.get('/things') }).catch(() => {});
    await waitFor(() => expect(location()).toHaveTextContent('/login'));
    expect(location()).toHaveAttribute('data-state', JSON.stringify({ from: '/activity?from=2026-11-01' }));
  });
});

describe('route guards & redirects', () => {
  it('rule 1: no session → /login, preserving the intended URL', async () => {
    server.use(authMe(null));
    renderAt('/activity?page=2', <AppRoutes />);

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(location()).toHaveTextContent('/login');
    expect(location()).toHaveAttribute('data-state', JSON.stringify({ from: '/activity?page=2' }));
  });

  it('a store role with the permission reaches the store route', async () => {
    server.use(authMe(sessionFor('employee')));
    renderAt('/activity', <AppRoutes />);
    expect(await screen.findByRole('heading', { name: 'Activity' })).toBeInTheDocument();
  });

  it('rule 3: platform admin without a selected store gets the picker state on a store route', async () => {
    server.use(authMe(sessionFor('platform_admin')));
    renderAt('/activity', <AppRoutes />);

    expect(await screen.findByRole('heading', { name: 'Select a store to continue' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Activity' })).not.toBeInTheDocument();
    expect(location()).toHaveTextContent('/activity');
  });

  it.each(['manager', 'employee', 'platform_admin'] as const)(
    'rule 4: an unknown route sends the %s to the role home',
    async (role) => {
      server.use(authMe(sessionFor(role)));
      renderAt('/no/such/page', <AppRoutes />);
      // Store roles land on /home; the admin on /platform/tenants (login.md).
      await waitFor(() => expect(location()).toHaveTextContent(role === 'platform_admin' ? '/platform/tenants' : '/home'));
    },
  );

  it('rule 4: an unknown route without a session goes to /login', async () => {
    server.use(authMe(null));
    renderAt('/no/such/page', <AppRoutes />);
    await waitFor(() => expect(location()).toHaveTextContent('/login'));
  });

  it('/ has no page of its own: without a session it goes to /login (DP-01)', async () => {
    server.use(authMe(null));
    renderAt('/', <AppRoutes />);
    await waitFor(() => expect(location()).toHaveTextContent('/login'));
  });
});

describe('/unauthorized', () => {
  it('with a session: heading, body and a link to the role home', async () => {
    server.use(authMe(sessionFor('manager')));
    renderAt('/unauthorized', <AppRoutes />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Unauthorized access' })).toBeInTheDocument();
    expect(screen.getByText("You don't have permission to view this page.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Go to Home' }));
    expect(await screen.findByRole('heading', { level: 1, name: /^Good (morning|afternoon|evening)/ })).toBeInTheDocument();
    expect(location()).toHaveTextContent('/home');
  });

  it('without a session: the link signs in', async () => {
    server.use(authMe(null));
    renderAt('/unauthorized', <AppRoutes />);

    await userEvent.click(await screen.findByRole('link', { name: 'Sign in' }));
    expect(location()).toHaveTextContent('/login');
  });
});
