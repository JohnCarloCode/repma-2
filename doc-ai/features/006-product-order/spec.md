# Feature 006 — Product order within a category

> Status: done
> Date: 2026-11-17

## Context and motivation

RF-45 let the Platform Admin order the categories, but products inside each category were still listed by name, and the replenishment-flow ProductPicker listed the store's assortment in availability's aging order — out-of-stock products first, which leaks availability into list-building (DP-06). This feature lets the Platform Admin order the products of each category, and every product list (the picker in both flows included) follows that order.

## Scope

- DB: `products.position` (database.md §4.4), migration `0005_product_position` initialising existing rows to their by-name order within each category; the seed sets an explicit order (database.md §9).
- API: new `PUT /categories/:id/products/order` (RF-46; rules in architecture.md §7, mirroring RF-45's `PUT /categories/order`). A product created in, or moved into, a category goes last there.
- API: `GET /products` now answers in catalog order (RF-15, RF-45, RF-46) instead of by name.
- API: `GET /availability` accepts `sort=catalog` (RF-18, AD-22); absent keeps the aging order.
- Web: `/platform/catalog` Products tab ordering mode with up/down moves (`design/pages/platform-catalog.md`); the replenishment-flow ProductPicker sends `sort=catalog` (`design/shared/product-picker.md`).

## Out of scope

- Drag-and-drop ordering; ordering a category with more than 100 products (the page-size cap).
- Exposing `position` in the `Product` shape — clients rely on the response order.
- Changing the `/availability` page's or Home's order (they keep RF-18's aging order, DP-07).

## Impact on existing documentation

- `core/spec.md`: new RF-46; RF-15 and RF-18 order text amended.
- `core/architecture.md`: §7 Catalog and Availability rows (new route, `sort` param, `GET /products` order); AD-22 note.
- `core/database.md`: §4.4 `position` column, §8 note on `sort=catalog`, §9 seed order.
- `design/pages/platform-catalog.md`, `design/shared/product-picker.md`, `design/pages/catalog.md`.

## Acceptance criteria

- Given a category's whole product set (inactive included), when the Platform Admin PUTs it in a new order, then positions become `0..n-1`, the answer is 204 and `GET /products` follows it; any other set → 409, unknown category → 404, malformed body/params/query → 400, no session → 401, store roles → 403, write limiter (integration: `products-write.integration.test.ts`, `app.surface.test.ts`).
- Given products in two categories, `GET /products` lists them by category position then product position (`products.integration.test.ts`).
- Given `sort=catalog`, `GET /availability` lists the assortment in catalog order; any other `sort` → 400; absent → aging order unchanged (`availability/list.integration.test.ts`).
- A new product, or one moved to another category, goes last there (`products-write.integration.test.ts`); the seed's order holds (`seed.integration.test.ts`).
- Web: ordering mode only with one category, no search and status All; moves send the whole order; a failure restores it with a toast (`PlatformProductsTab.test.tsx`); the replenishment picker sends `sort=catalog`, the assortment picker does not (`ProductPicker.test.tsx`).
