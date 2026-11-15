import { Description, Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import type { FormEvent, ReactNode } from 'react';
import { dangerButtonClass, primaryButtonClass, secondaryButtonClass } from './buttons';

// components.md §Modals & confirms. Headless UI's Dialog portals to the document root
// (outside the shell's stacking context), traps focus while open and restores it to the
// trigger on close. Scrim at `{layers.dialog-scrim}`, panel at `{layers.dialog}`: above the
// entire shell at every breakpoint. Only toasts (portalled to <body>, lib/toast.tsx) outrank it.

interface ModalProps {
  open: boolean;
  /** Escape, a scrim click or Cancel. Ignored while `pending`, so a running mutation is never orphaned. */
  onClose: () => void;
  title: string;
  /** Panel sizing (e.g. `max-w-[640px]`); the panel is full width up to it. */
  className: string;
  pending?: boolean;
  /**
   * Below the tablet breakpoint (744px) the panel becomes a full-screen sheet: no gutter, no
   * radius, the full dynamic viewport height (product-picker.md §Anatomy). From tablet up it is
   * the centered card, sized by `className` — which must then set its tablet-up height too.
   */
  sheetOnMobile?: boolean;
  children: ReactNode;
}

/**
 * The shared base: scrim + centered `modal` card (DESIGN.md `components.modal`) with its 18px
 * title. FormModal/ConfirmModal build on it; a dialog with its own layout (ProductPicker) can too.
 */
export function Modal({ open, onClose, title, className, pending = false, sheetOnMobile = false, children }: ModalProps) {
  return (
    // autoFocus off: Headless UI's default would focus only a `data-autofocus` element (else the
    // panel); without it the trap focuses the panel's first focusable element — the first field
    // of a form, Cancel in a confirm. (Initial focus is skipped on touch devices, by design.)
    <Dialog open={open} onClose={() => !pending && onClose()} autoFocus={false}>
      <DialogBackdrop
        transition
        className="fixed inset-0 z-dialog-scrim bg-scrim transition-opacity duration-base data-closed:opacity-0"
      />
      <div
        className={`fixed inset-0 z-dialog flex items-center justify-center overflow-y-auto ${sheetOnMobile ? 'tablet:p-base' : 'p-base'}`}
      >
        <DialogPanel
          transition
          className={`w-full bg-surface transition-[opacity,transform] duration-base data-closed:scale-95 data-closed:opacity-0 ${
            sheetOnMobile
              ? 'h-dvh p-base tablet:rounded-md tablet:border tablet:border-border tablet:p-lg'
              : 'rounded-md border border-border p-lg'
          } ${className}`}
        >
          <DialogTitle className="text-h2">{title}</DialogTitle>
          {children}
        </DialogPanel>
      </div>
    </Dialog>
  );
}

/** Actions row: bottom-right, Cancel first (DESIGN.md §Forms & modals). */
function Actions({ children }: { children: ReactNode }) {
  return <div className="mt-lg flex flex-wrap justify-end gap-sm">{children}</div>;
}

interface FormModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** The submit button, e.g. "Create list". */
  submitLabel: string;
  /** Shown on the disabled submit while `pending` (components.md §Forms). */
  pendingLabel?: string;
  /** The mutation is running: submit disabled with its pending label; the modal can't be dismissed. */
  pending?: boolean;
  /** A non-field failure, shown as an `alert` beneath the fields. Field errors render inline in `children`. */
  error?: string | null;
  /** Called on submit (Enter or the button); the native submit is already prevented. */
  onSubmit: () => void;
  /** The fields, single column. */
  children: ReactNode;
}

/** Form modal (max-w 640px): create/edit forms that don't warrant a page. Focus lands on the first field. */
export function FormModal({
  open,
  onClose,
  title,
  submitLabel,
  pendingLabel = 'Saving…',
  pending = false,
  error,
  onSubmit,
  children,
}: FormModalProps) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!pending) onSubmit();
  };
  return (
    <Modal open={open} onClose={onClose} title={title} pending={pending} className="max-w-[640px]">
      <form noValidate onSubmit={submit} className="mt-lg flex flex-col gap-base">
        {children}
        {error && (
          <div role="alert" className="flex items-start gap-sm rounded-sm bg-alert-soft p-[12px] text-alert">
            <span className="icon" aria-hidden>
              error
            </span>
            <span>{error}</span>
          </div>
        )}
        <Actions>
          <button type="button" className={secondaryButtonClass} disabled={pending} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={primaryButtonClass} disabled={pending}>
            {pending ? pendingLabel : submitLabel}
          </button>
        </Actions>
      </form>
    </Modal>
  );
}

interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Names the entity and states the consequence, e.g. "Delete the list “X”? Its items will be deleted too." */
  message: ReactNode;
  /** e.g. "Delete list". */
  confirmLabel: string;
  /** e.g. "Deleting…". */
  pendingLabel: string;
  /** `danger` (default) for destructive actions; `primary` for the benign side of a toggle (e.g. reactivate). */
  tone?: 'danger' | 'primary';
  pending?: boolean;
  onConfirm: () => void;
}

/** Confirm modal (max-w 480px): every destructive action. Focus lands on Cancel (first in the DOM), never on the destructive button. */
export function ConfirmModal({
  open,
  onClose,
  title,
  message,
  confirmLabel,
  pendingLabel,
  tone = 'danger',
  pending = false,
  onConfirm,
}: ConfirmModalProps) {
  return (
    <Modal open={open} onClose={onClose} title={title} pending={pending} className="max-w-[480px]">
      <Description className="mt-sm">{message}</Description>
      <Actions>
        <button type="button" className={secondaryButtonClass} disabled={pending} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={tone === 'danger' ? dangerButtonClass : primaryButtonClass}
          disabled={pending}
          onClick={onConfirm}
        >
          {pending ? pendingLabel : confirmLabel}
        </button>
      </Actions>
    </Modal>
  );
}
