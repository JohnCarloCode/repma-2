import type { CreateUserBody, Page, UpdateUserBody, User, UserListQuery } from 'shared';
import { AppError } from '../../core/errors.js';
import { toPage } from '../../core/http/pagination.js';
import { authAdmin } from '../../lib/supabase.js';
import { findStore, findUser, insertUserProfile, listUsers, updateUserProfile } from './repository.js';

// RF-09
export async function list(query: UserListQuery): Promise<Page<User>> {
  const { items, total } = await listUsers(query);
  return toPage(items, total, query);
}

function userNotFound(): AppError {
  return new AppError(404, 'NOT_FOUND', 'User not found');
}

export async function get(id: string): Promise<User> {
  const user = await findUser(id);
  if (!user) throw userNotFound();
  return user;
}

function invalidField(path: string, message: string): AppError {
  return new AppError(400, 'VALIDATION_ERROR', 'Invalid request', [{ path, message }]);
}

function emailTaken(): AppError {
  return new AppError(409, 'CONFLICT', 'A user with this email already exists');
}

// RF-10 — two systems, one outcome (architecture.md §9): the Supabase Auth
// identity first (admin API, confirmed — there is no email flow, DP-01), then
// the profile. If the profile cannot be written the identity is deleted
// (compensation) and the original failure surfaces; a failed compensation is
// raised as its own error so the orphan is logged, never silent. The password
// only travels to Supabase Auth: it is never stored, logged or returned.
export async function create(body: CreateUserBody): Promise<User> {
  // RN-01 coherence is already enforced by the body schema; the store must
  // also exist and be active (a deactivated store's users cannot sign in, RF-05).
  if (body.tenantId) {
    const store = await findStore(body.tenantId);
    if (!store) throw invalidField('tenantId', 'Store not found');
    if (!store.isActive) throw invalidField('tenantId', 'This store is inactive');
  }

  const { data, error } = await authAdmin.createUser({ email: body.email, password: body.password, email_confirm: true });
  if (error) {
    if (error.code === 'email_exists') throw emailTaken();
    if (error.code === 'weak_password') throw invalidField('password', error.message);
    throw error;
  }
  const id = data.user.id;

  let outcome: 'created' | 'duplicate';
  try {
    outcome = await insertUserProfile({
      id,
      email: body.email,
      fullName: body.fullName,
      role: body.role,
      tenantId: body.tenantId ?? null,
    });
  } catch (err) {
    await compensate(id, err);
    throw err;
  }
  if (outcome === 'duplicate') {
    const conflict = emailTaken();
    await compensate(id, conflict);
    throw conflict;
  }

  const user = await findUser(id);
  if (!user) throw new Error(`User ${id} was created but cannot be read back`);
  return user;
}

async function compensate(authUserId: string, original: unknown): Promise<void> {
  const { error } = await authAdmin.deleteUser(authUserId);
  if (error) {
    throw new Error(`User creation failed and its auth identity ${authUserId} could not be removed: ${error.message}`, {
      cause: original,
    });
  }
}

// RF-11 — profile fields and an optional password reset. Order: every check
// first (self-deactivation, existence, RN-01 role rule), then the password in
// Supabase Auth, then the profile. Auth goes first because it is the step that
// can still reject the request (its own password policy → 400) — nothing has
// been written yet when it does. The two systems can't share a transaction and
// an old password can't be restored, so there is no compensation: if the
// profile write then fails (a database error), the request is a 500 with the
// password already reset, and repeating the same request converges (both
// steps are idempotent). Deactivation needs nothing in Auth: the profile is
// checked on every request (RF-05, AD-20).
export async function update(callerId: string, id: string, body: UpdateUserBody): Promise<User> {
  const { password, ...fields } = body;
  if (id === callerId && fields.isActive === false) {
    throw new AppError(409, 'CONFLICT', 'You cannot deactivate your own account');
  }

  const current = await findUser(id);
  if (!current) throw userNotFound();
  // RN-01 — role changes never cross the store boundary: manager ↔ employee
  // only (the DB CHECK on role↔store coherence is the backstop).
  if (fields.role !== undefined && fields.role !== current.role) {
    if (current.role === 'platform_admin') throw invalidField('role', "A Platform Admin's role cannot be changed");
    if (fields.role === 'platform_admin') throw invalidField('role', 'A store user cannot become a Platform Admin');
  }

  if (password !== undefined) {
    const { error } = await authAdmin.updateUserById(id, { password });
    if (error) {
      if (error.code === 'user_not_found') throw userNotFound();
      if (error.code === 'weak_password') throw invalidField('password', error.message);
      throw error;
    }
  }

  if (Object.keys(fields).length > 0 && !(await updateUserProfile(id, fields))) throw userNotFound();

  const user = await findUser(id);
  if (!user) throw userNotFound();
  return user;
}

// RF-12 — deleted in Supabase Auth (hard delete); the profile falls by the
// `auth.users` cascade and the user's availability events and replenishment
// lists stay, their `created_by` set to NULL (RN-09, database.md §4.7/§4.8 —
// no FK to the profile is RESTRICT, so nothing can block it).
export async function remove(callerId: string, id: string): Promise<void> {
  if (id === callerId) throw new AppError(409, 'CONFLICT', 'You cannot delete your own account');
  if (!(await findUser(id))) throw userNotFound();
  const { error } = await authAdmin.deleteUser(id);
  if (error) {
    if (error.code === 'user_not_found') throw userNotFound();
    throw error;
  }
}
