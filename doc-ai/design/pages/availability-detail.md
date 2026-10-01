# Availability item detail — `/availability/:id`

> Guard: `availability:read` · Zone: store
> API: `GET /availability/:id`, `GET /availability/:id/events`, `POST /availability/:id/events`, `DELETE /availability/:id` (RF-44)

## Purpose

Detail of one assortment item — a **product size** in this store's assortment: its current availability and the immutable event history behind it. Availability is per size and binary — the item's state (`is_available`) is exactly the latest event; there is no quantity to display or edit, ever. The page answers "is it available, since when, who flagged it" and lets the user record the next event. Tenant-scoped; platform_admin sends `X-Tenant-Id` per `../shared/layout.md`.

## Layout

Detail screen skeleton (DESIGN.md §Screen Skeletons): header → summary card → related table.

- **Header**: back `icon-button-ivory` (→ `/availability`, preserving list URL state) on the left; on the right, the flag action for the current state (gated `availability:flag`): **"Mark out of stock"** when available, **"Mark restocked"** when out of stock — preceded, **only while the history is empty**, by a ghost **"Remove from assortment"** (`button-secondary`, gated `assortment:manage`, RF-44; the trigger stays a ghost because the header already carries a filled action — the danger fill belongs to its confirm modal, DESIGN.md §Buttons). Nothing else — the item's identity lives in the summary card.
- **Summary card**, stacked top to bottom:
  1. **"Product name — size label"** (h1, e.g. "Runner Sneaker — 42") + size SKU caption, with `badge-inactive` "Inactive" beside the name if the product or the size is inactive (RN-08).
  2. **Availability state**: `badge-out-of-stock` rendering **"Out of stock"** plus its elapsed figure in the uniform out-of-stock mark — dotted outline + amber dot, no aging fill; the figure's weight is the only thing age changes (DP-07) — or plain **"Available"**.
  3. **"since `<date of the latest event>`"** — or "no events recorded" when the history is empty.
  4. **Category**.

  Product image thumb on the right of the card. This page is the one place where a lone badge carries the state, because its subject is a single size and there is no run to carry it (DESIGN.md §Badges). **No quantity figure** — nothing on this page computes or renders a unit count.
- **Event history table** below, with `<Pagination>`.

## Content

### Event history table (`GET /availability/:id/events`, reverse-chronological, paginated)

| Column | Content | Notes |
|---|---|---|
| Date | `created_at` per `../shared/components.md` date convention | |
| Event | Label per `../shared/components.md`: `out_of_stock` → "Out of stock", `restock` → "Restocked" | |
| User | Author name; **"—"** when the author was deleted (RN-09) | |

Three columns are the whole story: an event is nothing but its type, author and timestamp (RN-06).

The history is immutable: no edit or delete affordances, on any permission.

### Flag actions (gated `availability:flag` — this page is the only flagging surface in the app, RF-20)

- **"Mark out of stock"** (shown when available): one tap, no confirm → creates an `out_of_stock` event.
- **"Mark restocked"** (shown when out of stock): one tap, no confirm → creates a `restock` event. No modal, no fields — the event carries no quantity and no note (RN-06).

## Actions by permission

| Action | Permission | Behavior |
|---|---|---|
| View item + event history | `availability:read` | Route guard; page content |
| "Mark out of stock" | `availability:flag` | One tap → `POST /availability/:id/events` `{ type: "out_of_stock" }` (manager and employee) |
| "Mark restocked" | `availability:flag` | One tap → `POST /availability/:id/events` `{ type: "restock" }` (manager and employee) |
| "Remove from assortment" | `assortment:manage` | Rendered only while the item has no events → confirm modal → `DELETE /availability/:id` (RF-44/RN-13; manager — the only store role holding `assortment:manage` — plus platform_admin, as everywhere) |

## States

Defaults per `../shared/components.md`. Page-specific:

- **Empty history**: item added to the assortment and never flagged — the card shows "Available" with "no events recorded" in the date slot (no aging figure: there is nothing to age); the history table shows "No events yet. The item is available." + "Mark out of stock" if `availability:flag`. This is also the only state where "Remove from assortment" renders (RF-44).
- **404 on `GET /availability/:id`** (bad id or another tenant's item, indistinguishable by design, RN-03): `<ErrorState>` "Item not found" + link "Back to availability".
- **Flag pending**: the header action shows its pending state over the optimistic flip; the refetch reconciles (see Flows).

## Flows

### Mark out of stock

1. Click "Mark out of stock" (no confirm) → `POST /availability/:id/events` `{ type: "out_of_stock" }`. Optimistically flip the badge to "Out of stock" with a 0 elapsed figure (the mark is the same at any age — DP-07) and swap the header action.
2. Success (201): toast "Marked as out of stock"; invalidate the item query, its events query, the `/availability` list, Home queries (summary + out-of-stock), and the store-wide feed (`GET /availability/events`, `/activity`).
3. Error: revert the optimistic flip, error toast with the API message.

### Mark restocked

1. Click "Mark restocked" (no confirm) → `POST /availability/:id/events` `{ type: "restock" }`. Optimistically flip the badge to "Available" and swap the header action — the mirror of "Mark out of stock".
2. Success (201): toast "Marked as restocked"; same invalidations as above. The new event appears at the top of the history.
3. Error: revert the optimistic flip, error toast with the API message.

### Remove from assortment (RF-44)

1. Visible only with `assortment:manage` and an empty history. Click → confirm modal naming the item: "Remove “Runner Sneaker — 42” from the assortment?" — confirm is `button-danger`.
2. `DELETE /availability/:id` → 204: toast "Removed from assortment", navigate to `/availability` (list invalidated; the size becomes addable again in the picker, RN-04). Home needs no invalidation: an item without events is available and none of the summary's figures counts it (RF-41).
3. 409 (RN-13 — an event was recorded or the size sits on a replenishment list, possibly from another session): error toast with the API message + refetch item and events; if events now exist, the action disappears with them.

## Edge cases

- **State is the latest event**: after any mutation the invalidation refetches item + events together, so the badge can never disagree with the top row of the history. Its elapsed figure is derived from that same timestamp at render time (DP-07), never stored.
- **Concurrent flags** (two users act on the same item): the server serializes them — the first event wins and the redundant same-type event is rejected with 409 (RN-14). Revert the loser's optimistic flip, surface the message as a toast, and refetch: both clients settle on the same state.
- **Inactive product or size**: flagging remains allowed (RN-08); only new assortment additions are blocked, which does not concern this page.
- **Author of old events deleted**: rows keep rendering with "—" (RN-09); history is immutable.
- **Deep link to `/availability/:id` as platform_admin without store selected**: picker state per `../shared/layout.md`, then the item loads for the chosen store (or 404 if it belongs to another).
- **Size on a replenishment list but never flagged**: the removal 409s (RN-13 — the composite FK from list items). The UI does not pre-check it (the list reference is not in this page's data); the 409 toast explains it and the item stays.
