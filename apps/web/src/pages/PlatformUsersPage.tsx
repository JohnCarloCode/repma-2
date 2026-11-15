import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import {
  ROLES,
  createUserBody,
  updateUserBody,
  type CreateUserBody,
  type Page,
  type UpdateUserBody,
  type User,
} from 'shared';
import { useSession } from '../auth/AuthContext';
import { ROLE_LABEL, authMeKey } from '../auth/session';
import { InactiveBadge } from '../components/InactiveBadge';
import { ConfirmModal, FormModal } from '../components/Modal';
import { primaryButtonClass } from '../components/buttons';
import { textInputClass } from '../components/form';
import { DataTable, RowAction, type Column } from '../components/list/DataTable';
import { FilterBand, SearchField, filterControlClass } from '../components/list/FilterBand';
import { PageHeader } from '../components/list/PageHeader';
import { Pagination } from '../components/list/Pagination';
import { EmptyState, ErrorState, LoadingState } from '../components/list/states';
import { useEmptyPageRecovery, useListParams } from '../components/list/useListParams';
import { selectorStoresQuery } from '../components/shell/TenantBlock';
import { ApiError, api } from '../lib/apiClient';
import { useToast } from '../lib/toast';

/** Every users query shares this prefix (global — users are not store-scoped), so writes invalidate it whole. */
const USERS = ['users'] as const;

/** A modal whose content outlives `open` so it can animate out. */
type Opened<T> = { value: T; open: boolean } | null;

let openings = 0;

/**
 * platform-users.md — the Platform Admin's users (RF-09..12): list with search + store filter,
 * create, edit and delete. Platform zone: global calls, never `X-Tenant-Id`, no store needed.
 * Self-protection (RF-12): no Delete on the admin's own row and its status toggle disabled; the
 * API's 409 for a stale attempt still lands as a toast.
 */
export function PlatformUsersPage() {
  const session = useSession();
  const list = useListParams(['search', 'tenantId'] as const);
  const { page } = list;
  const { search, tenantId } = list.filters;

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: [...USERS, { page, search, tenantId }],
    queryFn: () => {
      const query = new URLSearchParams({ page: String(page) });
      if (search) query.set('search', search);
      if (tenantId) query.set('tenantId', tenantId);
      return api.get<Page<User>>(`/users?${query}`);
    },
  });
  // A delete that empties a page > 1 lands on the previous one (RF-36).
  useEmptyPageRecovery(data, list.setPage);
  // Filter options: every store, inactive included — their users stay listed (platform-users.md §Edge cases).
  const stores = useQuery(selectorStoresQuery);

  const [creating, setCreating] = useState(false);
  // `seq` remounts the form on every opening, so it always starts from the row's current values.
  const [editing, setEditing] = useState<(Opened<User> & { seq: number }) | null>(null);
  const [deleting, setDeleting] = useState<Opened<User>>(null);
  const isSelf = (user: User) => user.id === session?.user.id;

  const columns: Column<User>[] = [
    {
      header: 'Name',
      cell: (user) => (
        <span className="text-body-medium">
          {user.fullName}
          {isSelf(user) && <span className="text-text-secondary"> (you)</span>}
        </span>
      ),
    },
    { header: 'Email', cell: (user) => <span className="text-text-secondary [overflow-wrap:anywhere]">{user.email}</span> },
    { header: 'Role', cell: (user) => ROLE_LABEL[user.role] },
    { header: 'Store', cell: (user) => user.tenant?.name ?? '—' },
    { header: 'Status', cell: (user) => (user.isActive ? 'Active' : <InactiveBadge />) },
    {
      header: '',
      align: 'right',
      cell: (user) => (
        <span className="inline-flex">
          <RowAction
            icon="edit"
            label={`Edit ${user.fullName}`}
            onClick={() => setEditing({ value: user, open: true, seq: ++openings })}
          />
          {isSelf(user) ? (
            // No self-delete (RF-12); the spacer keeps Edit aligned with the other rows.
            <span className="inline-block size-[44px]" aria-hidden />
          ) : (
            <RowAction icon="delete" label={`Delete ${user.fullName}`} onClick={() => setDeleting({ value: user, open: true })} />
          )}
        </span>
      ),
    },
  ];

  const newUser = (
    <button type="button" className={primaryButtonClass} onClick={() => setCreating(true)}>
      New user
    </button>
  );

  return (
    <main className="flex flex-col gap-lg">
      <PageHeader
        title="Users"
        subtitle={data && `${data.total} ${data.total === 1 ? 'user' : 'users'} on the platform`}
        action={newUser}
      />
      <FilterBand>
        <SearchField
          label="Search"
          placeholder="Search users…"
          value={search}
          onChange={(value) => list.setFilter('search', value)}
        />
        <select
          aria-label="Store"
          value={tenantId}
          onChange={(e) => list.setFilter('tenantId', e.target.value)}
          className={`${filterControlClass} tablet:min-w-[200px]`}
        >
          <option value="">All stores</option>
          {stores.data?.items.map((store) => (
            <option key={store.id} value={store.id}>
              {store.isActive ? store.name : `${store.name} (inactive)`}
            </option>
          ))}
        </select>
      </FilterBand>
      {isPending ? (
        <LoadingState columns={columns.length} />
      ) : isError ? (
        <ErrorState message={error.message} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        list.hasFilters ? (
          <EmptyState
            icon="search"
            title={search ? 'No results for this search' : 'This store has no users'}
            action={{ label: 'Clear filters', onClick: list.clearFilters }}
          />
        ) : (
          <EmptyState icon="group" title="No users yet" action={{ label: 'New user', onClick: () => setCreating(true) }} />
        )
      ) : (
        <>
          <DataTable label="Users" columns={columns} rows={data.items} rowKey={(user) => user.id} />
          <Pagination data={data} onPageChange={list.setPage} />
        </>
      )}

      <CreateUserModal open={creating} onClose={() => setCreating(false)} />
      {editing && (
        <EditUserModal
          key={editing.seq}
          user={editing.value}
          self={isSelf(editing.value)}
          open={editing.open}
          onClose={() => setEditing({ ...editing, open: false })}
        />
      )}
      {deleting && (
        <DeleteUserModal user={deleting.value} open={deleting.open} onClose={() => setDeleting({ ...deleting, open: false })} />
      )}
    </main>
  );
}

type Field = 'email' | 'password' | 'fullName' | 'role' | 'tenantId';
type Values = Record<Field, string>;
type Errors = Partial<Record<Field, string>>;

const EMPTY: Values = { email: '', password: '', fullName: '', role: '', tenantId: '' };
const FIELDS: readonly Field[] = ['email', 'password', 'fullName', 'role', 'tenantId'];
const isField = (path: unknown): path is Field => FIELDS.includes(path as Field);

/** The form as `createUserBody` sees it: blank selects are absent (`tenantId` omitted for a Platform Admin). */
const toBody = (values: Values) => ({
  email: values.email,
  password: values.password,
  fullName: values.fullName,
  role: values.role || undefined,
  tenantId: values.tenantId || undefined,
});

/** 400 `details` whose path is one of the form's fields, first message per field (components.md §Forms). */
function inlineDetails<F extends string>(err: unknown, isFormField: (path: unknown) => path is F) {
  const inline: Partial<Record<F, string>> = {};
  if (err instanceof ApiError && err.status === 400 && Array.isArray(err.details)) {
    for (const detail of err.details as { path: string; message: string }[]) {
      if (isFormField(detail.path)) inline[detail.path] ??= detail.message;
    }
  }
  return Object.keys(inline).length > 0 ? inline : null;
}

function validate(values: Values): { body?: CreateUserBody; errors: Errors } {
  const parsed = createUserBody.safeParse(toBody(values));
  if (parsed.success) return { body: parsed.data, errors: {} };
  const errors: Errors = {};
  for (const issue of parsed.error.issues) {
    const path = issue.path[0];
    if (isField(path)) errors[path] ??= issue.message;
  }
  return { errors };
}

/**
 * platform-users.md §Create modal — `POST /users`. Role drives Store live (RN-01): required for
 * store roles, hidden and cleared for a Platform Admin, so `tenantId` is never sent for one. The
 * store select offers active stores only. 409 (email taken) and 400 `details` render inline on
 * their fields; anything else is a toast.
 */
function CreateUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const stores = useQuery({
    ...selectorStoresQuery,
    enabled: open,
    select: (page) => page.items.filter((store) => store.isActive),
  });

  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  // Validate on submit, then on blur (components.md §Forms).
  const [submitted, setSubmitted] = useState(false);

  const create = useMutation({
    mutationFn: (body: CreateUserBody) => api.post<User>('/users', body),
    onSuccess: () => {
      toast.success('User created');
      void queryClient.invalidateQueries({ queryKey: USERS });
      close();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) return setErrors({ email: err.message });
      const inline = inlineDetails(err, isField);
      if (inline) return setErrors(inline);
      toast.error(err);
    },
  });

  const close = () => {
    onClose();
    setValues(EMPTY);
    setErrors({});
    setSubmitted(false);
  };

  const set = (field: Field, value: string) =>
    setValues((prev) =>
      // A Platform Admin has no store (RN-01): picking that role clears it.
      field === 'role' && value === 'platform_admin' ? { ...prev, role: value, tenantId: '' } : { ...prev, [field]: value },
    );

  const blur = (field: Field) => {
    if (submitted) setErrors((prev) => ({ ...prev, [field]: validate(values).errors[field] }));
  };

  const submit = () => {
    setSubmitted(true);
    const { body, errors: found } = validate(values);
    setErrors(found);
    if (body) create.mutate(body);
  };

  const control = (field: Field) => ({
    id: `new-user-${field}`,
    onBlur: () => blur(field),
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': errors[field] ? `new-user-${field}-error` : undefined,
    className: textInputClass,
  });

  const storeRole = values.role !== 'platform_admin';

  return (
    <FormModal
      open={open}
      onClose={close}
      title="New user"
      submitLabel="Create user"
      pendingLabel="Creating…"
      pending={create.isPending}
      onSubmit={submit}
    >
      <FormField id="new-user-email" label="Email" error={errors.email}>
        <input
          type="email"
          maxLength={254}
          autoComplete="off"
          value={values.email}
          onChange={(e) => set('email', e.target.value)}
          {...control('email')}
        />
      </FormField>
      <FormField id="new-user-password" label="Password" error={errors.password}>
        <input
          type="password"
          maxLength={72}
          autoComplete="new-password"
          value={values.password}
          onChange={(e) => set('password', e.target.value)}
          {...control('password')}
        />
      </FormField>
      <FormField id="new-user-fullName" label="Full name" error={errors.fullName}>
        <input
          type="text"
          maxLength={120}
          autoComplete="off"
          value={values.fullName}
          onChange={(e) => set('fullName', e.target.value)}
          {...control('fullName')}
        />
      </FormField>
      <FormField id="new-user-role" label="Role" error={errors.role}>
        <select value={values.role} onChange={(e) => set('role', e.target.value)} {...control('role')}>
          <option value="">Select a role</option>
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABEL[role]}
            </option>
          ))}
        </select>
      </FormField>
      {storeRole && (
        <FormField id="new-user-tenantId" label="Store" error={errors.tenantId}>
          <select value={values.tenantId} onChange={(e) => set('tenantId', e.target.value)} {...control('tenantId')}>
            <option value="">Select a store</option>
            {stores.data?.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
        </FormField>
      )}
    </FormModal>
  );
}

type EditField = 'fullName' | 'role' | 'isActive' | 'password';
type EditValues = Pick<User, 'fullName' | 'role' | 'isActive'> & { password: string };
type EditErrors = Partial<Record<EditField, string>>;

const EDIT_FIELDS: readonly EditField[] = ['fullName', 'role', 'isActive', 'password'];
const isEditField = (path: unknown): path is EditField => EDIT_FIELDS.includes(path as EditField);

/**
 * The `PATCH` body: only what differs from the row (the name compared trimmed), plus the password
 * when filled. Email and store are immutable (RF-11), so they are never part of it.
 */
function changedFields(values: EditValues, user: User) {
  const changes: Record<string, unknown> = {};
  if (values.fullName.trim() !== user.fullName) changes.fullName = values.fullName;
  if (values.role !== user.role) changes.role = values.role;
  if (values.isActive !== user.isActive) changes.isActive = values.isActive;
  if (values.password !== '') changes.password = values.password;
  return changes;
}

/** `updateUserBody` over the changes; `body` is `null` when nothing changed (the API rejects an empty body). */
function validateEdit(values: EditValues, user: User): { body?: UpdateUserBody | null; errors: EditErrors } {
  const changes = changedFields(values, user);
  if (Object.keys(changes).length === 0) return { body: null, errors: {} };
  const parsed = updateUserBody.safeParse(changes);
  if (parsed.success) return { body: parsed.data, errors: {} };
  const errors: EditErrors = {};
  for (const issue of parsed.error.issues) {
    const path = issue.path[0];
    if (isEditField(path)) errors[path] ??= issue.message;
  }
  return { errors };
}

/**
 * platform-users.md §Edit modal — `PATCH /users/:id` with the changed fields only. Role is
 * manager ↔ employee for store users and fixed for a Platform Admin (RN-01); store and email are
 * read-only (RF-11); the status toggle is disabled on the admin's own account (RF-12); the
 * password is a write-only reset, sent only when filled. 400 `details` render inline; 404 (deleted
 * meanwhile) closes and re-reads the list; anything else — the self-rule 409s included — is a
 * toast with the modal left open.
 */
function EditUserModal({ user, self, open, onClose }: { user: User; self: boolean; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [values, setValues] = useState<EditValues>({
    fullName: user.fullName,
    role: user.role,
    isActive: user.isActive,
    password: '',
  });
  const [errors, setErrors] = useState<EditErrors>({});
  // Validate on submit, then on blur (components.md §Forms).
  const [submitted, setSubmitted] = useState(false);

  const save = useMutation({
    mutationFn: (body: UpdateUserBody) => api.patch<User>(`/users/${user.id}`, body),
    onSuccess: () => {
      toast.success('User updated');
      void queryClient.invalidateQueries({ queryKey: USERS });
      // The shell shows the signed-in user's name (UserMenu): keep it current after a self-edit.
      if (self) void queryClient.invalidateQueries({ queryKey: authMeKey });
      onClose();
    },
    onError: (err) => {
      const inline = inlineDetails(err, isEditField);
      if (inline) return setErrors(inline);
      toast.error(err);
      if (err instanceof ApiError && err.status === 404) {
        void queryClient.invalidateQueries({ queryKey: USERS });
        onClose();
      }
    },
  });

  const set = <F extends keyof EditValues>(field: F, value: EditValues[F]) => setValues((prev) => ({ ...prev, [field]: value }));

  const blur = (field: EditField) => {
    if (submitted) setErrors((prev) => ({ ...prev, [field]: validateEdit(values, user).errors[field] }));
  };

  const submit = () => {
    setSubmitted(true);
    const { body, errors: found } = validateEdit(values, user);
    setErrors(found);
    if (body === null) onClose(); // nothing changed: nothing to send
    else if (body) save.mutate(body);
  };

  const control = (field: EditField) => ({
    id: `edit-user-${field}`,
    onBlur: () => blur(field),
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': errors[field] ? `edit-user-${field}-error` : undefined,
  });

  const admin = user.role === 'platform_admin';

  return (
    <FormModal
      open={open}
      onClose={onClose}
      title="Edit user"
      submitLabel="Save changes"
      pending={save.isPending}
      onSubmit={submit}
    >
      <FormField id="edit-user-email" label="Email">
        <input type="email" readOnly value={user.email} id="edit-user-email" className={`${textInputClass} text-text-secondary`} />
      </FormField>
      <FormField id="edit-user-fullName" label="Full name" error={errors.fullName}>
        <input
          type="text"
          maxLength={120}
          autoComplete="off"
          value={values.fullName}
          onChange={(e) => set('fullName', e.target.value)}
          {...control('fullName')}
          className={textInputClass}
        />
      </FormField>
      <FormField id="edit-user-role" label="Role" error={errors.role}>
        <select
          value={values.role}
          disabled={admin}
          onChange={(e) => set('role', e.target.value as User['role'])}
          {...control('role')}
          className={`${textInputClass} disabled:text-text-secondary`}
        >
          {(admin ? (['platform_admin'] as const) : (['manager', 'employee'] as const)).map((role) => (
            <option key={role} value={role}>
              {ROLE_LABEL[role]}
            </option>
          ))}
        </select>
      </FormField>
      <div className="flex flex-col gap-xs">
        <span className="text-label text-text">Store</span>
        <span className="inline-flex flex-wrap items-center gap-sm" data-testid="edit-user-store">
          {user.tenant?.name ?? '—'}
          {user.tenant && !user.tenant.isActive && <InactiveBadge />}
        </span>
      </div>
      <div className="flex flex-col gap-xs">
        <label className="inline-flex cursor-pointer items-center gap-sm has-disabled:cursor-not-allowed has-disabled:text-text-secondary">
          <input
            type="checkbox"
            checked={values.isActive}
            disabled={self}
            onChange={(e) => set('isActive', e.target.checked)}
            {...control('isActive')}
            className="size-[16px] accent-accent"
          />
          Active user
        </label>
        {self && <span className="text-caption text-text-secondary">You cannot deactivate your own account.</span>}
        {errors.isActive && (
          <span id="edit-user-isActive-error" className="text-caption text-alert">
            {errors.isActive}
          </span>
        )}
      </div>
      <FormField
        id="edit-user-password"
        label="Reset password (optional)"
        hint="Leave empty to keep the current password."
        error={errors.password}
      >
        <input
          type="password"
          maxLength={72}
          autoComplete="new-password"
          value={values.password}
          onChange={(e) => set('password', e.target.value)}
          {...control('password')}
          className={textInputClass}
        />
      </FormField>
    </FormModal>
  );
}

/**
 * platform-users.md §Delete user — the confirm naming the user with the RN-09 consequence →
 * `DELETE /users/:id`. 204 → toast, list re-read (an emptied page recovers, RF-36). Any error
 * (404 already deleted, the self-delete 409 from a stale UI) → toast with the API message and the
 * list re-read so the row shows the server's state.
 */
function DeleteUserModal({ user, open, onClose }: { user: User; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const remove = useMutation({
    mutationFn: () => api.delete(`/users/${user.id}`),
    onSuccess: () => toast.success('User deleted'),
    onError: (err) => toast.error(err),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: USERS });
      onClose();
    },
  });

  return (
    <ConfirmModal
      open={open}
      onClose={onClose}
      title="Delete user"
      message={`Delete the user “${user.fullName}”? They will permanently lose access. The availability events they recorded will be kept.`}
      confirmLabel="Delete user"
      pendingLabel="Deleting…"
      pending={remove.isPending}
      onConfirm={() => remove.mutate()}
    />
  );
}

/**
 * Label above the control (`id` is the control's), an optional hint and the error caption beneath
 * it (`${id}-error`, components.md §Forms).
 */
function FormField({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-xs">
      <label htmlFor={id} className="text-label text-text">
        {label}
      </label>
      {children}
      {hint && !error && <span className="text-caption text-text-secondary">{hint}</span>}
      {error && (
        <span id={`${id}-error`} className="text-caption text-alert">
          {error}
        </span>
      )}
    </div>
  );
}
