import type { AuthSession, Role } from 'shared';

/** The React Query key holding the session (`GET /auth/me`); null = no session. */
export const authMeKey = ['auth', 'me'] as const;

interface Home {
  path: string;
  /** The link label on /unauthorized (unauthorized.md §Content). */
  label: string;
}

/**
 * Each role's landing route — the one definition `*`, /login and /unauthorized
 * share (layout.md §Route guards rule 4). Interim: every role lands on
 * /availability until the real homes ship — store roles flip to /home
 * "Go to Home" (5.3), the platform admin to /platform/tenants "Go to stores"
 * (7.5). Until then the admin lands like on any store route: the selected
 * store's page, or the picker state with none selected.
 */
export const ROLE_HOME: Readonly<Record<Role, Home>> = {
  platform_admin: { path: '/availability', label: 'Go to Availability' },
  manager: { path: '/availability', label: 'Go to Availability' },
  employee: { path: '/availability', label: 'Go to Availability' },
};

/** The role label the user menu shows under the name (layout.md §User menu). */
export const ROLE_LABEL: Readonly<Record<Role, string>> = {
  platform_admin: 'Platform Admin',
  manager: 'Manager',
  employee: 'Employee',
};

const SIGN_IN: Home = { path: '/login', label: 'Sign in' };

export function roleHome(session: AuthSession | null): Home {
  return session ? ROLE_HOME[session.role] : SIGN_IN;
}
