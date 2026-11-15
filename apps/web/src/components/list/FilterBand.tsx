import { useEffect, useRef, useState, type ReactNode } from 'react';

/** The filter band's control look: `surface` fill, 1px `border-strong`, 44px high (DESIGN `filter-band.controls`). */
export const filterControlClass =
  'h-[44px] rounded-sm border border-border-strong bg-surface px-[12px] text-body text-text';

/**
 * components.md §Filter band — the one branded band of a list screen
 * (`accent-hover`, `rounded.sm`, 16px padding, 12px gap). Controls sit inline
 * from tablet up; below 744px they stack full-width, search first.
 */
export function FilterBand({ children }: { children: ReactNode }) {
  return (
    <div
      role="search"
      className="flex flex-col gap-[12px] rounded-sm bg-accent-hover p-base tablet:flex-row tablet:flex-wrap tablet:items-center"
    >
      {children}
    </div>
  );
}

export const SEARCH_DEBOUNCE_MS = 300;

interface SearchFieldProps {
  /** The committed value (from the URL). */
  value: string;
  /** Called 300ms after the user stops typing, with the trimmed text. */
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
}

/** The band's search input: typing is local, the value is committed debounced (300ms). */
export function SearchField({ value, onChange, label, placeholder }: SearchFieldProps) {
  const [draft, setDraft] = useState(value);
  const commit = useRef(onChange);
  useEffect(() => {
    commit.current = onChange;
  });

  // What this field last committed: its echo coming back as `value` is not an outside change.
  const committed = useRef(value);

  // Follow the committed value when it changes from outside (Back, "Clear filters"),
  // without clobbering what is being typed (e.g. a trailing space, or keys typed after a commit).
  useEffect(() => {
    if (value === committed.current) return;
    committed.current = value;
    setDraft((current) => (current.trim() === value ? current : value));
  }, [value]);

  useEffect(() => {
    if (draft.trim() === value) return;
    const timer = setTimeout(() => {
      committed.current = draft.trim();
      commit.current(draft.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, value]);

  return (
    <div
      className={`${filterControlClass} flex items-center gap-sm focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent-bright tablet:min-w-[220px] tablet:flex-1`}
    >
      <span className="icon text-text-secondary" aria-hidden>
        search
      </span>
      <input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="h-full min-w-0 flex-1 bg-transparent text-text outline-none placeholder:text-text-secondary"
      />
    </div>
  );
}
