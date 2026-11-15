import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { hasPermission, type AuthSession, type Page, type Tenant } from 'shared';
import { api } from '../../lib/apiClient';
import { useActiveStore, useSelectStore } from '../../tenant/activeStore';
import { Tooltip } from '../Tooltip';

const SELECT_A_STORE = 'Select a store';

/** The collapsed tile: a 44px circle (the pill dialect with only an initial left — layout.md §Collapse). */
const tile =
  'flex size-[44px] shrink-0 items-center justify-center rounded-full bg-surface-raised text-[16px] font-[600] text-text';

const initial = (name: string) => name.trim().charAt(0).toUpperCase();

/** Every store the selector offers: `GET /tenants` (one 100-row page), active ones only. */
export const selectorStoresKey = ['tenants', 'selector'] as const;

function StoreOptions({ close }: { close: () => void }) {
  const active = useActiveStore();
  const select = useSelectStore();
  const [search, setSearch] = useState('');
  const stores = useQuery({
    queryKey: selectorStoresKey,
    // Global route: never sent with `X-Tenant-Id`. Inactive stores are listed by the API; the selector hides them.
    queryFn: () => api.get<Page<Tenant>>('/tenants?pageSize=100'),
    select: (page) => page.items.filter((store) => store.isActive),
  });
  const term = search.trim().toLowerCase();
  const matches = stores.data?.filter((store) => store.name.toLowerCase().includes(term)) ?? [];

  const choose = (store: { id: string; name: string } | null) => {
    if ((store?.id ?? null) !== (active?.id ?? null)) select(store);
    close();
  };

  return (
    <>
      <label className="mb-sm flex h-[44px] items-center gap-sm rounded-sm border border-border-strong px-3 focus-within:border-accent-bright">
        <span className="icon text-text-secondary" aria-hidden>
          search
        </span>
        <input
          type="text"
          aria-label="Search stores"
          placeholder="Search stores…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-body text-text outline-none placeholder:text-text-secondary"
        />
      </label>
      {stores.isPending ? (
        <p role="status" className="p-3 text-caption text-text-secondary">
          Loading stores…
        </p>
      ) : stores.isError ? (
        <p role="alert" className="p-3 text-caption text-text-secondary">
          Could not load stores.
        </p>
      ) : matches.length === 0 ? (
        <p className="p-3 text-caption text-text-secondary">No results</p>
      ) : (
        <ul aria-label="Stores" className="max-h-[280px] overflow-y-auto">
          {matches.map((store) => {
            const current = store.id === active?.id;
            return (
              <li key={store.id}>
                <button
                  type="button"
                  aria-current={current ? 'true' : undefined}
                  onClick={() => choose(store)}
                  className={`flex min-h-[44px] w-full items-center justify-between gap-sm rounded-sm px-3 text-left text-body-medium transition-colors hover:bg-surface-hover hover:text-accent-bright ${
                    current ? 'text-accent-bright' : 'text-text'
                  }`}
                >
                  <span className="truncate">{store.name}</span>
                  {current && (
                    <span className="icon shrink-0" aria-hidden>
                      check
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-sm border-t border-border pt-sm">
        <button
          type="button"
          onClick={() => choose(null)}
          className="flex min-h-[44px] w-full items-center rounded-sm px-3 text-left text-body text-text-secondary transition-colors hover:bg-surface-hover hover:text-accent-bright"
        >
          Clear selection
        </button>
      </div>
    </>
  );
}

/**
 * The platform admin's store selector (layout.md §Tenant context block): a
 * `rounded.full` pill on `surface-raised` (`rail` → the 44px circular tile,
 * name as a tooltip) opening an anchored, portalled panel — search, active
 * stores, "Clear selection" — so the sidebar's `overflow-hidden` never clips it.
 */
export function StoreSelector({ rail = false }: { rail?: boolean }) {
  const active = useActiveStore();
  const label = active?.name ?? SELECT_A_STORE;

  return (
    <Popover className={rail ? 'flex justify-center' : 'w-full'}>
      <Tooltip content={rail ? label : null}>
        <PopoverButton
          aria-label={active ? `Store: ${active.name}` : SELECT_A_STORE}
          className={
            rail
              ? `${tile} transition-colors hover:bg-surface-hover data-open:bg-surface-hover`
              : 'flex min-h-[44px] w-full items-center gap-sm rounded-full bg-surface-raised px-3 py-sm text-left text-body-medium text-text transition-colors hover:bg-surface-hover data-open:bg-surface-hover'
          }
        >
          {rail ? (
            active ? (
              <span aria-hidden>{initial(active.name)}</span>
            ) : (
              <span className="icon text-text-secondary" aria-hidden>
                storefront
              </span>
            )
          ) : (
            <>
              <span className="icon shrink-0 text-text-secondary" aria-hidden>
                storefront
              </span>
              <span className={`min-w-0 flex-1 truncate ${active ? '' : 'text-text-secondary'}`}>{label}</span>
              <span className="icon shrink-0 text-text-secondary" aria-hidden>
                expand_more
              </span>
            </>
          )}
        </PopoverButton>
      </Tooltip>
      <PopoverPanel
        focus
        anchor={rail ? { to: 'right start', gap: 8 } : { to: 'bottom start', gap: 8 }}
        className={`z-popover rounded-sm border border-border-strong bg-surface-raised p-sm ${
          rail ? 'w-[280px]' : 'w-(--button-width) min-w-[240px]'
        }`}
      >
        {({ close }) => <StoreOptions close={close} />}
      </PopoverPanel>
    </Popover>
  );
}

/**
 * RF-33 — the current store, always on screen, between the wordmark and the
 * nav: a session with its own store (manager/employee) shows it as static
 * text; a session that can list stores (`tenant:manage`) gets the selector.
 */
export function TenantBlock({ session, rail }: { session: AuthSession; rail: boolean }) {
  if (session.store) {
    const { name } = session.store;
    return rail ? (
      <div className="-mt-sm flex justify-center">
        <Tooltip content={name}>
          {/* Focusable so keyboard users get the name tooltip too (layout.md §Collapse). */}
          <span role="img" tabIndex={0} aria-label={`Store: ${name}`} className={tile}>
            {initial(name)}
          </span>
        </Tooltip>
      </div>
    ) : (
      <p className="-mt-sm flex min-h-[44px] items-center gap-sm px-3 text-body-medium text-text">
        <span className="icon shrink-0 text-text-secondary" aria-hidden>
          storefront
        </span>
        <span className="truncate">
          <span className="sr-only">Store: </span>
          {name}
        </span>
      </p>
    );
  }
  if (!hasPermission(session, 'tenant:manage')) return null;
  return (
    <div className="-mt-sm">
      <StoreSelector rail={rail} />
    </div>
  );
}
