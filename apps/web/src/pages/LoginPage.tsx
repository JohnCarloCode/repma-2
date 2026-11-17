import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router';
import { loginBody, type AuthSession, type LoginBody } from 'shared';
import { useSession } from '../auth/AuthContext';
import type { LoginRedirectState } from '../auth/guards';
import { authMeKey, roleHome } from '../auth/session';
import { Wordmark } from '../components/Wordmark';
import { secondaryButtonClass } from '../components/buttons';
import { textInputClass } from '../components/form';
import { api, ApiError } from '../lib/apiClient';

// Demo-only credentials, public by design (database.md §9: the seed users and password).
const DEMO_PASSWORD = 'repma-demo-2026';
const DEMO_ACCOUNTS = [
  { role: 'Platform Admin', scope: 'all stores', email: 'admin@repma.demo' },
  { role: 'Manager', scope: 'Downtown Store', email: 'manager.downtown@repma.demo' },
  { role: 'Employee', scope: 'Downtown Store', email: 'employee.downtown@repma.demo' },
  { role: 'Manager', scope: 'North Store', email: 'manager.north@repma.demo' },
  { role: 'Employee', scope: 'North Store', email: 'employee.north@repma.demo' },
];

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
  const submitRef = useRef<HTMLButtonElement>(null);

  const [values, setValues] = useState<LoginBody>({ email: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  // components.md §Forms: validate on submit, then per field on blur.
  const [submitted, setSubmitted] = useState(false);
  // The demo account whose credentials were just filled in (login.md §Demo accounts).
  const [filledEmail, setFilledEmail] = useState<string | null>(null);

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

  const tryUser = (demoEmail: string) => {
    setValues({ email: demoEmail, password: DEMO_PASSWORD });
    setFieldErrors({});
    setFormError(null);
    setSubmitted(false);
    setFilledEmail(demoEmail);
    submitRef.current?.focus();
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
        <Wordmark blink />
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
          {filledEmail && (
            <p role="status" className="rounded-sm bg-info-soft p-[12px] text-info">
              Email and password filled in for {filledEmail}. Click Sign in to enter.
            </p>
          )}
          <button
            ref={submitRef}
            type="submit"
            disabled={login.isPending}
            className="h-[44px] w-full rounded-sm bg-accent px-base text-body-medium text-on-accent transition-colors hover:bg-accent-hover active:bg-accent-active disabled:opacity-60"
          >
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
      <section aria-labelledby="demo-accounts" className="w-full max-w-[400px] rounded-md border border-border bg-surface p-card">
        <h2 id="demo-accounts" className="text-body-medium">
          Demo accounts
        </h2>
        <p className="mt-xs text-caption text-text-secondary">
          A shared public demo: other visitors may change the data.
        </p>
        <ul className="mt-base flex flex-col divide-y divide-border">
          {DEMO_ACCOUNTS.map((account) => (
            <li key={account.email} className="flex items-center justify-between gap-base py-sm">
              <div className="min-w-0">
                <div className="text-body-medium">
                  {account.role} <span className="text-caption text-text-secondary">· {account.scope}</span>
                </div>
                <div className="truncate font-mono text-caption text-text-secondary">{account.email}</div>
              </div>
              <button type="button" onClick={() => tryUser(account.email)} className={`${secondaryButtonClass} shrink-0`}>
                Try this user
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
