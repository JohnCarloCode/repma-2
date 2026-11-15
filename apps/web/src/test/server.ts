import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

/**
 * MSW server shared by every web test; each test installs its own handlers.
 * One default survives `resetHandlers`: `/activity` is the shell tests'
 * generic store route, so its feed answers an empty page unless a test
 * overrides it.
 */
export const server = setupServer(
  http.get('*/api/v1/availability/events', () => HttpResponse.json({ items: [], page: 1, pageSize: 20, total: 0 })),
);
