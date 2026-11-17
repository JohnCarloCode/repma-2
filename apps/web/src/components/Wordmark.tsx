/**
 * DESIGN.md §Typography "Wordmark": the 32px owl mark + "REPMA" (login card,
 * sidebar). `compact` keeps only the logo mark (collapsed rail, layout.md §Collapse).
 * `blink` swaps in the blinking owl (sidebar only). `letterTile` keeps the old "R" tile for the landing page until it adopts the owl.
 */
export function Wordmark({
  compact = false,
  blink = false,
  letterTile = false,
}: {
  compact?: boolean;
  blink?: boolean;
  letterTile?: boolean;
}) {
  return (
    <div className="flex items-center gap-sm">
      {letterTile ? (
        <span
          aria-hidden
          className="flex size-[32px] shrink-0 items-center justify-center rounded-sm bg-accent text-body-medium text-on-accent"
        >
          R
        </span>
      ) : (
        <img
          src={blink ? "/logo-blink.svg" : "/logo.svg"}
          alt=""
          aria-hidden
          className="size-[32px] shrink-0 object-contain"
        />
      )}
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
