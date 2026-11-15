import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, NETWORK_ERROR } from './apiClient';

// components.md §Toasts (RF-36): every mutation reports its outcome — success
// toasts auto-dismiss after ~4s, error toasts persist until dismissed. One
// stack, top-right, above everything (`{layers.toast}`).

export const SUCCESS_DISMISS_MS = 4000;

const GENERIC_ERROR = 'Something went wrong. Try again.';

/**
 * The user-facing line for a failed call (components.md §Toasts — error
 * mapping). API messages are written for users, so 4xx envelopes are shown
 * verbatim; what the user can't act on — a 5xx, a non-envelope answer, a
 * client-side bug — becomes one generic line. 401/429 get their own copy.
 */
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return GENERIC_ERROR;
  if (error.code === NETWORK_ERROR) return error.message;
  if (error.status === 401) return 'Your session has expired. Sign in again.';
  if (error.status === 429) return 'Too many requests. Wait a minute and try again.';
  if (error.status >= 500 || error.code === 'HTTP_ERROR') return GENERIC_ERROR;
  return error.message;
}

type Tone = 'success' | 'error';

interface Toast {
  id: number;
  tone: Tone;
  message: string;
}

export interface Toaster {
  /** Auto-dismisses after `SUCCESS_DISMISS_MS`. */
  success: (message: string) => void;
  /** Persists until dismissed. Takes the caught error (mapped by `errorMessage`) or a ready message. */
  error: (error: unknown) => void;
}

const ToastContext = createContext<Toaster | null>(null);

export function useToast(): Toaster {
  const toaster = useContext(ToastContext);
  if (!toaster) throw new Error('useToast must be used inside <ToastProvider>');
  return toaster;
}

const TONE = {
  success: { border: 'border-l-live', icon: 'check_circle', iconColor: 'text-live' },
  error: { border: 'border-l-alert', icon: 'error', iconColor: 'text-alert' },
} as const;

/**
 * Holds the stack and renders it. Mounted once above the router (App), so a
 * toast raised just before a navigation survives it.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (tone: Tone, message: string) => {
      const id = ++nextId.current;
      setToasts((current) => [...current, { id, tone, message }]);
      if (tone === 'success') timers.current.set(id, setTimeout(() => dismiss(id), SUCCESS_DISMISS_MS));
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const toaster = useMemo<Toaster>(
    () => ({
      success: (message) => push('success', message),
      error: (error) => push('error', typeof error === 'string' ? error : errorMessage(error)),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={toaster}>
      {children}
      {/* Always mounted, so screen readers register the live region before the first toast
          arrives. Success is polite; an error item is role="alert" (assertive). */}
      <section
        aria-label="Notifications"
        aria-live="polite"
        className="pointer-events-none fixed top-base right-base z-toast flex w-[min(360px,calc(100vw-32px))] flex-col gap-sm"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : undefined}
            className={`pointer-events-auto flex items-start gap-[12px] rounded-sm border border-l-4 border-border bg-surface py-[12px] pr-sm pl-base text-text motion-safe:animate-[toast-in_var(--transition-duration-base)_var(--ease-standard)] ${TONE[t.tone].border}`}
          >
            <span className={`icon mt-[2px] ${TONE[t.tone].iconColor}`} aria-hidden>
              {TONE[t.tone].icon}
            </span>
            <p className="flex-1 pt-[1px] text-body">{t.message}</p>
            {/* icon-button: 44px hit area around a 32px visual, pulled into the toast's padding. */}
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => dismiss(t.id)}
              className="group -my-[10px] inline-flex size-[44px] shrink-0 items-center justify-center rounded-sm"
            >
              <span className="inline-flex size-[32px] items-center justify-center rounded-sm text-text-secondary transition-colors group-hover:bg-surface-hover group-hover:text-text">
                <span className="icon" aria-hidden>
                  close
                </span>
              </span>
            </button>
          </div>
        ))}
      </section>
    </ToastContext.Provider>
  );
}
