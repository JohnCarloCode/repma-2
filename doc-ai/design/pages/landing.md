# Landing — `/`

> Guard: public (a signed-in visitor is redirected to their role home) · Zone: public
> API: none of its own (reads the session `GET /api/v1/auth/me` already loaded at bootstrap)

## Purpose
The public front door required by DP-01: a short, honest product pitch with the **demo credentials in plain sight** and one way in (`/login`). Audience: a **recruiter or technical reviewer** opening the deployed URL cold — they should understand in under a minute what REPMA is, why availability and replenishment are separate (DP-06), what the engineering is about, and how to get in. It is not a marketing site: no testimonials, pricing, signup (DP-01) or invented metrics.

## Layout
NO app shell (`../shared/layout.md`: public pages don't use it). Same framing as `/login`: `canvas` background, content in `card`s, dark theme, no shadows, no illustrations or external assets (DESIGN.md §Do's and Don'ts). One centered column, max width 1080px, side gutters 16px (mobile) / 24px (≥ 744px), 48px between sections (`spacing.xxl`).

Landmarks top to bottom:
1. **`<header>`** (banner): `Wordmark` on the left, a `button-text` link "Sign in" → `/login` on the right.
2. **`<main>`**:
   1. **Hero** (two columns ≥ 744px — pitch left, demo-accounts card right; stacked below, pitch first). The credentials sit above the fold on tablet and desktop.
   2. **"Two jobs, kept apart"** — two cards side by side ≥ 744px (stacked below).
   3. **"How it's built"** — four cards in a 2×2 grid ≥ 744px (stacked below), then a one-line stack caption.
3. **`<footer>`** (contentinfo): one caption line + the source-code link.

Heading outline: one `h1` (hero); `h2` per section and for the demo card; `h3` per card.

## Content

### Hero
- Eyebrow (`label`, `text-secondary`): "Availability & replenishment for multi-store retail".
- h1 (`display`): "Know which sizes are missing — without counting stock."
- Lead (`body`, `text-secondary`, max ~60ch): "REPMA is a multi-tenant web app for sports retail stores. Staff flag the sizes that are out of stock and see how long each one has been missing; separately, they keep manual lists of what to bring out from the stockroom. A platform admin runs the stores, the users and the shared catalog."
- The screen's **one primary** (`button-primary` styled link): "Sign in to the demo" → `/login`.

### Demo accounts card (`card`, h2 "Demo accounts")
- "Every account uses the password" + the password in mono (`repma-demo-2026`) — the demo-only public password documented in the README (database.md §9). Showing it is the point of DP-01; it is not a secret (DP-05 is about server credentials) and grants only what the demo roles can do.
- One row per seed user (database.md §9), email in mono with `select-all` so one click selects it:

  | Role · store | Email |
  |---|---|
  | Platform Admin · all stores | `admin@repma.demo` |
  | Manager · Downtown Store | `manager.downtown@repma.demo` |
  | Employee · Downtown Store | `employee.downtown@repma.demo` |
  | Manager · North Store | `manager.north@repma.demo` |
  | Employee · North Store | `employee.north@repma.demo` |

- Caption under the list: "Admins manage stores, users and the global catalog. Managers also curate their store's assortment; employees flag sizes and work the lists. This is a shared public demo — other visitors may change the data."
- The accounts are a constant in the page: the web can't read the seed (DP-05), and the five rows change only if database.md §9 does.

### Two jobs, kept apart (DP-06)
- h2 "Two jobs, kept apart"; intro: "An out-of-stock flag and a replenishment list answer different questions, so neither is ever generated from the other."
- Card **Availability** (icon `inventory_2`, as in the nav): "Out of stock means gone from the whole store, stockroom included. Staff flag a size from the floor, everyone sees it at once, and the time since the flag sets its emphasis — a few hours is normal churn, a week is a failure nobody noticed. Every change is an event in an append-only history." Under it, an **illustrative size run** (the real `<SizeRun>`, read-only, no links) captioned "Example": sizes 38–43 with 41 out of stock for 9 days, its `AgingFigure` beside it — the product's signature component, built from static data computed at render (no API).
- Card **Replenishment** (icon `list_alt`): "A list is written by staff walking the floor: what the sales area needs from a stockroom that does have it. Lists are manual on purpose — generating them from out-of-stock flags would ask the stockroom for exactly what it doesn't have."

### How it's built
- h2 "How it's built"; four cards (h3 + one paragraph), no icons:
  - **Tenant isolation in the database** — "Every store shares one schema, isolated by PostgreSQL Row-Level Security that is forced on every tenant table and fed per transaction by the API. Isolation tests run in CI and fail the build on any cross-store leak."
  - **An immutable availability log** — "A size changes state only by appending an “Out of stock” or “Restocked” event. Nothing edits the flag directly, and no stock quantity is ever stored or shown."
  - **Authorization by permission** — "One role-to-permission matrix, shared by the API and the UI. Routes, menus and actions check permissions, never role names."
  - **Tested and deployed** — "TypeScript end to end. Unit and integration tests run against a real Postgres with RLS; GitHub Actions gates every change, and merges to main deploy automatically."
- Stack caption (`caption`, `text-secondary`): "TypeScript · Node.js + Express · PostgreSQL on Supabase · Drizzle ORM · React · TanStack Query · Tailwind CSS".

### Footer
Caption: "REPMA is a portfolio project built to demonstrate engineering quality."
Right of it (wrapping below on mobile), a text link "Source code on GitHub" → the public repository (`https://github.com/JohnCarloCode/repma-2`), `accent-bright`, same tab.

No test counts or other figures that drift with the code.

## States
- **Session loading**: the app-wide neutral bootstrap state (`../shared/layout.md` §Session bootstrap) — the page never flashes before the session is known.
- **Signed in** (any role): immediate `replace` redirect to the role home (`ROLE_HOME`: `/platform/tenants` or `/home`), the same rule as `/login`.
- **Anonymous**: the static page. No queries → no loading/empty/error states of its own.

## Responsive
- < 744px (390): single column; header stays one row (wordmark + "Sign in"); hero → demo card → jobs → built cards; emails fit at 390px without horizontal scroll (mono 13px; `overflow-wrap:anywhere` as a fallback).
- 744–1279px (834): hero in two columns (pitch | demo card ~360px); jobs 2-up; built 2×2.
- ≥ 1280px: same as tablet, column capped at 1080px.

## Accessibility
- Landmarks `banner` / `main` / `contentinfo`; one `h1`, `h2`/`h3` per the outline above.
- Icons `aria-hidden`; the example run keeps `<SizeRun>`'s accessible names ("Example sizes", each tile's state as text) and its out-of-stock tile is told apart by more than color (DESIGN.md §Out of stock).
- The CTA and header link are real links (`<a href="/login">`), 44px targets, visible focus ring.
- The demo emails and password are plain text (selectable, read by screen readers), not images.

## Flows
1. Anonymous visitor opens `/` → reads the pitch and the credentials.
2. "Sign in to the demo" (or the header "Sign in") → `/login` (client navigation). Login is not prefilled — the visitor picks a role from the card and types or pastes it; prefill would need extra state for a one-time convenience.
3. `/login` carries a one-line hint under the card (the slot login.md reserved): "Trying the demo? See the demo accounts" → `/`, for visitors who were sent straight to `/login`.
