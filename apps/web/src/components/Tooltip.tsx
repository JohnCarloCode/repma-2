import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  /** Tooltip text; `null` disables the tooltip (e.g. the sidebar shows its labels when expanded). */
  content: ReactNode | null;
  /** The trigger — a focusable element that already carries its own accessible name. */
  children: ReactNode;
  className?: string;
  /** Side of the trigger; `right` (default) for the sidebar, `top` for inline triggers in a row (size tiles). */
  placement?: 'right' | 'top';
}

/**
 * DESIGN.md `components.tooltip`: `surface-raised`, caption text, `rounded.sm`,
 * 1px `border-strong` (§Elevation). Shown on hover **and** keyboard focus,
 * dismissed on leave/blur or Escape, placed to the right of (or above) the trigger.
 * Portalled to the body at `{layers.popover}` so no scrolling ancestor (the
 * sidebar nav) clips it. Purely visual: the trigger keeps its own accessible
 * name, so the tooltip is not wired as a description (no double announcement).
 */
export function Tooltip({ content, children, className, placement = 'right' }: TooltipProps) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const show = (wrapper: HTMLElement) => {
    const rect = (wrapper.firstElementChild ?? wrapper).getBoundingClientRect();
    setPosition(
      placement === 'top'
        ? { top: rect.top - 8, left: rect.left + rect.width / 2 }
        : { top: rect.top + rect.height / 2, left: rect.right + 8 },
    );
  };
  const hide = () => setPosition(null);

  return (
    <div
      className={className}
      onMouseEnter={(e) => show(e.currentTarget)}
      onMouseLeave={hide}
      onFocus={(e) => show(e.currentTarget)}
      onBlur={hide}
      onKeyDown={(e) => e.key === 'Escape' && hide()}
    >
      {children}
      {content !== null &&
        position &&
        createPortal(
          <div
            role="tooltip"
            style={{ top: position.top, left: position.left }}
            className={`pointer-events-none fixed z-popover ${placement === 'top' ? '-translate-x-1/2 -translate-y-full' : '-translate-y-1/2'} whitespace-nowrap rounded-sm border border-border-strong bg-surface-raised px-sm py-xs text-caption text-text`}
          >
            {content}
          </div>,
          document.body,
        )}
    </div>
  );
}
