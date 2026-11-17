/**
 * DESIGN.md §Typography "Wordmark": the 32px owl mark + "REPMA" (login card,
 * sidebar). `compact` keeps only the logo mark (collapsed rail, layout.md §Collapse).
 * `blink` swaps in the blinking owl (sidebar only).
 */
export function Wordmark({
  compact = false,
  blink = false,
}: {
  compact?: boolean;
  blink?: boolean;
}) {
  return (
    <div className="flex items-center gap-sm">
      {/* App-icon tile: the owl's belly is white and vanishes on a light surface. */}
      <div className="flex size-[36px] shrink-0 items-center justify-center rounded-sm bg-text">
        <img
          src={blink ? "/logo-blink.svg" : "/logo.svg"}
          alt=""
          aria-hidden
          className="size-[28px] object-contain"
        />
      </div>
      <span
        className={
          compact ? "sr-only" : "text-body font-[600] tracking-[0.14em]"
        }
      >
        REPMA
      </span>
    </div>
  );
}
