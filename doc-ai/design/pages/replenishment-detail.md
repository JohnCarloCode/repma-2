# Replenishment list detail — `/replenishment/:id`

> Guard: `replenishment:read` · Zone: store
> API: `GET /replenishment-lists/:id` · `PATCH /replenishment-lists/:id` · `POST /replenishment-lists/:id/items` · `PATCH /replenishment-lists/:id/items/:itemId` (`quantity` and/or `isDone`) · `DELETE /replenishment-lists/:id/items/:itemId` · `DELETE /replenishment-lists/:id` · `GET /availability` (ProductPicker source)

## Purpose

Detail of one replenishment list: metadata (name, status, notes), its item set (RF-28), and the shop-floor **progress state** of each line (RF-40). Each item line references a **product size** with a `quantity_requested` and an `is_done` check; a size appears at most once per list (RN-04). Editing is gated by `replenishment:manage`, which every store role holds; the read-only rendering below remains for any session lacking the permission (guards are by permission, not role — RF-32).

**One saving model: everything autosaves.** Metadata saves on blur, items save per action (add, quantity change, remove, check) the moment they happen (RF-28/RF-40). There is no "save" button, no dirty state, no leave-without-saving confirm — nothing on this page can be lost by navigating away.

## Layout

Detail screen skeleton (DESIGN.md §Screen Skeletons), top to bottom:

1. **Back arrow** (`icon-button-ivory`) to `/replenishment` — the first item of the header row, per `../shared/components.md`.
2. **List name** — the page's identity, right after the arrow.
3. **"Delete list"** — a **filled `button-danger`**, right-aligned at the end of the header row.
4. **Progress card**.
5. **Notes card**.
6. **Filter band** → **items table** (unchanged).

Sidebar keeps "Replenishment" active per `../shared/layout.md`.

## Content

**Header** — one row, left to right (editors; read-only text without `replenishment:manage`):

| Position | Element | Notes |
|---|---|---|
| 1 | **Back arrow** | `icon-button-ivory` → `/replenishment`, preserving that page's URL state. First item of the row at every width (`../shared/components.md`) |
| 2 | **Name** | Inline editable text (click-to-edit input, saves on blur) — the page's title, `{typography.display}` |
| 3 | **Status** | Badge (`badge-status-draft/-processing/-done`, labels per `../shared/components.md`) + adjacent select with the three statuses — any transition allowed, no state machine (RF-30). Stays in the header: it is the list's state, not an action on it |
| 4 | **"Delete list"** | **Filled `button-danger`** (error fill, white text — not a tertiary text action), right-aligned at the end of the row, gated by `replenishment:manage`. Always behind the confirm modal (DESIGN.md §Buttons) |

Beneath the header row, one **meta line** in `{typography.caption}` / `{colors.muted}`: "Created `<date>` · `<creator>`" — the date per `../shared/components.md` conventions, the creator "—" if deleted (RN-09). It is the card-grid provenance (`replenishment.md`) restated where the card no longer is; it never repeats the status, which the badge beside the name already carries.

On **mobile** the row wraps in that same order: back arrow + name on the first line, status and "Delete list" below it, the delete full-width — the order never changes, only the wrapping.

Why the delete is filled here: this page has **no primary action** — the name saves on blur, the status saves on change, items autosave (RF-28) — so nothing competes with it and the screen still keeps one loudest voice (DESIGN.md `icon-button-ink`, "one loudest voice"). Deleting a list is also the one irreversible act on the page, and a text link is the wrong weight for it: it should be found deliberately, not discovered by accident.

**Progress card** (below the header, above the notes card): a `{component.card}` — white surface, `{rounded.md}`, 24px padding: **the same dress as the Notes card beneath it**, so the two summary blocks read as one pair of panels instead of a floating bar plus a card. It holds, in this order:

1. **"Progress"** (label, `body-medium`) on the left, with the fraction **`0/4`** right-aligned on the same line (`tabular-nums`) — done items / total items, strictly `done/total`: no unit, no "done", no percentage (`../shared/components.md` §`<ProgressBar>`).
2. The **`<ProgressBar>`** track full-width beneath it (10px, DESIGN.md `progress-bar`).

Updates immediately when a check is toggled and when items are added/removed. The whole card is hidden when the list has no items. At 100%, if the list status is not `done`, the hint lives **inside this card, under the bar**: "All items done." + tertiary action "Mark list as done" → the same status `PATCH` as the header select (suggestion only, never automatic — RF-30/RF-40).

**Summary card**: "Notes" — editable textarea (saves on blur) / plain text without `replenishment:manage`.

**Filter band** (above the items table; visuals and responsive stacking per `../shared/components.md` §Filter band — the dark `filter-band` surface, search + selects inline on desktop, stacked on mobile):

| Control | Behavior |
|---|---|
| Search ("Search by product or SKU…") | Debounced 300ms; matches product name and size SKU. **Client-side** over the loaded items — no refetch. |
| Category select ("All categories") | Client-side filter by the item's product category. |
| Group by category (toggle, off by default) | Off: the table renders in the endpoint's own order — **grouped by product** (RF-26), with product-name header rows (`surface-soft`, `body-medium`). On: regroups the same set under category header rows; within a category, items keep their product order (a product's sizes stay adjacent). Pure view-state — URL param, no API. There is no flat, insertion-ordered view. |

Filter and group state live in the URL (shared convention). Filtering/grouping only changes what is shown, never the underlying set.

**Items table**:

| Column | Content | Notes |
|---|---|---|
| Done | Checkbox, gated `replenishment:manage` (disabled rendering without it) | Toggles `is_done` via `PATCH …/items/:itemId` — saves instantly (RF-40). Done rows render with muted text (check + muted, never color alone) |
| Product | Product name | `body-medium` |
| Size | Size label + size SKU (caption, muted) | |
| Requested quantity | `quantity_requested` | Numeric input, min 1, right-aligned tabular-nums; **autosaves on blur/enter** when valid and changed (`PATCH …/items/:itemId`); plain number without `replenishment:manage` |
| — | Remove row (icon-button-ivory) | Editors only; deletes immediately (`DELETE …/items/:itemId`) — no confirm; the toast offers "Undo" (see Flows) |

On mobile the collapsible-column rules apply as elsewhere, but the Done checkbox and the group header rows are never collapsed — they are the shop-floor essentials.

Below the table (editors): "Add product" opens the `<ProductPicker>` (`../shared/product-picker.md` — category navigation + search + image grid; selecting a product reveals its size tiles, then quantity). It sources the store's assortment via `GET /availability`, which returns products with their size run nested (AD-22) — exactly the shape the picker's grid + pills need, and a list can only reference sizes the store carries (RN-12, enforced by the schema's composite FK and validated by the API). Availability state is **not** a filter here: an out-of-stock size can sit on a list like any other, since the two are independent (DP-06). Sizes already on the list render as disabled tiles in the picker (RN-04: a size at most once per list). Confirming saves the item immediately (`POST …/items`); the picker stays open for adding several in a row. New items start unchecked (RF-40).

## Actions by permission

| Action | Permission | Behavior |
|---|---|---|
| View list | `replenishment:read` | `GET /replenishment-lists/:id` on mount |
| Edit name / notes / status | `replenishment:manage` | `PATCH /replenishment-lists/:id` on blur/change, one field per call |
| Add item | `replenishment:manage` | Picker confirm → `POST /replenishment-lists/:id/items` `{sizeId, quantity}` — immediate |
| Edit item quantity | `replenishment:manage` | `PATCH /replenishment-lists/:id/items/:itemId` `{quantity}` on blur/enter — immediate |
| Toggle item done check | `replenishment:manage` | `PATCH /replenishment-lists/:id/items/:itemId` `{isDone}` — immediate (RF-40) |
| Remove item | `replenishment:manage` | `DELETE /replenishment-lists/:id/items/:itemId` — immediate, toast with "Undo" |
| "Delete list" | `replenishment:manage` | Confirm modal → `DELETE` → navigate to `/replenishment` |

## States

Defaults from `../shared/components.md` apply. Page-specific:

- `GET` 404 (deleted or cross-tenant, RN-03): full-content error card "List not found" + link "Back to replenishment" — not the generic retry state.
- Empty items (editors): empty-state inside the table area — "This list has no items" + "Add product". Without `replenishment:manage`, the explanation only. No progress card, no filter band (nothing to filter).
- Filtered empty (items exist, filters match none): "No results for these filters" + "Clear filters" — the standard filtered-empty state, inside the table area.
- Invalid quantity input (empty, non-integer, < 1): inline field error, **no request is sent** — the server keeps the last valid value; correcting the input and blurring saves normally.
- Mutation pending: the affected control shows its optimistic/pending state (check flips, quantity dims briefly); no page-level blocking, no toast on success for checks and quantities — silent autosave is the point (the documented exception to RF-36, `../shared/components.md` §Toasts).

## Flows

**Metadata edits (RF-28, RF-30)** — name blur / notes blur / status select change → `PATCH /replenishment-lists/:id` with only that field. Success: toast "List updated", invalidate the detail query (and the lists index query so badges/names stay fresh). 400: inline error at the field, value kept for correction. Other errors: error toast + revert to server value.

**Add item (RF-28)**:
1. "Add product" → picker → pick size + quantity → confirm → `POST /replenishment-lists/:id/items` `{sizeId, quantity}`.
2. Success (201): the row appears **inside its product's group** (the table is product-grouped by default, RF-26 — never appended at the bottom) and the tile flips to disabled in the still-open picker — that is the feedback; no toast per add (adding several in a row is the common case).
3. 409 (size already on the list, RN-04 — race with another session): toast with the API message; the tile flips to disabled after invalidation.

**Edit quantity (RF-28)**:
1. Change the value → on blur/enter, if valid (integer ≥ 1) and changed → `PATCH …/items/:itemId` `{quantity}`.
2. Success: silent (the value is the feedback). Error: error toast + revert to the server value.

**Toggle done check (RF-40)**:
1. Checkbox tap → optimistic flip (row mutes/unmutes, the progress card's bar and fraction update) + `PATCH …/items/:itemId` `{isDone}` fires immediately. No toast on success — the check and the bar are the feedback.
2. Error: revert the optimistic flip, error toast. 404 (item removed in another session): error toast + invalidate the detail query so the row disappears.
3. When the toggle brings the list to 100% done and status ≠ `done`, the "Mark list as done" hint appears inside the progress card, under the bar (suggestion only).

**Remove item (RF-28)**:
1. Remove button → `DELETE …/items/:itemId` immediately (no confirm — the action is small and undoable).
2. Success: row leaves the table, the progress card updates; toast "Item removed" with an **"Undo"** action that re-adds the same size and quantity via `POST` (the done check restarts unchecked — acceptable loss for a just-removed line).
3. Error (e.g. 404 already removed elsewhere): error toast + invalidate.

**Filter / group items** — client-side only:
1. Search, the category filter, and the "Group by category" toggle update the URL and re-render the loaded set; nothing refetches.
2. The table is always grouped: by product (the default — the endpoint's order, RF-26) or by category (toggle on). Rows keep all their controls (check, quantity, remove) inside groups. A group whose items are all filtered out renders no header row.

**Delete list (RF-29)**:
1. "Delete list" → confirm modal: "Delete the list “X”? Its items will be deleted too." (RN-09). Confirm is `button-danger`.
2. `DELETE /replenishment-lists/:id` → success: toast "List deleted", invalidate lists queries, navigate to `/replenishment`.
3. Error: error toast, stay on page.

## Edge cases

- Read-only fallback (a session with `replenishment:read` but without `replenishment:manage` — no current store role, kept for permission evolution): no inputs, no picker, no remove/delete buttons, checks rendered read-only — the same layout via `<RequirePermission>`. The API enforces this regardless (RF-32). The progress card still renders (it is information, not an action).
- Concurrent edits from two sessions: every mutation is per item, so users editing different lines never conflict; on the same line, last write wins and the post-mutation invalidation settles both clients. A mutation against a line removed elsewhere returns 404 → error toast + invalidate.
- "Undo" after the list was deleted elsewhere: the `POST` returns 404 → error toast "List not found" + navigate to `/replenishment`.
- Rapid quantity edits: debounce/enqueue per item so requests do not race each other out of order (one in-flight `PATCH` per item; the latest value wins).
- Picker with an inactive product or size already in the assortment: still selectable — assortment membership, not product/size activity, is the criterion (RN-12; RN-08 keeps it visible where it exists).
- Removing the last item hides the progress card and the filter band (empty state takes over).
- The 100% hint never fires the status change itself: it is a shortcut to the same explicit action as the header select (RF-30 — no enforced state machine, no automatic transitions).
- platform_admin: `X-Tenant-Id` sent per `../shared/layout.md`; switching store while on this page invalidates tenant-scoped queries → the detail 404s for the new tenant → "List not found" card.
