import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { AppRoutes } from '../App';
import { authMe, renderAt, sessionFor } from '../test/renderApp';
import { server } from '../test/server';
import { setViewportWidth } from '../test/viewport';
import { Sheet } from './Sheet';

/** A trigger that opens the sheet; the sheet sits next to it, in the app tree, like a page would mount it. */
function Harness({ footer = true }: { footer?: boolean }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Sheet
        open={open}
        onClose={close}
        title="Runner Sneaker"
        footer={
          footer && (
            <button type="button" onClick={close}>
              Close
            </button>
          )
        }
      >
        <a href="#first">First link</a>
        <p>Body</p>
      </Sheet>
    </>
  );
}

/** Headless UI sets the `inert` property (jsdom doesn't reflect it as an attribute). */
function isInert(element: Element | null): boolean {
  for (let el = element as HTMLElement | null; el; el = el.parentElement) if (el.inert) return true;
  return false;
}

async function open() {
  await userEvent.click(screen.getByRole('button', { name: 'Open' }));
  return screen.findByRole('dialog');
}

describe('<Sheet> (components.md §Slide-over)', () => {
  it('portals to the document root on the sheet layers: right-anchored 420px panel with a left rule, over the scrim', async () => {
    const { container } = render(<Harness />);
    const dialog = await open();

    expect(dialog).toHaveAccessibleName('Runner Sneaker');
    expect(container).not.toContainElement(dialog);
    expect(document.querySelector('.z-sheet-scrim')).toHaveClass('fixed', 'inset-0', 'bg-scrim');
    const layer = document.querySelector('.z-sheet')!;
    expect(layer).toHaveClass('fixed', 'inset-0', 'justify-end');
    const panel = within(dialog).getByText('Body').closest('.max-w-\\[420px\\]');
    expect(panel).toHaveClass('h-dvh', 'border-l', 'border-border', 'bg-surface');
    expect(layer).toContainElement(panel as HTMLElement);
    expect(isInert(container)).toBe(true);
  });

  it('renders the footer pinned under the body only when given', async () => {
    render(<Harness />);
    const dialog = await open();
    expect(within(dialog).getByRole('button', { name: 'Close' }).parentElement).toHaveClass('border-t');
  });

  it('focuses the first focusable element and restores focus to the trigger on close', async () => {
    render(<Harness />);
    const dialog = await open();
    await waitFor(() => expect(within(dialog).getByRole('link', { name: 'First link' })).toHaveFocus());

    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
  });

  it('traps focus: Tab cycles inside the panel', async () => {
    render(<Harness />);
    const dialog = await open();
    const first = within(dialog).getByRole('link', { name: 'First link' });
    await waitFor(() => expect(first).toHaveFocus());
    await userEvent.tab();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus();
    await userEvent.tab();
    expect(first).toHaveFocus();
  });

  it('closes on Escape and on a scrim click (outside the panel)', async () => {
    render(<Harness footer={false} />);
    await open();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await open();
    await userEvent.click(document.querySelector('.z-sheet')!);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it.each([
    ['mobile', 500, () => screen.getByRole('button', { name: 'Open menu', hidden: true })],
    ['tablet', 1000, () => screen.getByRole('navigation', { name: 'Main', hidden: true })],
  ])('%s: the shell chrome is inert beneath an open sheet', async (_, width, chrome) => {
    setViewportWidth(width);
    server.use(authMe(sessionFor('manager')));
    renderAt('/activity', <><Harness /><AppRoutes /></>);
    await screen.findAllByRole('button', { name: /menu/i });

    const dialog = await open();
    expect(isInert(chrome())).toBe(true);
    expect(isInert(dialog)).toBe(false);
  });
});
