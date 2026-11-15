import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { api, ApiError, NETWORK_ERROR } from './apiClient';
import { ACTION_DISMISS_MS, errorMessage, SUCCESS_DISMISS_MS, ToastProvider, useToast, type Toaster } from './toast';

const GENERIC = 'Something went wrong. Try again.';

describe('errorMessage (components.md §Toasts — error mapping)', () => {
  it.each([
    [new ApiError(409, 'CONFLICT', 'This size is already out of stock'), 'This size is already out of stock'],
    [new ApiError(404, 'NOT_FOUND', 'Item not found'), 'Item not found'],
    [
      new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action'),
      'You do not have permission to perform this action',
    ],
    [new ApiError(400, 'VALIDATION_ERROR', 'Invalid request', [{ path: 'type', message: 'x' }]), 'Invalid request'],
  ])('shows a 4xx API message verbatim (%#)', (error, expected) => {
    expect(errorMessage(error)).toBe(expected);
  });

  it('keeps the apiClient network message', () => {
    const error = new ApiError(0, NETWORK_ERROR, 'Network error. Check your connection and try again.');
    expect(errorMessage(error)).toBe('Network error. Check your connection and try again.');
  });

  it('replaces 401 and 429 with their own copy', () => {
    expect(errorMessage(new ApiError(401, 'UNAUTHORIZED', 'Authentication required'))).toBe(
      'Your session has expired. Sign in again.',
    );
    expect(errorMessage(new ApiError(429, 'RATE_LIMITED', 'Too many requests, try again later'))).toBe(
      'Too many requests. Wait a minute and try again.',
    );
  });

  it('replaces 5xx, non-envelope answers and non-API errors with the generic line', () => {
    expect(errorMessage(new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong'))).toBe(GENERIC);
    expect(errorMessage(new ApiError(503, 'SERVICE_UNAVAILABLE', 'Down for maintenance'))).toBe(GENERIC);
    expect(errorMessage(new ApiError(404, 'HTTP_ERROR', 'Request failed with status 404.'))).toBe(GENERIC);
    expect(errorMessage(new TypeError('x is undefined'))).toBe(GENERIC);
  });
});

let toaster: Toaster;
function Capture() {
  toaster = useToast();
  return null;
}

function renderToasts() {
  render(
    <ToastProvider>
      <Capture />
    </ToastProvider>,
  );
  return screen.getByRole('region', { name: 'Notifications' });
}

describe('<ToastProvider> (RF-36)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders an always-mounted polite live region, empty at first', () => {
    const region = renderToasts();
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toBeEmptyDOMElement();
  });

  it('success: shows in the region, not as an alert, and auto-dismisses after ~4s', () => {
    vi.useFakeTimers();
    const region = renderToasts();
    act(() => toaster.success('Marked as out of stock'));

    expect(within(region).getByText('Marked as out of stock')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(SUCCESS_DISMISS_MS - 1));
    expect(within(region).getByText('Marked as out of stock')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(within(region).queryByText('Marked as out of stock')).not.toBeInTheDocument();
  });

  it('error: an assertive alert that persists until dismissed', () => {
    vi.useFakeTimers();
    renderToasts();
    act(() => toaster.error(new ApiError(409, 'CONFLICT', 'This size is already out of stock')));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('This size is already out of stock');
    act(() => vi.advanceTimersByTime(SUCCESS_DISMISS_MS * 10));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    fireEvent.click(within(alert).getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('error accepts a ready message', () => {
    renderToasts();
    act(() => toaster.error('List not found'));
    expect(screen.getByRole('alert')).toHaveTextContent('List not found');
  });

  it('stacks in arrival order; dismissing a success early cancels its timer', () => {
    vi.useFakeTimers();
    const region = renderToasts();
    act(() => {
      toaster.success('First');
      toaster.error('Second');
      toaster.success('Third');
    });
    expect(region.children).toHaveLength(3);
    expect([...region.children].map((t) => t.textContent)).toEqual([
      expect.stringContaining('First'),
      expect.stringContaining('Second'),
      expect.stringContaining('Third'),
    ]);

    fireEvent.click(within(region.children[0] as HTMLElement).getByRole('button', { name: 'Dismiss notification' }));
    act(() => vi.advanceTimersByTime(SUCCESS_DISMISS_MS));
    expect([...region.children].map((t) => t.textContent)).toEqual([expect.stringContaining('Second')]);
  });

  it('shows the API message of a real failed call (envelope from apiClient)', async () => {
    server.use(
      http.post('*/api/v1/availability/:id/events', () =>
        HttpResponse.json({ error: { code: 'CONFLICT', message: 'This size is already available' } }, { status: 409 }),
      ),
    );
    renderToasts();
    const failure = await api.post('/availability/abc/events', { type: 'restocked' }).catch((e: unknown) => e);
    act(() => toaster.error(failure));
    expect(screen.getByRole('alert')).toHaveTextContent('This size is already available');
  });

  it('success with an action: the button runs it once and dismisses; the toast lasts ~6s', () => {
    vi.useFakeTimers();
    const region = renderToasts();
    const onAction = vi.fn();
    act(() => {
      toaster.success('Item removed', { label: 'Undo', onAction });
      toaster.success('Plain');
    });

    act(() => vi.advanceTimersByTime(SUCCESS_DISMISS_MS));
    expect(within(region).queryByText('Plain')).not.toBeInTheDocument();
    expect(within(region).getByText('Item removed')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(ACTION_DISMISS_MS - SUCCESS_DISMISS_MS));
    expect(within(region).queryByText('Item removed')).not.toBeInTheDocument();
    expect(onAction).not.toHaveBeenCalled();

    act(() => toaster.success('Item removed', { label: 'Undo', onAction }));
    fireEvent.click(within(region).getByRole('button', { name: 'Undo' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(within(region).queryByText('Item removed')).not.toBeInTheDocument();
  });

  it('useToast outside the provider fails loudly', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Capture />)).toThrow(/inside <ToastProvider>/);
  });
});
