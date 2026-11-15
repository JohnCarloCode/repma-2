import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import type { ReactNode } from 'react';

// components.md §Slide-over (sheet). The same Headless UI Dialog base as Modal.tsx: portalled to
// the document root (outside the shell's stacking context), focus trapped while open and restored
// to the trigger on close, Escape / a scrim click close it. Scrim at `{layers.sheet-scrim}`, panel
// at `{layers.sheet}`: above the whole shell (≤ `shell-panel`), below popovers, dialogs and toasts,
// so a confirm opened from a sheet stacks above it.

interface SheetProps {
  open: boolean;
  /** Escape or a scrim click (and whatever close action the caller renders). */
  onClose: () => void;
  title: string;
  /** The scrolling body. */
  children: ReactNode;
  /** Pinned under the body (e.g. the "Close" tertiary action); the body scrolls, the footer stays. */
  footer?: ReactNode;
}

/**
 * Right-anchored slide-over (DESIGN.md `components.sheet`): full height, 420px (the full width
 * below that), `surface` with a 1px `border` left rule, no radius. Enters from the right over
 * the `scrim`.
 */
export function Sheet({ open, onClose, title, children, footer }: SheetProps) {
  return (
    // autoFocus off, as in Modal: the trap focuses the panel's first focusable element.
    <Dialog open={open} onClose={onClose} autoFocus={false}>
      <DialogBackdrop
        transition
        className="fixed inset-0 z-sheet-scrim bg-scrim transition-opacity duration-base data-closed:opacity-0"
      />
      <div className="fixed inset-0 z-sheet flex justify-end">
        <DialogPanel
          transition
          className="flex h-dvh w-full max-w-[420px] flex-col border-l border-border bg-surface transition-[opacity,transform] duration-base data-closed:translate-x-[24px] data-closed:opacity-0"
        >
          <DialogTitle className="px-lg pt-lg text-h2">{title}</DialogTitle>
          <div className="min-h-0 flex-1 overflow-y-auto p-lg">{children}</div>
          {footer && <div className="flex justify-end gap-sm border-t border-border px-lg py-base">{footer}</div>}
        </DialogPanel>
      </div>
    </Dialog>
  );
}
