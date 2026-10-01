# product-picker — Visual product & size selector

> Shared component (`apps/web/src/components/ProductPicker`). Replaces every select/combobox-based product selection. Visual tokens per `../DESIGN.md`; behavior conventions per `components.md`. UI copy is English (RNF-19).

## Purpose

Choosing a product should feel like browsing a catalog, not filling a form: image + name, navigable by category, then pick the size and quantity. One component, used by every flow that adds a product to something.

## Anatomy

Modal (max-w 960px on desktop; full-screen sheet on mobile), two zones:

**It renders above the entire shell at every breakpoint** — portalled at the document root, `{layers.dialog}` over a `{layers.dialog-scrim}` scrim (DESIGN.md §Elevation · Layering, `components.md` §Modals & confirms, `layout.md` §Layering with dialogs). On mobile the sheet covers the fixed mobile header, hamburger included; on tablet it covers the collapsed rail and the expanded panel; on desktop it covers the sidebar. No shell chrome stays visible or tappable beside an open picker — and since the picker is where a shop-floor tap lands most often, chrome showing through it is a tap that goes to the wrong layer, not just a visual seam.


```
┌────────────────────────────────────────────────┐
│ [Search products…         ]  flow title        │
├──────────┬─────────────────────────────────────┤
│ Categories│  Product grid (image, name,        │
│ · All     │  size count) — 3-4 col desktop,    │
│ · Footwear│  2 col tablet, 1-2 col mobile      │
│ · Apparel │                                    │
│ · …       │  [pagination / load more]          │
├──────────┴─────────────────────────────────────┤
│ Selection panel (visible once a product is     │
│ chosen): image · name · size tiles · quantity  │
│                        [Cancel] [Primary CTA]  │
└────────────────────────────────────────────────┘
```

- **Category rail** (left; horizontal chips on mobile): "All" + `GET /categories`. Single-select, resets grid pagination.
- **Search**: debounced 300ms, matches product name and size SKU. The endpoint depends on the flow (see Consumers): the assortment flow browses the global catalog (`GET /products?search=&categoryId=`); the replenishment flow browses the store's assortment (`GET /availability?search=&categoryId=`, AD-22 shape — a list only references sizes the store carries, RN-12).
- **Product grid**: card per product — image (fallback: initials placeholder on `surface-soft`), name, caption with size count ("3 sizes" / "One size"). Inactive handling is per flow: the assortment flow never shows inactive products (RN-08 — no new assortment additions); the replenishment flow shows products already in the assortment even when inactive, with `badge-inactive` (membership, not activity, is the criterion — RN-12/RN-08).
- **Stable height**: the modal's height is fixed at its maximum (a full grid page, viewport-capped) and never changes with the result count. Switching category, searching or paginating only swaps the grid's content — the grid zone keeps its height (scrolling internally when needed) and short result sets leave the remaining space empty. The modal must not resize while open.
- **Selection panel**: appears when a product card is selected. Size tiles (label, e.g. `36 37 38 … One size`), then the flow's extra fields, if any (e.g. quantity stepper in the replenishment flow). The tiles are the **same primitive as the availability size run** — `<SizeRun>` / `run-tile-*` in `components.md` and DESIGN.md §Size run — not a look-alike: `run-tile-selected` marks the chosen size, `run-tile-disabled` the unavailable ones. They inherit the run's **44×44px sharp** geometry, so the picker's size step is as tappable as the list it feeds; the selection panel budgets height for a wrapped run of 44px tiles (this is part of the modal's fixed maximum height, above).

## Size tile states (per consuming context)

| State | Rendering | Why |
|---|---|---|
| Available | `run-tile-available`, selectable | — |
| Already added | `run-tile-disabled` + caption "Already in the assortment" / "Already on the list" | RN-04: a size at most once per assortment/list |
| Inactive size (assortment flow) | not rendered | soft-deactivated (RN-08): no new assortment additions |
| Inactive size (replenishment flow) | rendered muted, **selectable**, `badge-inactive` in its tooltip | assortment membership, not activity, is the criterion (RN-12; RN-08 keeps it visible where it exists) |

## Consumers and their CTAs

| Flow | Page | Grid source | Extra fields in panel | CTA | On confirm |
|---|---|---|---|---|---|
| Add to assortment | `/availability` | `GET /products` (global catalog; inactive excluded, RN-08) | none | "Add to assortment" | `POST /availability` `{sizeId}` — the item starts as available |
| Add replenishment item | `/replenishment/:id` | `GET /availability` (the store's assortment, AD-22; inactive assortment items included — RN-12) | quantity_requested (≥1) | "Add to list" | `POST /replenishment-lists/:id/items` `{sizeId, quantity}` — saved immediately (autosave, RF-28; see replenishment-detail.md) |

The component receives: the disabled-size set (already-present sizeIds), the extra fields to render, the CTA label, and an `onConfirm({sizeId, …fields})` callback. It performs no mutations itself — the consumer owns the API call and its error handling, including the 409 duplicate race (RN-04): each flow surfaces it per its own page doc — inline on the size step in the assortment flow (`../pages/availability.md`), toast in the replenishment flow (`../pages/replenishment-detail.md`) — and in both the tile flips to disabled after invalidation.

## States

- Loading: skeleton cards matching grid geometry.
- Empty (no results for search/category): `<EmptyState>` with "Clear filters".
- The modal stays open after confirm in the replenishment flow (adding several items in a row is the common case; "Close" ends the session); it closes after confirm in the assortment flow.

## Accessibility

Focus trap per `components.md` modals; grid cards and tiles are buttons (keyboard navigable); selected state communicated by text (tile `aria-pressed`), not color alone. The picker never renders the out-of-stock mark or the elapsed figure (DP-07): availability duration is not a selection criterion.
