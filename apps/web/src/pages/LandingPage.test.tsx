import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { AppRoutes } from '../App';
import { authMe, renderAt, sessionFor } from '../test/renderApp';
import { server } from '../test/server';

const location = () => screen.getByTestId('location');

// Every request the page triggers (landing.md: no API of its own besides the bootstrap GET /auth/me).
const requested: string[] = [];
const record = ({ request }: { request: Request }) => {
  requested.push(new URL(request.url).pathname);
};
server.events.on('request:start', record);
afterEach(() => {
  requested.length = 0;
});

async function openLanding() {
  server.use(authMe(null));
  renderAt('/', <AppRoutes />);
  return screen.findByRole('heading', { level: 1 });
}

describe('/ landing (anonymous)', () => {
  it('renders the pitch with its landmarks and heading outline', async () => {
    expect(await openLanding()).toHaveTextContent('Know which sizes are missing — without counting stock.');
    expect(location()).toHaveTextContent(/^\/$/);

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(within(screen.getByRole('contentinfo')).getByRole('link', { name: 'Source code on GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/JohnCarloCode/repma-2',
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Demo accounts',
      'Two jobs, kept apart',
      "How it's built",
    ]);
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Availability',
      'Replenishment',
      'Tenant isolation in the database',
      'An immutable availability log',
      'Authorization by permission',
      'Tested and deployed',
    ]);
  });

  it('shows the seed demo accounts and the demo-only password in plain text', async () => {
    await openLanding();
    const card = screen.getByRole('region', { name: 'Demo accounts' });

    // One unbroken token, so it reads (and copies) as a whole even where the card is narrow.
    expect(within(card).getByText('repma-demo-2026')).toHaveClass('whitespace-nowrap');
    const emails = within(card)
      .getAllByRole('listitem')
      .map((item) => within(item).getByText(/@repma\.demo$/).textContent);
    expect(emails).toEqual([
      'admin@repma.demo',
      'manager.downtown@repma.demo',
      'employee.downtown@repma.demo',
      'manager.north@repma.demo',
      'employee.north@repma.demo',
    ]);
    expect(within(card).getByText('Platform Admin · all stores')).toBeInTheDocument();
    expect(within(card).getByText('Employee · North Store')).toBeInTheDocument();
  });

  it('shows the example size run with its out-of-stock size told by text, not color only', async () => {
    await openLanding();
    const run = screen.getByRole('group', { name: 'Example sizes' });
    expect(within(run).getAllByText(/^(38|39|40|41|42|43)$/)).toHaveLength(6);
    expect(within(run).getByText(/out of stock 9 d/)).toBeInTheDocument();
  });

  it('the primary CTA and the header link go to /login', async () => {
    await openLanding();
    const cta = screen.getByRole('link', { name: 'Sign in to the demo' });
    expect(cta).toHaveAttribute('href', '/login');
    expect(within(screen.getByRole('banner')).getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/login',
    );

    await userEvent.click(cta);
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(location()).toHaveTextContent('/login');
  });

  it('makes no API call besides the session bootstrap', async () => {
    await openLanding();
    await waitFor(() => expect(requested).toContain('/api/v1/auth/me'));
    expect(requested.filter((path) => path !== '/api/v1/auth/me')).toEqual([]);
  });
});

describe('/ landing (signed in)', () => {
  it('a store user goes to /home', async () => {
    server.use(authMe(sessionFor('employee')));
    renderAt('/', <AppRoutes />);
    await waitFor(() => expect(location()).toHaveTextContent('/home'));
    expect(screen.queryByText('Demo accounts')).not.toBeInTheDocument();
  });

  it('the platform admin goes to /platform/tenants', async () => {
    server.use(authMe(sessionFor('platform_admin')));
    renderAt('/', <AppRoutes />);
    await waitFor(() => expect(location()).toHaveTextContent('/platform/tenants'));
    expect(screen.queryByText('Demo accounts')).not.toBeInTheDocument();
  });
});
