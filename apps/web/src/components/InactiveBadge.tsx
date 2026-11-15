/** DESIGN.md `badge-inactive`: the one status label for a deactivated product, size, store or user (components.md §Data conventions). */
export function InactiveBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-surface-raised px-[10px] py-[2px] text-label text-text-secondary">
      Inactive
    </span>
  );
}
