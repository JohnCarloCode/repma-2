# Catalog — `/catalog`

> Guard: `assortment:manage` · Zone: store
> API: `GET /products`, `GET /categories`, `GET /availability` (assortment cross-reference), `POST /availability` (add to assortment)

## Purpose
Manager-facing view of the global catalog (RF-15, RF-35): browse what the platform offers, see what is already in this store's assortment, and add product **sizes** to it (RF-19). The route is guarded by `assortment:manage` — the page exists to grow the assortment, so only the manager (and platform_admin) sees it; employees keep `catalog:read` at the API level because the ProductPicker (RF-39) reads the same endpoints from the replenishment flow, but they have no standalone catalog page. Products carry sizes (non-sized products have a single "One size" entry), and assortment membership is per size: a product counts as "in assortment" if **any** of its sizes is. Catalog editing lives in `/platform/catalog`, never here (RN-02).

## Layout
Standard shell (`../shared/layout.md`). List screen skeleton per `../shared/components.md`: `<PageHeader>` (no primary action — the per-size "Add to assortment" in the product detail is the action surface; subtitle "N products in the global catalog" from the products envelope's `total` — the catalog is global, so no store name) → filter band → `<DataTable>` → `<Pagination>`. Product detail opens as a slide-over/modal, **not a route** — the URL stays `/catalog` (plus filter params).

## Content

### Filter band
- Search (product name / size SKU — SKUs live on sizes), debounced per `../shared/components.md` → `GET /products?search=`.
- Category select fed by `GET /categories` (RF-13) → `?categoryId=`.
- "Status" select (All / Active / Inactive) → `?isActive=`. Default: Active.
- All filter + page state in the URL.

### Products table (`GET /products`, paginated; sizes embedded in each item)

| Column | Content |
|---|---|
| Product | Image thumb (40px, placeholder if none) + name |
| Sizes | Size count ("3 sizes"; "1 size" for single-"One size" products), muted caption |
| Category | category name |
| Status | `badge-inactive` ("Inactive") when `is_active = false`; nothing when active |
| In assortment | "In assortment" check when **any** of the product's sizes is in this store's assortment (with "N of M sizes" caption when partial); otherwise "—". Per-size add actions live in the detail (below), not in the row |

Row click opens the product detail (slide-over) with the full size list.

### Assortment cross-reference
There is no "is this size in my assortment" flag on `GET /products`, so the page cross-references `GET /availability` **by product id**: call it with `productId=` the ids of the products on the rendered page (RF-18) — and `pageSize` = the number of ids sent, so the default page size never truncates the cross-reference (the cap, 100, exceeds any catalog page) — and read each returned product's run — the endpoint returns products with their size run nested (AD-22) — for the per-size state. The match is correct by construction: the query asks for exactly the rendered products, so the two listings' own paginations can never desynchronize the column. One extra tenant-scoped query per rendered page, no client-side regrouping. Items found in the run also supply the `/availability/:id` link target per size.

## Actions by permission

| Action | Permission | Behavior |
|---|---|---|
| View list + filters + detail | `assortment:manage` (route guard) | The data itself comes from `catalog:read` endpoints, which every visitor of this page also holds. Employees never reach the page (no sidebar item, `/unauthorized` on direct URL). |
| "Add to assortment" | `assortment:manage` | **Per size**, from the detail slide-over's size list → `POST /availability` directly, no extra form step. This page does not open the ProductPicker — the slide-over is its only add surface (the picker's assortment flow lives on `/availability`, `../shared/product-picker.md`). Hidden for inactive products/sizes (RN-08) and for sizes already in the assortment (RN-04, size-level uniqueness). |

## States
- Deviations from `../shared/components.md` defaults only:
  - Empty with filters: "No results for these filters" + "Clear filters" (default behavior, no primary action even for managers — the catalog is never empty by store action).
  - Assortment query failing while products load fine: render the table with the "In assortment" column in an indeterminate "—" state + non-blocking retry; never block the whole catalog on the cross-reference.
- Inactive products render with `badge-inactive` and muted row treatment; they remain visible (RN-08) but expose no add action. Inactive sizes inside an active product are listed in the detail with their own `badge-inactive` and no add action.

## Flows

### Add size to assortment (manager / platform_admin with store selected)
1. From the detail slide-over, "Add to assortment" on a size row adds that size directly — **no form step**: no quantity, no threshold; the item starts as available.
2. Submit → `POST /availability { sizeId }` (tenant-scoped; `X-Tenant-Id` only for platform_admin per `../shared/layout.md`).
3. Success → toast "Added to assortment" + invalidate the availability/assortment queries (the size row flips to "In assortment", and the product row updates its partial/full status). Home's summary needs no invalidation: the new item starts available and none of its three figures counts it (RF-41).
4. 400 (Zod details) → error toast. 409 (size already in assortment, RN-04 — race with another user) → error toast with API message + invalidate the assortment query so the row corrects itself. 422/400 for an inactive product/size (RN-08) → error toast; the row re-renders without the action after invalidation.

### Product detail (slide-over)
1. Row click opens a slide-over with the data already in the list response: large image, name, category, description, active badge, aggregate assortment status.
2. **Size list**: one row per size — label ("42", "M", "One size"), SKU (muted caption), `badge-inactive` when the size is inactive, and per-size assortment status for this store: "In assortment" + link to `/availability/:id` when in the assortment; otherwise "Add to assortment" (gated `assortment:manage`) or "—". This is a **list, not a `<SizeRun>`**: the catalog's subject is the product's full definition (SKUs, activity, per-size actions), which a compact run of tiles cannot carry. Availability duration never appears here — the catalog is global, aging is per store (DP-07).
3. No extra fetch needed (`GET /products` list items embed sizes); if the payload is ever slimmed, fetch `GET /products/:id` on open — decide at implementation, prefer no fetch.
4. Footer: "Close" (tertiary). Focus trap + restore per DESIGN.md §Accessibility.

## Edge cases
- Size added to the assortment in another tab/session: the add action 409s (RN-04); handled in flow step 4 — the UI never trusts its stale cross-reference as authority (RF-32).
- Product or size deactivated between page load and add attempt: API rejects (RN-08); same toast-plus-invalidate handling.
- `isActive` filter is a string enum in the URL (`true`/`false`/absent); absent means the default "Active" only on first load — an explicit "All" choice writes a param so back/refresh keep it.
- Deleting is impossible here by design; empty-page recovery (RF-36) does not apply to this list.
- Category with zero products under current search: normal filtered-empty state, not an error.
- platform_admin without a selected store: `GET /products` and `GET /categories` are global and could work, but the assortment column and add action are meaningless — the route uses the standard picker state from `../shared/layout.md` for consistency with the other store views.

## As built (6.5)

- **Route**: `/catalog` under `RouteGuard permission="assortment:manage" store` — employee → `/unauthorized`; platform_admin without a store → the picker state (Edge cases). Nav item "Catalog" gated by the same permission (manager + platform_admin).
- **`isActive` in the URL**: absent = Active (the default, request `isActive=true`); `false` = Inactive; `all` = All (request omits `isActive`). Choosing Active drops the param (`true` is still read as Active). "Clear filters" returns to the default; `isActive=all|false` counts as a filter for the empty state.
- **Queries**: products `['products', { page, search, categoryId, isActive }]` (global, no `X-Tenant-Id`, default page size 20); cross-reference `scope.key('availability', 'catalog', ids)` → `GET /availability?productId=<ids>&pageSize=<ids.length>` (store-scoped; not sent for an empty page) — under the `availability` family so adds/removals (6.6, `/availability`) refresh it; categories `['categories', { pageSize: 100 }]` (shared with `/availability`).
- **"In assortment"**: N = the length of the product's run in the cross-reference (its sizes in this store's assortment), M = all the product's sizes (inactive included — the same count as the Sizes column). N ≥ 1 → check + "In assortment", plus the mono caption "N of M sizes" when N < M; N = 0 → "—". While the cross-reference loads the cell shows a skeleton bar (no verdict); when it fails every cell shows "—" and an inline `alert` line above the table ("Assortment status could not be loaded." + text "Retry", refetching only the cross-reference) — the table never waits for it.
- **Inactive products**: muted name + `badge-inactive` in Status (the muting lives in the Product cell; `<DataTable>` has no per-row class).
- **Empty states**: with filters → "No results for these filters" + "Clear filters"; default (Active, no search/category) → "No active products in the catalog", no action.
- **Rows**: row → slide-over and the per-size add flow — see §As built (6.6).

## As built (6.6)

- **Opening**: a row click or Enter on the focused row (`<DataTable onRowClick>`, components.md §DataTable) opens `<Sheet>` titled with the product name — not a route, the URL stays `/catalog` (+ filters). No extra fetch: the sheet reads the product from the current products page (falling back to the row it was opened from), so a products refetch reaches an open sheet. Escape / scrim / footer "Close" (tertiary) close it; focus returns to the row.
- **Body**: 96px thumb (placeholder initials when no image), category, `badge-inactive` for an inactive product, the aggregate status (the row's "In assortment" cell: check + "N of M sizes"), the description when present, then the **Sizes** list (`ul` "Sizes"): label (muted + `badge-inactive` when the size is inactive), SKU as a mono caption, and the per-size state right-aligned.
- **Per-size state** (from the cross-reference `scope.key('availability','catalog',ids)`: `AvailabilitySize.sizeId` = `ProductSize.id`, its `id` = the link target): in the assortment → "In assortment" link (`button-text` + check) to `/availability/:id`, shown even for an inactive product/size; otherwise active product **and** active size → `button-secondary` "Add to assortment"; otherwise "—" (RN-08). No separate permission check in the sheet: the route guard is already `assortment:manage`.
- **Cross-reference loading / failed**: loading → a skeleton per size; failed → "—" per size plus the same alert + "Retry" as the page, inside the sheet. No add action until the cross-reference has answered (no verdict = no offer; the API stays the authority via 409).
- **Add**: `POST /availability { sizeId }` with the store scope (`X-Tenant-Id` for platform_admin). One request in flight per size — that size's button reads "Adding…" (disabled) while the others stay usable; it stays pending until the invalidated queries have refetched, so it flips straight to its new state. Every outcome is a toast (unlike the picker's inline messages): 201 → "Added to assortment" + invalidate `scope.key('availability')` (sheet size + row cell); 409 → the API message + same invalidation; 400 with a `sizeId` detail (RN-08) → that detail's message + invalidate `['products']` (the size/product re-reads inactive and loses the action); anything else → the error toast, the size can be retried. Home not invalidated (flow step 3).
- Known limit: if the 400 refetch drops the product from the current filter (e.g. it became inactive under "Active"), the open sheet keeps the row it was opened from — a retry just repeats the RN-08 toast; closing the sheet shows the corrected list.
- `sizeIdMessage` (the 400 `sizeId` detail reader) is shared with `/availability`'s picker add; the picker's `useAddToAssortment` is not reused — its contract returns inline messages for the picker, this one toasts.
