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
| AD-21 | Product sizes (resolves PD-01) | **`product_sizes` (formerly "product variants") adopted into the MVP**, between `products` and `assortment_items`: label ("42"/"M"/"One size"), **per-size unique SKU** (moved off `products`), `position`, `is_active`. Every product has ≥1 size ("One size" for non-sized products), enforced by the API. Assortment items, availability events, out-of-stock flags, and replenishment list items are **per size**. The catalog — sizes included — remains 100% global and Platform-Admin-managed (AD-07 unchanged). Size presets (Clothing XS–2XL, Footwear 36–45, "One size") live as shared constants in `packages/shared` for UI prefill. | The replenishment UX requires choosing the size visually, which is only coherent if availability itself is tracked per size; placing the SKU at size level matches retail reality. |
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
│   │       ├── app/                  # router, providers (QueryClient, AuthContext), guards
│   │       ├── components/           # design system: Button, Table, EmptyState/ErrorState/LoadingState…
│   │       ├── lib/                  # apiClient (credentials include), queryClient, toasts
│   │       └── features/             # mirror of the backend: auth/, catalog/, availability/,
│   │           └── <feature>/        #   replenishment/, platform-admin/
│   │               ├── api.ts        #   typed fetch with schemas from shared
│   │               ├── hooks.ts      #   React Query (queries + mutations + invalidation)
│   │               └── components/   #   presentation
│   └── …
├── packages/
│   └── shared/                       # Zod request/response schemas + types + constants
│                                     # (permissions, roles, states, size presets) used by api and web
├── supabase/                         # local CLI config + seed.sql
├── docs/                             # ADRs and additional documentation
├── .github/workflows/ci.yml
├── Dockerfile                        # single production image (api serves web/dist)
└── docker-compose.yml                # optional: documented alternative to `supabase start`
```

**Dependency rules** (verified in the review of each phase):

- `modules/*` may import from `core/`, `db/`, `lib/`, `shared` — never from another module (if two modules need the same thing, promote it to `core/` or expose an explicit service).
- `core/` does not import from `modules/` (it knows nothing about the domain).
- `web/features/*` only imports from `components/`, `lib/`, `shared`, and itself.
- `shared` imports from no one (leaf of the graph).

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

### 3.4 Frontend

- **React 19 + Vite + TypeScript**, React Router, TanStack Query (server state; no additional global store — session state lives in a context fed by `GET /auth/me`), Tailwind CSS v4 + Headless UI, UI in English.
- **Guards by permission, not by role**: `shared` exports the same permission matrix the API uses; `<RequirePermission p="catalog:manage">` decides routes and action visibility. The API remains the authority (the UI guard is UX, not security).
- **Active store**: for manager/employee it is implicit (their store). The Platform Admin has a store selector; the choice is sent as the `X-Tenant-Id` header on tenant-scoped calls (§5.2).
- Uniform pattern per feature: `api.ts` (typed fetch) → `hooks.ts` (React Query with invalidation) → `components/` (presentation).

Route map:

| Route | Access |
|---|---|
| `/login`, `/` (landing, built in the final polish phase per DP-01) | Public |
| `/home` → store home (greeting header + figures card, out-of-stock products with their size run and aging, a bounded table of up to 7 open replenishment lists — RF-25) | manager, employee (Platform Admin with a store selected) |
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
- **Seed**: 1 Platform Admin, 2 stores with manager+employee, generic catalog (~6 categories, ~40 products with their sizes: size runs for apparel/footwear, "One size" for the rest), and per-store assortments with some sizes flagged out of stock, each with an event history of alternating out-of-stock and restock events.

---

## 5. Multi-tenancy

### 5.1 Model

Shared schema (AD-01): the tenant is a column with an RLS policy on every tenant-scoped table. The catalog and users are global by product design (AD-07/08).

### 5.2 Tenant context in the request

1. `authenticate` validates the Supabase JWT (HttpOnly cookie takes priority, `Bearer` as fallback) verifying the signature locally against JWKS (AD-20) and loads `user_profiles` (inactive user or store → 401). Loading the profile establishes the **identity context** `{ userId, role, tenantId }`: for store users `tenantId` is always their own store — which is also what lets the API verify that store's `is_active` under RLS on any route, since the `tenants` SELECT policy allows a store to see its own row (`database.md` §7.3); for the Platform Admin it is empty.
2. `tenantContext` resolves the **active tenant**. An endpoint's tenant scope is an **explicit per-router declaration, never an inference**: tenant-scoped routers (`availability`, `replenishment`, `home`) mount `tenantContext`; global routers (`auth`, `tenants`, `users`, `catalog`) do not mount it and never resolve an **active** tenant — store users still carry their identity `tenantId` from step 1, and for the Platform Admin it stays empty. With the middleware mounted:
   - `manager`/`employee` → always their `tenant_id` (a different `X-Tenant-Id` header is a 403; no ambiguity is possible).
   - `platform_admin` → requires `X-Tenant-Id` (validating that the tenant exists and is active); no header → 400.
3. The `{ userId, role, tenantId }` context is stored in `AsyncLocalStorage` — available at any layer without passing it as parameters.
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

A single module (`packages/shared/permissions.ts`, consumed by `core/authz` and by the UI) defines permissions and the matrix. No one writes `role === 'x'` outside of it.

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

All routes: `authenticate` + per-user rate limit + `authorize` (login and health skip auth and are limited per IP — RNF-07). Pagination `page`/`pageSize` (default 20, max 100) with `{ items, page, pageSize, total }`. Errors: `{ error: { code, message, details? } }`.

| Family | Endpoints | Permission |
|---|---|---|
| Health | `GET /health` (liveness + DB ping) | public |
| Auth | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` (user + role + tenant + permissions) | public login with strict rate limit |
| Tenants | `GET/POST /tenants`, `GET/PATCH /tenants/:id` (PATCH includes `is_active`) | `tenant:manage` |
| Users | `GET/POST /users`, `GET/PATCH/DELETE /users/:id` (creation = Supabase Auth admin + profile, transactional-compensated; PATCH optionally carries a new `password` — a write-only reset via Supabase Auth admin, RF-11) | `user:manage` |
| Catalog | `GET /categories`, `GET /products` (embeds each product's sizes; filters `categoryId`, `search`, `isActive` + pagination; `search` matches product name + size SKU) | `catalog:read` |
| | `POST/PATCH /categories/:id?`, `POST/PATCH /products/:id?` (POST requires ≥1 size), `POST /products/:id/sizes`, `PATCH /products/:id/sizes/:sizeId` (no delete — sizes are soft-deactivated via `is_active`), `POST /products/:id/image` (multipart 5MB → Storage) | `catalog:manage` |
| Availability | `GET /availability` (assortment **grouped by product** with the full size run nested and each size's latest-event timestamp for aging — AD-22, DP-07; a page is a page of products; filters `outOfStock=true`, `search`, `categoryId`, `productId` (one or more ids — the `/catalog` cross-reference, RF-18); `search` matches product name + size SKU), `GET /availability/:id` (one size), `GET /availability/:id/events` | `availability:read` |
| | `GET /availability/events` (store-wide feed, reverse chronological, optional `from`/`to` — RF-23; its consumers are the Activity page, RF-42, and Home's recent-activity block, RF-25) | `activity:read` |
| | `POST /availability` (add a catalog size to the assortment via `sizeId`), `DELETE /availability/:id` (remove an unreferenced item — no events, no list lines, RF-44/RN-13; otherwise 409) | `assortment:manage` |
| | `POST /availability/:id/events` (`type` `out_of_stock` \| `restock` — the whole payload, RN-06; the API derives the new `is_available` flag; an event matching the current state → 409, RN-14) | `availability:flag` |
| Replenishment | `GET /replenishment-lists` (paginated; filters `status` — one or more of `draft,processing,done` —, `search` on name, and `from`/`to` on `created_at`; each list carries `itemCount`, `productCount` and `doneCount`), `GET /replenishment-lists/:id` | `replenishment:read` |
| | `POST /replenishment-lists` (manual only — name + optional notes; no generation from availability flags, DP-06), `PATCH /replenishment-lists/:id`, `DELETE /replenishment-lists/:id`; items managed per item with immediate persistence (RF-28/RF-40): `POST /replenishment-lists/:id/items` (`{sizeId, quantity}` — the size must be in the store's assortment, RN-12), `PATCH /replenishment-lists/:id/items/:itemId` (`quantity` and/or `isDone`), `DELETE /replenishment-lists/:id/items/:itemId` | `replenishment:manage` |
| Home | `GET /home/summary`: the figures Home's figures card needs, in one response — `{ openLists, pendingItems, outOfStock }` (RF-41: open lists — `draft` or `processing` —, unchecked items across all open lists, out-of-stock sizes) | `availability:read` |

The Availability, Replenishment, and Home routes are tenant-scoped (§5.2). One domain, one name: each aggregate uses the same naming in DB, API, modules, and frontend. Inside the availability router, `GET /availability/events` is registered **before** `GET /availability/:id` — with Express matching in declaration order, the reverse would capture `events` as an `:id`.

`GET /home/summary` exists because its figures are not derivable from a list endpoint without extra round-trips: `pendingItems` aggregates over **all** open lists (not the 7 rows Home shows), and `openLists` / `outOfStock` would each cost a count query of their own. Returning the three together gives Home's figures card a single loading state. The earlier `categories` and `productsInStore` counts were dropped with the stat-card grid, and `agedBeyondBand` with the one-sentence summary (RF-41): figures with no remaining consumer. `GET /replenishment-lists` gains a `status` filter and per-list `itemCount` / `doneCount` because Home's open-work block (RF-25) is a real consumer of both: it queries `status=draft,processing&pageSize=7` and renders each line's compact `done/total` fraction ("6/14"). Multiple values are accepted (comma-separated) so "open work" is one query, not two; the filter rides the existing `(tenant_id, created_at DESC)` index (`database.md` §Indexes). The counts also feed the `/replenishment` card's size and progress lines (`design/pages/replenishment.md`). That index adds three more parameters for the same reason — a real consumer, never symmetry: `search` (name, `ILIKE` per `database.md` §Indexes) and `from`/`to` back its filter band, and `productCount` — `COUNT(DISTINCT product_id)` over the list's sizes — is the only figure on the card that cannot be composed client-side, because items reference sizes and never products (`database.md` §4.9). The date range needs no new index: it is a range on the second column of the existing `(tenant_id, created_at DESC)` index. The endpoint is guarded by `availability:read` — Home's route guard; every store role also holds `catalog:read` and `replenishment:read`, so the figures expose nothing their holder could not already read. That sufficiency is a property of the **current** matrix: any future narrowing of `replenishment:read` must revisit this endpoint's guard, or the summary would leak counts its holder can no longer list.

---

## 8. Non-functional requirements

- **Security**: HttpOnly cookie `SameSite=Lax` `Secure` in prod; helmet with CSP (`img-src` for Storage); CORS allowlist with credentials; body ≤100 kb, images ≤5 MB; rate limit on **all** families, keyed per authenticated user (reads 100/min, writes 30/min, shop-floor writes — flag events RF-20 + item autosave RF-28/RF-40 — 120/min; the public routes per IP — login 10/min, health under the read limit — RNF-07: store staff share one NAT'd IP); Zod whitelist validation on body/query/params; forced RLS (§5.3); `trust proxy`.
- **Errors**: typed `AppError` + central handler; Zod errors are mapped to 400 with per-field issues; unexpected errors → opaque 500 + structured log (pino) with request id.
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
| User creation = two systems (Auth + profile) | Compensated operation in `users/service`: if the profile fails, the created auth user is deleted; integration test for the failure case. |
| Disorderly code growth | Dependency rules of §3.2 reviewed at the close of each phase; modules with no cross-imports; one domain = one name across all layers. |
