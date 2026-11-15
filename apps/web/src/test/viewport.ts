import { act } from '@testing-library/react';

/**
 * jsdom has no `matchMedia`. This stub answers `(min-width: Npx)` queries
 * against a settable viewport width (default: desktop) and notifies
 * listeners when it changes.
 */
let width = 1440;
const listeners = new Set<() => void>();

export function installMatchMedia() {
  window.matchMedia = (query: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
    return {
      get matches() {
        return width >= min;
      },
      media: query,
      onchange: null,
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
      addListener: (listener: () => void) => listeners.add(listener),
      removeListener: (listener: () => void) => listeners.delete(listener),
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  };
}

/** Sets the viewport width; call before rendering, or inside a test to simulate a resize. */
export function setViewportWidth(next: number) {
  width = next;
  act(() => listeners.forEach((listener) => listener()));
}

export function resetViewport() {
  width = 1440;
  listeners.clear();
}
