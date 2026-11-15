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
 * share (layout.md §Route guards rule 4). Store roles land on /home (login.md,
 * final). Interim: the platform admin lands on /availability until
 * /platform/tenants "Go to stores" ships (7.5) — like on any store route: the
 * selected store's page, or the picker state with none selected.
 */
export const ROLE_HOME: Readonly<Record<Role, Home>> = {
  platform_admin: { path: '/availability', label: 'Go to Availability' },
  manager: { path: '/home', label: 'Go to Home' },
  employee: { path: '/home', label: 'Go to Home' },
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
