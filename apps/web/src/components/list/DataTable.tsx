import { Fragment, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { textButtonClass } from '../buttons';

export interface Column<T> {
  /** Header text; also labels the cell when rows stack as cards below 744px. */
  header: string;
  cell: (row: T) => ReactNode;
  /** Numeric columns (and row actions) align right; numbers render in `font-mono` (tabular-nums). */
  align?: 'left' | 'right';
}

interface DataTableProps<T> {
  /** Accessible name of the table. */
  label: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /**
   * Where a row leads (detail route); rows without it are not interactive. An interactive row is
   * the `group/row` hover group, so a destination chevron inside it can light up on row hover.
   */
  rowHref?: (row: T) => string;
  /**
   * What a row opens when it is not a route (e.g. `/catalog`'s product slide-over): the same
   * interactive row (click / Enter, focusable, hover) calling back instead of navigating.
   * `rowHref` wins when both are given.
   */
  onRowClick?: (row: T) => void;
  /**
   * Group header rows (optional): the group a row belongs to. A full-width header row naming
   * the group is rendered before each run of consecutive rows sharing a `key` — the consumer
   * orders `rows` so a group's rows are adjacent. Headers derive from the rows given, so a
   * group whose rows were all filtered out renders no header.
   */
  group?: (row: T) => { key: string; label: ReactNode };
  /**
   * Bounded (unpaginated) use — a capped set instead of a page (Home's blocks): a tertiary
   * "View all" link to the full screen, bottom-right under the table, in place of `<Pagination>`.
   * `total` is the set's true size: when it exceeds the rows shown the link states it
   * ("View all (9)"); leave it out for a feed teaser, whose total bounds no work.
   */
  viewAll?: { to: string; total?: number };
}

/** The bounded variant's "View all" label: the true total only when rows are actually hidden. */
export function viewAllLabel(shown: number, total?: number): string {
  return total !== undefined && total > shown ? `View all (${total})` : 'View all';
}

/**
 * components.md §`<DataTable>` (visual: DESIGN §Data Table): a card holding a
 * full-bleed table. A row with a destination navigates on click or Enter (a
 * row with `onRowClick` calls it instead);
 * buttons inside it (`<RowAction>`) stop propagation so they never also
 * navigate. Below 744px each row stacks into a card list (DESIGN §Responsive
 * Behavior), every cell labelled with its column header.
 */
export function DataTable<T>({
  label,
  columns,
  rows,
  rowKey,
  rowHref,
  onRowClick,
  group,
  viewAll,
}: DataTableProps<T>) {
  const navigate = useNavigate();

  const table = (
    <div className="overflow-hidden rounded-md border border-border bg-surface">
      <table aria-label={label} className="w-full border-collapse max-tablet:block">
        <thead className="max-tablet:hidden">
          <tr>
            {columns.map((column, index) => (
              <th
                key={index}
                scope="col"
                className={`border-b border-border px-base py-[10px] text-label text-text-secondary ${alignClass(column.align)}`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="max-tablet:block">
          {rows.map((row, index) => {
            const href = rowHref?.(row);
            const open = href ? () => navigate(href) : onRowClick && (() => onRowClick(row));
            const rowGroup = group?.(row);
            const startsGroup = rowGroup && (index === 0 || group!(rows[index - 1]!).key !== rowGroup.key);
            return (
              <Fragment key={rowKey(row)}>
                {startsGroup && (
                  <tr className="border-b border-border bg-surface-raised max-tablet:block">
                    <th
                      scope="colgroup"
                      colSpan={columns.length}
                      className="px-base py-[10px] text-left text-body-medium text-text max-tablet:block"
                    >
                      {rowGroup.label}
                    </th>
                  </tr>
                )}
                <tr
                  onClick={open}
                  onKeyDown={open && ((e: KeyboardEvent) => e.key === 'Enter' && open())}
                  tabIndex={open ? 0 : undefined}
                  className={`border-b border-border last:border-b-0 max-tablet:block max-tablet:py-sm ${
                    open ? 'group/row cursor-pointer transition-colors hover:bg-surface-hover' : ''
                  }`}
                >
                  {columns.map((column, index) => (
                    <td
                      key={index}
                      data-label={column.header}
                      className={`h-[44px] px-base py-[10px] align-middle ${alignClass(column.align)} max-tablet:flex max-tablet:h-auto max-tablet:items-center max-tablet:justify-between max-tablet:gap-base max-tablet:py-xs max-tablet:text-right max-tablet:before:text-label max-tablet:before:text-text-secondary max-tablet:before:content-[attr(data-label)]`}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  if (!viewAll) return table;
  return (
    <div className="flex flex-col gap-[12px]">
      {table}
      <div className="flex justify-end">
        <Link to={viewAll.to} className={textButtonClass}>
          {viewAllLabel(rows.length, viewAll.total)}
        </Link>
      </div>
    </div>
  );
}

const alignClass = (align: Column<unknown>['align']) => (align === 'right' ? 'text-right' : 'text-left');

interface RowActionProps {
  icon: string;
  /** Accessible name (the button shows only its icon). */
  label: string;
  onClick: () => void;
}

/**
 * A row action (`icon-button`: 32px `surface-raised` square, 44px hit area).
 * Clicks and keys stop here, so acting on a row never also opens it.
 */
export function RowAction({ icon, label, onClick }: RowActionProps) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className="group inline-flex size-[44px] items-center justify-center rounded-sm align-middle"
    >
      <span
        className="inline-flex size-[32px] items-center justify-center rounded-sm bg-surface-raised text-text transition-colors group-hover:bg-surface-hover">
        <span className="icon" aria-hidden>
          {icon}
        </span>
      </span>
    </button>
  );
}
