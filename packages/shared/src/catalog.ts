import { paginationQuery } from './pagination.js';

// RF-13 — `GET /categories` query: pagination only, ordered by name. Its
// consumers (the `/availability` category filter, the ProductPicker rail)
// read the whole list in one page (`pageSize=100`).
export const categoryListQuery = paginationQuery;

// One category as the listing returns it: what its consumers render and send.
export interface Category {
  id: string;
  name: string;
}
