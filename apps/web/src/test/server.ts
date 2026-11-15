import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

const emptyPage = (pageSize = 20) => HttpResponse.json({ items: [], page: 1, pageSize, total: 0 });

/**
 * MSW server shared by every web test; each test installs its own handlers.
 * Defaults survive `resetHandlers`: `/activity` is the shell tests' generic
 * store route, `/home` the store roles' home and `/availability` the admin's
 * (redirect tests land on them), so their reads answer empty unless a test
 * overrides them; `/products` is the assortment picker's grid.
 */
export const server = setupServer(
  http.get('*/api/v1/home/summary', () => HttpResponse.json({ openLists: 0, pendingItems: 0, outOfStock: 0 })),
  http.get('*/api/v1/replenishment-lists', () => emptyPage()),
  http.get('*/api/v1/availability/events', () => emptyPage()),
  http.get('*/api/v1/availability', () => emptyPage()),
  http.get('*/api/v1/categories', () => emptyPage(100)),
  http.get('*/api/v1/products', () => emptyPage(24)),
);
