// DESIGN.md §Buttons — the shared class strings for the 44px buttons. One primary per screen;
// the danger fill is reserved for the confirm of a destructive action.

const base =
  'inline-flex h-[44px] items-center justify-center gap-sm rounded-sm px-base text-body-medium transition-colors ' +
  'disabled:pointer-events-none disabled:opacity-45';

/** `button-primary`: accent fill, on-accent text. */
export const primaryButtonClass = `${base} bg-accent text-on-accent hover:bg-accent-hover active:bg-accent-active`;

/** `button-secondary`: transparent with a `border-strong` outline. */
export const secondaryButtonClass = `${base} border border-border-strong text-text hover:bg-surface-hover`;

/** `button-danger`: alert fill, white text (`on-accent` is white in both themes). */
export const dangerButtonClass = `${base} bg-alert text-on-accent hover:opacity-90`;
