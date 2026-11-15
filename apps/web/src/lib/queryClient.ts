import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from './apiClient';
import { authMeKey } from '../auth/session';
import { setSelectedStore, STORE_SCOPE } from '../tenant/activeStore';

const isUnauthorized = (error: unknown) => error instanceof ApiError && error.status === 401;
const isInvalidTenant = (error: unknown) => error instanceof ApiError && error.code === 'INVALID_TENANT';

/**
 * One QueryClient for the app (architecture §AD stack: server state in
 * TanStack Query, session in AuthContext). Any 401 from the API — session
 * expired or revoked mid-use — clears the auth context, so the route guard
 * sends the user to /login with the current URL preserved (login.md, layout.md
 * §Session bootstrap). An `INVALID_TENANT` (the platform admin's stored store
 * was deactivated or deleted, architecture §5.2) clears the selection, so
 * store routes fall back to the picker state instead of a broken page.
 */
export function createQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => {
        if (isUnauthorized(error)) client.setQueryData(authMeKey, null);
        if (isInvalidTenant(error)) {
          client.removeQueries({ queryKey: [STORE_SCOPE] });
          setSelectedStore(null);
        }
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        if (isUnauthorized(error)) client.setQueryData(authMeKey, null);
      },
    }),
    defaultOptions: {
      queries: {
        // A 4xx won't change by asking again; network/5xx gets one retry.
        retry: (failureCount, error) =>
          failureCount < 1 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
      },
    },
  });
  return client;
}
