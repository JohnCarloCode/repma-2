import type { ReactNode } from 'react';

/**
 * Label above the control (`id` is the control's), an optional hint and the error caption beneath
 * it (`${id}-error`, components.md §Forms).
 */
export function FormField({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-xs">
      <label htmlFor={id} className="text-label text-text">
        {label}
      </label>
      {children}
      {hint && !error && <span className="text-caption text-text-secondary">{hint}</span>}
      {error && (
        <span id={`${id}-error`} className="text-caption text-alert">
          {error}
        </span>
      )}
    </div>
  );
}
