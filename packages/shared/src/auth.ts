import { z } from 'zod';
import type { Role } from './enums.js';
import type { Permission } from './permissions.js';

// RF-01 — `POST /auth/login` body, shared by the api (validate, strict) and
// the login form (2.3). Messages are the ones design/pages/login.md shows.
export const loginBody = z.object({
  email: z.email({ error: 'Enter a valid email address' }),
  password: z.string({ error: 'Password is required' }).min(1, { error: 'Password is required' }),
});

export type LoginBody = z.infer<typeof loginBody>;

// RF-02 — `GET /auth/me` (and the `POST /auth/login` 200 body): the auth
// context the web keeps (architecture.md §7). `store` is null for the
// Platform Admin; `permissions` = rolePermissions[role].
export interface AuthSession {
  user: { id: string; email: string; fullName: string };
  role: Role;
  store: { id: string; name: string } | null;
  permissions: readonly Permission[];
}
