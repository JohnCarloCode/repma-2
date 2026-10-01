# REPMA — Requirements Specification (spec.md)

> Functional and non-functional specification of REPMA, a multi-tenant per-store availability tracking and replenishment platform. Date: 2026-08-16.
> Related documents: `architecture.md` (system architecture) and `database.md` (database architecture).

---

## 1. Product vision

REPMA is a **generic multi-store availability tracking and replenishment platform**. A platform operator serves multiple independent stores on top of a shared product catalog:

- A **Platform Admin** manages the entire platform: stores (tenants), users, and the **global catalog** of categories and products.
- Each **store (tenant)** has its own users (**manager** / **employee**) and its **own assortment and availability state** on top of the global catalog.
- A product exists **exactly once** in the catalog, with its **sizes**; each store decides which sizes it offers (its *assortment*) and tracks whether each one is currently available on the shop floor. E.g.: "Nike Air Max" exists once with sizes 36–45; Store A has size 42 out of stock, Store B has it available.
- REPMA deliberately does **not** track stock quantities: without POS integration a quantity cannot be kept truthful. Staff flag on the shop floor which sizes are out of stock — meaning the store has none **anywhere, stockroom included** (DP-06) — and, separately, keep manual replenishment lists of what the sales area needs. The application **never** shows or implies a current stock quantity ("X left" is forbidden).
- A store's data is **never** accessible from another store.

The goal of the project is not feature count but **demonstrating engineering quality**: React, TypeScript, Node.js, REST API, PostgreSQL, authentication, RBAC, multi-tenancy, validation, testing, Docker, and CI/CD with a clean architecture proportionate to the project's actual size.

## 2. Roles and access levels

| Role | Scope | Description |
|---|---|---|
| **Platform Admin** (`platform_admin`) | Platform (no store) | Manages stores, users, and the global catalog. Can operate inside any store by selecting it. |
| **Manager** (`manager`) | Their store | Manages their store's assortment (which catalog product sizes it offers), tracks availability (flags out-of-stock and restock events), manages replenishment lists, and reviews the store's activity feed. |
| **Employee** (`employee`) | Their store | Flags availability on the shop floor (out-of-stock and restock events), views the assortment, reviews the store's activity feed, and manages replenishment lists (create, edit, delete, change status — the full `replenishment:manage` surface) — employees detect replenishment needs on the shop floor. Reads the catalog only through in-flow pickers (RF-39), never as a standalone page. |

Manager and employee both hold `catalog:read`, `availability:read`, `availability:flag`, `activity:read`, `replenishment:read`, and `replenishment:manage`; the only manager-exclusive store permission is `assortment:manage`. Every store role reads the activity feed (RF-42) because "what happened while I was off" is a shift-handover question, and the employee is the role that most needs it answered; `activity:read` nonetheless remains a permission of its own (`architecture.md` §6) because it gates a distinct endpoint (RF-23) and keeps narrowing it later a one-cell change. The concrete permissions of each role are defined in a centralized authorization matrix (`architecture.md` §6); these levels must be able to evolve without touching scattered code.

### Product decisions

- **DP-01 — Everything behind login.** There is no public content beyond the login screen and the landing page (`/`): a product pitch with visible demo credentials, **built in the final polish phase** — until then `/` redirects to the login. There is no signup: all users are created by the Platform Admin.
- **DP-02 — Global catalog, per-store availability.** Categories, products, and their sizes are unique and global, editable only by the Platform Admin. What is tenant-scoped is the assortment, its availability state, the availability events, and the replenishment lists.
- **DP-03 — One user, one store.** Manager and employee belong to exactly one store. The Platform Admin belongs to none and can operate on all of them (store selector).
- **DP-04 — Centralized user management.** Only the Platform Admin creates, edits, and deactivates users; managers do not manage users.
- **DP-05 — The API is the only gateway to the data.** The frontend never talks to the database or to identity/storage services; it contains no secrets.
- **DP-06 — Availability and replenishment are independent.** An `out_of_stock` flag means the size is unavailable **anywhere in the store, stockroom included**: there is nothing left to bring out to the sales area, so no internal move can fix it. The flag exists so that staff on the floor know instantly, without searching the stockroom. A replenishment list is a different job: **manual** sales-area work, written by staff who walk the floor and note what needs bringing out from a stockroom that *does* have it. Neither is derived from the other — a list is never generated from out-of-stock flags (that would ask the stockroom for exactly what it does not have), and recording an availability event never creates or modifies a list.
- **DP-07 — Out-of-stock aging is the operational signal.** How long a size has been out of stock matters more than the bare fact: a few hours is normal shop-floor churn, a week is a failure nobody noticed. Wherever the product reports the out-of-stock state it also reports the **time elapsed since the latest `out_of_stock` event**, on three bands — **under 24 h** (normal, no emphasis), **24 h to 7 days, inclusive** (attention), **over 7 days** (escalated). The out-of-stock state itself is signalled identically whatever its age; the bands modulate only the **emphasis of the elapsed figure** (`design/DESIGN.md` §Out of stock). They drive presentation only: never persisted, never gate an action, never imply a quantity.

## 3. Functional requirements

### 3.1 Authentication and session

- **RF-01** Login with email/password: `POST /api/v1/auth/login`. The session is delivered in an **HttpOnly** cookie (`SameSite=Lax`, `Secure` in production); browser JS never sees the token.
- **RF-02** Current session: `GET /api/v1/auth/me` returns the user, role, store (if applicable), and effective permissions, or 401.
- **RF-03** Logout: `POST /api/v1/auth/logout` invalidates the cookie.
- **RF-04** The API accepts the token via cookie or via `Authorization: Bearer` header (the cookie takes priority).
- **RF-05** A deactivated user (`is_active = false`) or one belonging to a deactivated store cannot operate.
- **RF-43** Transparent session renewal (AD-23): the session cookie carries the Supabase access and refresh tokens; when the access token expires, the API refreshes it on the request itself, re-issues the cookie, and the request proceeds — no mid-shift re-login, and browser JS never sees any token (RF-01). A failed refresh clears the cookie and returns 401.

### 3.2 Stores (Platform Admin)

- **RF-06** List stores, paginated with search: `GET /api/v1/tenants`.
- **RF-07** Create store: `POST /api/v1/tenants` (name, unique slug).
- **RF-08** Edit store: `PATCH /api/v1/tenants/:id`, including activation/deactivation (`is_active`). Stores are not deleted: they are deactivated.

### 3.3 Users (Platform Admin)

- **RF-09** List users, paginated with search and store filter: `GET /api/v1/users`. `search` matches the full name and the email (served by the profile's denormalized `email` column, `database.md` §4.2).
- **RF-10** Create user: `POST /api/v1/users` (email, password, name, role, and — for manager/employee — their store). Creation establishes the identity and the profile atomically or with compensation: a failure never leaves orphaned records.
- **RF-11** Edit user: `PATCH /api/v1/users/:id` (name, role, `is_active`, and optionally a new `password` — a **reset** applied via Supabase Auth admin, write-only and never readable back), maintaining role↔store consistency (RN-01). The store is **not editable** — it is fixed at creation, and role changes never cross the store boundary (manager ↔ employee only; RN-01): moving someone to another store, or into/out of the platform role, is done by deactivating the user and creating a new one. Email is not editable either. There is no self-service password change and no email recovery (DP-01): a forgotten password is recovered through the Platform Admin (DP-04), never by delete + create — which would orphan the user's event authorship (RN-09).
- **RF-12** Delete user: `DELETE /api/v1/users/:id`. A user cannot delete or deactivate themselves.

### 3.4 Global catalog

- **RF-13** List categories: `GET /api/v1/categories` (readable by any authenticated user).
- **RF-14** Create/edit categories: Platform Admin only. Categories cannot be deleted in the MVP (there is no delete endpoint); the RESTRICT FK from products additionally protects any category with products at the schema level.
- **RF-15** List products, paginated with filters `categoryId`, `search`, and `isActive`: `GET /api/v1/products` (readable by any authenticated user). Each product embeds its sizes; `search` matches the product name and the size SKU.
- **RF-16** Create/edit products (name, category, description, image): Platform Admin only. The product is the grouping unit; the business SKU lives on the size (RF-37). Creation (`POST /api/v1/products`) requires **at least one size** — a sizeless request is rejected (400); non-sized products get their single "One size" entry from the creator via the preset (RF-38), never silently from the API. Product retirement is **soft** (`is_active = false`): the product is no longer offered for new assortment additions but existing assortment entries and event history remain intact.
- **RF-17** Upload product image (multipart, 5 MB limit) to a public storage bucket; the product stores the URL.
- **RF-37** Product sizes (formerly "variants"): every product has ≥ 1 size in the global entity `product_sizes` (label such as "42"/"M"/"One size", **unique SKU per size**, `is_active`, display order). Platform Admin only: add a size with `POST /api/v1/products/:id/sizes` and edit it with `PATCH /api/v1/products/:id/sizes/:sizeId` — label, **SKU** (editable like the label; nothing references a SKU by value — FKs go by id — and global uniqueness stays enforced, 409 on conflict), position and `is_active`; sizes are never deleted. Size retirement is **soft** (`is_active = false`), like products: a deactivated size admits no new assortment additions but keeps its existing assortment entries and event history.
- **RF-38** Size presets as shared constants for UI prefill: "Clothing" (XS/S/M/L/XL/2XL), "Footwear" (36–45), and the default "One size". Presets only prefill the form; the Platform Admin can freely edit the labels per product.

### 3.5 Assortment and availability (per store)

- **RF-18** View the store's assortment with availability: `GET /api/v1/availability`, with pagination and filters `search`, `categoryId`, `outOfStock=true`, and `productId` (one or more product ids — it lets the `/catalog` page read the assortment state of exactly the products it renders, RF-35, with no pagination mismatch); a single item is retrieved with `GET /api/v1/availability/:id` (both require `availability:read`). The listing is **grouped by product** (AD-22): each page item is a product (name, image, category) carrying the store's full **size run** — every size of that product in the assortment, in `position` order, each with its label, SKU, `is_available` flag, its `is_active`, and the timestamp of its latest event; the product carries its own `is_active` too — inactive products and sizes stay visible and marked wherever they already exist (RN-08). A page is therefore a page of **products**, not of sizes, so a product's run is never split across pages. `search` matches the product name and the size SKU; `outOfStock=true` selects products with **at least one** size out of stock and still returns their complete run, so the reader sees which sizes are missing *and* which are not. Default order is **aging descending**: products whose oldest currently-out-of-stock size has held longest come first (sort key: the oldest `created_at` among the latest `out_of_stock` events in the run — the operational triage, DP-07); products with nothing out of stock follow, ordered by name. There is no sort parameter: this is the server's only order. `GET /api/v1/availability/:id` addresses a single assortment item (one size) and is unchanged.
- **RF-19** Add a catalog size to the assortment: `POST /api/v1/availability` with `sizeId` (requires `assortment:manage`). The item starts as available (`is_available = true`, no events). A size can only appear once in a store's assortment; a deactivated product or size admits no new additions.
- **RF-44** Remove a size from the assortment: `DELETE /api/v1/availability/:id` (requires `assortment:manage`). Allowed only while the item is unreferenced — no availability events and no replenishment list lines (RN-13); otherwise 409. It exists to correct a mistaken addition (RF-19), never to erase history: an item with events is permanent.
- **RF-20** Record availability events: `POST /api/v1/availability/:id/events` with `{type}` (requires `availability:flag`). Types: `out_of_stock` ("Out of stock") and `restock` ("Restocked"). The event carries **no other payload** — no quantity, no note: flagging is binary by design (RN-05, RN-06), so recording either event is a single tap with no form. Every event records who and when. An event whose type matches the item's current state is rejected with 409 (RN-14): the history is strictly alternating, so the latest `out_of_stock` event always marks the start of the current outage — the timestamp DP-07's aging is computed from (RF-24).
- **RF-21** View an item's event history, paginated in reverse chronological order: `GET /api/v1/availability/:id/events` (who, when, type).
- **RF-22** The application never displays or implies a current stock quantity ("X left" is forbidden). `is_available` is not an editable field on any endpoint: it changes exclusively as a consequence of recording availability events (RN-05); its presence in any request body is a validation error.
- **RF-23** Store-wide events feed: `GET /api/v1/availability/events` returns the store's recent availability events across all items, paginated in reverse chronological order, with optional `from`/`to` date filters; each event carries its type, timestamp, author (null when the author was deleted, RN-09) and its item's identity (assortment item id, product name, size label) — everything its consumers render, with no extra fetch. It requires `activity:read` (its consumers are the Activity page, RF-42, and Home's recent-activity block, RF-25) — unlike the per-item history (RF-21), which stays under `availability:read`.
- **RF-24** Out-of-stock detection **per size**: an item is out of stock when the state implied by its latest event is `out_of_stock` (no events → available); it can be queried as a filter (`outOfStock=true`, RF-18 — which selects at product level while still returning the whole run) and is visible on Home. Every surface that reports the state also reports how long it has held (DP-07), computed from the timestamp of the latest `out_of_stock` event.
- **RF-25** Home (store landing page, `/home`): opens with a **greeting header** — a time-of-day greeting with the session user's first name over a muted store-name · date line, and the page's one primary action, **"New list"** (gated `replenishment:manage`) — then a single **full-width figures card** built from the summary (RF-41): three figures in a row separated by vertical hairlines — **open lists**, **items to replenish** (unchecked items across the open lists), **sizes out of stock**. The escalated-aging count is not one of the figures: aging stays a per-product signal in the evidence list (DP-07). Below it, first a **bounded block of open replenishment work** (rendered only for holders of `replenishment:read`, like the recent-activity block for `activity:read`): up to **7 lists in `draft` or `processing`**, most recent first, as a **table** — one row each with its status, its check progress and a direct exit to that list — plus a "View all" exit to the full index (RF-26); then the current out-of-stock items **grouped by product with their full size run** (RF-18) and their aging, each size tile opening its item detail (`/availability/:id`), where events are recorded (RF-20); and, closing the page, a **recent-activity block**: the store's four latest availability events (RF-23, rendered only for holders of `activity:read`) as one row each — author, event, product and size, relative time — with a "View all" exit to `/activity` (RF-42). No ornament anywhere: no photos, illustrations, gradients or quick-access tiles. All three summary blocks share one bounded-table presentation — header row, one fact set per row, a "View all" exit bottom-right — because their facts are read down the columns (which list is furthest along, which product has waited longest); the bound and the absence of pagination are what keep them a summary. Home never paginates — `/replenishment` is the paginated index; Home shows enough open work to act on and states the true total when it truncates (the recent-activity teaser excepted: a feed's total bounds no work, so its "View all" carries no count). Home never derives a replenishment list from the out-of-stock items (DP-06): the two blocks answer unrelated questions.
- **RF-41** Home summary: `GET /api/v1/home/summary` (tenant-scoped) returns exactly what Home's figures card needs, in one response: `{ openLists, pendingItems, outOfStock }` — **open** replenishment lists (`draft` or `processing`), **items to replenish** (list items with `is_done = false` across **all** open lists, not just the 7 rows Home shows), and currently out-of-stock assortment items (sizes). All three are counts, never quantities (RN-05). `openLists` is also what lets Home's open-work block state the true total when it truncates at 7, the same honesty the out-of-stock block has. The card's lineage of removed figures, each dropped when its consumer left the page: `listsInProgress` (no surface consumed it once the block listed open lists directly), the four-card `categories` / `productsInStore` (catalog inventory figures with no decision attached — "categories" was identical in every store), `agedBeyondBand` (aging stays per product in the evidence list, DP-07, where it is actionable), and the interim chart-cards contract's `productsAffected`, 14-day `trend` and `draftLists` / `processingLists` split (sparkline and donut removed with that design). None of the three figures is derivable from a list endpoint without extra round-trips — `pendingItems` in particular aggregates across all open lists — and one response gives the card a single loading state.

### 3.6 Replenishment lists (per store)

- **RF-26** List and view replenishment lists: `GET /api/v1/replenishment-lists`, `GET /api/v1/replenishment-lists/:id`. The index is filterable and paginated: by **name**, by **status** (one or more of `draft`/`processing`/`done`) and by **creation date range**, all combinable; its only order is **most recent first** (`created_at` descending — the same order Home's open-work block reuses, RF-25), with no sort parameter. Each list reports how many sizes it covers, how many distinct products those sizes belong to, and its check progress (RF-40). The detail returns the list's items **ordered by product** (product name, then size `position`), each embedding its size's identity — product name and category, size label, SKU — so the detail's table and its client-side category filter need no extra fetch: a list is walked product by product on the shop floor, so the default rendering is grouped by product straight from the endpoint's order (`design/pages/replenishment-detail.md`); there is no sort parameter and no insertion-ordered view.
- **RF-27** Create a list **manually**: `POST /api/v1/replenishment-lists` with a name and optional notes. Items are added by hand afterwards (RF-28), each with `quantity_requested` defaulting to 1 and freely editable. Lists have **no generated origin**: there is no endpoint, parameter or UI action that builds one from the out-of-stock flags (DP-06).
- **RF-28** Edit a list (name, notes, status) and manage its items **individually with immediate persistence** (autosave — there is no batch "save" step): add an item (`POST /api/v1/replenishment-lists/:id/items`), edit it (`PATCH …/items/:itemId` — `quantity` and/or `isDone`), remove it (`DELETE …/items/:itemId`). Constraints: the size must be in the store's assortment (RN-12), `quantity ≥ 1`, each size at most once per list.
- **RF-29** Delete a list (its items are removed in cascade).
- **RF-30** List statuses: `draft` → `processing` → `done`, as an editable field without an enforced state machine.
- **RF-40** Per-item progress check: every list item carries `is_done` (default `false`) so staff can track which lines are already handled and resume later. It is toggled through the same per-item `PATCH` as the quantity (RF-28) and persisted immediately; new items always start unchecked. The list detail shows check progress (progress bar + the compact `done/total` fraction, "6/14"); reaching 100% only suggests — never forces — moving the list to `done` (RF-30).

### 3.7 User interface

- **RF-31** SPA with login, an `/unauthorized` page, and redirects for unknown routes; UI in English (the application's user interface language is English).
- **RF-32** Route and action guards **by permission** (not by role), using the same authorization matrix as the API. The API is always the final authority.
- **RF-33** The current store is always visible in the app shell (sidebar tenant block): for manager/employee as static text (their store is implicit); for the Platform Admin it is the active-store selector.
- **RF-34** Platform panel (`/platform/*`): store, user, and catalog management, visible only to the Platform Admin.
- **RF-35** Store views: Home (RF-25), catalog (manager-only — the page is guarded by `assortment:manage`; every store role keeps `catalog:read` at the API for the ProductPicker, RF-39), availability (the assortment grouped by product, each with its size run, availability state and aging — RF-18, DP-07 — plus per-item event history), replenishment lists, and Activity (RF-42).
- **RF-42** Activity page (`/activity`): the store-wide availability-events feed (RF-23) as a full page — paginated, reverse chronological, with `from`/`to` date filters. Guarded by `activity:read` — held by every store role plus the Platform Admin (§2) — the same permission as the endpoint that feeds it.
- **RF-36** Listings with pagination and search; consistent loading/empty/error states via shared components; toasts for mutation results — with one documented exception: the per-item autosave mutations of RF-28/RF-40 (add item, quantity, done check) are silent on success (the visible state change is the feedback; errors always toast, `design/shared/components.md` §Toasts) — item **removal** does toast, because its toast carries the "Undo" action; recovery from an empty page after deleting the last item on a page.
- **RF-39** Shared visual **ProductPicker** as the standard product selection pattern: a modal with category navigation, search, an image grid of products, size tiles, and — where a quantity applies (replenishment items) — a quantity input. It is used both to add a size to the assortment (RF-19) and to add items to a replenishment list (RF-28). Its size tiles and the availability size run (RF-18) are the same visual primitive, defined once (`design/DESIGN.md` §Components).

## 4. Non-functional requirements

### 4.1 Security

- **RNF-01** Multi-tenant defense in depth: in addition to application-level filtering, PostgreSQL enforces **Row-Level Security** with a non-bypassing connection role; tenant isolation is covered by automated tests that block the build.
- **RNF-02** The frontend contains no secrets; the database and identity/storage services are accessible only from the API.
- **RNF-03** HttpOnly session cookie, SameSite=Lax, Secure in production.
- **RNF-04** Security headers with Helmet (CSP with `img-src` for the image bucket); `x-powered-by` disabled.
- **RNF-05** CORS with an origin allowlist and `credentials: true`.
- **RNF-06** JSON/urlencoded body limit of 100 kb; image uploads limited to 5 MB.
- **RNF-07** Rate limiting on **all** endpoint families, keyed **per authenticated user** — never per IP on authenticated routes, because a store's staff share one NAT'd IP and a per-IP bucket would pool the whole shop floor: read 100/min, write 30/min, and a **shop-floor write family** at 120/min covering the mutations whose legitimate cadence is one tap per line — availability flag events (RF-20) and per-item replenishment autosave (RF-28/RF-40). The two public routes stay keyed per IP: login at 10/min, health under the read limit.
- **RNF-08** Strict input validation (whitelisting of body/query/params with per-field issues) on all endpoints.
- **RNF-09** `trust proxy` enabled (correct IPs behind the deployment proxy).

### 4.2 Operations and deployment

- **RNF-10** Health check `GET /api/v1/health` (liveness + DB ping).
- **RNF-11** Single-service deployment: the API serves the frontend's static build from the same origin (first-party cookie) with SPA fallback for non-`/api` routes.
- **RNF-12** Environment variables validated at startup (fail-fast with a clear message).
- **RNF-13** Project reproducible from scratch: versioned migrations + seed bring up a complete environment locally, in CI, and in production with no manual steps.
- **RNF-14** Multi-stage Docker image for production; local development environment startable with a single command.
- **RNF-15** CI on every PR (lint, typecheck, tests, build, docker build) and automatic deployment to production on merge to `main`.

### 4.3 Quality and maintenance

- **RNF-16** npm workspaces monorepo (`apps/api`, `apps/web`, `packages/shared`) with root scripts: `dev`, `build`, `start`, `test`, `typecheck`, `lint`.
- **RNF-17** Strict TypeScript and ESLint in all packages.
- **RNF-18** Test pyramid: unit (services, permission matrix), API integration against a real Postgres (RLS isolation, availability invariant, per-route authz), and frontend with Vitest + React Testing Library + MSW, colocated with the code.
- **RNF-19** UI in English (the application's user interface language is English); single styling stack (Tailwind CSS + Headless UI); accessibility as a review criterion.

## 5. Business rules

| ID | Rule |
|---|---|
| RN-01 | A user has exactly one role. The Platform Admin belongs to no store; manager and employee belong to exactly one. Role↔store consistency is a structural constraint. The store assignment is **immutable after creation** and role changes never cross it (manager ↔ employee only): an event author's profile never migrates out of the store where their events live, which is what keeps authors readable there (`database.md` §7.3) — "moving" a user is deactivate + create (RF-11). |
| RN-02 | The catalog (categories, products, and their sizes) is global and unique; only the Platform Admin modifies it. Any authenticated user can read it. |
| RN-03 | Availability data is the exclusive property of each store: no operation can read or modify another store's assortment, availability events, or replenishment lists. |
| RN-04 | A size appears at most once in a store's assortment and at most once per replenishment list. |
| RN-05 | `is_available` changes only through availability events: **no API endpoint accepts `is_available` as an editable field**. The event history is **immutable**, and `is_available` always equals the state implied by the item's latest event (no events → available). The only write path is the events service, which inserts the event and updates the flag in the **same transaction** (an invariant verified by integration tests, including under concurrency). |
| RN-06 | Event type semantics: `out_of_stock` ("Out of stock") and `restock` ("Restocked"). An event carries nothing but its type, its author and its timestamp — no quantity and no note: availability is binary and REPMA records no unit counts anywhere (RN-05). |
| RN-07 | An item is out of stock when its latest availability event is `out_of_stock`; an item with no events is available. |
| RN-08 | Products, sizes, and stores are never physically deleted: they are deactivated. An inactive product or size does not admit new assortment additions but remains visible wherever it already exists. |
| RN-09 | Deleting a replenishment list deletes its items (cascade). Deleting a user never alters the availability events they created. |
| RN-10 | Slugs (stores, categories) are unique and generated by the application from the name. |
| RN-11 | Every product has at least one size: the API rejects creation without sizes (400). Non-sized products are created with a single "One size" entry via the preset (RF-38) — a creator's choice, never an API default. The business SKU belongs to the size and is unique across all sizes. |
| RN-12 | A replenishment list only references sizes in the store's assortment: the schema enforces it structurally (composite FK to the assortment, `database.md` §4.9) and the API validates it first for a clean error. Assortment membership — not product/size activity — is the criterion: an inactive size already in the assortment can still be added to a list (RN-08). |
| RN-13 | An assortment item can be removed (RF-44) only while nothing references it: no availability events and no replenishment list items. Both conditions are structural (RESTRICT FKs, `database.md` §4.6); the API validates them first for a clean 409. An item with history is permanent — no removal ever deletes an event. |
| RN-14 | An item's event history is **strictly alternating**: an event whose type matches the state implied by the item's latest event (RN-07) is rejected (409). A redundant flag records nothing anyone consumes, and accepting it would reset the aging clock — aging is measured from the latest `out_of_stock` event (DP-07, RF-24), which this rule keeps equal to the start of the current outage. The check runs inside the events service's single write transaction (RN-05), serialized by the row lock the flag update already takes; verified by the concurrency integration test (two simultaneous same-type flags → exactly one event, one 409). |

## 6. Out of scope for the MVP

Anticipated evolutions the design must allow without restructuring, but which are not part of the initial scope:

- Quantity-tracked stock (a movement ledger with running balances) — **deliberately excluded**: quantities cannot stay truthful without POS integration; the availability model replaces it.
- A user belonging to multiple stores with different roles.
- Public per-store catalog (URLs without login).
- Self-service store signup.
- Transfers of merchandise between stores.
- Distributed rate limiting (Redis) and observability metrics.
- Full E2E with Playwright (a minimal smoke test is considered optional in the final phase).
