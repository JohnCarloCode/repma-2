import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useState } from 'react';
import type { AvailabilityProduct, AvailabilitySize, Page } from 'shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SELECTED_STORE_KEY } from '../tenant/activeStore';
import { authMe, renderAt, sessionFor } from '../test/renderApp';
import { server } from '../test/server';
import { ProductPicker, type PickerSelection } from './ProductPicker';

const size = (product: string, label: string, over: Partial<AvailabilitySize> = {}): AvailabilitySize => ({
  id: `item-${product}-${label}`,
  sizeId: `size-${product}-${label}`,
  label,
  sku: `${product.toUpperCase()}-${label}`,
  isAvailable: true,
  isActive: true,
  latestEventAt: null,
  ...over,
});

const runner: AvailabilityProduct = {
  id: 'p-runner',
  name: 'Runner Sneaker',
  imageUrl: null,
  categoryName: 'Footwear',
  isActive: true,
  sizes: [
    size('run', '38'),
    size('run', '39', { isAvailable: false, latestEventAt: new Date(Date.now() - 9 * 86_400_000).toISOString() }),
    size('run', '40'),
    size('run', '41', { isActive: false }),
  ],
};
const cap: AvailabilityProduct = {
  id: 'p-cap',
  name: 'Wool Cap',
  imageUrl: 'https://img.test/cap.png',
  categoryName: 'Accessories',
  isActive: false,
  sizes: [size('cap', 'One size')],
};

const envelope = (items: AvailabilityProduct[], over: Partial<Page<AvailabilityProduct>> = {}) => ({
  items,
  page: 1,
  pageSize: 24,
  total: items.length,
  ...over,
});

/** `GET /availability` answering `respond(url)`, recording every request. */
function availability(
  respond: (url: URL) => Response | Promise<Response> = () => HttpResponse.json(envelope([runner, cap])),
) {
  const requests: Request[] = [];
  server.use(
    http.get('*/api/v1/availability', ({ request }) => {
      requests.push(request);
      return respond(new URL(request.url));
    }),
    http.get('*/api/v1/categories', () =>
      HttpResponse.json({
        items: [
          { id: 'c-foot', name: 'Footwear' },
          { id: 'c-acc', name: 'Accessories' },
        ],
        page: 1,
        pageSize: 100,
        total: 2,
      }),
    ),
  );
  const lastParams = () => new URL(requests.at(-1)!.url).searchParams;
  return { requests, lastParams };
}

interface HarnessProps {
  onConfirm?: (selection: PickerSelection) => Promise<unknown>;
  disabled?: string[];
}

/** A consumer like 4.10's: owns the open state and the disabled set, and adds a confirmed size to it. */
function Harness({ onConfirm = async () => {}, disabled = [] }: HarnessProps) {
  const [open, setOpen] = useState(true);
  const [taken, setTaken] = useState(() => new Set(disabled));
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Add product
      </button>
      <ProductPicker
        open={open}
        onClose={() => setOpen(false)}
        title="Add product"
        confirmLabel="Add to list"
        pendingLabel="Adding…"
        disabledSizeIds={taken}
        disabledLabel="Already on the list"
        onConfirm={async (selection) => {
          await onConfirm(selection);
          setTaken((current) => new Set(current).add(selection.sizeId));
        }}
      />
    </>
  );
}

function renderPicker(props: HarnessProps = {}, role: 'manager' | 'platform_admin' = 'manager') {
  server.use(authMe(sessionFor(role)));
  renderAt('/replenishment/l1', <Harness {...props} />);
}

const dialog = () => screen.findByRole('dialog', { name: 'Add product' });
const products = () => screen.findByRole('list', { name: 'Products' });
const card = (name: RegExp) => screen.getByRole('button', { name });
const tile = (label: string) =>
  within(screen.getByRole('group', { name: /sizes$/ })).getByRole('button', { name: new RegExp(`^${label}\\b`) });
const cta = () => screen.getByRole('button', { name: /^(Add to list|Adding…)$/ });

afterEach(() => localStorage.clear());

describe('<ProductPicker> — replenishment flow', () => {
  it('opens as a dialog over the store assortment: category rail, cards with placeholder, size count and inactive badge', async () => {
    const api = availability();
    renderPicker();

    const picker = await dialog();
    const grid = await products();
    expect(within(grid).getAllByRole('listitem')).toHaveLength(2);

    const runnerCard = card(/Runner Sneaker/);
    expect(runnerCard).toHaveTextContent('RSRunner Sneaker4 sizes'); // initials placeholder (no image)
    expect(runnerCard).toHaveAttribute('aria-pressed', 'false');
    const capCard = card(/Wool Cap/);
    expect(capCard).toHaveTextContent('One size');
    expect(within(capCard).getByText('Inactive')).toBeInTheDocument(); // RN-12/RN-08: listed, flagged
    expect(capCard.querySelector('img')).toHaveAttribute('src', 'https://img.test/cap.png');

    const rail = within(picker).getByRole('navigation', { name: 'Categories' });
    expect(within(rail).getAllByRole('button').map((b) => b.textContent)).toEqual(['All', 'Footwear', 'Accessories']);
    expect(within(rail).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');

    // The store's assortment, one page; availability state is never a filter (DP-06).
    expect(api.lastParams().toString()).toBe('page=1&pageSize=24');
    // Nothing selected yet: no panel, the CTA is disabled.
    expect(screen.queryByRole('region', { name: 'Selection' })).not.toBeInTheDocument();
    expect(cta()).toBeDisabled();
  });

  it('filters by category and by debounced search, each resetting to page 1, with Clear filters on an empty result', async () => {
    const user = userEvent.setup();
    const api = availability((url) =>
      url.searchParams.get('search') === 'zzz'
        ? HttpResponse.json(envelope([]))
        : HttpResponse.json(envelope([runner, cap], { total: 30, page: Number(url.searchParams.get('page')) })),
    );
    renderPicker();
    await products();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(api.lastParams().get('page')).toBe('2'));

    await user.click(screen.getByRole('button', { name: 'Footwear' }));
    await waitFor(() => expect(api.lastParams().toString()).toBe('page=1&pageSize=24&categoryId=c-foot'));
    expect(screen.getByRole('button', { name: 'Footwear' })).toHaveAttribute('aria-pressed', 'true');

    const before = api.requests.length;
    await user.type(screen.getByRole('searchbox', { name: 'Search products' }), 'zzz');
    expect(await screen.findByText('No results for these filters.')).toBeInTheDocument();
    // One request for the whole word: the 300ms debounce.
    expect(api.requests.length - before).toBe(1);
    expect(api.lastParams().toString()).toBe('page=1&pageSize=24&search=zzz&categoryId=c-foot');

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(api.lastParams().toString()).toBe('page=1&pageSize=24'));
    expect(screen.getByRole('searchbox', { name: 'Search products' })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('reveals the selection panel: a SizeRun of buttons, no out-of-stock mark, inactive selectable, listed sizes disabled', async () => {
    const user = userEvent.setup();
    availability();
    renderPicker({ disabled: ['size-run-40'] });
    await products();

    await user.click(card(/Runner Sneaker/));
    expect(card(/Runner Sneaker/)).toHaveAttribute('aria-pressed', 'true');
    const panel = screen.getByRole('region', { name: 'Selection' });
    expect(within(panel).getByText('Footwear')).toBeInTheDocument();

    const run = within(panel).getByRole('group', { name: 'Runner Sneaker sizes' });
    expect(within(run).getAllByRole('button')).toHaveLength(4);
    expect(within(run).queryAllByRole('link')).toHaveLength(0);
    // The picker never renders availability state or its age (DP-06/DP-07).
    expect(run).not.toHaveTextContent(/out of stock|available/i);
    expect(run.querySelector('.bg-alert, .border-dashed')).toBeNull();
    expect(tile('39')).toBeEnabled();

    // Already on the list: disabled, named as text (RN-04).
    expect(tile('40')).toBeDisabled();
    expect(tile('40')).toHaveAccessibleName(/^40 ?, already on the list$/);
    expect(within(panel).getByText('Already on the list: 40')).toBeInTheDocument();

    // Inactive but in the assortment: muted and selectable (RN-12/RN-08).
    expect(tile('41')).toHaveAccessibleName(/^41 ?, inactive$/);
    expect(tile('41')).toHaveClass('text-text-secondary');
    await user.hover(tile('41'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('41 · RUN-41Inactive');
    expect(screen.getByRole('tooltip')).toHaveClass('z-dialog'); // above the dialog, not under it
    await user.click(tile('41'));
    expect(tile('41')).toHaveAttribute('aria-pressed', 'true');
    expect(tile('41')).toHaveClass('border-accent-bright', 'bg-accent-soft');
    expect(cta()).toBeEnabled();

    // Another product: its own run, the size selection starts over.
    await user.click(card(/Wool Cap/));
    expect(screen.getByRole('group', { name: 'Wool Cap sizes' })).toBeInTheDocument();
    expect(cta()).toBeDisabled();
  });

  it('steps and validates the quantity (1–9999), disabling the CTA while invalid', async () => {
    const user = userEvent.setup();
    availability();
    renderPicker();
    await products();
    await user.click(card(/Runner Sneaker/));
    await user.click(tile('38'));

    const input = screen.getByLabelText('Quantity');
    expect(input).toHaveValue('1');
    await user.click(screen.getByRole('button', { name: 'Decrease quantity' }));
    expect(input).toHaveValue('1'); // floor
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }));
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }));
    expect(input).toHaveValue('3');

    for (const bad of ['0', '2.5', 'abc', '10000', '']) {
      await user.clear(input);
      if (bad) await user.type(input, bad);
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(input).toHaveAccessibleDescription('Enter a whole number from 1 to 9999.');
      expect(cta()).toBeDisabled();
    }
    await user.clear(input);
    await user.type(input, '9999');
    expect(input).toHaveAttribute('aria-invalid', 'false');
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }));
    expect(input).toHaveValue('9999'); // ceiling
    expect(cta()).toBeEnabled();
  });

  it('hands the selection to onConfirm, shows its pending state, then stays open with the size flipped to disabled', async () => {
    const user = userEvent.setup();
    availability();
    let finish!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    renderPicker({ onConfirm });
    await products();
    await user.click(card(/Runner Sneaker/));
    await user.click(tile('39')); // out of stock: addable like any other size (DP-06)
    await user.click(screen.getByRole('button', { name: 'Increase quantity' }));
    await user.click(cta());

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({
      sizeId: 'size-run-39',
      quantity: 2,
      product: runner,
      size: runner.sizes[1],
    });
    expect(cta()).toHaveTextContent('Adding…');
    expect(cta()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Add product' })).toBeInTheDocument(); // not dismissable mid-flight

    finish();
    await waitFor(() => expect(cta()).toHaveTextContent('Add to list'));
    // Still open, same product, size cleared and now disabled, quantity back to 1.
    expect(screen.getByRole('dialog', { name: 'Add product' })).toBeInTheDocument();
    expect(card(/Runner Sneaker/)).toHaveAttribute('aria-pressed', 'true');
    expect(tile('39')).toBeDisabled();
    expect(screen.getByLabelText('Quantity')).toHaveValue('1');
    expect(cta()).toBeDisabled();

    // The next one in a row.
    await user.click(tile('38'));
    await user.click(cta());
    finish();
    await waitFor(() => expect(tile('38')).toBeDisabled());
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  it('keeps the selection when onConfirm rejects (the consumer surfaces the error)', async () => {
    const user = userEvent.setup();
    availability();
    const onConfirm = vi.fn(() => Promise.reject(new Error('This size is already on the list')));
    renderPicker({ onConfirm });
    await products();
    await user.click(card(/Runner Sneaker/));
    await user.click(tile('38'));
    await user.type(screen.getByLabelText('Quantity'), '2');
    await user.click(cta());

    await waitFor(() => expect(cta()).toBeEnabled());
    expect(tile('38')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Quantity')).toHaveValue('12');
  });

  it('closes on Close, and a reopened session starts clean', async () => {
    const user = userEvent.setup();
    availability();
    renderPicker();
    await products();
    await user.click(screen.getByRole('button', { name: 'Footwear' }));
    await user.click(card(/Runner Sneaker/));

    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Add product' }));
    await products();
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('region', { name: 'Selection' })).not.toBeInTheDocument();
  });

  it('shows skeleton cards while loading, then an error with Retry', async () => {
    const user = userEvent.setup();
    let fail = true;
    availability(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return fail
        ? HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'Gone' } }, { status: 404 })
        : HttpResponse.json(envelope([runner]));
    });
    renderPicker();
    const picker = await dialog();
    expect(within(picker).getByRole('status', { name: 'Loading' })).toBeInTheDocument();

    expect(await within(picker).findByRole('alert')).toHaveTextContent('Gone');
    fail = false;
    await user.click(within(picker).getByRole('button', { name: 'Retry' }));
    expect(within(await products()).getAllByRole('listitem')).toHaveLength(1);
  });

  it('distinguishes an empty assortment from an empty filter result', async () => {
    availability(() => HttpResponse.json(envelope([])));
    renderPicker();
    expect(await screen.findByText('No items in the assortment yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('sends the selected store as X-Tenant-Id for the platform admin', async () => {
    localStorage.setItem(SELECTED_STORE_KEY, JSON.stringify({ id: 'store-b', name: 'Store B' }));
    const api = availability();
    renderPicker({}, 'platform_admin');
    await products();
    expect(api.requests.at(-1)!.headers.get('X-Tenant-Id')).toBe('store-b');
  });
});
