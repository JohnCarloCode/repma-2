import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import { useState, type KeyboardEvent, type SyntheticEvent } from 'react';

/**
 * A product thumb: the image, or a placeholder with the name's initials when
 * the product has none. `sizeClass` sets the square (32px on list lines,
 * larger on the detail's summary card).
 *
 * An image thumb is a button that opens it enlarged (components.md §Image
 * preview). `zoom={false}` keeps it a plain image, for a thumb that sits
 * inside another control (the picker's product tiles).
 */
export function ProductThumb({
  name,
  imageUrl,
  sizeClass = 'size-[32px]',
  zoom = true,
}: {
  name: string;
  imageUrl: string | null;
  sizeClass?: string;
  zoom?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = `${sizeClass} flex-none rounded-sm border border-border bg-surface-raised`;

  if (!imageUrl) {
    const initials = name
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word.charAt(0).toUpperCase())
      .join('');
    return (
      <span aria-hidden className={`${box} inline-flex items-center justify-center text-label text-text-secondary`}>
        {initials}
      </span>
    );
  }
  if (!zoom) return <img src={imageUrl} alt="" className={`${box} object-cover`} />;

  // React events bubble through the dialog's portal to this thumb's ancestors, so clicks and
  // keys stop here: a thumb inside a clickable row never also opens the row. Escape goes on —
  // the dialog listens for it on the document.
  const stopClick = (e: SyntheticEvent) => e.stopPropagation();
  const stopKey = (e: KeyboardEvent) => e.key !== 'Escape' && e.stopPropagation();
  return (
    <span className="contents" onClick={stopClick} onKeyDown={stopKey}>
      <button
        type="button"
        aria-label={`Enlarge image of ${name}`}
        onClick={() => setOpen(true)}
        className={`${box} cursor-zoom-in overflow-hidden p-0`}
      >
        <img src={imageUrl} alt="" className="size-full object-cover" />
      </button>
      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogBackdrop
          transition
          className="fixed inset-0 z-dialog-scrim bg-scrim backdrop-blur-md transition-opacity duration-base data-closed:opacity-0"
        />
        <div className="fixed inset-0 z-dialog flex items-center justify-center p-base">
          <DialogPanel
            transition
            className="relative transition-[opacity,transform] duration-base data-closed:scale-95 data-closed:opacity-0"
          >
            <DialogTitle className="sr-only">{name}</DialogTitle>
            <img
              src={imageUrl}
              alt={name}
              className="max-h-[85dvh] max-w-[min(calc(100vw-32px),800px)] rounded-md border border-border bg-surface object-contain"
            />
            <button
              type="button"
              aria-label="Close"
              onClick={() => setOpen(false)}
              className="absolute top-sm right-sm flex size-[44px] items-center justify-center rounded-full bg-surface-raised text-text transition-colors hover:bg-surface-hover"
            >
              <span className="icon" aria-hidden>
                close
              </span>
            </button>
          </DialogPanel>
        </div>
      </Dialog>
    </span>
  );
}
