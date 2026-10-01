# layout — Application shell

> Applies to every authenticated page. Visual tokens and component styles live in `../DESIGN.md` (§Layout, §Navigation); this doc specifies structure and behavior. UI copy is English (RNF-19).

## Structure

```
warm ash canvas ({colors.canvas}); no topbar at ≥ 744px (mobile pins a fixed mobile header — see Responsive); no shadows anywhere
┌──────────┬─────────────────────────────────────────┐
│ Sidebar  │   Content area (24px padding — 16px     │
│ spine    │   on mobile; max-width ~1200px) — starts│
│ 256px    │   at the top of the viewport            │
│ expanded │                                         │
│ / 64px   │                                         │
│ collapsed│                                         │
│          │                                         │
└──────────┴─────────────────────────────────────────┘
  ↑ flush to the left/top/bottom edges, 0px radius, no shadow (DESIGN.md §Elevation)
```

Public pages (landing, `/login`) do NOT use this shell. `/unauthorized` uses it when there is a session, bare when there is not.

## Sidebar

A **flush ink spine**: full viewport height, glued to the left edge, 0px radius, no shadow, no border — dark garnet-ink surface (tokens in `../DESIGN.md` §Application Shell / `{component.sidebar}`). The darkest mass in the system sitting on the warm ash canvas needs no inset, radius or shadow to read as its own plane (DESIGN.md §Elevation).

Vertical order: product wordmark → **tenant context block** → nav sections → (pinned at the bottom) **user menu** + collapse toggle. There is no top bar at tablet width and above — and the mobile header carries navigation only — so the tenant context and the user menu live here (see No topbar · Mobile header below).

- Internal padding 12px; the spine is `100vh` tall and never scrolls as a whole.
- If the nav sections exceed the available height, **only the nav list scrolls**: wordmark, tenant context block and the bottom block (user menu + toggle) stay fixed inside the spine.
- The spine stays flush in every state (expanded, collapsed, tablet overlay) — only its width changes.

### Tenant context block (RF-33)

Sits directly below the wordmark, above the navigation, visible to every role — the current store is always on screen:

- **manager / employee**: their store name as static text (`on-sidebar` tone). No selector. Their store is implicit in every API call (no `X-Tenant-Id` header sent).
- **platform_admin**: the tenant selector (`tenant-selector` in DESIGN.md, dark sidebar variant). Dropdown with search + active stores list + a **"Clear selection"** row that returns to the no-store-selected state below, opening as a floated menu (white surface, 1px ink rule — DESIGN.md §Elevation). The selection:
  - persists in `localStorage` across sessions;
  - is sent as `X-Tenant-Id` on every tenant-scoped call (availability, replenishment, home summary);
  - on change, invalidates all tenant-scoped queries (React Query) so no data from the previous store lingers.
- **platform_admin with no store selected**: the block shows a "Select a store" placeholder, and store routes render a full-content picker state ("Select a store to continue" + selector), never a broken page or a silent 400. Platform routes work regardless of selection.

### Navigation

**Item visibility is driven by `hasPermission`, never by role** (RF-32):

| Section | Item (UI copy) | Route | Visible with permission |
|---|---|---|---|
| — | Home | `/home` | `availability:read` |
| — | Replenishment | `/replenishment` | `replenishment:read` |
| — | Availability | `/availability` | `availability:read` |
| — | Activity | `/activity` | `activity:read` |
| — | Catalog | `/catalog` | `assortment:manage` |
| Platform | Stores | `/platform/tenants` | `tenant:manage` |
| Platform | Users | `/platform/users` | `user:manage` |
| Platform | Global catalog | `/platform/catalog` | `catalog:manage` |

- The store items are ordered by operating frequency — Replenishment and Availability are the daily work, Activity is review, Catalog is occasional assortment growth — so Catalog closes the section.
- "Catalog" is gated by `assortment:manage`, not `catalog:read`: every store role holds `catalog:read` (the ProductPicker reads the catalog endpoints from the replenishment flow, RF-39), so it cannot discriminate; the page exists to grow the assortment, which is manager work. Employees therefore never see this item (see `../pages/catalog.md` and `architecture.md` §6).
- Active item matches the current route prefix (`/availability/:id` keeps "Availability" active).
- The "Platform" section header only renders if at least one of its items is visible.

### User menu

Pinned at the bottom of the sidebar, alongside the collapse toggle (menu above, toggle below — the toggle keeps its own row). Shows the user's name and role label ("Platform Admin", "Manager", "Employee"); opening it reveals a single action: "Log out" → `POST /auth/logout` → redirect to `/login`. The open menu floats above the sidebar (white surface, 1px ink rule — DESIGN.md §Elevation).

### Collapse / expand

The sidebar has two widths: **expanded** (256px, icon + label) and **collapsed** (64px, icon-only rail). Visual tokens in `../DESIGN.md` (§Application Shell); width animates per DESIGN.md §Motion.

- **Toggle**: a chevron icon-button pinned at the bottom of the sidebar (below the user menu), with `aria-expanded` and an accessible label ("Collapse menu" / "Expand menu").
- **Collapsed state**: wordmark reduces to the logo mark; each nav item shows its icon only, with the label as a tooltip on hover **and keyboard focus**; the "Platform" section header is replaced by a hairline divider. Hover keeps its fill; the active item's 2px `on-sidebar` rule sits under the icon (DESIGN.md §Navigation — the marker is white on the spine, never the primary).
  - **Tenant context block, collapsed**: a compact **circular** tile (44px, `sidebar-hover` fill) showing the store's initial (first letter of the store name), with the full store name as a tooltip (hover + focus). Circular because the tenant block keeps the pill dialect even collapsed (DESIGN.md §Shape — it names the store you are in): a pill with nothing but an initial left in it is a circle. For platform_admin the tile is a button: clicking it opens the same tenant-selector dropdown as a flyout next to the rail (search + store list, unchanged behavior). With no store selected it shows a placeholder glyph and the "Select a store" tooltip.
  - **User menu, collapsed**: a **square** 32px initials avatar button (sharp — it is a menu button, DESIGN.md §Shape, unlike the tenant tile above) with the user's name + role as a tooltip (hover + focus); clicking opens the same menu ("Log out") as a flyout.
- **Persistence**: the choice is stored in `localStorage` (`sidebarCollapsed`) and applied on load before first paint (no width flash).
- The toggle only exists at tablet width and above; on mobile the sidebar is a drawer (see Responsive).

## No topbar (tablet and desktop) · Mobile header

The shell has **no top bar at tablet width and above**. Every page already opens with its own header carrying its name (`<PageHeader>` on list pages, the entity header on detail pages — `./components.md`), so a bar repeating it added no information. Consequences at ≥ 744px:

- The content area starts at the top of the viewport; nothing sticks to it (there is no topbar offset).
- Tenant context and the user menu live in the sidebar (they already did).

At **mobile width (< 744px)** the sidebar is off-canvas, so the shell pins a **mobile header** to the top edge (`{component.mobile-header}` in `../DESIGN.md` §Application Shell):

- A slim **fixed** band (56px), full width, flush, 0px radius, no shadow — the filter band's garnet (`{colors.filter-band}`, the primary's tone), same dark surface family as the spine; glyphs in `on-sidebar`.
- Its only content is the **hamburger** on the left (label "Open menu", `aria-expanded`, 44px hit area), which opens the navigation drawer. No wordmark, no page title, no actions — the page's own header sits right below and already carries the name.
- Because the band is fixed, **the content area starts below its height** — the product's only vertical offset, mobile-only.
- Page headers **no longer host the drawer trigger** at any width (`./components.md`).
- It sits at `{layers.shell}` — **below the dialog band** (DESIGN.md §Elevation · Layering). Any open dialog (modal, confirm, ProductPicker sheet) covers it completely: the fixed band must never remain visible or tappable above a scrim.

## Route guards

Declared per route, permission-based (same matrix as the API, from `packages/shared`):

1. No session (`GET /auth/me` → 401) → redirect to `/login`, preserving the intended URL to return after login.
2. Session but missing the route's permission → redirect to `/unauthorized`.
3. Store route + platform_admin without selected store → picker state (see above).
4. Unknown route (`*`) → redirect to the session's **role home** — `/platform/tenants` for platform_admin, `/home` for store roles, the same definition `/login` and `/unauthorized` use — or `/login` without a session.

Guards are UX only; the API is the authority (RF-32). A 403 from the API on an action the guard allowed still surfaces as an error toast.

## Session bootstrap

On app load, one `GET /auth/me` populates the auth context (user, role, store, effective permissions). While it resolves, render a full-page neutral loading state (no shell flash). A 401 clears context and lands on `/login`.

## Responsive

Breakpoints per DESIGN.md §Responsive Behavior; the sidebar behaves differently at each:

| Width | Sidebar behavior |
|---|---|
| < 744px (mobile) | Off-canvas drawer behind the hamburger in the **fixed mobile header** (see No topbar · Mobile header above); the content area starts below the header's height. Drawer: full height, flush, 0px radius — the same spine treatment at every width. Always full labels (never icon-only). Its top row carries an explicit **close button** ("Close navigation", X glyph in `on-sidebar`, 44px hit area) — the drawer also closes on navigation and on outside tap, but the button gives the gesture a visible target. No collapse toggle. The drawer mirrors the expanded sidebar's order: wordmark → tenant context block (static name or selector) → nav → user menu at the bottom. Drawer at `{layers.shell-panel}` over its scrim at `{layers.shell-overlay}` — both **below** the dialog band. |
| 744–1128px (tablet) | Defaults to the **collapsed** 64px rail, flush. The toggle expands it to 256px **in place, overlaying the content** (with scrim) — the panel grows, the content never reflows; it re-collapses on navigation or outside click. Rail at `{layers.shell}`, expanded panel at `{layers.shell-panel}` over its scrim at `{layers.shell-overlay}`: the panel overlays **page content only**. An open dialog outranks all three — the rail is covered by the dialog's scrim like everything else, never left showing down the left edge. |
| > 1128px (desktop) | Defaults to **expanded** (256px) inline; the toggle collapses it to the 64px rail and the content area reflows to use the freed width. The user's choice persists (`sidebarCollapsed`). |

The persisted preference applies only at desktop width; tablet always starts collapsed and mobile always uses the drawer.

## Layering with dialogs

The shell's z-index band ends where the dialog band begins (`layers` in `../DESIGN.md`, rules in §Elevation · Layering). Concretely, whenever a modal, confirm or the `<ProductPicker>` is open:

- **Mobile (< 744px)**: the sheet and its scrim cover the fixed mobile header. The hamburger is not visible and not tappable while a dialog is open — closing the dialog is the only way back to it.
- **Tablet (744–1128px)**: the sheet and its scrim cover the collapsed rail and, if it was expanded, the panel and the panel's own scrim. No strip of spine is left showing beside the dialog.
- **Desktop (> 1128px)**: same rule — the dialog covers the expanded sidebar; it is never inset to "make room" for it.

This is a consequence of portalling dialogs at the document root, not of tuning numbers per breakpoint: a dialog mounted inside the content area is trapped in the shell's stacking context and will slide under the chrome no matter its z-index (`./components.md` §Modals & confirms).
