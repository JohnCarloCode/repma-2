import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { MemoryRouter, useLocation, type InitialEntry } from 'react-router';
import { rolePermissions, type AuthSession, type Role } from 'shared';
import { AuthProvider } from '../auth/AuthContext';
import { createQueryClient } from '../lib/queryClient';

export function sessionFor(role: Role): AuthSession {
  return {
    user: { id: '00000000-0000-4000-8000-000000000001', email: `${role}@repma.test`, fullName: 'Test User' },
    role,
    store: role === 'platform_admin' ? null : { id: '00000000-0000-4000-8000-0000000000aa', name: 'Store A' },
    permissions: rolePermissions[role],
  };
}

/** `GET /auth/me` answering with the role's session, or 401 when `null`. */
export function authMe(session: AuthSession | null) {
  return http.get('*/api/v1/auth/me', () =>
    session
      ? HttpResponse.json(session)
      : HttpResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, { status: 401 }),
  );
}

/** Shows where the router ended up, including the state a redirect carried. */
function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location" data-state={JSON.stringify(location.state ?? null)}>
      {location.pathname + location.search}
    </div>
  );
}

/** Renders `ui` the way App does (QueryClient → router → AuthProvider) at `path` (a URL, or a location with state). */
export function renderAt(path: InitialEntry, ui: ReactNode, queryClient: QueryClient = createQueryClient()) {
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          {ui}
          <LocationProbe />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { queryClient };
}
