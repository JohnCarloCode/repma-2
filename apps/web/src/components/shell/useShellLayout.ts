import { useCallback, useState, useSyncExternalStore } from 'react';

/** DESIGN.md §Responsive Behavior — the same widths as `--breakpoint-*` in theme.css. */
const TABLET_QUERY = '(min-width: 744px)';
const DESKTOP_QUERY = '(min-width: 1280px)';

export type ShellMode = 'mobile' | 'tablet' | 'desktop';

function subscribe(onChange: () => void) {
  const queries = [window.matchMedia(TABLET_QUERY), window.matchMedia(DESKTOP_QUERY)];
  queries.forEach((q) => q.addEventListener('change', onChange));
  return () => queries.forEach((q) => q.removeEventListener('change', onChange));
}

function currentMode(): ShellMode {
  if (window.matchMedia(DESKTOP_QUERY).matches) return 'desktop';
  return window.matchMedia(TABLET_QUERY).matches ? 'tablet' : 'mobile';
}

/** The shell's breakpoint, read synchronously so the first render already has the right layout. */
export function useShellMode(): ShellMode {
  return useSyncExternalStore(subscribe, currentMode);
}

/** layout.md §Collapse / expand · Persistence. */
export const SIDEBAR_COLLAPSED_KEY = 'sidebarCollapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
  } catch {
    return false; // storage blocked: default expanded
  }
}

/**
 * The desktop collapse preference, persisted in `localStorage`. Read in the
 * state initializer — i.e. during the shell's first render, before it is ever
 * painted — so a collapsed sidebar never flashes expanded.
 */
export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(!prev));
      } catch {
        // storage blocked: the choice lasts for this page load only
      }
      return !prev;
    });
  }, []);
  return [collapsed, toggle];
}
