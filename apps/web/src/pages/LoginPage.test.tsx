import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import type { AuthSession } from 'shared';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from '../App';
import { authMe, renderAt, sessionFor } from '../test/renderApp';
import { server } from '../test/server';

const location = () => screen.getByTestId('location');
const email = () => screen.getByLabelText('Email');
const password = () => screen.getByLabelText('Password');
const submit = () => screen.getByRole('button', { name: /Sign(ing)? in/ });

/** `POST /auth/login` answering with `status` (the session on 200, else the error envelope). */
function loginAnswers(status: number, session: AuthSession = sessionFor('employee'), details?: unknown) {
  return http.post('*/api/v1/auth/login', () =>
    status === 200
      ? HttpResponse.json(session)
      : HttpResponse.json({ error: { code: 'ERR', message: 'Server message', details } }, { status }),
  );
}

async function openLogin(path: Parameters<typeof renderAt>[0] = '/login') {
  renderAt(path, <AppRoutes />);
  await screen.findByRole('heading', { name: 'Sign in' });
}

async function signIn(emailValue = 'employee@repma.test', passwordValue = 'secret') {
  await userEvent.type(email(), emailValue);
  await userEvent.type(password(), passwordValue);
  await userEvent.click(submit());
}

describe('/login form', () => {
  it('renders the card: heading, autofill-ready fields, submit — and no recovery or signup links', async () => {
    server.use(authMe(null));
    await openLogin();

    expect(email()).toHaveAttribute('type', 'email');
    expect(email()).toHaveAttribute('autocomplete', 'email');
    expect(password()).toHaveAttribute('type', 'password');
    expect(password()).toHaveAttribute('autocomplete', 'current-password');
    expect(submit()).toHaveTextContent('Sign in');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('validates on submit with the shared schema, then per field on blur; nothing is sent while invalid', async () => {
    let posted = false;
    server.use(
      authMe(null),
      http.post('*/api/v1/auth/login', () => {
        posted = true;
        return HttpResponse.json(sessionFor('employee'));
      }),
    );
    await openLogin();

    await userEvent.type(email(), 'not-an-email');
    await userEvent.tab(); // blur before the first submit: no message yet
    expect(screen.queryByText('Enter a valid email address')).not.toBeInTheDocument();

    await userEvent.click(submit());
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(email()).toHaveAttribute('aria-invalid', 'true');
    expect(posted).toBe(false);

    await userEvent.clear(email());
    await userEvent.type(email(), 'a@b.co');
    await userEvent.tab();
    expect(screen.queryByText('Enter a valid email address')).not.toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
  });

  it('while submitting: the button is disabled with the pending label, the fields stay enabled', async () => {
    server.use(
      authMe(null),
      http.post('*/api/v1/auth/login', async () => {
        await delay('infinite');
        return HttpResponse.json(sessionFor('employee'));
      }),
    );
    await openLogin();
    await signIn();

    expect(submit()).toHaveTextContent('Signing in…');
    expect(submit()).toBeDisabled();
    expect(email()).toBeEnabled();
    expect(password()).toBeEnabled();
  });

  it('401: one generic inline message, password cleared and focused', async () => {
    server.use(authMe(null), loginAnswers(401));
    await openLogin();
    await signIn();

    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.');
    expect(password()).toHaveValue('');
    expect(password()).toHaveFocus();
    expect(email()).toHaveValue('employee@repma.test');
    expect(location()).toHaveTextContent('/login');
  });

  it('429: the rate-limit message, submit stays enabled', async () => {
    server.use(authMe(null), loginAnswers(429));
    await openLogin();
    await signIn();

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Wait a minute and try again.');
    expect(submit()).toBeEnabled();
    expect(password()).toHaveValue('secret');
  });

  it.each([
    ['a 5xx', loginAnswers(500)],
    ['a network failure', http.post('*/api/v1/auth/login', () => HttpResponse.error())],
  ])('%s: "Could not sign in. Try again." inline', async (_, handler) => {
    server.use(authMe(null), handler);
    await openLogin();
    await signIn();

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not sign in. Try again.');
  });

  it('400: the API field details map back onto the fields by name', async () => {
    server.use(authMe(null), loginAnswers(400, undefined, [{ path: 'email', message: 'Enter a valid email address' }]));
    await openLogin();
    await signIn();

    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a new submit clears the previous inline error', async () => {
    server.use(authMe(null), loginAnswers(401));
    await openLogin();
    await signIn();
    await screen.findByRole('alert');

    server.use(
      http.post('*/api/v1/auth/login', async () => {
        await delay('infinite');
        return HttpResponse.json(sessionFor('employee'));
      }),
    );
    await userEvent.type(password(), 'again');
    await userEvent.click(submit());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('/login redirects', () => {
  it.each(['manager', 'employee', 'platform_admin'] as const)(
    'success sends the %s to the role home with the posted credentials, no extra GET /auth/me',
    async (role) => {
      let body: unknown;
      let meCalls = 0;
      server.use(
        http.get('*/api/v1/auth/me', () => {
          meCalls += 1;
          return HttpResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'x' } }, { status: 401 });
        }),
        http.post('*/api/v1/auth/login', async ({ request }) => {
          body = await request.json();
          return HttpResponse.json(sessionFor(role));
        }),
      );
      await openLogin();
      await signIn(`${role}@repma.test`, 'pw');

      await waitFor(() => expect(location()).toHaveTextContent(role === 'platform_admin' ? '/availability' : '/home'));
      expect(body).toEqual({ email: `${role}@repma.test`, password: 'pw' });
      expect(meCalls).toBe(1); // the bootstrap only
    },
  );

  it('returns to the intended URL the guard preserved (path + search)', async () => {
    server.use(authMe(null), loginAnswers(200, sessionFor('manager')));
    renderAt('/activity?page=2', <AppRoutes />);
    await screen.findByRole('heading', { name: 'Sign in' });

    await signIn();
    expect(await screen.findByRole('heading', { name: 'Activity' })).toBeInTheDocument();
    expect(location()).toHaveTextContent('/activity?page=2');
  });

  it.each([
    ['/login', '/login?x=1'],
    ['protocol-relative', '//evil.example/activity'],
    ['absolute', 'https://evil.example/activity'],
  ])('ignores an intended URL that is %s → role home', async (_, from) => {
    server.use(authMe(null), loginAnswers(200, sessionFor('employee')));
    await openLogin({ pathname: '/login', state: { from } });

    await signIn();
    await waitFor(() => expect(location()).toHaveTextContent('/home'));
    expect(location().textContent).toBe('/home');
  });

  it.each(['manager', 'employee', 'platform_admin'] as const)(
    'an authenticated %s visiting /login goes to the role home without the form ever rendering',
    async (role) => {
      server.use(authMe(sessionFor(role)));
      renderAt('/login', <AppRoutes />);

      await waitFor(() => expect(location()).toHaveTextContent(role === 'platform_admin' ? '/availability' : '/home'));
      expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    },
  );
});
