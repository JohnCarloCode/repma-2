import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../App';
import { ToastProvider, useToast } from '../lib/toast';
import { authMe, renderAt, sessionFor } from '../test/renderApp';
import { server } from '../test/server';
import { setViewportWidth } from '../test/viewport';
import { ConfirmModal, FormModal, Modal } from './Modal';

/** A trigger that opens `modal(close)`; the modal sits next to it, in the app tree, like a page would mount it. */
function Harness({ modal }: { modal: (open: boolean, close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {modal(open, () => setOpen(false))}
    </>
  );
}

function confirmHarness(props: Partial<Parameters<typeof ConfirmModal>[0]> = {}) {
  return (
    <Harness
      modal={(open, close) => (
        <ConfirmModal
          open={open}
          onClose={close}
          title="Delete list"
          message="Delete the list “Weekly replenishment”? Its items will be deleted too."
          confirmLabel="Delete list"
          pendingLabel="Deleting…"
          onConfirm={() => {}}
          {...props}
        />
      )}
    />
  );
}

function formHarness(props: Partial<Parameters<typeof FormModal>[0]> = {}) {
  return (
    <Harness
      modal={(open, close) => (
        <FormModal open={open} onClose={close} title="New list" submitLabel="Create list" onSubmit={() => {}} {...props}>
          <label className="flex flex-col">
            Name
            <input name="name" />
          </label>
          <label className="flex flex-col">
            Notes
            <textarea name="notes" />
          </label>
        </FormModal>
      )}
    />
  );
}

/** Headless UI sets the `inert` property (jsdom doesn't reflect it as an attribute) plus `aria-hidden`. */
function isInert(element: Element | null): boolean {
  for (let el = element as HTMLElement | null; el; el = el.parentElement) if (el.inert) return true;
  return false;
}

async function open() {
  await userEvent.click(screen.getByRole('button', { name: 'Open' }));
  return screen.findByRole('dialog');
}

describe('layering (components.md §Modals & confirms, layout.md §Layering with dialogs)', () => {
  it('portals to the document root: the dialog is outside the app tree, scrim and panel on the dialog layers', async () => {
    const { container } = render(confirmHarness());
    const dialog = await open();

    expect(container).not.toContainElement(dialog);
    const scrim = document.querySelector('.z-dialog-scrim');
    expect(scrim).toHaveClass('fixed', 'inset-0', 'bg-scrim');
    expect(dialog.querySelector('.z-dialog')).toContainElement(screen.getByRole('heading', { name: 'Delete list' }));
    // The app tree underneath is inert and hidden from assistive tech while the dialog is open.
    expect(isInert(container)).toBe(true);
    expect(container).toHaveAttribute('aria-hidden', 'true');
  });

  it.each([
    ['mobile', 500, () => screen.getByRole('button', { name: 'Open menu', hidden: true })],
    ['tablet', 1000, () => screen.getByRole('navigation', { name: 'Main', hidden: true })],
    ['desktop', 1440, () => screen.getByRole('navigation', { name: 'Main', hidden: true })],
  ])('%s: the whole shell is covered — its chrome is inert beneath an open dialog', async (_, width, chrome) => {
    setViewportWidth(width);
    server.use(authMe(sessionFor('manager')));
    renderAt('/activity', <>{confirmHarness()}<AppRoutes /></>);
    await screen.findAllByRole('button', { name: /menu/i });

    const dialog = await open();
    expect(isInert(chrome())).toBe(true);
    expect(isInert(dialog)).toBe(false);
  });

  it('toasts stay above an open dialog: announced, and dismissable without closing it', async () => {
    function RaisesError() {
      const toast = useToast();
      return (
        <ConfirmModal
          open
          onClose={() => {}}
          title="Delete list"
          message="Delete the list “X”?"
          confirmLabel="Delete list"
          pendingLabel="Deleting…"
          onConfirm={() => toast.error('List not found')}
        />
      );
    }
    render(
      <ToastProvider>
        <RaisesError />
      </ToastProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Delete list' }));

    // Reachable by role (not under an aria-hidden ancestor) and outside the inert app root.
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('List not found');
    expect(isInert(alert)).toBe(false);
    expect(alert.closest('section')).toHaveClass('z-toast');

    await userEvent.click(within(alert).getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('<Modal> sheetOnMobile (product-picker.md §Anatomy)', () => {
  const panelOf = (title: string) => screen.getByRole('heading', { name: title }).parentElement!;

  it('is a full-screen sheet below tablet and the bordered card, with its gutter, from tablet up', async () => {
    render(
      <Modal open onClose={() => {}} title="Add product" sheetOnMobile className="max-w-[960px] tablet:h-[600px]">
        <button type="button">Close</button>
      </Modal>,
    );
    const panel = panelOf('Add product');
    expect(panel).toHaveClass('h-dvh', 'tablet:rounded-md', 'tablet:border', 'max-w-[960px]', 'tablet:h-[600px]');
    expect(panel).not.toHaveClass('rounded-md', 'border');
    expect(panel.parentElement).toHaveClass('z-dialog', 'tablet:p-base');
    expect(panel.parentElement).not.toHaveClass('p-base');
  });

  it('is the centered card everywhere by default', async () => {
    render(
      <Modal open onClose={() => {}} title="Plain" className="max-w-[480px]">
        <button type="button">Close</button>
      </Modal>,
    );
    const panel = panelOf('Plain');
    expect(panel).toHaveClass('rounded-md', 'border', 'p-lg');
    expect(panel).not.toHaveClass('h-dvh');
    expect(panel.parentElement).toHaveClass('p-base');
  });
});

describe('<ConfirmModal>', () => {
  it('names the entity, focuses Cancel, and restores focus to the trigger on close', async () => {
    render(confirmHarness());
    const dialog = await open();

    expect(dialog).toHaveAccessibleName('Delete list');
    expect(dialog).toHaveAccessibleDescription('Delete the list “Weekly replenishment”? Its items will be deleted too.');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus());

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
  });

  it('traps focus: Tab cycles between its two actions', async () => {
    render(confirmHarness());
    const dialog = await open();
    const [cancel, confirm] = within(dialog).getAllByRole('button');
    await waitFor(() => expect(cancel).toHaveFocus());

    await userEvent.tab();
    expect(confirm).toHaveFocus();
    await userEvent.tab();
    expect(cancel).toHaveFocus();
  });

  it('confirm is button-danger by default, button-primary with tone="primary"', async () => {
    const onConfirm = vi.fn();
    const { unmount } = render(confirmHarness({ onConfirm }));
    await open();
    const danger = screen.getByRole('button', { name: 'Delete list' });
    expect(danger).toHaveClass('bg-alert');
    await userEvent.click(danger);
    expect(onConfirm).toHaveBeenCalledOnce();
    unmount();

    render(confirmHarness({ tone: 'primary', confirmLabel: 'Reactivate' }));
    await open();
    expect(screen.getByRole('button', { name: 'Reactivate' })).toHaveClass('bg-accent');
  });

  it('closes on Escape and on a scrim click', async () => {
    render(confirmHarness());
    await open();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await open();
    await userEvent.click(document.querySelector('.z-dialog')!);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('while pending: pending label, both actions disabled, not dismissable', async () => {
    render(confirmHarness({ pending: true }));
    const dialog = await open();

    expect(within(dialog).getByRole('button', { name: 'Deleting…' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('<FormModal>', () => {
  it('titles the dialog, focuses the first field and submits on Enter', async () => {
    const onSubmit = vi.fn();
    render(formHarness({ onSubmit }));
    const dialog = await open();

    expect(dialog).toHaveAccessibleName('New list');
    await waitFor(() => expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveFocus());
    await userEvent.keyboard('Weekly{Enter}');
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('actions bottom-right: Cancel closes, the submit button calls onSubmit', async () => {
    const onSubmit = vi.fn();
    render(formHarness({ onSubmit }));
    const dialog = await open();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Create list' }));
    expect(onSubmit).toHaveBeenCalledOnce();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows a non-field error as an alert inside the modal', async () => {
    render(formHarness({ error: 'Could not create the list.' }));
    const dialog = await open();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Could not create the list.');
  });

  it('while pending: "Saving…" on a disabled submit, no resubmit, not dismissable', async () => {
    const onSubmit = vi.fn();
    render(formHarness({ onSubmit, pending: true }));
    const dialog = await open();

    expect(within(dialog).getByRole('button', { name: 'Saving…' })).toBeDisabled();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), '{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
