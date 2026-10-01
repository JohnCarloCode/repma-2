# Activity — `/activity`

> Guard: `activity:read` (all roles — `../../core/architecture.md` §6, RF-42) · Zone: store
> API: `GET /availability/events` (store-wide feed: paginated, reverse chronological, optional `from`/`to` — RF-23)

## Purpose
The store-wide availability-events feed as a full page (RF-42): every out-of-stock and restock event across the store's assortment, newest first, with date filtering. It answers "what happened on the shop floor, and who flagged it" — the store-wide review view that complements the per-item history (RF-21). Visibility is by permission (`activity:read`), never by role (RF-32). Every store role holds it: "what happened while I was off" is a shift-handover question and the employee is the role that most needs it answered (`core/spec.md` §2). The permission still exists in its own right so narrowing it later stays a one-cell change.

## Layout
Standard shell (`../shared/layout.md`). Standard list screen skeleton (`../shared/components.md` / DESIGN.md §Screen Skeletons): `<PageHeader>` (title "Activity", subtitle "`<store>` · N events" from the feed envelope's `total` reflecting the active date filters — `../shared/components.md` §`<PageHeader>`; no primary action — the page is read-only) → filter band → `<DataTable>` → `<Pagination>`.

## Content

**Filter band**: two date inputs, "From" and "To", mapped to the endpoint's `from`/`to` params (RF-23). Both optional and combinable; a "Clear" tertiary action resets them. Dates are sent as local-midnight timestamps ("From" = start of day, "To" = end of day) so the filter matches the user's calendar day, not the server's.

**Events table** (row click → `/availability/:id` of the flagged item):

| Column | Content |
|---|---|
| Product | Product name + **size label** ("42", "M", "One size") — events are per size, so rows name the size (`../shared/components.md` data conventions) |
| Event | "Out of stock" / "Restocked" (`../shared/components.md` event labels) |
| User | Event author's name; "—" if the author was deleted (RN-09: history survives) |
| Date | `created_at`, relative < 24h ("2 h ago"), date convention from `../shared/components.md` otherwise |

Standard pagination (`page`/`pageSize`); events are immutable (RN-05), so there are no row actions and no mutations on this page.

## Actions by permission

| Action | Permission | Behavior |
|---|---|---|
| View the feed | `activity:read` | Route guard; the endpoint carries the same permission (RF-23), so guard and API agree per RF-32. |
| Navigate to `/availability/:id` | `availability:read` | Row click. Every role holding `activity:read` also holds `availability:read`. |

## States
Defaults from `../shared/components.md` apply. Page-specific:

- `<EmptyState>` with no filters: "No events yet".
- `<EmptyState>` with date filters set: "No events in this period" + "Clear" action.
- platform_admin without a selected store: full-content picker state per `../shared/layout.md`, before any query fires.

## Flows

1. **Filter by date**: changing "From"/"To" refetches page 1 with the new params; the filters are reflected in the URL query string so the view is shareable/restorable.
2. **Open an item**: row click → `/availability/:id` (detail + that item's own event history).
3. **Tenant switch (platform_admin)**: selector change invalidates the feed per `../shared/layout.md`; the page refetches for the new store, keeping the active date filters.

## Edge cases
- "From" later than "To": the band swaps them rather than querying an empty range — the same convention as `/replenishment`'s date filter.
- An event whose author was deleted still renders (User "—", RN-09).
- An event's item can never have been removed — an item with events is permanent (RF-44/RN-13) — so row links never dangle for a store user; the only reachable 404 on that detail is a platform_admin switching store mid-navigation, and it surfaces as that page's own error state — the feed itself never breaks (events are immutable).
- The guard is still real even though every current role passes it: a session lacking `activity:read` gets no sidebar item (`../shared/layout.md`) and direct navigation redirects to `/unauthorized` (guard rule 2). Nothing here checks a role name.
