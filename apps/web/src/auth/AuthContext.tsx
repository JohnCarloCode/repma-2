import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import type { AuthSession } from 'shared';
import { api, ApiError } from '../lib/apiClient';
import { authMeKey } from './session';

const AuthContext = createContext<AuthSession | null | undefined>(undefined);

async function fetchSession(): Promise<AuthSession | null> {
  try {
    return await api.get<AuthSession>('/auth/me');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null; // no session (RF-02)
    throw error;
  }
}

/**
 * Session bootstrap (layout.md §Session bootstrap): one `GET /auth/me` on app
 * load. Until it resolves, a full-page neutral state — never the shell. Login
 * and logout update the same query (`authMeKey`) instead of refetching.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const query = useQuery({ queryKey: authMeKey, queryFn: fetchSession, staleTime: Infinity });

  if (query.isPending || (query.isError && query.isFetching)) {
    return <div role="status" aria-label="Loading" className="min-h-screen bg-canvas" />;
  }
  if (query.isError) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-base bg-canvas p-base text-center">
        <span className="icon text-text-secondary" aria-hidden>
          error
        </span>
        <h1 className="text-h2">Could not load your session</h1>
        <p className="text-text-secondary">Check your connection and try again.</p>
        <button
          type="button"
          onClick={() => void query.refetch()}
          className="h-[44px] rounded-sm bg-accent px-base text-body-medium text-on-accent transition-colors hover:bg-accent-hover active:bg-accent-active"
        >
          Try again
        </button>
      </main>
    );
  }
  return <AuthContext.Provider value={query.data}>{children}</AuthContext.Provider>;
}

/** The current session, or null when there is none. */
export function useSession(): AuthSession | null {
  const session = useContext(AuthContext);
  if (session === undefined) throw new Error('useSession must be used inside <AuthProvider>');
  return session;
}
