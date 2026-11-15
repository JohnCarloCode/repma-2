import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import type { AvailabilitySize } from 'shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgingFigure, SizeRun } from './SizeRun';

const NOW = new Date('2026-11-15T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const H = 3_600_000;
const D = 24 * H;

const size = (label: string, over: Partial<AvailabilitySize> = {}): AvailabilitySize => ({
  id: `item-${label}`,
  sizeId: `size-${label}`,
  label,
  sku: `RUN-${label}`,
  isAvailable: true,
  isActive: true,
  latestEventAt: null,
  ...over,
});

const run = [
  size('38'),
  size('39', { isAvailable: false, latestEventAt: ago(2 * H) }),
  size('40', { isAvailable: false, latestEventAt: ago(9 * D) }),
  size('41', { isActive: false }),
];

function Location() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}|${JSON.stringify(location.state)}`}</div>;
}

function renderRun(props: Partial<React.ComponentProps<typeof SizeRun>> = {}) {
  render(
    <MemoryRouter initialEntries={['/availability?page=2']}>
      <SizeRun sizes={run} label="Runner sizes" {...props} />
      <Location />
    </MemoryRouter>,
  );
  return screen.getByRole('group', { name: 'Runner sizes' });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('<SizeRun>', () => {
  it('renders one tile per size in the given order, each naming its state as text', () => {
    const group = renderRun();
    expect(group.children).toHaveLength(4);
    expect(group).toHaveTextContent(
      /^38, available39, out of stock 2 h40, out of stock 9 d41, available, inactive$/,
    );
  });

  it('gives every out-of-stock tile the same mark whatever its age (DP-07)', () => {
    const group = renderRun();
    const tile = (label: string) => within(group).getByText(label, { exact: false }).closest('span.rounded-sm')!;
    const fresh = tile('39');
    const escalated = tile('40');
    expect(fresh.className).toBe(escalated.className);
    expect(fresh).toHaveClass('border-dashed', 'bg-transparent', 'h-[44px]', 'min-w-[44px]');
    expect(fresh.querySelector('.bg-alert')).not.toBeNull();
    expect(tile('38')).toHaveClass('bg-surface-raised');
    expect(tile('38').querySelector('.bg-alert')).toBeNull();
    expect(tile('41')).toHaveClass('text-text-secondary'); // inactive: muted
  });

  it('is a read-only run of spans without a destination', () => {
    renderRun();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('renders link tiles to the destination, carrying the router state', async () => {
    const user = userEvent.setup();
    renderRun({ href: (s) => `/availability/${s.id}`, linkState: { from: '?page=2' } });
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(4);
    expect(links[1]).toHaveAccessibleName(/^39 ?, out of stock 2 h$/);
    expect(links[1]).toHaveAttribute('href', '/availability/item-39');

    await user.click(links[1]!);
    expect(screen.getByTestId('location')).toHaveTextContent('/availability/item-39|{"from":"?page=2"}');
  });

  it('previews label, SKU, state and inactivity in a tooltip on hover and focus', async () => {
    const user = userEvent.setup();
    renderRun({ href: (s) => `/availability/${s.id}` });

    await user.hover(screen.getByRole('link', { name: /^40/ }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('40 · RUN-40 · Out of stock 9 d');
    await user.unhover(screen.getByRole('link', { name: /^40/ }));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    screen.getByRole('link', { name: /^41/ }).focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('41 · RUN-41 · AvailableInactive');
  });
});

describe('<SizeRun> — selection mode (ProductPicker)', () => {
  it('renders button tiles that select, with selected and disabled states named as text', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderRun({ onSelect, selectedSizeId: 'size-38', disabledSizeIds: new Set(['size-40']), disabledLabel: 'Already on the list' });
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(4);
    expect(screen.queryAllByRole('link')).toHaveLength(0);

    const [t38, t39, t40, t41] = buttons as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];
    expect(t38).toHaveAttribute('aria-pressed', 'true');
    expect(t38).toHaveClass('border-2', 'border-accent-bright', 'bg-accent-soft', 'h-[44px]', 'min-w-[44px]');
    expect(t39).toHaveAttribute('aria-pressed', 'false');
    expect(t40).toBeDisabled();
    expect(t40).toHaveAccessibleName(/^40 ?, already on the list$/);
    expect(t40).toHaveClass('text-text-disabled');
    expect(t41).toHaveAccessibleName(/^41 ?, inactive$/);

    await user.click(t39);
    expect(onSelect).toHaveBeenCalledWith(run[1]);
    await user.click(t40);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('never renders availability state or its age on a selection tile (DP-06/DP-07)', async () => {
    const user = userEvent.setup();
    const group = renderRun({ onSelect: () => {}, disabledSizeIds: new Set(['size-40']), disabledLabel: 'Already on the list' });
    expect(group).toHaveTextContent(/^383940, already on the list41, inactive$/);
    expect(group.querySelector('.bg-alert, .border-dashed')).toBeNull();

    await user.hover(screen.getByRole('button', { name: /^39/ }));
    expect(screen.getByRole('tooltip')).toHaveTextContent(/^39 · RUN-39$/);
  });
});

describe('<AgingFigure>', () => {
  it.each([
    [2 * H, '2 h', 'font-normal'],
    [3 * D, '3 d', 'font-semibold'],
    [22 * D, '3 w', 'font-bold'],
  ])('weights the figure by band (%d ms)', (ms, text, weight) => {
    render(<AgingFigure since={ago(ms)} />);
    const figure = screen.getByText(text);
    expect(figure).toHaveClass('font-mono', weight);
    if (weight === 'font-bold') expect(figure).toHaveClass('text-alert');
  });
});
