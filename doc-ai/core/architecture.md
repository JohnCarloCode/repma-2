# REPMA — System Architecture (architecture.md)

> Technical design of REPMA, a multi-tenant availability and replenishment platform. Date: 2026-08-15.
> Related documents: `spec.md` (requirements) and `database.md` (database architecture).

---

## 1. Product vision

REPMA is a **generic multi-store availability and replenishment platform**:

- A **Platform Admin** administers the entire platform: stores (tenants), users, and the **global catalog** of categories and products.
- Each **store (tenant)** has its own users (**manager** / **employee**) and its **own assortment and availability state** on top of the global catalog.
- A product exists **exactly once** in the catalog, together with its **sizes** (such as "42" or "M", or a single "One size" entry for non-sized items); each store decides which sizes it offers (assortment), and staff flag which of them are out of stock — quantities are never counted or displayed. E.g.: "Nike Air Max" exists once with sizes 36–45; in Store A size 42 is available, in Store B it is flagged **out of stock** (none left anywhere in the store, stockroom included), and Store C does not offer it at all. Replenishment lists are a separate, manual working document — never derived from the out-of-stock flags (DP-06).

The goal of the project is not the number of features but **demonstrating engineering quality**: React, TypeScript, Node.js, REST API, PostgreSQL, authentication, RBAC, multi-tenancy, validation, testing, Docker, and CI/CD with a clean architecture proportional to the real size of the project.

---

## 2. Architecture decisions (log)

Decisions made explicitly with the product owner. Each one is binding for the implementation.

| ID | Decision | Choice | Rationale |
|---|---|---|---|
| AD-01 | Multi-tenant isolation | **Shared schema + `tenant_id` + PostgreSQL RLS** | Defense in depth: even if an application query forgets the filter, the DB blocks cross-tenant access. Testable in an automated way. |
| AD-02 | Identity and files | **Supabase Auth** (identity/JWT) and **Supabase Storage** (product images) | Managed identity and storage; the DB is Supabase's Postgres but is accessed via direct connection (not PostgREST). |
| AD-03 | Data access | **Drizzle ORM** (direct Postgres connection) | TS-first, transparent SQL, versioned migrations, compatible with RLS and per-transaction context because it does not hide the connection. |
| AD-04 | Availability model | **Immutable availability-event ledger + cached `is_available` flag** | Quantities cannot stay truthful without POS integration, so the product records **observed availability** instead: staff flag sizes as out of stock and register restocks; the current `is_available` flag is derived from the latest event. Keeps the immutable-ledger engineering pattern — derived state, single write path, concurrency tests. *Note: this supersedes the former quantity ledger (movement ledger + cached quantity).* |
| AD-05 | Backend framework | **Express 5** | No framework magic: the layers are defined by the project, which is exactly what we want to demonstrate. |
| AD-06 | Role model | **Global Platform Admin** (outside the tenants) + store roles **manager** and **employee**. There is no "store admin". | Platform-style operation: central administration, local operation. |
| AD-07 | Catalog | **100% global**, editable only by the Platform Admin. The manager manages their store's **assortment** (which sizes it offers) and, like the employee, operates the availability flags. | No product duplication across stores. |
| AD-08 | User management | **Only the Platform Admin** creates/edits/deactivates users (platform and store users). | Centralization decided by product; managers do not manage users. |
| AD-09 | Membership | **A user belongs to exactly one store** (direct FK), **fixed at creation**: the store is not editable and role changes never cross it (manager ↔ employee only) — moving a user is deactivate + create (RF-11/RN-01). The Platform Admin belongs to none and can operate on any of them (store selector). | Simplicity of the session model and of the isolation; immutability keeps event authors readable in the store where their events live (`database.md` §7.3); multi-membership remains a future evolution. |
| AD-10 | Public access | **Everything behind login.** Public: only landing and login. No public signup (users are created by the Platform Admin). | Internal B2B tool. |
| AD-11 | CI/CD | **GitHub Actions** (lint + typecheck + tests + build + docker build per PR) + **automatic deploy to Render** on merge to `main` (single-service). | Full demonstrable cycle at zero cost. |
| AD-12 | Session | **HttpOnly cookie** carrying the Supabase token, managed by the API: the frontend never sees the token nor talks to Supabase. | Immune to exfiltration via XSS; centralizes authentication in the API. |
| AD-21 | Product sizes (resolves PD-01) | **`product_sizes` adopted into the MVP**, between `products` and `assortment_items`: label ("42"/"M"/"One size"), **per-size unique SKU** (moved off `products`), `position`, `is_active`. Every product has ≥1 size ("One size" for non-sized products), enforced by the API. Assortment items, availability events, out-of-stock flags, and replenishment list items are **per size**. The catalog — sizes included — remains 100% global and Platform-Admin-managed (AD-07 unchanged). Size presets (Clothing XS–2XL, Footwear 36–45, "One size") live as shared constants in `packages/shared` for UI prefill (`SIZE_PRESETS` — `{ clothing, footwear, oneSize }`, each `{ name, labels }`, key order = button order — and `ONE_SIZE_LABEL` in `catalog.ts`; the seed builds its size runs from them). | The replenishment UX requires choosing the size visually, which is only coherent if availability itself is tracked per size; placing the SKU at size level matches retail reality. |
| AD-22 | Availability listing shape | **`GET /availability` returns products with their size run nested**: a page is a page of **products**, not of sizes, and `outOfStock=true` selects products with at least one size out of stock while still returning the complete run. Availability is the only listing with this shape; every other endpoint keeps the flat `{ items, page, pageSize, total }` envelope. | The sellable unit is the size, but the *legible* unit on the shop floor is the product's whole size run: "this model is missing 38 and 42" is one fact, not two rows scattered in a 240-row table. A flat size list also splits a run across page boundaries, destroying exactly the reading the page exists for. The deviation is contained to one endpoint and its envelope still paginates. |
| AD-23 | Session lifetime | **Transparent refresh in the API**: the HttpOnly cookie carries the Supabase access **and refresh** tokens; when a request arrives with an expired access token, the API refreshes it against Supabase, re-issues the cookie, and the request proceeds. A failed refresh (revoked or expired refresh token) clears the cookie and returns 401. | Completes AD-12/AD-20: the frontend still never sees a token, JWKS verification stays local, and revocation remains covered by the per-request profile load — while a store shift is never interrupted by a mid-work re-login (the access token's short lifetime, which AD-20 relies on, stays short). |

### Minor decisions (made by the architect, revocable at no cost)

| ID | Decision | Choice |
|---|---|---|
| AD-13 | Input validation | **Zod** at the HTTP edge (body/query/params), with schemas shared api↔web via the `shared` package. |
| AD-14 | Monorepo | **npm workspaces**: `apps/api`, `apps/web`, `packages/shared`. No Turborepo/Nx (unnecessary at this scale). |
| AD-15 | Testing | **Vitest** in all three packages. API: unit + integration with supertest against real Postgres (local Supabase stack). Web: Vitest + React Testing Library + MSW. |
| AD-16 | Rate limiting | In-memory behind a `RateLimitStore` interface (replaceable by Redis without touching consumers). The limitation is documented. |
| AD-17 | Identifiers | `uuid` (`gen_random_uuid()`) as PK in all tables: prevents enumeration across tenants and simplifies seeds. |
| AD-18 | HTTP verbs | `PATCH` for every partial update; `PUT` only for full replacements of a set. |
| AD-19 | Request context | `AsyncLocalStorage` for the authenticated context (user, role, active tenant); DB operations run inside a transaction that sets that context with `set_config(..., true)` for the RLS policies. |
| AD-20 | JWT verification | **Local against JWKS**: the signature of the Supabase token (asymmetric keys) is verified in the API with `jose` against the project's JWKS endpoint (derived from `SUPABASE_URL`), with key caching. No network call per request (`auth.getUser()` is not in the hot path); effective revocation is covered by the profile load from the DB on every request (user and store `is_active`) + the short lifetime of the access token. |

### Pending decisions (do not block the start)

| ID | Question | Status |
|---|---|---|
| PD-02 | E2E with Playwright | Proposal: minimal E2E smoke (login + one availability flow) in the final phase of the project; it will be decided then based on value/cost. |
| PD-03 | Tenant suspension | **Resolved**: the deactivate/reactivate flow is part of the MVP — RF-08 (PATCH with `is_active`) and the confirm flow in `design/pages/platform-tenants.md`. `tenants.is_active` exists from day 1, as anticipated. |

---

## 3. System architecture

### 3.1 Overview

```text
┌──────────────┐  fetch /api/v1/*  ┌────────────────────┐  drizzle (pg, repma_api role,  ┌─────────────────────┐
│  apps/web    │  HttpOnly cookie  │  apps/api          │  RLS ACTIVE, per-tx context)   │  Supabase           │
│  React 19 +  │ ────────────────► │  Express 5 + TS    │ ─────────────────────────────► │  · Postgres (data)  │
│  Vite + RQ + │ ◄──────────────── │  routes→controllers│                                │  · Auth  (identity) │
│  Tailwind    │       JSON        │  →services→repos   │  supabase-js (admin API):      │  · Storage (imgs)   │
└──────────────┘                   └────────────────────┘  JWT verification, user        └─────────────────────┘
        ▲                                    │             creation, image uploads
        └── packages/shared (Zod schemas + API types) ──────┘
```

Principles:

1. **The API is the only gateway to the data.** The frontend never talks to Supabase; it contains no secrets.
2. **Two paths to Supabase, each with its own role:** **data** goes over a direct Postgres connection with a dedicated `repma_api` role **subject to RLS** (not `service_role`); **identity/file** operations (verifying JWT, creating users, uploading images) go through `supabase-js` with the service role, encapsulated in `lib/supabase`.
3. **The tenant context flows through the entire request** (§5.2): middleware → AsyncLocalStorage → transaction with local context → RLS policies. No layer has to "remember" to filter by tenant manually: the DB guarantees it.
4. **Declarative, centralized authorization** (§6): a single module defines the permission→role matrix; routes and UI consume permissions, never compare roles.
5. **Thin, symmetric layers**, no speculative abstractions: no generic repositories, event buses, or CQRS. Complexity must be justified by a real requirement.

### 3.2 Monorepo structure

```text
repma-2/
├── apps/
│   ├── api/
│   │   └── src/
│   │       ├── app.ts                # Express composition (middlewares + routers), exportable for tests
│   │       ├── server.ts             # bootstrap (listen on port, signals, shutdown)
│   │       ├── config/               # env validated with Zod; fails at startup if anything is missing
│   │       ├── db/                   # Drizzle client, schema/, migrations/, withTenantContext()
│   │       ├── core/                 # cross-cutting, domain-FREE:
│   │       │   ├── errors.ts         #   typed AppError {status, code, message, details}
│   │       │   ├── auth/             #   authenticate (cookie/Bearer → Supabase JWT), session
│   │       │   ├── authz/            #   permissions: matrix, authorize(permission), types
│   │       │   ├── tenant/           #   active tenant resolution + AsyncLocalStorage
│   │       │   ├── http/             #   validate(zodSchema), pagination, responses
│   │       │   └── rateLimit/        #   limiter + RateLimitStore (in-memory)
│   │       ├── lib/supabase.ts       # supabase-js admin client (auth admin + storage)
│   │       └── modules/              # ONE directory per domain aggregate:
│   │           ├── auth/             #   login/logout/me
│   │           ├── tenants/          #   router.ts / controller.ts / service.ts / repository.ts
│   │           ├── users/            #   (each module, same 4 pieces + *.test.ts next to the code)
│   │           ├── catalog/          #   categories + products + sizes + images
│   │           ├── availability/     #   assortment_items + availability_events + out-of-stock
│   │           ├── replenishment/    #   lists + items (manual only, DP-06)
│   │           └── home/             #   Home summary (RF-41): read-only — three COUNTs in one transaction
│   ├── web/
│   │   └── src/
│   │       ├── App.tsx               # router (AppRoutes), providers
│   │       ├── auth/                 # AuthContext (GET /auth/me), RouteGuard/RequirePermission, role homes
│   │       ├── tenant/               # active store: useStoreScope() (§3.4)
│   │       ├── components/           # design system + shared UI: shell/, list/, availability/, replenishment/,
│   │       │                         #   Modal, Sheet, ProductPicker, FormField…
│   │       ├── lib/                  # apiClient (credentials include), queryClient, toasts, formatting
│   │       ├── pages/                # one component per route (+ its tests), queries/mutations inline
│   │       ├── styles/ · assets/     # theme tokens, font faces, icon subset list (icons.json) · self-hosted fonts
│   │       └── test/                 # MSW server + render helpers
│   └── …
├── packages/
│   └── shared/                       # Zod request/response schemas + types + constants
│                                     # (permissions, roles, states, size presets) used by api and web
├── supabase/                         # local CLI config (config.toml; the seed lives in apps/api/src/db/seed)
├── doc-ai/                           # product, architecture, database, design and plan docs
├── .github/workflows/                # ci.yml, deploy.yml, seed.yml
└── Dockerfile                        # single production image (api serves web/dist)
```

**Dependency rules** (enforced by ESLint `no-restricted-imports` in `eslint.config.js`, so `npm run check` fails on a violation):

- `modules/*` may import from `core/`, `db/`, `lib/`, `shared` — never from another module (if two modules need the same thing, promote it to `core/` or expose an explicit service).
- `core/`, `db/`, `lib/` and `config/` do not import from `modules/` (they know nothing about the domain).
- `shared` imports from no workspace (leaf of the graph).
- Web, runtime code (tests may render the whole `AppRoutes`): only `main.tsx` imports `App.tsx`; `pages/` is imported only by `App.tsx` and by other pages (a page may split into sibling files, e.g. `PlatformProductsTab` ↔ `platformProductCommon`); `components/`, `auth/`, `tenant/`, `styles/` never import `pages/`; `lib/` never imports `components/` either (it holds no UI). `auth/`, `tenant/` and `lib/` may use each other (session, active store and the query client are wired together), which is why the web rules are about direction toward `pages/`/`App`, not a strict layer stack.

### 3.3 Responsibilities per layer (backend)

| Layer | Does | Does not do |
|---|---|---|
| `router.ts` | Declares paths and chains middlewares: `authenticate → rateLimit → tenantContext → authorize(perm) → controller` (the limiter keys per user, RNF-07, so it needs the identity; login mounts its own per-IP limiter pre-auth) | Logic |
| `controller.ts` | Validates input (Zod from `shared`), calls the service, shapes the HTTP response | Business rules, SQL |
| `service.ts` | Business rules and orchestration (transactions across repos, domain invariants) | HTTP, direct SQL |
| `repository.ts` | Drizzle queries. All operations run inside `withTenantContext` | Business rules |
| `core/*` | Auth, authz, tenant, errors, validation, rate limit, pagination | Knowing the domain |

Pipeline of a request:

```text
helmet → cors(allowlist) → json(100kb) → /api/v1 router
  → authenticate → rateLimit(per user) → tenantContext → authorize(permission)   # login: rateLimit(per IP) pre-auth
  → controller(validate) → service → repository(withTenantContext: BEGIN; set_config(...); …; COMMIT)
  → JSON | AppError → central errorHandler (404 handler included)
```

After `/api/v1`, the API serves `apps/web/dist` (RNF-11, `core/http/web.ts`; mounted only when the build exists — in dev Vite serves the web): static files, then `index.html` for any other GET outside `/api` (SPA fallback), so unknown `/api/*` routes still reach the JSON 404. Cache: `assets/*` (content-hashed by Vite) `max-age=1y, immutable`; `index.html` `no-cache`. Same origin (in dev too, via Vite's `/api` proxy), so the session cookie is first-party and the CORS allowlist (`FRONTEND_URLS`) is not on the path of the app's own requests.

### 3.4 Frontend

- **React 19 + Vite + TypeScript**, React Router, TanStack Query (server state; no additional global store — session state lives in a context fed by `GET /auth/me`), Tailwind CSS v4 + Headless UI, UI in English.
- **Guards by permission, not by role**: `shared` exports the same permission matrix the API uses; `<RequirePermission p="catalog:manage">` decides routes and action visibility. The API remains the authority (the UI guard is UX, not security).
- **Active store**: for manager/employee it is implicit (their store). The Platform Admin has a store selector; the choice is sent as the `X-Tenant-Id` header on tenant-scoped calls (§5.2). Every tenant-scoped call goes through `useStoreScope()` (`apps/web/src/tenant/activeStore.ts`): its query key is `['store', storeId, …]` and its request options carry `X-Tenant-Id` only for a selected store — so store roles never send it and switching store can drop the previous store's cache by prefix.
- Uniform pattern per page: one `pages/<Name>Page.tsx` per route holds its queries and mutations inline (TanStack Query over `lib/apiClient`, keys from `useStoreScope()` for tenant-scoped data, invalidation by key prefix) and composes the presentational pieces of `components/`; a component moves to `components/` once a second page needs it. No per-feature `api.ts`/`hooks.ts` layer exists (§3.1: no layer without a consumer).

Route map:

| Route | Access |
|---|---|
| `/login`, `/` (landing, DP-01; a signed-in visitor is sent to the role home) | Public |
| `/home` → store home (greeting header + KPI strip, out-of-stock products with their size run and aging, a bounded table of up to 7 open replenishment lists — RF-25) | manager, employee (Platform Admin with a store selected) |
| `/activity` → store-wide availability-events feed, paginated with date filters (RF-42) | `activity:read` (all roles, §6) |
| `/availability` (sidebar "Availability"; products with their size run, out-of-stock sizes marked in the run and aged per DP-07), `/availability/:id` (single size: detail + event history), `/replenishment`, `/replenishment/:id` | per permission matrix |
| `/catalog` (browse + add to assortment) | `assortment:manage` — manager-only page (§6); the employee keeps `catalog:read` for the ProductPicker (RF-39) but has no catalog route |
| `/platform/tenants`, `/platform/users`, `/platform/catalog` | Platform Admin only |
| `/unauthorized`, `*` → redirect | — |

---

## 4. Data model (summary)

The full design — tables, constraints, indexes, RLS policies, DB roles, and seed — lives in **`database.md`**, which is the authoritative reference. The essentials:

```text
        GLOBAL (Platform Admin)                            PER STORE (tenant-scoped)
┌────────────┐   ┌──────────┐   ┌──────────────────┐    ┌──────────────────┐   ┌─────────────────────┐
│ categories │──►│ products │──►│ product_sizes    │───►│ assortment_items │──►│ availability_events │
└────────────┘   └──────────┘   │ (label + unique  │    │ (assortment +    │   │ (immutable ledger)  │
┌────────────┐   ┌─────────────┐│  SKU + position) │    │  is_available)   │   └─────────────────────┘
│  tenants   │──►│user_profiles│└──────────────────┘    └──────────────────┘   ┌───────────────────────┐
└────────────┘   │(1:1 auth.   │                                               │ replenishment_lists   │
                 │users, role  │                                               │  └─ *_list_items      │
                 │+ store)     │                                               └───────────────────────┘
                 └─────────────┘
```

- **Global**: `tenants`, `user_profiles` (1:1 with `auth.users`; CHECK for role↔store coherence), `categories`, `products` (soft delete via `is_active`), `product_sizes` (AD-21: label — "42", "M", "One size" —, **unique SKU per size**, `position`, `is_active`; every product has ≥1 size, "One size" for non-sized products, enforced by the API).
- **Tenant-scoped** (`tenant_id NOT NULL` + RLS): `assortment_items` (referencing `size_id` — availability is tracked **per size**; UNIQUE `(tenant_id, size_id)`, `is_available` flag; no quantity, no threshold), `availability_events` (immutable ledger: INSERT/SELECT only; `type` `out_of_stock` | `restock` and nothing else — no quantity, no note, RN-06 —, `created_by` with `SET NULL` to survive deletion of the author, `created_at`), `replenishment_lists` and `replenishment_list_items` (per size; UNIQUE `(list_id, size_id)`; a list only references sizes in the store's assortment — composite FK `(tenant_id, size_id)` → `assortment_items`, RN-12). The `tenant_id` is denormalized into the child tables so the RLS policies are direct comparisons without joins.
- **Availability invariant (AD-04)**: `assortment_items.is_available` = the state implied by the **latest** `availability_events` entry (`restock` → available, `out_of_stock` → not available; no events → available). The only way to modify `is_available` is the events service, which in a single transaction inserts the event and updates the flag — and rejects an event matching the current state (409, RN-14), so the ledger is strictly alternating. Verified by integration tests, including the concurrent case. Explicit rule at the HTTP edge: **no endpoint edits `is_available`; it only changes via events** (the Zod whitelist rejects it on every write schema).
- **Seed**: 1 Platform Admin, 2 stores with manager+employee, generic catalog (~6 categories, ~40 products with their sizes: size runs for apparel/footwear, "One size" for the rest), per-store assortments with some sizes flagged out of stock, each with an event history of alternating out-of-stock and restock events, and product images in the Storage bucket (database.md §9).

---

## 5. Multi-tenancy

### 5.1 Model

Shared schema (AD-01): the tenant is a column with an RLS policy on every tenant-scoped table. The catalog and users are global by product design (AD-07/08).

### 5.2 Tenant context in the request

1. `authenticate` validates the Supabase JWT (HttpOnly cookie takes priority, `Bearer` as fallback) verifying the signature locally against JWKS (AD-20) and loads `user_profiles` (inactive user or store → 401). Loading the profile establishes the **identity context** `{ userId, role, tenantId }`: for store users `tenantId` is always their own store — which is also what lets the API verify that store's `is_active` under RLS on any route, since the `tenants` SELECT policy allows a store to see its own row (`database.md` §7.3); for the Platform Admin it is empty.
2. `tenantContext` resolves the **active tenant**. An endpoint's tenant scope is an **explicit per-router declaration, never an inference**: tenant-scoped routers (`availability`, `replenishment`, `home`) mount `tenantContext`; global routers (`auth`, `tenants`, `users`, `catalog`) do not mount it and never resolve an **active** tenant — store users still carry their identity `tenantId` from step 1, and for the Platform Admin it stays empty. With the middleware mounted:
   - `manager`/`employee` → always their `tenant_id` (a different `X-Tenant-Id` header is the uniform 403 `FORBIDDEN` of §6; no ambiguity is possible).
   - `platform_admin` → requires `X-Tenant-Id` (validating that the tenant exists and is active); no header → 400 `TENANT_REQUIRED`; a malformed id, an unknown store or an inactive one → one 400 `INVALID_TENANT` (the client cannot tell which — the selector's stored choice is simply no longer usable).
3. The `{ userId, role, tenantId }` context is stored in `AsyncLocalStorage` — available at any layer without passing it as parameters. `authenticate` runs the rest of the request under the identity context (what global routers use); `tenantContext` replaces it with the active tenant on tenant-scoped routers.
4. `db/withTenantContext(fn)` opens a transaction and sets the context with transaction scope:
   ```sql
   BEGIN;
   SELECT set_config('app.user_id',   '<uuid>', true);  -- true = local to the transaction
   SELECT set_config('app.role',      '<role>', true);
   SELECT set_config('app.tenant_id', '<uuid>', true);  -- empty on platform routes
   -- … queries for the request …
   COMMIT;
   ```
   Every repository query runs inside it. The context dies with the transaction — safe with a connection pool.

Three independent safety nets against a misclassified endpoint: (1) a tenant-scoped repository invoked without `tenantId` in the context **fails closed** (`withTenantContext` requires it and throws an error, never degrades to "no filter"); (2) if a query nonetheless reached the DB without context, the RLS policies using `current_setting(…, true)` return 0 rows (deny-by-default); (3) the integration suite covers both cases per table.

### 5.3 RLS: defense in depth

Summary (full policies in `database.md` §7):

- The API connects with a dedicated Postgres role **`repma_api`**: `NOSUPERUSER`, **without** `BYPASSRLS`, with minimal GRANTs per table and operation. Supabase's `service_role` is not used for data.
- RLS `ENABLE` + `FORCE` on all tables; the policies read the context with `current_setting('app.…', true)`, so the absence of context is **deny-by-default**.
- Tenant-scoped tables: `tenant_id = context` in USING and WITH CHECK. The Platform Admin has no bypass: to operate inside a store it sets its tenant like any member — one access path, one path to test.
- Catalog: read for any authenticated context; write only `platform_admin`. Ledger: no UPDATE/DELETE policies or GRANTs — immutable via two independent layers.
- The PostgREST roles `anon`/`authenticated` are revoked: Supabase's REST API is not a gateway to the data.
- **Mandatory isolation tests**: the integration suite sets tenant A's context and attempts to read/write every tenant-scoped table of tenant B, expecting 0 rows or an error. It is the most important test of the project and blocks the build.

---

## 6. Authorization (RBAC)

A single module (`packages/shared/src/permissions.ts`, consumed by `core/authz` and by the UI) defines permissions and the matrix. No one writes `role === 'x'` outside of it.

```ts
// permissions as typed constants: 'resource:action'
type Permission =
  | 'tenant:manage' | 'user:manage'
  | 'catalog:read' | 'catalog:manage'
  | 'assortment:manage'                       // adding a size to the store's assortment
  | 'availability:read' | 'availability:flag'
  | 'activity:read'                           // store-wide availability-events feed (RF-23/RF-42)
  | 'replenishment:read' | 'replenishment:manage';

const rolePermissions: Record<Role, readonly Permission[]> = {
  platform_admin: [/* all */],
  manager:  ['catalog:read', 'assortment:manage', 'availability:read',
             'availability:flag', 'activity:read', 'replenishment:read',
             'replenishment:manage'],
  employee: ['catalog:read', 'availability:read', 'availability:flag',
             'activity:read', 'replenishment:read', 'replenishment:manage'],
};
```

- Backend: `authorize('availability:flag')` as per-route middleware; uniform 403 `FORBIDDEN`.
- Frontend: `hasPermission(session, p)` for guards and action visibility.
- Evolution (explicit requirement): adding a permission = 1 line in the type + cells in the matrix; adding a role = 1 column. The matrix has a unit snapshot test so that any change is deliberate and reviewed — a matrix edit is therefore always a two-file change (matrix + snapshot).
- `activity:read` is currently held by **all** roles, so it discriminates nobody. It stays a permission of its own on purpose: it gates a distinct endpoint (RF-23) whose cost profile differs from the per-item history, and narrowing it later — a plausible product move — is then one cell instead of a refactor. Recorded so the redundancy reads as a decision, not an oversight.
- The `/catalog` **page** is guarded by `assortment:manage`, not `catalog:read` (RF-35). `catalog:read` cannot make the page manager-only: every store role holds it because the ProductPicker (RF-39) reads `GET /categories` from the replenishment flow — that flow's grid reads the assortment via `GET /availability`, while the `GET /products` grid belongs to the assortment flow (`design/shared/product-picker.md` §Consumers). The page's purpose is growing the assortment — manager work — so its guard is the assortment permission; no new permission and no matrix change were needed. Page guards and endpoint guards may legitimately differ: the endpoint permission protects the data, the route guard reflects who the page is for.
- Sharp distinction: **authn** (who you are — Supabase JWT), **membership** (which store you belong to — `tenantContext`), **authz** (what you can do — this matrix). Three middlewares, three responsibilities.

Initial matrix:

| Permission | platform_admin | manager | employee |
|---|:-:|:-:|:-:|
| tenant:manage | ✔ | — | — |
| user:manage | ✔ | — | — |
| catalog:read | ✔ | ✔ | ✔ |
| catalog:manage | ✔ | — | — |
| assortment:manage | ✔ | ✔ | — |
| availability:read | ✔ | ✔ | ✔ |
| availability:flag (out-of-stock / restock events) | ✔ | ✔ | ✔ |
| activity:read (store-wide events feed) | ✔ | ✔ | ✔ |
| replenishment:read | ✔ | ✔ | ✔ |
| replenishment:manage | ✔ | ✔ | ✔ |

---

## 7. API surface (`/api/v1`)

All routes: `authenticate` + per-user rate limit + `authorize` (login and health skip auth and are limited per IP — RNF-07). This section is the surface's source of truth: `apps/api/src/app.surface.test.ts` parses every `METHOD /path` written here and fails if the app serves a route this section does not mention or vice versa; the same test asserts each route's single limiter family (RNF-07) and its `validate()` calls (RNF-08) from the router stacks. Pagination `page`/`pageSize` (default 20, max 100) with `{ items, page, pageSize, total }`. Errors: `{ error: { code, message, details? } }`.

| Family | Endpoints | Permission |
|---|---|---|
| Health | `GET /health` (liveness + DB ping) | public |
| Auth | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` (user + role + store + permissions — shape below) | login public with strict rate limit; logout/me authenticated only (no permission) |
| Tenants | `GET/POST /tenants`, `GET/PATCH /tenants/:id` (`GET /tenants` filter `search` + pagination, `search` matches the store name — `ILIKE` substring —, ordered by name, inactive stores included; every route answers stores as `{ id, name, slug, isActive, createdAt }`, typed as `Tenant` in `shared`. `POST /tenants` body `createTenantBody` — `{ name }` only (trimmed, 1–120 chars; `slug`/`isActive` keys → 400); the slug is generated from the name by `apps/api/src/core/slug.ts` `slugify` (RN-10: NFKD, accents stripped, lowercase ASCII letters/digits joined by single hyphens — the same util serves categories); a name yielding an empty slug → `400 VALIDATION_ERROR` on `name` "Name must contain letters or numbers"; a taken slug → `409 CONFLICT` "A store with an equivalent name already exists" (detected via `ON CONFLICT DO NOTHING` on the UNIQUE, never auto-suffixed); **201** with the new, active store. `PATCH /tenants/:id` body `updateTenantBody` — any of `name`, `isActive` (the API's camelCase for `is_active`); an empty body is a 400; the **slug is read-only and stable: a rename never regenerates it**, so PATCH has no 409; **200** with the updated store; deactivation takes effect on the store users' next request (RF-05, §5.2 step 1). `GET`/`PATCH /tenants/:id`: unknown id → `404 NOT_FOUND` "Store not found". Reads on the read limiter, POST/PATCH on the write limiter; global router — no `X-Tenant-Id`) | `tenant:manage` |
| Users | `GET/POST /users`, `GET/PATCH/DELETE /users/:id` (every route answers users as `{ id, email, fullName, role, isActive, tenant: { id, name, isActive } \| null, createdAt }`, typed as `User` in `shared` — `email` is the profile's denormalized copy, `tenant` the user's store (null for the Platform Admin, RN-01; `isActive` so the UI can flag a deactivated store). `GET /users` query `userListQuery`: pagination, `search` — a literal `ILIKE` substring of the full name **or** the email (RF-09) —, store filter `tenantId` (uuid; an unknown store is just an empty page); every user listed, inactive ones and those of deactivated stores included, ordered by full name (id tiebreak). `GET /users/:id`: unknown id → `404 NOT_FOUND` "User not found". Global router — no `X-Tenant-Id`; reads on the read limiter, writes on the write limiter. `POST /users` (RF-10) body `createUserBody` (strict): `email` (trimmed + lowercased — the profile's copy matches what Auth stores), `password` (8–72 characters, never trimmed; only ever sent to Supabase Auth — never stored, logged or returned), `fullName` (trim 1–120), `role`, `tenantId` (uuid). RN-01 coherence lives in the shared schema, so it is a 400 `VALIDATION_ERROR` on `tenantId` before anything is written ("Select a store" for manager/employee without one, "A Platform Admin does not belong to a store"); the store must exist ("Store not found") **and be active** ("This store is inactive" — a deactivated store's users could not sign in, RF-05; the create form offers active stores only), both 400 on `tenantId`. A taken email → `409 CONFLICT` "A user with this email already exists" (Auth's `email_exists`, or the profile's UNIQUE as backstop). 201 → the new `User`, re-read from the profile. Creation = Supabase Auth admin (identity confirmed, no email flow — DP-01) then the profile, compensated (§9): if the profile insert fails the identity is deleted and the original error surfaces (a failed compensation is raised as its own 500 naming the orphan identity); `PATCH /users/:id` (RF-11) body `updateUserBody` (strict, non-empty): any of `fullName` (trim 1–120), `role`, `isActive`, `password` (same rules as on create — a **write-only reset** via Supabase Auth admin `updateUserById`, never stored, logged or returned; omitted = unchanged). Email and store are immutable, so `email`/`tenantId` are unknown keys → 400. Role changes are manager ↔ employee only (RN-01): a store user to `platform_admin` → 400 on `role` "A store user cannot become a Platform Admin", a Platform Admin to a store role → 400 on `role` "A Platform Admin's role cannot be changed" (the unchanged role is a no-op; the DB CHECK is the backstop). Deactivating one's own account → `409 CONFLICT` "You cannot deactivate your own account" (RF-12; checked first, nothing written). Order: every check, then the password in Auth, then the profile — Auth first because it is the step that can still reject (its password policy → 400 on `password`) before anything is written; no compensation exists (an old password can't be restored), so a profile failure after a reset is a 500 and repeating the request converges (both steps idempotent). Deactivation touches nothing in Auth (no ban): the per-request profile check makes it effective on the user's next request (RF-05, AD-20). **200** → the updated `User`. `DELETE /users/:id` (RF-12): deleting one's own account → `409 CONFLICT` "You cannot delete your own account"; the identity is hard-deleted via Supabase Auth admin `deleteUser`, the profile falls by the `auth.users` cascade and the user's availability events and replenishment lists stay with `created_by = NULL` (RN-09 — every FK to `user_profiles` is `SET NULL`, none can block it, database.md §4.7/§4.8); **204**; the deleted user's still-valid token gets 401 (no profile). Both: unknown id → 404 "User not found"; no query params; write limiter) | `user:manage` |
| Catalog | `GET /categories` (paginated, ordered by name, no filters; items `{ id, name, slug, description }` — `description` null when empty —, typed as `Category` in `shared` — its consumers, the `/availability` category filter, the ProductPicker rail and `/platform/catalog`'s Categories tab, read it whole with `pageSize=100`), `GET /products` (RF-15: embeds each product's sizes; filters `categoryId`, `search`, `isActive` + pagination, intersected; `search` matches product name + the SKU of any of its sizes, inactive ones included — `ILIKE` substring, blank = no filter; `isActive` accepts only `true`/`false`, on the product's own flag, absent = both; no sort param — ordered by name, id as tiebreaker; items `{ id, name, description, imageUrl, categoryId, categoryName, isActive, sizes: [{ id, label, sku, position, isActive }] }` — every size, inactive ones flagged, in `position` order (label breaks ties) —, typed as `Product` in `shared`, query `productListQuery`; read limiter, global — no `X-Tenant-Id`. Consumers: the ProductPicker's assortment flow, which skips inactive products/sizes itself (RN-08), `/catalog`'s table + slide-over and `/platform/catalog`, all without a per-product fetch) | `catalog:read` |
| | `POST /categories` body `createCategoryBody` — `{ name, description? }` (name trimmed, 1–120 chars; description trimmed, ≤500 chars, blank or null stored as null; `slug` key → 400); the slug is generated by `slugify` exactly as for stores (RN-10): a name yielding an empty slug → `400 VALIDATION_ERROR` on `name` "Name must contain letters or numbers", a taken slug → `409 CONFLICT` "A category with an equivalent name already exists" (`ON CONFLICT DO NOTHING`, never auto-suffixed); **201** `Category`. `PATCH /categories/:id` body `updateCategoryBody` — any of `name`, `description` (null/blank clears it); empty body → 400; **the slug is read-only and stable, as a store's: a rename never regenerates it, so PATCH has no 409**; unknown id → `404 NOT_FOUND` "Category not found"; **200** `Category`. **No delete route** (RF-14). Both take no query params, write limiter, global — no `X-Tenant-Id`. `POST /products` (RF-16) body `createProductBody` — `{ name, description?, categoryId, sizes: [{ label, sku, position? }] }` (name trimmed 1–120; description trimmed ≤2000, blank/null → null; label trimmed 1–40; SKU trimmed 1–64; position an integer 0–9999, omitted = the row's index in `sizes`; strict at every level, so `imageUrl`/`isActive` or a size's `isActive`/`id` → 400 — the image is uploaded after creation, RF-17, and everything starts active). **`sizes` must hold ≥1 entry** (RN-11; at most 50) → 400 on `sizes` "Add at least one size"; a label repeated within the body → 400 on the repeating row's `sizes.N.label` "This label is already used" (the `(product_id, label)` UNIQUE, database.md §4.5, checked by the shared schema so the form reuses it); an unknown category → 400 on `categoryId` "Category not found". A SKU already held by any size, or repeated within the body (the later row), → `409 CONFLICT` whose `details` name every offending row — `[{ path: 'sizes.N.sku', message }]`, message "SKU X is already in use" / "SKU X is repeated in this product", the top-level message being the first one — so the sizes editor marks the rows. Product and sizes are written in **one transaction**; the sizes go in one `INSERT … ON CONFLICT (sku) DO NOTHING` and any skipped row rolls the whole create back (race-safe: a concurrent create of the same SKU gets the same 409). **201** with the product in the `GET /products` item shape (`Product`, sizes embedded and ordered as there). `PATCH /products/:id` body `updateProductBody` — any of `name`, `description`, `categoryId`, `isActive` (camelCase for `is_active`: `false` = soft retire, `true` = reactivate — RF-16/RN-08: the product's sizes, every store's assortment items, events and list lines are untouched, and `POST /availability` then rejects its sizes, "This product is inactive"); sizes (RF-37) and the image (RF-17) have their own routes, so `sizes`/`imageUrl` are unknown keys → 400; an empty body → 400; unknown category → 400 on `categoryId`; unknown id → `404 NOT_FOUND` "Product not found"; **200** `Product`. Both take no query params, write limiter, global — no `X-Tenant-Id`. `POST /products/:id/sizes` (RF-37) body `createProductSizeBody` — `{ label, sku, position? }` (same field rules as a `POST /products` size, strict, so `isActive`/`id` → 400; a new size starts active); an omitted position goes **after the product's last size** (`MAX(position) + 1` over all its sizes, inactive ones included); unknown product → `404 NOT_FOUND` "Product not found"; **201**. `PATCH /products/:id/sizes/:sizeId` body `updateProductSizeBody` — any of `label`, `sku`, `position`, `isActive` (camelCase for `is_active`: `false` = soft deactivate, `true` = reactivate — RN-08: the size's assortment items, events and list lines are untouched and `POST /availability` then rejects it, "This size is inactive"); empty body → 400; the size must belong to the product — an unknown product, an unknown size and another product's size all answer `404 NOT_FOUND` "Size not found"; **200**. **No delete route** (RF-37, RN-08). Both answer the **whole `Product`** (the `GET /products` item, sizes embedded) so the client replaces the product in its cache in one go. Conflicts are **409 on the field**, detected by the UNIQUEs themselves (race-safe; the first violated one, so one field per answer): a label the product already has → `[{ path: 'label', message: 'This label is already used' }]`, a SKU any other size holds → `[{ path: 'sku', message: 'SKU X is already in use' }]`, the top-level message being the detail's; re-sending a size's own label/SKU is no conflict. (`POST /products` reports a label repeated *within its body* as a 400 instead: that one is a schema check the form reuses; a clash with a stored row is a 409, like a SKU.) Both take no query params, write limiter, global — no `X-Tenant-Id`. `POST /products/:id/image` (RF-17) — `multipart/form-data` with **one file in the `image` field** and nothing else, parsed by `multer` (memory storage; mounted on this route only, after `authorize`, so the global 100 kb JSON/urlencoded parsers never see it). Limits (RNF-06): **≤5 MB** → `413 PAYLOAD_TOO_LARGE` "The image cannot exceed 5 MB" with `details: [{ path: 'image', … }]` (the API's envelope, never Express's default); the type is decided **by content** — JPEG (`FF D8 FF`) or PNG signature; the client's mimetype and file name are ignored — else `400 VALIDATION_ERROR` on `image` "The image must be a JPEG or PNG file" (an empty file included); no file → 400 on `image` "Select an image to upload" (a JSON body included); a second file → 400 on `image` "Upload a single image"; a file under another field or any text part → 400 "Unknown field" on that name; a malformed multipart body → 400 on `image` "The upload could not be read". Unknown product → `404 NOT_FOUND` "Product not found" (checked before uploading; nothing is stored). The bytes go through `lib/supabase` (service role, AD-02) to the **public `product-images` bucket** under the key **`<productId>/<uuid>.<jpg|png>`** with the detected Content-Type and a one-year `Cache-Control`: a new key per upload, so a replacement is a new URL (cache-busting, no stale CDN/browser copy) and objects are immutable. The public URL (`<SUPABASE_URL>/storage/v1/object/public/product-images/<key>`) is written to `products.image_url` under a row lock that also reads the replaced URL; that previous object is then deleted **only if it lies under this product's own folder** (seed or foreign URLs are never touched), best effort — a failed delete leaves a harmless orphan, never fails the upload; an object whose product vanished mid-upload is removed and the answer is 404. A Storage failure (e.g. a missing bucket) is an opaque 500, logged as "Product image upload failed: …". **200** with the whole `Product` (`imageUrl` set). No query params; write limiter; global — no `X-Tenant-Id`. There is no delete-image route (MVP). Bucket: declared in `supabase/config.toml` (public, 5 MiB, JPEG/PNG — mirrors the API's limits), so `supabase start` creates it locally and in CI; production creates it by hand (plan Manual 8-A) | `catalog:manage` |
| Availability | `GET /availability` (assortment **grouped by product** with the full size run nested and each size's latest-event timestamp for aging — AD-22, DP-07; a page is a page of products; filters `outOfStock=true`, `search`, `categoryId`, `productId` (one or more ids, **comma-separated in a single param** like `status` on `GET /replenishment-lists` — at most 100, the page-size cap; repeats tolerated; an empty/non-uuid entry or a repeated param → 400 — the `/catalog` cross-reference, RF-18); `search` matches product name + size SKU — only the SKUs of sizes the store carries —, `ILIKE` substring; `outOfStock` accepts only `true`; filters intersect; no sort param — the order is RF-18's, ties by product name then id; items `{ id, name, imageUrl, categoryName, isActive, sizes: [{ id, sizeId, label, sku, isAvailable, isActive, latestEventAt }] }` — `id` of a size is the assortment item (the `/availability/:id` target), `sizeId` the catalog size, `latestEventAt` the item's latest event timestamp or null with no events (RN-07), the outage start while out of stock (RN-14, DP-07) —, typed as `AvailabilityProduct` in `shared`; the envelope's `total` counts products), `GET /availability/:id` (one size — the list's size shape plus its product's identity without the run: `{ id, sizeId, label, sku, isAvailable, isActive, latestEventAt, product: { id, name, imageUrl, categoryName, isActive } }`, typed as `AvailabilityItem` in `shared`; everything the detail page's summary card renders; it takes no query — any parameter → 400), `GET /availability/:id/events` (RF-21: paginated, `created_at DESC` with id as tiebreaker, no filters; items `{ id, type, createdAt, authorName }` — the feed's event without the item identity, `authorName` null for a deleted author, RN-09 —, typed as `AvailabilityItemEvent` in `shared`; an item with no events is an empty page). Both take a uuid `:id` (malformed → 400); an unknown id and another store's item answer the same `404 NOT_FOUND` "Item not found" (RN-03 — under RLS a foreign item is no row) | `availability:read` |
| | `GET /availability/events` (store-wide feed, reverse chronological — `created_at DESC`, id as tiebreaker —, optional `from`/`to` — RF-23: ISO 8601 timestamps with an explicit offset, both bounds **inclusive** on `created_at`, an inverted range simply matches nothing; the client maps calendar days to local start/end-of-day timestamps; items `{ id, type, createdAt, authorName, item: { id, productName, sizeLabel } }` — `authorName` null for a deleted author, RN-09 —, typed as `AvailabilityFeedEvent` in `shared`; its consumers are the Activity page, RF-42, and Home's recent-activity block, RF-25) | `activity:read` |
| | `POST /availability` (RF-19: body `{ sizeId }` and nothing else — `addAssortmentItemBody` in `shared`; `is_available` or any other key → 400, RF-22; no query; the store comes from the request context; the item starts available with no events. Answers **201 with the new item** in the `GET /availability/:id` shape (`AvailabilityItem`, `latestEventAt: null`) so its consumers can patch caches or link to `/availability/:id` without a refetch. A rejected reference is a **400 `VALIDATION_ERROR` on `sizeId`**, like a list line outside the assortment (RN-12): "This size is not in the catalog" (unknown id), "This product is inactive" / "This size is inactive" (RN-08 — the product checked first); a size the store already carries → `409 CONFLICT` "This size is already in the assortment" (RN-04, race-safe via the UNIQUE + `ON CONFLICT DO NOTHING`)), `DELETE /availability/:id` (RF-44: no query; **204**; the item row is locked `FOR UPDATE` before the RN-13 checks, which serializes it against a concurrent flag or list line; history checked first — `409 CONFLICT` "This size has availability history and cannot be removed", then "This size is on a replenishment list and cannot be removed"; an unknown or foreign id → the same `404 NOT_FOUND` "Item not found" as the reads, RN-03). Both on the write limiter (RNF-07) | `assortment:manage` |
| | `POST /availability/:id/events` (`type` `out_of_stock` \| `restock` — the whole payload, RN-06, body typed `availabilityEventBody` in `shared`; `is_available` or any other key → 400, RF-22; no query; the API derives the new `is_available` flag; shop-floor limiter, RNF-07). Answers **201 with the updated item** — the `GET /availability/:id` shape (`AvailabilityItem`), its `latestEventAt` being the new event's timestamp — so the detail page settles its summary card from the response and only invalidates the history, the list and the feed. An event matching the current state → `409 CONFLICT` "This size is already out of stock" / "…already available" (RN-14 — the message names the state the item is in); an unknown or foreign id → the same `404 NOT_FOUND` "Item not found" as the reads (RN-03) | `availability:flag` |
| Replenishment | `GET /replenishment-lists` (RF-26: paginated, `created_at DESC` with id as tiebreaker, no sort param; filters intersect — `status` one or more of `draft,processing,done` **comma-separated in a single param** (`status=draft,processing`; repeats tolerated; an empty/unknown value or a repeated `status` param → 400), `search` on name (`ILIKE` substring, blank = no filter), `from`/`to` on `created_at` with the same timestamp rules as `GET /availability/events` (ISO 8601 with offset, both inclusive, an inverted range matches nothing); items `{ id, name, status, createdAt, creatorName, itemCount, productCount, doneCount }` — `creatorName` null for a deleted creator (RN-09), `productCount` = distinct products among the list's sizes —, typed as `ReplenishmentListSummary` in `shared`), `GET /replenishment-lists/:id` (no query — any parameter → 400; `{ id, name, status, createdAt, creatorName, notes, items: [{ id, sizeId, sizeLabel, sku, quantity, isDone, product: { id, name, categoryId, categoryName } }] }`, typed as `ReplenishmentList` in `shared`; items ordered by product name, then product id — two same-named products never interleave —, then size `position` (RF-26); `id` of an item is the list line (the `…/items/:itemId` target), `sizeId` the catalog size (the picker's disabled set, RN-04), `quantity` the requested quantity; progress is derived from the items). A uuid `:id` (malformed → 400); an unknown id and another store's list answer the same `404 NOT_FOUND` "List not found" (RN-03) | `replenishment:read` |
| | `POST /replenishment-lists` (manual only — `{ name, notes? }` and nothing else: no origin/generation key or query param exists, so any extra key is a 400 (DP-06); the store and author come from the request context; the list starts empty and `draft`; **201** with the new list in the `ReplenishmentList` detail shape, `items: []`), `PATCH /replenishment-lists/:id` (any of `name`, `notes`, `status` — free transitions, RF-30; an **empty body is a 400**; **200** with the updated list in the `ReplenishmentList` detail shape, items included, so the detail can replace its cache), `DELETE /replenishment-lists/:id` (**204**; items go by `ON DELETE CASCADE`, RN-09). Body rules (`createReplenishmentListBody` / `updateReplenishmentListBody` in `shared`): `name` trimmed, 1–120 chars; `notes` trimmed, ≤ 2000 chars, blank or `null` stored as `null`. An unknown id and another store's list answer the same `404 NOT_FOUND` "List not found" (RN-03). List writes ride the **write** limiter family. Items are managed per item with immediate persistence (RF-28/RF-40) on the **shop-floor** limiter family (RNF-07), each a uuid `:id`/`:itemId` (malformed → 400) with no query: `POST /replenishment-lists/:id/items` (`{ sizeId, quantity? }` — `quantity` defaults to 1, RF-27; no other key, so `isDone`/`tenantId`/`is_available` → 400; the line takes the list's store and starts `isDone: false`; **201** with the line in the `ReplenishmentListItem` shape, the same object the detail's `items` holds), `PATCH /replenishment-lists/:id/items/:itemId` (`quantity` and/or `isDone`; an **empty body is a 400**; **200** with the updated `ReplenishmentListItem`; the list's own row and `updated_at` are not touched), `DELETE /replenishment-lists/:id/items/:itemId` (**204**). Body rules (`addReplenishmentListItemBody` / `updateReplenishmentListItemBody`, `itemParams` in `shared`): `quantity` an integer **1–9999** (the bound only rejects typos). Checks in order: the list — unknown or another store's → `404 NOT_FOUND` "List not found" (RN-03); then, on POST, assortment membership (RN-12 — membership only: an inactive product/size still assorted is accepted, RN-08; availability state is never consulted, DP-06) → `400 VALIDATION_ERROR` "This size is not in the store's assortment" with `details: [{ path: 'sizeId', … }]` (the composite FK stays the structural backstop); then the size already on the list → `409 CONFLICT` "This size is already on the list" (RN-04, via `ON CONFLICT DO NOTHING` on the UNIQUE, so a concurrent duplicate gets the same answer); on PATCH/DELETE a line that is not on that list (unknown, removed elsewhere, another list's) → `404 NOT_FOUND` "Item not found". The target list is locked `FOR KEY SHARE` for the transaction, so a concurrent list delete can't turn a line write into a raw FK error | `replenishment:manage` |
| Home | `GET /home/summary`: the figures Home's KPI strip needs, in one response — `{ openLists, pendingItems, outOfStock }`, typed as `HomeSummary` in `shared` (RF-41: open lists — `draft` or `processing` —, unchecked items (`is_done = false`) across all open lists, out-of-stock **sizes** — assortment items with `is_available = false`, inactive products/sizes included since they stay assorted and flagged (RN-08) — never products: Home's "View all (N)" for out-of-stock evidence takes its product total from the `GET /availability?outOfStock=true` envelope instead). Read limiter; no query — any parameter → 400. Three `COUNT`s in one `withTenantContext` transaction, RLS-scoped to the active store; the list and availability counts never join each other (DP-06) | `availability:read` |

The Availability, Replenishment, and Home routes are tenant-scoped (§5.2). One domain, one name: each aggregate uses the same naming in DB, API, modules, and frontend. Inside the availability router, `GET /availability/events` is registered **before** `GET /availability/:id` — with Express matching in declaration order, the reverse would capture `events` as an `:id`.

Why these endpoint shapes (each parameter has a real consumer — never symmetry):

- **Auth** (RF-01/02/03): `GET /auth/me` → `{ user: { id, email, fullName }, role, store: { id, name } | null, permissions }` — exactly what the shell shows (user menu name + role label, the store name for store roles; `store` is null for the Platform Admin, whose tenant comes from the selector) plus the guards' input (`permissions` = `rolePermissions[role]`, §6); typed as `AuthSession` in `shared`. `POST /auth/login` (body `loginBody` from `shared`) answers 200 with that same session and sets the cookie — never a token in the body. Wrong credentials, a deactivated user, a user of a deactivated store or a user without a profile all get one uniform `401 INVALID_CREDENTIALS` (`design/pages/login.md`). `POST /auth/logout` → 204 clearing the cookie (RF-03); it does not revoke the Supabase session. Limits: login per IP (login family) pre-auth; logout per user as a write, me per user as a read.

- `GET /home/summary`: see RF-41. Guarded by `availability:read` (Home's route guard); every store role also holds `catalog:read` and `replenishment:read`, so it exposes nothing its holder couldn't already read. **Any future narrowing of `replenishment:read` must revisit this guard**, or the summary would leak counts its holder can no longer list.
- `GET /replenishment-lists`: `status` (multi, comma-separated) + per-list `itemCount`/`doneCount` serve Home's open-work block (`status=draft,processing&pageSize=7`, "6/14" fractions) and the `/replenishment` cards; `search` (name, `ILIKE`) and `from`/`to` back that page's filter band; `productCount` (`COUNT(DISTINCT product_id)`) is the only card figure not composable client-side, since items reference sizes, not products (`database.md` §4.9). All ride the existing `(tenant_id, created_at DESC)` index.

---

## 8. Non-functional requirements

- **Security**: HttpOnly cookie `SameSite=Lax` `Secure` in prod (one `repma_session` cookie whose value is the JSON `{ accessToken, refreshToken }`, AD-12/AD-23); helmet with CSP (`img-src 'self' <Storage origin>` — the origin derived from `SUPABASE_URL`, where the `product-images` bucket's public URLs live, RNF-04); CORS allowlist with credentials; body ≤100 kb (JSON/urlencoded — an oversize body → `413 PAYLOAD_TOO_LARGE`, malformed JSON → `400 VALIDATION_ERROR`, both in the error envelope), images ≤5 MB (multipart, only on `POST /products/:id/image`, JPEG/PNG by magic bytes); rate limit on **all** families, keyed per authenticated user (reads 100/min, writes 30/min, shop-floor writes — flag events RF-20 + item autosave RF-28/RF-40 — 120/min; the public routes per IP — login 10/min, health under the read limit — RNF-07: store staff share one NAT'd IP); Zod whitelist validation on body/query/params on **every** route through `validate()` with a `shared` schema — a route with no query or params still validates an empty object (`emptyQuery`), so any unexpected parameter is a 400; bodiless routes (GET, DELETE, `POST /auth/logout`) never read the body; forced RLS (§5.3); `trust proxy`.
- **Errors**: typed `AppError` + central handler; Zod errors are mapped to 400 with per-field issues; unexpected errors → opaque 500 + structured log (pino) with request id; credentials (`Cookie`, `Authorization`, `Set-Cookie`) are redacted from request logs.
- **Config**: `config/env.ts` validates with Zod at startup (fail-fast). Variables: `DATABASE_URL` (`repma_api` role), `SUPABASE_URL` (from which the JWKS endpoint is derived, AD-20), `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` (password login and token refresh, AD-23 — never used for data), `PORT`, `FRONTEND_URLS`, `NODE_ENV`.
- **Testing** (pyramid):
  - Unit (Vitest): services with fake repos, permission matrix, mappers, utils. Fast, no network.
  - API integration (Vitest + supertest + real Postgres from the local stack): auth/authz per route, **RLS isolation**, availability invariant (`is_available` derived from the latest event; same-type event rejected per RN-14 — including two concurrent flags: one event, one 409), cascades and uniques.
  - Frontend (Vitest + RTL + MSW): hooks and components of each feature, permission guards.
  - E2E smoke (PD-02, optional): login → flag a size out of stock → the event appears in the history.
- **Docker**: multi-stage `Dockerfile` (build workspaces → slim image serving API + web static assets). Development: `supabase start` (official local stack in Docker) + `npm run dev`.
- **CI/CD** (GitHub Actions): on every PR `lint → typecheck → test (unit + integration with local stack + migrations) → build → docker build`. On merge to `main`: deploy to Render (single-service). CI caches npm and fails red on any step.

---

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Cross-tenant leak via a badly written query | Forced RLS + role without bypass + isolation suite in CI (fails the build). |
| Flag/events divergence | Single write path (events service, transactional: event insert + flag update in one transaction; the flag update's row lock also serializes the same-type rejection, RN-14) + concurrency test. |
| Supabase dependency in tests/CI | Official local stack (`supabase start`) in dev and CI; JWT verification is encapsulated in `core/auth` and is replaceable. |
| User creation = two systems (Auth + profile) | Compensated operation in `users/service`: if the profile fails, the created auth user is deleted; integration test for the failure case. User edit with a password reset = two systems too, with no possible compensation: Auth is written first (the only step that can still reject), then the profile; a later profile failure is a 500 that a retry of the same request resolves (§7, Users row). Deletion is one Auth call — the profile cascades. |
| Disorderly code growth | Dependency rules of §3.2 reviewed at the close of each phase; modules with no cross-imports; one domain = one name across all layers. |
