/**
 * DESIGN.md §Typography "Wordmark": the 32px `logo-tile` + "REPMA" (login card,
 * sidebar). `compact` keeps only the logo mark (collapsed rail, layout.md §Collapse).
 */
export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-sm">
      <span
        aria-hidden
        className="flex size-[32px] shrink-0 items-center justify-center rounded-sm bg-accent text-body-medium text-on-accent"
      >
        R
      </span>
      <span className={compact ? 'sr-only' : 'text-body font-[600] tracking-[0.14em]'}>REPMA</span>
    </div>
  );
}
