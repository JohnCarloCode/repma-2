# Availability — `/availability`

> Guard: `availability:read` · Zone: store
> API: `GET /availability`, `POST /availability`, `GET /products`, `GET /categories`

## Purpose

The store's central day-to-day page. Assortment items are **product sizes**, but the page reads by **product**: one line per product carrying its full **size run** — every size the store carries, available ones plain and every missing one wearing the same mark, with a single elapsed figure per line for how long the oldest hole has held (AD-22, DP-07). "This model is missing 38 and 42, and has everything else" is one glance, not two rows in a 240-row table.

`out_of_stock` here means the store has none **anywhere, stockroom included** (DP-06): nothing internal fixes it, and the page exists so staff on the floor know instantly without searching. There are no stock quantities anywhere: the store tracks *whether* a size is available and *for how long it has not been*, never *how many* units remain. From here the user spots what is missing, opens any size's detail (`/availability/:id`) — where flagging and the event history live — and adds catalog sizes to the assortment. Tenant-scoped; platform_admin sends `X-Tenant-Id` per `../shared/layout.md`.

## Layout

The documented exception to the list skeleton (`../shared/components.md`, DESIGN.md §Screen Skeletons): `<PageHeader>` → filter band → **product list with size runs** → `<Pagination>`. Header and filter band are the shared ones; the body is not a `<DataTable>` of sizes.

- Title: **"Availability"**. Subtitle (`../shared/components.md` §`<PageHeader>`): "`<store>` · N products" from the availability envelope's `total`, reflecting the active filters. Primary action: **"Add to assortment"** (gated `assortment:manage`) — opens the shared ProductPicker (`../shared/product-picker.md`).
- A page is a page of **products** (RF-18): a run is never split across two pages.

## Content

### Filter band (params of `GET /availability`; state in URL)

| Filter | Control | Param |
|---|---|---|
| Search | Text input, placeholder "Search by name or SKU…", debounced 300ms. Matches product name **and size SKU** (SKUs live on sizes, not products) | `search` |
| Category | Select "All categories" + options from `GET /categories` | `categoryId` |
| Out of stock | Toggle/checkbox "Only out of stock" — selects products with **at least one** size out of stock, and still shows their complete run (RF-18) | `outOfStock=true` |

### Product lines (one per product; the run carries the sizes)

Each line has three zones, left to right:

| Zone | Content | Notes |
|---|---|---|
| Product | Thumb (product image, 32px, placeholder if none) + product name (`body-medium`) + category (muted caption) | Clicking the product identity does nothing on its own — the tiles are the interactive surface |
| Size run | `<SizeRun>` (`../shared/components.md`, DESIGN.md §Size run): one **tile** per size the store carries, in `position` order — sharp corners, like every button in the product (§Shape). Available tiles plain; every out-of-stock tile carries the same mark — dotted outline + amber dot, no fill — whatever its age (DP-07). Tiles are **44×44px, visual size = hit area** — this page is worked on a tablet on the shop floor, so the run is sized for a fingertip and the product line is taller than a table row by design | Size SKU is not shown here (it lives on `/availability/:id` and in search) — a run of SKUs would be unreadable |
| Aging | The oldest out-of-stock elapsed figure in that run ("6 d"), right-aligned, tabular-nums, weight-graded per DP-07 — the only place age is visible on this line | "—" when nothing in the run is out of stock. The list arrives sorted by this figure descending — the endpoint's default order (RF-18): the most neglected product first, fully available products after, by name |

**Interaction is on the tile, not the row — and a tile click navigates, like every other click in the app:**

- Tile click opens `/availability/:id` for that size: detail, full event history and the flag actions live there. One gesture, no modifiers, identical on touch. Flagging never happens from the list — mutations are explicit buttons on the detail page, so a stray tap on the shop floor can never create an immutable event.
- Hovering/focusing a tile surfaces the size label, SKU and its elapsed figure as a tooltip — a convenience preview of what the detail shows, never the only path to that data.

If the product is inactive (RN-08), append `badge-inactive` "Inactive" next to the product name; if an individual size is inactive, its tile is rendered muted with the same badge in its tooltip. Both remain fully visible and navigable (flagging on the detail stays allowed, RN-08).

### "Add to assortment" — ProductPicker

"Add to assortment" opens the shared **ProductPicker** (`../shared/product-picker.md`): category navigation + search + image grid of products; selecting a product reveals its size tiles. In this context the picker renders sizes already in the assortment as disabled tiles (RN-04, size-level uniqueness — `../shared/product-picker.md` §Size tile states) and never offers inactive products or sizes (RN-08). There is **no final form step** — no quantity, no threshold: picking a size is the whole input. The new item starts as available.

Submit → `POST /availability` with the chosen `sizeId`.

## Actions by permission

| Action | Permission | Behavior |
|---|---|---|
| View list, filter, paginate | `availability:read` | Route guard; page content |
| Open item detail | `availability:read` | Tile click → `/availability/:id` (detail, history and the flag actions) |
| "Add to assortment" (primary) | `assortment:manage` | Opens the ProductPicker (`../shared/product-picker.md`) → `POST /availability` (manager only) |

Flagging (`availability:flag`) has no surface on this page: both flag actions live on `/availability/:id` (RF-20). Neither does removal: "Remove from assortment" (RF-44) lives on the item detail too, and only while the item has no events.

## States

Defaults per `../shared/components.md`. Page-specific:

- **Empty (no assortment yet)**: "No items in the assortment yet." + primary action "Add to assortment" if `assortment:manage`.
- **Empty (filters)**: "No results for these filters." + "Clear filters". With "Only out of stock" on and zero results, this is good news — same component, message "No out-of-stock items."
- **Loading**: skeleton product lines matching the run geometry (a product line plus a row of 44px square blocks), not table rows — the skeleton must reserve the real tile height so the list does not jump when data lands.
- **platform_admin without store selected**: picker state per `../shared/layout.md`.

## Flows

### Add size to assortment

1. Click "Add to assortment" → ProductPicker opens (`../shared/product-picker.md`); browse by category or search (product name / size SKU) over `GET /products` (active only, sizes embedded).
2. Pick a product → pick a size tile (sizes already in the assortment or inactive are unavailable) → confirm directly; no extra fields.
3. Submit → `POST /availability` `{ sizeId }`.
4. Success (201): close picker, toast "Added to assortment", invalidate the availability list. The item appears as "Available" with no events; none of Home's three figures counts it (RF-41 — the item starts available), so the summary needs no invalidation.
5. 400: inline errors, picker stays open. 409 (size already in assortment, RN-04): inline error on the size step — "This size is already in the assortment" (friendly mapping, not the raw API message).

### Open a size's detail

1. Tap any tile → navigate to `/availability/:id`, preserving the list's URL state (filters + page) so the detail's back action returns to the same view.
2. Flag actions happen there (RF-20); on return, the list's queries are stale-invalidated by the detail's mutations, so the tile and the line's aging figure reflect the new state without page-specific wiring here.

### Filter / paginate

1. Any filter change updates the URL and refetches `GET /availability` at page 1; pagination updates `page` only.

## Edge cases

- **Duplicate race** (size added by another user between picker load and submit): the 409 mapping above covers it; the picker's exclusion is UX only, the API is the authority (a size is at most once per store assortment, RN-04).
- **All active sizes already in assortment**: picker shows "No sizes available to add"; nothing selectable.
- **Inactive products/sizes**: stay listed and navigable, and flagging on their detail stays allowed (RN-08) — only new additions are blocked (the picker never offers inactive products or sizes).
- **A product with one size** ("One size"): the run is a single tile; the line is not special-cased.
- **A long run** (footwear 36–45): with 44px tiles a run of ~10 sizes fills the line at tablet width, so it wraps to a second line inside the product line; the aging figure stays on the first line, right-aligned. The run never scrolls horizontally and the tiles never shrink to avoid the wrap — the touch target wins over the single-line ideal.
- **Aging is read-time**: the elapsed figures come from each size's latest `out_of_stock` timestamp and are recomputed on render (DP-07) — the page does not need to refetch for a "6 d" to become "7 d".
- **Age is never in the tile**: a size missing two hours and one missing nine days look identical in the run — the line's elapsed figure is where age lives (DP-07). The dot's amber is constant: it says "missing", never "for how long". Do not reintroduce per-tile colour grading to "help" triage; the sort order and the figure are the triage.
- **`outOfStock` + search + category combined**: all params are sent together; the API intersects them.
- **No quantities, ever**: the page never shows counts, thresholds or "X left" — availability is binary and events carry no quantities (RN-06). The only number on a line is an elapsed time.
- **403 from API despite visible action** (stale session): error toast per `../shared/layout.md` guards note.
