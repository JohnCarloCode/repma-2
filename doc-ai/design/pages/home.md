# Home — `/home`

> Guard: `availability:read` · Zone: store
> API: `GET /home/summary` (RF-41), `GET /replenishment-lists?status=draft,processing&pageSize=7` (open lists, most recent first — gated `replenishment:read`), `GET /availability?outOfStock=true&pageSize=10` (out-of-stock products with their runs), `GET /availability/events?pageSize=4` (recent-activity table, RF-23 — gated `activity:read`), `POST /replenishment-lists` (create from the header)

## Purpose
Store landing page (RF-25). It answers two questions at a glance — *what is missing* and *how is the open replenishment work going* — and then shows the evidence. Used daily by manager and employee; platform_admin sees it for whichever store is selected.

Two things are deliberately true here. **No ornament**: no photo, no illustration, no gradient, no quick-access tiles — in a tool for writing lists, decoration is where work should be. Identity comes from the greeting header and one full-width garnet figures card, both pure typography; the old "Categories" / "Products in store" counts stay gone (RF-41) because they were catalog inventory figures with no decision attached. **No funnel**: the availability figure and the replenishment figures share the card but answer unrelated questions and never feed each other (DP-06). No stock quantities anywhere (RN-05): every number is a count of lists, items or sizes, or an elapsed time — never units in stock. The full store-wide events feed lives on `/activity` (RF-42); Home closes with only its latest four lines.

## Layout
Standard shell (`../shared/layout.md`), per DESIGN.md §Screen Skeletons Home: **greeting header** (greeting + store/date line, "New list" primary on the right) → the **full-width figures card** on the family's garnet (`{colors.filter-band}`, soft card — the branded dark surface worn as the page's featured moment, DESIGN.md §Colors/§Screen Skeletons) → three summary blocks in the **same bounded-table dress** (shared `<DataTable>` geometry; tertiary "View all" bottom-right on each): open replenishment work (7 rows) → out-of-stock products (10 rows, each Sizes cell an intact size run) → recent activity (4 rows). 32px between sections.

## Content

### The greeting header
Home's page header is personal, built entirely from data the shell already has — it fires no query:

```
Good afternoon, Marta                              [ New list ]
Centro Store · Thursday, August 21
```

- The greeting at `{typography.display}` (32px, weight 400), banded by local time of day: "Good morning" before 12:00, "Good afternoon" 12:00–19:00, "Good evening" after — plus the session user's first name (`GET /auth/me`, already loaded by the shell). English like all UI text (RNF-19).
- Beneath, one `{typography.body}` line in `{colors.muted}`: the active store's name (session for manager/employee, the selector's store for platform_admin) · today's date in long weekday format, computed client-side.
- On the right, **"New list"** as `button-primary` (the ink block — gated `replenishment:manage`): the page's one primary action, moved up from the open-work block header, where its ink fill would compete with the arrow column below.

### The figures card
One full-width card on the family's garnet (`{colors.filter-band}`), built from one `GET /home/summary` call (RF-41): three figures in a row, evenly spaced, separated by vertical 1px `{colors.hairline-on-dark}` rules —

```
┌ garnet ──────────────────────────────────────────────────────────┐
│   3               │   14                  │   10                  │
│   open lists      │   items to replenish  │   sizes out of        │
│                   │                       │   stock               │
└───────────────────────────────────────────────────────────────────┘
```

- Numerals at `{typography.figure}` (48px, weight 400, proportional figures) in `{colors.on-dark}`, each with a `{typography.caption}` label beneath in `{colors.on-sidebar}`, sentence case, no trailing colon.
- The figures, in reading order: `openLists` (open replenishment lists), `pendingItems` (unchecked items across **all** open lists — the walking work still to do), `outOfStock` (sizes currently flagged). All three are counts, never quantities (RN-05).
- A zero renders as "0" — an honest zero across this card *is* the good state; no figure is ever replaced or hidden.
- The wide card with spaced figures is the page's one featured moment; it is a surface band with typography, not a hero and not a stat-card grid.
- The escalated-aging count ("N waiting more than a week") is **not** on the card: aging is a per-product signal and lives on each evidence line (DP-07), where the product it points at is right there to act on.

### Open replenishment work
Up to **7 open lists** — status `draft` or `processing`, most recent first (`created_at DESC`) — from `GET /replenishment-lists?status=draft,processing&pageSize=7`, rendered as a **bounded table**:

```
 List                  Status        Progress
──────────────────────────────────────────────────────
 Weekly replenishment   In progress   3/8         [▸]
 Saturday restock       Draft         0/4         [▸]
 Backroom sweep         Draft         —           [▸]
 Aisle 3 refill         In progress   6/6         [▸]
                                        View all (9)

[▸] = icon-button-ink — ink-filled 32px square, sharp corners, white chevron.
```

- **It is a table, and it borrows the shared `<DataTable>` geometry** (`../shared/components.md`): fog header row ("List", "Status", "Progress"), 1px hairline between rows, 8×12px cells, rows ≥ 44px on touch. What it does not borrow is pagination — this is a bounded set (below).
- Columns: name (`body-medium`), status badge (`../shared/components.md` labels), and the check progress as the compact `6/14` fraction (RF-40, one format for one datum — `../shared/components.md` §`<ProgressBar>`) built from the response's `itemCount` / `doneCount`. The **bar** itself stays on the list detail: a column of per-list bars on Home would read as the dashboard this page deliberately is not — Home carries no progress bars at all.
- **Trailing destination column**: an `{component.icon-button-ink}` resolving the row to `/replenishment/:id`. The whole row remains the click target and the arrow is rendered **inside that same row link**, not as a sibling button — one tab stop, one accessible name (the list name), no destination duplicated for assistive tech (`../shared/components.md` §`<DataTable>`). It makes an exit that already existed visible; it is not a second action.
- The block header carries **no action of its own**: "New list" lives in the greeting header (its ink fill would compete with the arrow column), and an out-of-stock item can never become a list (DP-06).
- A list with **no items** shows "—", not "0/0" (the `<ProgressBar>` convention: zero of zero is noise, not progress).
- **No pagination — the same pattern as the out-of-stock block**: a bounded set plus a tertiary **"View all"** → `/replenishment`. When `openLists` (RF-41) exceeds the 7 shown, the link states the true total — "View all (9)" — so the truncation is never silent. `/replenishment` is already the full, filterable, paginated index; paginating inside Home would make this block a second copy of that screen and Home would stop being a summary.
- `done` lists never appear here: the block answers "what work is open", and a finished list is not open work. They stay reachable from `/replenishment`.
- Ordering is `created_at DESC`, the same order `/replenishment` lists in — it reuses the existing index (`../../core/database.md` §Indexes) and keeps the two screens telling one story.
- Gated `replenishment:read` — held by every store role (`core/spec.md` §2); without it the block and its query do not render, the same discipline as the recent-activity block below (`activity:read`).
- **Why a table, when what this replaced was deliberately "lines, not a table"**: the original filler table listed the *most recent* lists with no datum that carried a decision — structure around nothing. This one earns the structure: each row now holds three facts read *down* the columns ("which of these is furthest along", "how many are still drafts", "where do I go"), and that comparison is what a table is for. The bound is what keeps it a summary rather than a second copy of `/replenishment` — 7 rows, no pagination, and a stated total when it truncates.

### Out-of-stock evidence
First 10 **products** from `GET /availability?outOfStock=true&pageSize=10` (a page of products, AD-22), in the **same bounded-table dress as the block above** — fog header row, hairlines, "View all" bottom-right. The cells' content is what `/availability` teaches: the same `<SizeRun>` component, same uniform out-of-stock mark, same weight-graded elapsed figure, same tile interactions — so the two pages teach one reading:

```
 Product           Sizes                                Waiting
────────────────────────────────────────────────────────────────
 Runner Sneaker    36  37 (•38) 39  40  41 (•42) 43     9 d
 Trail Jacket      XS (•S)  M   L   XL                  6 d
 …                                                      …
                                                View all (14)

(•nn) = the one out-of-stock mark: dotted outline + amber dot, same at any age.
The Waiting figure is the only place age shows (DP-07).
```

- Sorted by aging descending — the endpoint's default order (RF-18), no extra param: the most neglected product first. That ordering *is* the triage.
- Columns: product name (`body-medium`) — name only, **no image thumb**: Home's no-ornament rule keeps photos off this page, while `/availability` keeps its 32px thumbs — the intact size run, and the elapsed figure right-aligned. The table dress changes the frame, never the signature: tiles, mark, aging **and tile size** behave exactly as on `/availability`.
- Tile tap opens `/availability/:id` for its own size, exactly as on `/availability` — Home mutates nothing here: flagging lives on the item detail (RF-20).
- Tiles keep their full **44×44px** geometry inside the table dress (DESIGN.md §Size run): the run is the same touch surface here as on `/availability`, never a shrunken summary version. Rows therefore break the dense-table height (§Data Table density) — accepted, and the reason this block is bounded to 10 rows.
- No pagination here; **"View all" (tertiary, bottom-right, true total when it truncates — "View all (14)")** links to `/availability?outOfStock=true`. The N is the **product** total from the availability response's own envelope (`total` — a page is a page of products, AD-22); the card's `outOfStock` figure counts **sizes** (RF-41), a different unit, and is never the source of this N.
- The block header carries **no mutation action**: an out-of-stock item cannot become a replenishment list (DP-06).

### Recent activity
The page closes with the store's four latest availability events — the line that says whether the store is alive — from `GET /availability/events?pageSize=4` (RF-23), the same feed `/activity` pages through, in the **same bounded-table dress as the two blocks above** (fog header row, hairlines, "View all" bottom-right):

```
 Event                                                 When
────────────────────────────────────────────────────────────────
 Marta flagged Runner Sneaker · 42 out of stock        2 h ago
 Luis restocked Trail Jacket · M                       5 h ago
 Marta flagged Trail Jacket · S out of stock           20/08/2026 17:40
 Luis restocked Runner Sneaker · 38                    20/08/2026 09:12
                                                  View all →
```

- One `{typography.body}` row per event: author's name ("—" if the author was deleted, RN-09), event verb, product · size label, and the relative time right-aligned in `{colors.muted}` (date conventions from `../shared/components.md`). Row click → `/availability/:id` of the flagged item.
- **"View all" (tertiary, bottom-right)** → `/activity` (RF-42). The block is a teaser of that page, not a second copy: no filters, no pagination, fixed at 4 rows — and no count on its "View all": an event feed's total bounds no work (the documented exemption in `../shared/components.md` §`<DataTable>`).
- Gated `activity:read` — held by every store role (`core/spec.md` §2); without it the block and its query simply do not render.
- Only availability events exist in the log: list status changes are not recorded anywhere, so the table never shows replenishment activity ("closed a list" is not a real datum) — real data only.
- Empty (a brand-new store): one muted line, "No events yet" — the same wording as `/activity`.

## Actions by permission

| Action | Permission | Behavior |
|---|---|---|
| View Home | `availability:read` | Route guard; also gates `GET /home/summary`. |
| "New list" | `replenishment:manage` | `button-primary` in the greeting header → create modal, flow per `/replenishment` ("Create manually", RF-27). |
| See the open-work table | `replenishment:read` | Table and its query render only with the permission — the same one that guards its endpoint (RF-26). |
| See the recent-activity table | `activity:read` | Table and its query render only with the permission — the same one that guards the endpoint (RF-23). |
| Navigate to `/availability/:id` / `/replenishment/:id` | `availability:read` / `replenishment:read` | Tile in the evidence block, a line of the activity table, or a row of the open-work table — its trailing arrow is part of the same row link, not a separate action. |

## States
- Greeting header: no loading state — session, store and date are already client-side when the route mounts.
- Figures card pending: three figure-geometry skeletons inside the card (per `../shared/components.md` `<LoadingState>`; on the garnet surface the skeleton bars use the on-dark tones at low opacity, never the light-surface grays) — never a spinner, never a placeholder "0".
- Summary query failed: the card is replaced by one muted line ("Could not load the store summary") with a retry affordance; the rest of the page still renders on its own queries rather than the page failing whole.
- Open-work table pending: `<LoadingState>` skeleton rows at the table's own geometry (`../shared/components.md`), header row included — it is a table, so it loads like one.
- No open replenishment work: the `<EmptyState>` replaces the **whole table, header row included** — "No open replenishment work." + "New list" if permitted. A lone header row over nothing is chrome around an absence. Same line when every list is `done` — the store has lists, none of them open; "View all" still leads to them.
- Evidence block empty: positive empty state — "Nothing out of stock" (success framing, not a generic "no data").
- Activity table pending: four one-row skeletons at the table's geometry; failed: one muted line ("Could not load recent activity") — the block never blocks the page.
- platform_admin without a selected store: full-content picker state per `../shared/layout.md`, before any query fires.

## Flows

### Create a list manually ("New list")
Trigger: the greeting header's primary button. Same flow as `/replenishment` (RF-27): form modal (Name required, Notes optional) → `POST /replenishment-lists` → toast "List created", invalidate lists queries and the Home summary, navigate to the new list's detail. 400 → inline field errors, modal stays open.

### Open a size from the evidence block
1. Tile tap → `/availability/:id`, the same navigation as `/availability`; the flag actions live there (RF-20).
2. The detail's mutations invalidate Home's queries (summary, out-of-stock block, events feed), so on return the product line leaves the block once nothing in its run is out of stock, the figures card recomputes, and the new event tops the activity table — Home itself wires no mutation.

### Tenant switch (platform_admin)
Selector change invalidates all tenant-scoped queries (`../shared/layout.md`); the summary, the open-work table, the evidence block and the activity table refetch for the new store, and the greeting header's store name swaps instantly (it needs no query). Every figure on this page is tenant-scoped — the store-independent catalog counts are gone (RF-41) — so nothing survives a switch that should not.

## Edge cases
- More than 10 affected products: the block shows 10 and "View all (N)" states the true **product** total from the availability query's envelope (never the card's `outOfStock` figure, which counts sizes) — never paginate inside Home. Same rule for open lists: 7 shown, "View all (N)" covers the rest; there `openLists` (RF-41) and the envelope total agree, both counting lists.
- Figures card vs. the blocks below: all are server-derived and invalidated together after every mutation here; a transient mismatch between refetches is acceptable and self-heals.
- All queries failing (e.g. tenant deactivated mid-session → 401/403): route-level `<ErrorState>` instead of a broken page.
- A newly created list is `draft` and empty (RF-30, RF-27), so it enters the table at the top row with "—" for progress and increments `openLists` while leaving `pendingItems` unchanged; creating it records no availability events — no invalidation of availability queries is needed.
- Checking an item done on a list's detail decrements `pendingItems` here on the next invalidation; deleting an unchecked item does the same — the figure counts rows, both agree by construction.
- A list moved to `done` from its detail leaves the table on the next invalidation, and its unchecked items leave `pendingItems` with it (the figure counts **open** lists only): the empty state (table and header gone) must be reachable without a reload.
- Exactly 7 open lists: no "View all (7)" count — the count only appears when something is actually hidden.
- Aging crossing a band while the page is open (a "6 d" becoming "7 d"): recomputed at render from the event timestamps (DP-07), so it corrects itself on any re-render without a refetch. The greeting's time-of-day band follows the same convention: computed at render, corrected by any re-render — never a timer of its own.
- The blocks on this page answer unrelated questions and never feed each other (DP-06): the out-of-stock block is "what does this store not have at all", the open-work block is "what manual replenishment work is open". Home shows them in sequence; it does not turn one into the other.
- Events carry no quantities (RN-06); every number on this page is a count of lists, items or sizes, or an elapsed time — never units.
