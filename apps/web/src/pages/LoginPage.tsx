import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router';
import { loginBody, type AuthSession, type LoginBody } from 'shared';
import { useSession } from '../auth/AuthContext';
import type { LoginRedirectState } from '../auth/guards';
import { authMeKey, roleHome } from '../auth/session';
import { Wordmark } from '../components/Wordmark';
import { textInputClass } from '../components/form';
import { api, ApiError } from '../lib/apiClient';

type Field = keyof LoginBody;
type FieldErrors = Partial<Record<Field, string>>;

/** Only same-origin app paths are honored as the intended URL, never /login (login.md §Edge cases). */
function intendedUrl(state: unknown): string | null {
  const from = (state as Partial<LoginRedirectState> | null)?.from;
  if (typeof from !== 'string' || !from.startsWith('/') || from.startsWith('//')) return null;
  const path = new URL(from, window.location.origin).pathname;
  return path === '/login' ? null : from;
}

function fieldErrorsOf(values: LoginBody): FieldErrors {
  const result = loginBody.safeParse(values);
  const errors: FieldErrors = {};
  for (const issue of result.error?.issues ?? []) {
    const field = issue.path[0] as Field;
    errors[field] ??= issue.message;
  }
  return errors;
}

/** Non-field failures, rendered inline in the card — never a toast (login.md §States). */
function formErrorOf(error: ApiError): string {
  if (error.status === 401) return 'Incorrect email or password.';
  if (error.status === 429) return 'Too many attempts. Wait a minute and try again.';
  return 'Could not sign in. Try again.';
}

/**
 * design/pages/login.md. A signed-in visitor (or a sign-in that just
 * succeeded and stored its session in `authMeKey`) is redirected straight
 * away: to the intended URL the guard preserved, else the role home. The
 * session is resolved before any route renders, so the form never flashes.
 */
export function LoginPage() {
  const session = useSession();
  const location = useLocation();
  const queryClient = useQueryClient();
  const passwordRef = useRef<HTMLInputElement>(null);

  const [values, setValues] = useState<LoginBody>({ email: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  // components.md §Forms: validate on submit, then per field on blur.
  const [submitted, setSubmitted] = useState(false);

  const login = useMutation({
    mutationFn: (body: LoginBody) => api.post<AuthSession>('/auth/login', body),
    // The 200 body is the session (RF-02): no extra GET /auth/me needed.
    onSuccess: (newSession) => queryClient.setQueryData(authMeKey, newSession),
    onError: (caught) => {
      const error = caught instanceof ApiError ? caught : new ApiError(0, 'UNKNOWN', caught.message);
      if (error.status === 400 && Array.isArray(error.details)) {
        const errors: FieldErrors = {};
        for (const { path, message } of error.details as { path: string; message: string }[]) {
          if (path === 'email' || path === 'password') errors[path] ??= message;
        }
        if (Object.keys(errors).length > 0) {
          setFieldErrors(errors);
          return;
        }
      }
      setFormError(formErrorOf(error));
      if (error.status === 401) {
        setValues((current) => ({ ...current, password: '' }));
        passwordRef.current?.focus();
      }
    },
  });

  if (session) {
    return <Navigate to={intendedUrl(location.state) ?? roleHome(session).path} replace />;
  }

  const update = (field: Field) => (event: ChangeEvent<HTMLInputElement>) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));

  const revalidate = (field: Field) => () => {
    if (submitted) setFieldErrors((current) => ({ ...current, [field]: fieldErrorsOf(values)[field] }));
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    setFormError(null);
    const errors = fieldErrorsOf(values);
    setFieldErrors(errors);
    if (Object.keys(errors).length === 0) login.mutate(values);
  };

  const field = (name: Field, label: string, props: { type: string; autoComplete: string }) => (
    <div className="flex flex-col gap-xs">
      <label htmlFor={`login-${name}`} className="text-label text-text">
        {label}
      </label>
      <input
        id={`login-${name}`}
        name={name}
        ref={name === 'password' ? passwordRef : undefined}
        value={values[name]}
        onChange={update(name)}
        onBlur={revalidate(name)}
        aria-invalid={fieldErrors[name] ? true : undefined}
        aria-describedby={fieldErrors[name] ? `login-${name}-error` : undefined}
        className={textInputClass}
        {...props}
      />
      {fieldErrors[name] && (
        <span id={`login-${name}-error`} className="text-caption text-alert">
          {fieldErrors[name]}
        </span>
      )}
    </div>
  );

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-base bg-canvas p-lg">
      <div className="w-full max-w-[400px] rounded-md border border-border bg-surface p-card">
        <Wordmark />
        <h1 className="mt-[12px] mb-lg text-display">Sign in</h1>
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-base">
          {field('email', 'Email', { type: 'email', autoComplete: 'email' })}
          {field('password', 'Password', { type: 'password', autoComplete: 'current-password' })}
          {formError && (
            <div role="alert" className="flex items-start gap-sm rounded-sm bg-alert-soft p-[12px] text-alert">
              <span className="icon" aria-hidden>
                error
              </span>
              <span>{formError}</span>
            </div>
          )}
          <button
            type="submit"
            disabled={login.isPending}
            className="h-[44px] w-full rounded-sm bg-accent px-base text-body-medium text-on-accent transition-colors hover:bg-accent-hover active:bg-accent-active disabled:opacity-60"
          >
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
      {/* Reserved slot: the demo-credentials hint arrives with the landing page (DP-01, 9.1). */}
      <div aria-hidden className="h-[56px] w-full max-w-[400px]" />
    </main>
  );
}
