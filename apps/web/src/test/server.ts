import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

const emptyPage = (pageSize = 20) => HttpResponse.json({ items: [], page: 1, pageSize, total: 0 });

/**
 * MSW server shared by every web test; each test installs its own handlers.
 * Defaults survive `resetHandlers`: `/activity` is the shell tests' generic
 * store route and `/availability` the role home (redirect tests land on it),
 * so their reads answer an empty page unless a test overrides them.
 */
export const server = setupServer(
  http.get('*/api/v1/availability/events', () => emptyPage()),
  http.get('*/api/v1/availability', () => emptyPage()),
  http.get('*/api/v1/categories', () => emptyPage(100)),
);
