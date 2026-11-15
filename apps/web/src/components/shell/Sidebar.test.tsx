import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from '../../App';
import { authMe, renderAt, sessionFor } from '../../test/renderApp';
import { server } from '../../test/server';
import { setViewportWidth } from '../../test/viewport';
import { SIDEBAR_COLLAPSED_KEY } from './useShellLayout';

const mainNav = () => screen.findByRole('navigation', { name: 'Main' });
const activityLink = () => screen.getByRole('link', { name: 'Activity' });
/** The nav item's label span (the page itself also says "Activity"). */
const activityLabel = () => within(activityLink()).getByText('Activity');

async function renderShell(width = 1440) {
  setViewportWidth(width);
  server.use(authMe(sessionFor('manager')));
  renderAt('/activity', <AppRoutes />);
  await mainNav();
}

describe('desktop (≥ 1280px): collapse / expand with persistence', () => {
  it('starts expanded; the toggle collapses to the rail, persists the choice and expands back', async () => {
    await renderShell();
    const toggle = screen.getByRole('button', { name: 'Collapse menu' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(activityLabel()).not.toHaveClass('sr-only');

    await userEvent.click(toggle);
    expect(toggle).toHaveAccessibleName('Expand menu');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // Icon only: the label stays as the accessible name, hidden visually.
    expect(activityLink()).toBeInTheDocument();
    expect(activityLabel()).toHaveClass('sr-only');
    expect(screen.getByText('REPMA')).toHaveClass('sr-only');
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('true');

    await userEvent.click(toggle);
    expect(toggle).toHaveAccessibleName('Collapse menu');
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('false');
  });

  it('a persisted collapse is applied on the very first shell render (no width flash)', async () => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'true');
    await renderShell();
    // Checked right when the nav first appears — no effect/re-render needed to get there.
    expect(screen.getByRole('button', { name: 'Expand menu' })).toHaveAttribute('aria-expanded', 'false');
    expect(activityLabel()).toHaveClass('sr-only');
  });

  it('collapsed: nav labels show as tooltips on hover and on keyboard focus', async () => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'true');
    await renderShell();

    await userEvent.hover(activityLink());
    expect(screen.getByRole('tooltip')).toHaveTextContent('Activity');
    await userEvent.unhover(activityLink());
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    activityLink().focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Activity');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('expanded: no tooltips (the labels are visible)', async () => {
    await renderShell();
    await userEvent.hover(activityLink());
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('collapsed: the user menu is the avatar alone, name + role as a tooltip, menu as a flyout', async () => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'true');
    await renderShell();

    const trigger = screen.getByRole('button', { name: /Test User\s*Manager/ });
    expect(within(trigger).getByText('TU')).toBeInTheDocument();
    await userEvent.hover(trigger);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Test User · Manager');

    await userEvent.click(trigger);
    expect(await screen.findByRole('menuitem', { name: 'Log out' })).toBeInTheDocument();
  });
});

describe('tablet (744–1279px): rail with expand-in-place over a scrim', () => {
  it('always starts as the rail, ignoring the desktop preference', async () => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'false');
    await renderShell(1000);
    expect(screen.getByRole('button', { name: 'Expand menu' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('sidebar-scrim')).not.toBeInTheDocument();
  });

  it('the toggle expands the panel over a scrim (not persisted); an outside click re-collapses it', async () => {
    await renderShell(1000);
    const toggle = screen.getByRole('button', { name: 'Expand menu' });

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(activityLabel()).not.toHaveClass('sr-only');
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBeNull();

    await userEvent.click(screen.getByTestId('sidebar-scrim'));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('sidebar-scrim')).not.toBeInTheDocument();
  });

  it('re-collapses on navigation', async () => {
    await renderShell(1000);
    await userEvent.click(screen.getByRole('button', { name: 'Expand menu' }));
    expect(screen.getByTestId('sidebar-scrim')).toBeInTheDocument();

    await userEvent.click(activityLink());
    expect(screen.getByRole('button', { name: 'Expand menu' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('sidebar-scrim')).not.toBeInTheDocument();
  });
});

describe('mobile (< 744px): fixed header + off-canvas drawer', () => {
  async function renderMobile() {
    setViewportWidth(500);
    server.use(authMe(sessionFor('manager')));
    renderAt('/activity', <AppRoutes />);
    return screen.findByRole('button', { name: 'Open menu' });
  }

  it('the header carries only the hamburger; no sidebar, no collapse toggle', async () => {
    const hamburger = await renderMobile();
    expect(hamburger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /(Collapse|Expand) menu/ })).not.toBeInTheDocument();
  });

  it('opens the drawer with full labels; the close button closes it', async () => {
    const hamburger = await renderMobile();
    await userEvent.click(hamburger);

    const drawer = await screen.findByRole('dialog', { name: 'Navigation' });
    expect(within(drawer).getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
    expect(activityLabel()).not.toHaveClass('sr-only');
    expect(within(drawer).getByText('REPMA')).not.toHaveClass('sr-only');
    expect(within(drawer).getByRole('button', { name: /Test User\s*Manager/ })).toBeInTheDocument();

    await userEvent.click(within(drawer).getByRole('button', { name: 'Close navigation' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(hamburger).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on an outside tap (the scrim)', async () => {
    const hamburger = await renderMobile();
    await userEvent.click(hamburger);
    await screen.findByRole('dialog');
    await userEvent.click(document.body);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('closes on navigation and on Escape', async () => {
    const hamburger = await renderMobile();

    await userEvent.click(hamburger);
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('link', { name: 'Activity' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await userEvent.click(hamburger);
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

it('follows the viewport: resizing from desktop to mobile swaps the sidebar for the mobile header', async () => {
  await renderShell();
  expect(screen.queryByRole('button', { name: 'Open menu' })).not.toBeInTheDocument();

  setViewportWidth(500);
  expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
});
