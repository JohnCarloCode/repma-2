import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { hasPermission, type Permission } from 'shared';
import { useSession } from './AuthContext';
import { StorePickerState } from '../pages/StorePickerState';
import { useActiveStore } from '../tenant/activeStore';

/**
 * Action-level guard (RF-32): renders `children` only when the session holds
 * `permission` (shared matrix — never a role check), else `fallback`.
 * UX only; the API stays the authority.
 */
export function RequirePermission({
  permission,
  children,
  fallback = null,
}: {
  permission: Permission;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const session = useSession();
  return session && hasPermission(session, permission) ? children : fallback;
}

/** Where the login page returns to after sign-in (login.md §Flows). */
export interface LoginRedirectState {
  from: string;
}

/**
 * Route guard (layout.md §Route guards), used as a layout route element:
 * 1. no session → /login, preserving the intended URL;
 * 2. missing the route's permission → /unauthorized;
 * 3. store route without an active store (a platform admin with no store
 *    selected) → the picker state.
 */
export function RouteGuard({ permission, store = false }: { permission?: Permission; store?: boolean }) {
  const session = useSession();
  const location = useLocation();
  const activeStore = useActiveStore();

  if (!session) {
    const state: LoginRedirectState = { from: location.pathname + location.search + location.hash };
    return <Navigate to="/login" replace state={state} />;
  }
  if (permission && !hasPermission(session, permission)) {
    return <Navigate to="/unauthorized" replace />;
  }
  if (store && !activeStore) {
    return <StorePickerState />;
  }
  return <Outlet />;
}
