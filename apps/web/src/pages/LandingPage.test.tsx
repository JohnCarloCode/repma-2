import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';
import { authMe, renderAt } from '../test/renderApp';
import { server } from '../test/server';

async function renderLanding() {
  server.use(authMe(null));
  renderAt('/', <AppRoutes />);
  await screen.findByRole('heading', { level: 1, name: /Every store knows what's out/ });
}

describe('LandingPage', () => {
  it('points every "Try the demo" call to /login', async () => {
    await renderLanding();
    const links = screen.getAllByRole('link', { name: 'Try the demo' });
    expect(links.length).toBeGreaterThan(1);
    for (const link of links) expect(link).toHaveAttribute('href', '/login');
  });

  it('size demo: tapping a size toggles it and adds an event to the log', async () => {
    await renderLanding();
    const log = screen.getByRole('list', { name: 'Event log' });
    expect(within(log).getAllByRole('listitem')).toHaveLength(2);

    await userEvent.click(screen.getByRole('button', { name: 'Evergreen Hoodie size M, available' }));
    const pressed = screen.getByRole('button', { name: 'Evergreen Hoodie size M, out of stock' });
    expect(pressed).toHaveAttribute('aria-pressed', 'true');
    const items = within(log).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Marked out of stock Evergreen Hoodie, size M');
    expect(screen.getByText(/3 sizes out of stock/)).toBeInTheDocument();

    await userEvent.click(pressed);
    expect(within(log).getAllByRole('listitem')[0]).toHaveTextContent('Marked available Evergreen Hoodie, size M');
    expect(screen.getByText(/2 sizes out of stock/)).toBeInTheDocument();
  });

  it('"Contact me" in the header, the final CTA and the footer opens the contact dialog with LinkedIn and email', async () => {
    await renderLanding();
    const showModal = vi.fn();
    HTMLDialogElement.prototype.showModal = showModal;
    const buttons = screen.getAllByRole('button', { name: 'Contact me' });
    expect(buttons).toHaveLength(3);
    for (const button of buttons) await userEvent.click(button);
    expect(showModal).toHaveBeenCalledTimes(3);
    const dialog = document.querySelector('dialog.contact') as HTMLElement;
    expect(within(dialog).getByRole('link', { name: /LinkedIn/, hidden: true })).toHaveAttribute(
      'href',
      'https://www.linkedin.com/in/johncarlogarciano/',
    );
    expect(within(dialog).getByRole('link', { name: /Email/, hidden: true })).toHaveAttribute(
      'href',
      'mailto:garcianojohncarlo2001@gmail.com',
    );
  });
});
