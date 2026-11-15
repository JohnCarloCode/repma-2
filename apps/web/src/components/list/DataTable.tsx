import type { KeyboardEvent, ReactNode } from 'react';
import { useNavigate } from 'react-router';

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
  /** Where a row leads (detail route); rows without it are not interactive. */
  rowHref?: (row: T) => string;
}

/**
 * components.md §`<DataTable>` (visual: DESIGN §Data Table): a card holding a
 * full-bleed table. A row with a destination navigates on click or Enter;
 * buttons inside it (`<RowAction>`) stop propagation so they never also
 * navigate. Below 744px each row stacks into a card list (DESIGN §Responsive
 * Behavior), every cell labelled with its column header.
 */
export function DataTable<T>({ label, columns, rows, rowKey, rowHref }: DataTableProps<T>) {
  const navigate = useNavigate();

  return (
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
          {rows.map((row) => {
            const href = rowHref?.(row);
            const open = href ? () => navigate(href) : undefined;
            return (
              <tr
                key={rowKey(row)}
                onClick={open}
                onKeyDown={open && ((e: KeyboardEvent) => e.key === 'Enter' && open())}
                tabIndex={open ? 0 : undefined}
                className={`border-b border-border last:border-b-0 max-tablet:block max-tablet:py-sm ${
                  open ? 'cursor-pointer transition-colors hover:bg-surface-hover' : ''
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
            );
          })}
        </tbody>
      </table>
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
