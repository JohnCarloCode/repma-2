// DESIGN.md `components.text-input` — the shared class strings for form controls: a `canvas`
// well with a `border-strong` outline, `accent-bright` border + 3px `accent-soft` ring on focus,
// `alert` border when invalid (components.md §Forms).

const field =
  'w-full rounded-sm border border-border-strong bg-canvas px-[12px] text-body text-text placeholder:text-text-secondary ' +
  'focus:border-accent-bright focus:outline-3 focus:outline-offset-0 focus:outline-accent-soft ' +
  'aria-invalid:border-alert';

/** A 44px single-line input. */
export const textInputClass = `${field} h-[44px]`;

/** A multi-line textarea, resizable vertically, starting at roughly four lines. */
export const textAreaClass = `${field} min-h-[112px] resize-y py-[10px]`;
