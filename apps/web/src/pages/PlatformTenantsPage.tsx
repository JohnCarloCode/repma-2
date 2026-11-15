import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { createTenantBody, type Page, type Tenant } from 'shared';
import { InactiveBadge } from '../components/InactiveBadge';
import { ConfirmModal, FormModal } from '../components/Modal';
import { primaryButtonClass, secondaryButtonClass } from '../components/buttons';
import { textInputClass } from '../components/form';
import { DataTable, RowAction, type Column } from '../components/list/DataTable';
import { FilterBand, SearchField } from '../components/list/FilterBand';
import { PageHeader } from '../components/list/PageHeader';
import { Pagination } from '../components/list/Pagination';
import { EmptyState, ErrorState, LoadingState } from '../components/list/states';
import { useListParams } from '../components/list/useListParams';
import { ApiError, api } from '../lib/apiClient';
import { formatDate } from '../lib/format';
import { useToast } from '../lib/toast';
import { useActiveStore, useSelectStore } from '../tenant/activeStore';

/**
 * Every tenants query (this page's list pages and the sidebar selector's `['tenants', 'selector']`)
 * shares this prefix, so one invalidation after any write refreshes both: new and renamed stores
 * reach the selector, (de)activated ones join or leave it (platform-tenants.md §Edge cases).
 */
const TENANTS = ['tenants'] as const;

/** A modal whose content outlives `open` so it can animate out. */
type Opened<T> = { value: T; open: boolean } | null;

let openings = 0;

/**
 * platform-tenants.md — the Platform Admin's stores (RF-06..08): list, create, rename and
 * deactivate/reactivate. Platform zone: global calls, never `X-Tenant-Id`, no store needed.
 * No delete anywhere (RN-08).
 */
export function PlatformTenantsPage() {
  const list = useListParams(['search'] as const);
  const { page } = list;
  const { search } = list.filters;

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: [...TENANTS, 'list', { page, search }],
    queryFn: () => {
      const query = new URLSearchParams({ page: String(page) });
      if (search) query.set('search', search);
      return api.get<Page<Tenant>>(`/tenants?${query}`);
    },
  });

  const [creating, setCreating] = useState(false);
  // `seq` remounts the form on every opening, so it always starts from the row's current name.
  const [editing, setEditing] = useState<(Opened<Tenant> & { seq: number }) | null>(null);
  const [toggling, setToggling] = useState<Opened<Tenant>>(null);

  const columns: Column<Tenant>[] = [
    { header: 'Name', cell: (store) => <span className="text-body-medium">{store.name}</span> },
    { header: 'Slug', cell: (store) => <span className="text-caption text-text-secondary">{store.slug}</span> },
    { header: 'Status', cell: (store) => (store.isActive ? 'Active' : <InactiveBadge />) },
    { header: 'Created', cell: (store) => formatDate(store.createdAt) },
    {
      header: '',
      align: 'right',
      cell: (store) => (
        <RowAction icon="edit" label={`Edit ${store.name}`} onClick={() => setEditing({ value: store, open: true, seq: ++openings })} />
      ),
    },
  ];

  const newStore = (
    <button type="button" className={primaryButtonClass} onClick={() => setCreating(true)}>
      New store
    </button>
  );

  return (
    <main className="flex flex-col gap-lg">
      <PageHeader
        title="Stores"
        subtitle={data && `${data.total} ${data.total === 1 ? 'store' : 'stores'} on the platform`}
        action={newStore}
      />
      <FilterBand>
        <SearchField
          label="Search"
          placeholder="Search stores…"
          value={search}
          onChange={(value) => list.setFilter('search', value)}
        />
      </FilterBand>
      {isPending ? (
        <LoadingState columns={columns.length} />
      ) : isError ? (
        <ErrorState message={error.message} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        list.hasFilters ? (
          <EmptyState
            icon="search"
            title="No results for this search"
            action={{ label: 'Clear filters', onClick: list.clearFilters }}
          />
        ) : (
          <EmptyState icon="storefront" title="No stores yet" action={{ label: 'New store', onClick: () => setCreating(true) }} />
        )
      ) : (
        <>
          <DataTable label="Stores" columns={columns} rows={data.items} rowKey={(store) => store.id} />
          <Pagination data={data} onPageChange={list.setPage} />
        </>
      )}

      <StoreFormModal open={creating} onClose={() => setCreating(false)} />
      {editing && (
        <StoreFormModal
          key={editing.seq}
          store={editing.value}
          open={editing.open}
          onClose={() => setEditing({ ...editing, open: false })}
          onToggleActive={() => {
            setEditing({ ...editing, open: false });
            setToggling({ value: editing.value, open: true });
          }}
        />
      )}
      {toggling && (
        <ActivationConfirm
          store={toggling.value}
          open={toggling.open}
          onClose={() => setToggling({ ...toggling, open: false })}
        />
      )}
    </main>
  );
}

/**
 * The create ("New store", `POST /tenants`) and edit ("Edit store", `PATCH /tenants/:id { name }`)
 * form: the name is the only input (RN-10 — the API derives the slug, shown read-only on edit and
 * never regenerated). 400 on `name` and 409 (an equivalent slug, create only) render inline on
 * Name; anything else is a toast. Edit also hosts the separate activation control.
 */
function StoreFormModal({
  open,
  onClose,
  store,
  onToggleActive,
}: {
  open: boolean;
  onClose: () => void;
  store?: Tenant;
  onToggleActive?: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const active = useActiveStore();
  const selectStore = useSelectStore();

  const [name, setName] = useState(store?.name ?? '');
  const [nameError, setNameError] = useState<string | undefined>();
  // Validate on submit, then on blur (components.md §Forms).
  const [submitted, setSubmitted] = useState(false);
  const validate = (value: string) => createTenantBody.safeParse({ name: value }).error?.issues[0]?.message;

  const save = useMutation({
    mutationFn: (body: { name: string }) =>
      store ? api.patch<Tenant>(`/tenants/${store.id}`, body) : api.post<Tenant>('/tenants', body),
    onSuccess: (saved) => {
      toast.success(store ? 'Store updated' : 'Store created');
      void queryClient.invalidateQueries({ queryKey: TENANTS });
      // The selected store's name lives with the selection (layout.md §Tenant context): keep it current.
      if (active?.selected && active.id === saved.id && active.name !== saved.name) {
        selectStore({ id: saved.id, name: saved.name });
      }
      close();
    },
    onError: (err) => {
      const inline =
        err instanceof ApiError &&
        (err.status === 409
          ? err.message
          : err.status === 400 && Array.isArray(err.details)
            ? (err.details as { path: string; message: string }[]).find((d) => d.path === 'name')?.message
            : undefined);
      if (inline) setNameError(inline);
      else toast.error(err);
    },
  });

  const close = () => {
    onClose();
    if (!store) {
      setName('');
      setNameError(undefined);
      setSubmitted(false);
    }
  };

  const submit = () => {
    setSubmitted(true);
    const found = validate(name);
    setNameError(found);
    if (!found) save.mutate({ name: name.trim() });
  };

  const prefix = store ? 'edit-store' : 'new-store';
  return (
    <FormModal
      open={open}
      onClose={close}
      title={store ? 'Edit store' : 'New store'}
      submitLabel={store ? 'Save changes' : 'Create store'}
      pendingLabel={store ? 'Saving…' : 'Creating…'}
      pending={save.isPending}
      onSubmit={submit}
    >
      <div className="flex flex-col gap-xs">
        <label htmlFor={`${prefix}-name`} className="text-label text-text">
          Name
        </label>
        <input
          id={`${prefix}-name`}
          type="text"
          maxLength={120}
          autoComplete="off"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => submitted && setNameError(validate(name))}
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? `${prefix}-name-error` : undefined}
          className={textInputClass}
        />
        {nameError && (
          <span id={`${prefix}-name-error`} className="text-caption text-alert">
            {nameError}
          </span>
        )}
      </div>
      {store && (
        <>
          <div className="flex flex-col gap-xs">
            <label htmlFor="edit-store-slug" className="text-label text-text">
              Slug
            </label>
            <input
              id="edit-store-slug"
              type="text"
              readOnly
              value={store.slug}
              className={`${textInputClass} text-text-secondary`}
            />
          </div>
          {/* The activation control, apart from the name form (platform-tenants.md §Edit modal). */}
          <div className="flex flex-wrap items-center justify-between gap-sm border-t border-border pt-base">
            <span className="text-text-secondary">{store.isActive ? 'This store is active.' : 'This store is deactivated.'}</span>
            <button type="button" className={secondaryButtonClass} disabled={save.isPending} onClick={onToggleActive}>
              {store.isActive ? 'Deactivate store' : 'Reactivate store'}
            </button>
          </div>
        </>
      )}
    </FormModal>
  );
}

/**
 * platform-tenants.md §Flows · Deactivate / reactivate (PD-03): a confirm stating the consequence
 * (RF-05 — the store's users stop operating on their next request) → `PATCH { isActive }`.
 * Success refreshes every tenants query (the selector lists active stores only) and, when the
 * deactivated store is the admin's selected one, clears the selection. A failure is a toast; the
 * list is re-read so the row shows the server's state.
 */
function ActivationConfirm({ store, open, onClose }: { store: Tenant; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const active = useActiveStore();
  const selectStore = useSelectStore();
  const deactivating = store.isActive;

  const toggle = useMutation({
    mutationFn: () => api.patch<Tenant>(`/tenants/${store.id}`, { isActive: !deactivating }),
    onSuccess: (saved) => {
      toast.success(saved.isActive ? 'Store reactivated' : 'Store deactivated');
      if (!saved.isActive && active?.selected && active.id === saved.id) selectStore(null);
    },
    onError: (err) => toast.error(err),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: TENANTS });
      onClose();
    },
  });

  return (
    <ConfirmModal
      open={open}
      onClose={onClose}
      title={deactivating ? 'Deactivate store' : 'Reactivate store'}
      message={
        deactivating
          ? `Deactivate the store “${store.name}”? Its users will not be able to operate while it is deactivated.`
          : `Reactivate the store “${store.name}”? Its users will be able to operate again.`
      }
      confirmLabel={deactivating ? 'Deactivate store' : 'Reactivate store'}
      pendingLabel={deactivating ? 'Deactivating…' : 'Reactivating…'}
      tone={deactivating ? 'danger' : 'primary'}
      pending={toggle.isPending}
      onConfirm={() => toggle.mutate()}
    />
  );
}
