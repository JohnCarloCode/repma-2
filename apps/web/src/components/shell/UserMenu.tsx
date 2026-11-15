import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import { hashKey, useMutation, useQueryClient } from '@tanstack/react-query';
import type { AuthSession } from 'shared';
import { authMeKey, ROLE_LABEL } from '../../auth/session';
import { api } from '../../lib/apiClient';
import { Tooltip } from '../Tooltip';

function initials(session: AuthSession): string {
  const words = session.user.fullName.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 0 ? words.slice(0, 2).map((w) => w[0]) : [session.user.email[0]];
  return letters.join('').toUpperCase();
}

/**
 * layout.md §User menu: name + role label; one action, "Log out" →
 * `POST /auth/logout` → /login. Every cached query except the session is
 * dropped, then the session is set to null (kept, not removed, so the
 * bootstrap does not refetch it) and the route guard redirects to /login —
 * the same single path as an expired session (layout.md §Route guards rule 1).
 */
export function UserMenu({ session, rail = false }: { session: AuthSession; rail?: boolean }) {
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: () => api.post<void>('/auth/logout'),
    onSuccess: () => {
      const sessionHash = hashKey(authMeKey);
      queryClient.removeQueries({ predicate: (query) => query.queryHash !== sessionHash });
      queryClient.setQueryData(authMeKey, null);
    },
  });
  const roleLabel = ROLE_LABEL[session.role];

  return (
    <Menu as="div" className="relative">
      {/* Collapsed (rail): the 32px avatar alone, name + role as a tooltip; the menu opens as a flyout beside the rail. */}
      <Tooltip content={rail ? `${session.user.fullName} · ${roleLabel}` : null}>
        <MenuButton
          className={`flex min-h-[44px] items-center text-left transition-colors hover:bg-surface-hover data-open:bg-surface-hover ${
            rail ? 'w-[44px] justify-center rounded-sm' : 'w-full gap-sm rounded-full px-sm py-[6px]'
          }`}
        >
          <span
            aria-hidden
            className="flex size-[32px] shrink-0 items-center justify-center rounded-sm bg-accent-soft text-label font-[600] text-accent-bright"
          >
            {initials(session)}
          </span>
          <span className={rail ? 'sr-only' : 'flex min-w-0 flex-1 flex-col leading-tight'}>
            <span className="truncate text-body-medium">{session.user.fullName}</span>
            <span className="truncate text-caption text-text-secondary">{roleLabel}</span>
          </span>
          {!rail && (
            <span className="icon shrink-0 text-text-secondary" aria-hidden>
              expand_less
            </span>
          )}
        </MenuButton>
      </Tooltip>
      <MenuItems
        anchor={rail ? { to: 'right end', gap: 8 } : undefined}
        className={`z-popover min-w-[200px] rounded-sm border border-border-strong bg-surface-raised p-sm focus:outline-none ${
          rail ? '' : 'absolute bottom-full left-0 mb-sm w-full'
        }`}
      >
        <div className="border-b border-border px-3 pt-sm pb-3">
          <p className="text-body-medium">{session.user.fullName}</p>
          <p className="text-caption text-text-secondary">{roleLabel}</p>
        </div>
        <MenuItem>
          <button
            type="button"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
            className="mt-sm flex min-h-[44px] w-full items-center gap-sm rounded-sm px-3 text-left text-body transition-colors data-focus:bg-surface-hover"
          >
            <span className="icon" aria-hidden>
              logout
            </span>
            Log out
          </button>
        </MenuItem>
      </MenuItems>
    </Menu>
  );
}
