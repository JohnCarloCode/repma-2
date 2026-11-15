import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';
import { hasPermission } from 'shared';
import { useSession } from '../auth/AuthContext';
import type { RequestOptions } from '../lib/apiClient';

/**
 * The active store (RF-33, layout.md §Tenant context block).
 * - Store roles: their session's store, implicit in every API call.
 * - Platform admin (no store of their own): the store picked in the selector,
 *   persisted in `localStorage` across sessions (logout keeps it) and sent as
 *   `X-Tenant-Id` on tenant-scoped calls.
 */
export interface StoreRef {
  id: string;
  name: string;
}

export const SELECTED_STORE_KEY = 'selectedStore';

/** First element of every tenant-scoped query key: `[STORE_SCOPE, storeId, ...]`. */
export const STORE_SCOPE = 'store';

// The selection lives in localStorage itself (read on every snapshot, parsed
// once per distinct value), so there is no second copy to keep in sync.
const listeners = new Set<() => void>();
let lastRaw: string | null = null;
let lastParsed: StoreRef | null = null;

function readSelectedStore(): StoreRef | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SELECTED_STORE_KEY);
  } catch {
    // Storage unavailable → no selection.
  }
  if (raw !== lastRaw) {
    lastRaw = raw;
    lastParsed = null;
    try {
      const value: unknown = raw === null ? null : JSON.parse(raw);
      if (
        value !== null &&
        typeof value === 'object' &&
        typeof (value as StoreRef).id === 'string' &&
        typeof (value as StoreRef).name === 'string'
      ) {
        lastParsed = { id: (value as StoreRef).id, name: (value as StoreRef).name };
      }
    } catch {
      // Corrupt value → no selection.
    }
  }
  return lastParsed;
}

/** Sets (or clears, with null) the platform admin's selected store. */
export function setSelectedStore(store: StoreRef | null) {
  try {
    if (store) localStorage.setItem(SELECTED_STORE_KEY, JSON.stringify({ id: store.id, name: store.name }));
    else localStorage.removeItem(SELECTED_STORE_KEY);
  } catch {
    // Storage unavailable: the selection cannot stick.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface ActiveStore extends StoreRef {
  /** True when the store comes from the selector (platform admin) → sent as `X-Tenant-Id`. */
  selected: boolean;
}

/**
 * The store the current session works in, or null (no session, or a platform
 * admin with no store selected). A session's own store always wins; otherwise
 * the selection counts only for a session that can list stores (`tenant:manage`).
 */
export function useActiveStore(): ActiveStore | null {
  const session = useSession();
  const selected = useSyncExternalStore(subscribe, readSelectedStore);
  if (!session) return null;
  if (session.store) return { ...session.store, selected: false };
  if (selected && hasPermission(session, 'tenant:manage')) return { ...selected, selected: true };
  return null;
}

/**
 * Switches the platform admin's store (or clears it with null). Every
 * tenant-scoped query is dropped first so no data from the previous store
 * lingers; the new store's queries have new keys and fetch fresh.
 */
export function useSelectStore(): (store: StoreRef | null) => void {
  const queryClient = useQueryClient();
  return useCallback(
    (store) => {
      queryClient.removeQueries({ queryKey: [STORE_SCOPE] });
      setSelectedStore(store);
    },
    [queryClient],
  );
}

export interface StoreScope {
  store: ActiveStore;
  /** The query key for a tenant-scoped query: `[STORE_SCOPE, storeId, ...parts]`. */
  key: (...parts: unknown[]) => QueryKey;
  /** The request options for a tenant-scoped call (`X-Tenant-Id` only for a selected store). */
  request: RequestOptions;
}

/**
 * Everything a tenant-scoped query/mutation needs. Only for components behind
 * a store route guard (layout.md §Route guards rule 3), which guarantees an
 * active store.
 */
export function useStoreScope(): StoreScope {
  const store = useActiveStore();
  if (!store) throw new Error('useStoreScope needs an active store (render it behind a store route guard)');
  return {
    store,
    key: (...parts) => [STORE_SCOPE, store.id, ...parts],
    request: store.selected ? { tenantId: store.id } : {},
  };
}
