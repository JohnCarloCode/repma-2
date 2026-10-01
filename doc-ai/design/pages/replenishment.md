# Replenishment lists — `/replenishment`

> Guard: `replenishment:read` · Zone: store
> API: `GET /replenishment-lists` (paginated; filters `status` — one or more of `draft,processing,done` —, `search` on name, `from`/`to` on `created_at`; each list carries `itemCount`, `productCount` and `doneCount`) · `POST /replenishment-lists` · `DELETE /replenishment-lists/:id`

## Purpose

Index of the store's replenishment lists (RF-26). From here users create lists — always **manually** (RF-27), with items added by hand in the detail (RF-28) — open a list's detail, and delete lists (RF-29). A list records what the sales area needs brought out from a stockroom that has it, so it is never built from the out-of-stock flags, which mean the opposite: nothing left anywhere in the store (DP-06). Tenant-scoped: manager/employee see their store implicitly; platform_admin sends `X-Tenant-Id` per `../shared/layout.md`.

## Layout

**This page is not the standard list skeleton.** It keeps the page header, the filter band and the pagination row, but its body is a **grid of cards**, one card per list, instead of a `<DataTable>`. It is the second documented exception to the table skeleton (`../shared/components.md` §List screen skeleton, DESIGN.md §Screen Skeletons) and it earns the deviation the same way `/availability` does (AD-22): a replenishment list is not a row of attributes to be compared down a column — it is a **work item**. Its state, its size, who opened it and how old it is are read together, as one object, and then acted on (open it, or delete it). Scanning those five facts across five columns is the reading a table is good at and this page never needs.

Page title: "Replenishment", subtitle "`<store>` · N lists" from the lists envelope's `total`, reflecting the active filters (`../shared/components.md` §`<PageHeader>`). Grid: **3 columns ≥ 1200px, 2 columns ≥ 744px, 1 column below**, gap `{spacing.base}` (16px). Pagination stays: page header → filter band → card grid → `<Pagination>`.

## Content — the list card

One card per list, on `{component.card}` (white on the ash floor, soft `{rounded.md}` radius, no border, no shadow — DESIGN.md §Elevation). The whole card is the navigation target: click or `Enter` → `/replenishment/:id`. It is a single focusable element with an accessible name (the list name), which is what replaces the table's row click.

| Slot | Content | Notes |
|---|---|---|
| Top left | Status badge | `badge-status-draft` "Draft" / `-processing` "In progress" / `-done` "Done" per `../shared/components.md` labels |
| Top right | Delete action | `icon-button-ivory`, gated; `stopPropagation` so it never opens the list — same rule as `<DataTable>` row actions |
| Title | List name | `{typography.h2}` (Inter Tight 20/400), truncated at 2 lines |
| Size line | `productCount` + `itemCount` | `{typography.caption}` in `{colors.muted}`, tabular-nums: "8 products · 14 sizes". Singular forms at 1 ("1 product · 1 size"). An empty list reads "Empty" |
| Progress line | `doneCount` of `itemCount` | **While the list is open** (`draft` or `processing`) **and has items**: the same compact fraction the detail page uses — "6/14", `tabular-nums`, caption treatment (one format for one datum, `../shared/components.md` §`<ProgressBar>`). Omitted on `done` (the work is finished) and on empty lists (the size line already reads "Empty") — the same rule as Home's open-work table, which shows the fraction for every open list with items (`home.md`) |
| — | Hairline | 1px `{colors.hairline}` rule separating identity from provenance |
| Creator | Creator's name | `{typography.caption}`; "—" if the user was deleted (RN-09: history survives) |
| Age | `created_at` | Date convention from `../shared/components.md`: relative under 24h ("14 minutes ago", "4 h ago"), the absolute `dd/mm/yyyy HH:mm` beyond it |
| Bottom right | Destination arrow | `{component.icon-button-ink}` — ink-filled 32px square, sharp corners, white chevron — on the card's last row, baseline-aligned with the provenance text on its left. Same control as the trailing column of Home's open-work table (`../shared/components.md` §`<DataTable>`) |

The card carries no product imagery: a list has none, and the design system has no decorative surface to spend on one (DESIGN.md §Color — color is rationed, the data is the imagery).

The **destination arrow** does not add an action: the whole card already resolves to `/replenishment/:id`, and the arrow is rendered **inside that same card link** rather than as a sibling button — one tab stop, one accessible name (the list name), no destination announced twice. It makes the exit visible instead of merely discoverable, which on a card matters more than on a table row: a card has no row-shaped affordance to suggest it leads anywhere.

Interaction states carry no lift and no shadow — there are none in the product (DESIGN.md §Elevation). Hovering the card puts the garnet link underline under the list name, a pointer cursor on the card, **and fills the arrow garnet** (`{component.icon-button-ink-hover}`, white chevron kept) — the two garnet marks appear together because they belong to the same single link. `:focus-visible` draws the standard garnet focus outline on the card itself. The delete button keeps its own hover and focus, independent of the card's, and hovering it does not light the arrow: they are different targets and must never read as one.

## Filters

Standard filter band (`../shared/components.md` §Filter band): white controls on the dark `filter-band` surface, state in the URL, any change resets to page 1, and the band stacks on mobile with the search full-width on top.

| Control | Options | Query param |
|---|---|---|
| Search | Name search, debounced 300ms | `search` |
| Status | "All" / "Draft" / "In progress" / "Done", multi-select | `status` (comma-separated — the endpoint accepts several) |
| Date | "Any time" / "Today" / "Last 7 days" / "Last 30 days" / "Custom…" | `from` / `to` on `created_at` |

The date control is **one select, not two inputs**: the frequent question is "this week", which should cost one click. "Custom…" reveals two date inputs that write the same `from`/`to` pair, so the URL shape is identical whichever path produced it. Presets are resolved in the browser's timezone at query time (a page left open overnight re-resolves "Today" on its next fetch, it does not pin the old day).

## Actions by permission

| Action | Permission | Behavior |
|---|---|---|
| Open list | `replenishment:read` | Card click / `Enter` → `/replenishment/:id`; the bottom-right arrow is part of that same link, not a separate action |
| "New list" | `replenishment:manage` | Primary action → create modal |
| Delete | `replenishment:manage` | Card's delete button → confirm modal → `DELETE /replenishment-lists/:id` |

The header's primary action is a single **"New list"** button, gated by `<RequirePermission p="replenishment:manage">` — which every store role holds (employees detect replenishment needs on the shop floor). There is no second creation path (DP-06).

## States

Defaults from `../shared/components.md` apply, with the card grid as the geometry they mirror:

- `<LoadingState>`: **skeleton cards** laid out on the same grid, not skeleton table rows.
- `<EmptyState>` (no lists yet): "No replenishment lists yet" + primary action "New list" if permitted.
- `<EmptyState>` (filters match nothing): "No results for these filters" + "Clear filters" — the standard filtered-empty state, distinct from the previous one.

## Flows

**Create manually (RF-27)**
1. "New list" → form modal (max-w 640px): "Name" (required text input), "Notes" (optional textarea).
2. Submit → `POST /replenishment-lists` with `{ name, notes }`.
3. Success (201): close modal, toast "List created", invalidate the lists query, navigate to `/replenishment/:id` of the new list so items can be added immediately.
4. 400: inline field errors, modal stays open. Other errors: error toast.

**Delete (RF-29)**
1. Card delete → confirm modal naming the list: "Delete the list “X”? Its items will be deleted too." (cascade per RN-09). Confirm is `button-danger`.
2. `DELETE /replenishment-lists/:id` → 204: toast "List deleted", invalidate lists query.
3. Empty-page recovery per `../shared/components.md`: if the delete empties the current page and `page > 1`, refetch on `page − 1`.
4. Error (e.g. 404 already deleted): error toast + invalidate.

## Edge cases

- platform_admin without a selected store: full-content picker state per `../shared/layout.md`, never a 400.
- A newly created list is always empty: the create modal collects name and notes only, and the user lands on the detail to add items by hand (RF-28). No path pre-fills it (DP-06). Seen from the index, such a card reads "Empty" in its size line.
- A list whose creator was deleted still renders (creator shown as "—", RN-09).
- A long list name truncates at 2 lines; the full name is available in the card's accessible name and on the detail page. Card height stays uniform across the row regardless of truncation or of the progress line being present.
- `from`/`to` inverted (user picks a "Custom…" range backwards): the band swaps them rather than querying an empty range.
- Filters active + delete: the empty-page recovery of `../shared/components.md` applies to the filtered result set, since `page` and the filters live in the same URL state.
- 403 on a mutation the guard allowed (matrix drift): surfaces as an error toast per `../shared/layout.md`; the API is the authority (RF-32).
- Concurrent delete from another session: the delete returns 404 → error toast + list invalidation removes the stale card.
