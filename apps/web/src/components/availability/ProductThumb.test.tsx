import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProductThumb } from './ProductThumb';

const url = 'https://example.test/jersey.webp';

/** The thumb inside a clickable row, as on /catalog: opening or closing the preview never opens the row. */
function renderInRow(onRowClick = vi.fn()) {
  render(
    <div onClick={onRowClick} onKeyDown={onRowClick}>
      <ProductThumb name="Home Jersey 2025" imageUrl={url} />
    </div>,
  );
  return onRowClick;
}

describe('ProductThumb image preview (components.md §Image preview)', () => {
  it('opens the image enlarged in a dialog named after the product', async () => {
    renderInRow();
    await userEvent.click(screen.getByRole('button', { name: 'Enlarge image of Home Jersey 2025' }));

    const dialog = await screen.findByRole('dialog', { name: 'Home Jersey 2025' });
    expect(dialog.querySelector('img')).toHaveAttribute('src', url);
    expect(dialog.querySelector('img')).toHaveAttribute('alt', 'Home Jersey 2025');
  });

  it('closes with the X button', async () => {
    const onRowClick = renderInRow();
    await userEvent.click(screen.getByRole('button', { name: 'Enlarge image of Home Jersey 2025' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('closes with Escape', async () => {
    renderInRow();
    await userEvent.click(screen.getByRole('button', { name: 'Enlarge image of Home Jersey 2025' }));
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('closes on a click outside the image', async () => {
    renderInRow();
    await userEvent.click(screen.getByRole('button', { name: 'Enlarge image of Home Jersey 2025' }));
    await screen.findByRole('dialog');
    await userEvent.click(document.body);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('opening it by keyboard never reaches the row either', async () => {
    const onRowClick = renderInRow();
    screen.getByRole('button', { name: 'Enlarge image of Home Jersey 2025' }).focus();
    await userEvent.keyboard('{Enter}');

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('with zoom off, or without an image, is not a button', () => {
    render(
      <>
        <ProductThumb name="Away Jersey 2025" imageUrl={url} zoom={false} />
        <ProductThumb name="Third Jersey 2025" imageUrl={null} />
      </>,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('TJ')).toBeInTheDocument();
    expect(document.querySelector('img')).toHaveClass('object-contain'); // the picker's tiles: never cropped either
  });

  it('defaults to the 64px list tier and contains the image, never crops it', () => {
    render(
      <>
        <ProductThumb name="Home Jersey 2025" imageUrl={url} />
        <ProductThumb name="Away Jersey 2025" imageUrl={url} sizeClass="size-[120px]" />
      </>,
    );
    const [list, detail] = screen.getAllByRole('button');
    expect(list).toHaveClass('size-[64px]');
    expect(detail).toHaveClass('size-[120px]');
    expect(detail).not.toHaveClass('size-[64px]');
    expect(list?.querySelector('img')).toHaveClass('object-contain');
    expect(list?.querySelector('img')).not.toHaveClass('object-cover');
  });
});
