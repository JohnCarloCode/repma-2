import type { ReplenishmentStatus } from 'shared';
import { LIST_STATUS_LABEL } from '../lib/format';

/** DESIGN.md `badge-status-draft/-processing/-done`: soft fill + strong text of the same semantic pair. */
const TONE: Record<ReplenishmentStatus, string> = {
  draft: 'bg-info-soft text-info',
  processing: 'bg-warning-soft text-warning',
  done: 'bg-live-soft text-live',
};

/** A replenishment list's state as a pill, always named in text (components.md §Badges, §Data conventions). */
export function ListStatusBadge({ status }: { status: ReplenishmentStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-[10px] py-[2px] text-label ${TONE[status]}`}>
      {LIST_STATUS_LABEL[status]}
    </span>
  );
}
