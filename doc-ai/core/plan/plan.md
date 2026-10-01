# REPMA — Build plan (plan.md)

> Roadmap and progress tracker. Phases and sub-tasks are checked off as they close. Decisions never live here — they live in `core/` by ID; this file only sequences them. The session-by-session diary is `journal.md`; the execution ritual is `prompts_plan.md` Prompt 2.
> **Green criterion** (used by every sub-task and by Prompt 2): `npm run check` passes — lint + typecheck + all tests in all workspaces (integration tests require the local Supabase stack to be up: `supabase status`). One commit per closed sub-task.

## Standing rules (apply to every sub-task; each phase's audit re-checks them)

- **Every API endpoint ships with**: (a) Zod request schemas in `packages/shared`, whitelisting body/query/params with per-field issues, consumed by api and web (RNF-08, AD-13) — write schemas reject `is_available` everywhere (RF-22, RN-05); (b) the correct rate-limit family mounted on its router — read 100/min, write 30/min, shop-floor 120/min, login 10/min per IP (RNF-07, AD-16) — asserted by test; (c) per-route authn/authz integration tests: 401 unauthenticated, 403 without the permission (RNF-18); (d) the `{items, page, pageSize, total}` envelope where it lists (availability's grouped envelope is the sole documented deviation, AD-22); (e) tenant-scoping tests where tenant-scoped; (f) `PATCH` for partial updates (AD-18).
- **Every UI sub-task**: English copy (RNF-19); permission gates via `<RequirePermission>`/`hasPermission`, never `role === 'x'` (RF-32); shared Loading/Empty/Error states and conventions from `design/shared/components.md`; filter/page state in the URL; the page doc is the spec and is read before building.
- **Interim states are explicit**: this plan ships some pages before their neighbors exist. Each interim is named in its sub-task and closed by a named later sub-task. The two structural ones: **role home** evolves `/activity` (2.2) → `/availability` (3.7) → `/home` for store roles (5.3) and `/platform/tenants` for platform_admin (7.5), reaching `login.md`'s final state; **seed image URLs are NULL** (placeholder thumbs) until the bucket exists (8.8 restores full `database.md` §9).
- Tests are colocated with the code (RNF-18); test fixtures for integration tests are created per-suite against the local stack, independent of the demo seed.

---

## Phase 1 — Foundations: DB, RLS, auth, CI, deploy (L)

**Objective:** the hardest, least-visible layer first — schema + forced RLS with the isolation suite blocking the build, the auth stack, and a deployed API answering `/health`, so every later phase only adds verticals on a proven base.
**Scope:** AD-01, AD-02, AD-03, AD-05, AD-09(schema), AD-11, AD-12, AD-13(core), AD-14, AD-15, AD-16, AD-17, AD-19, AD-20, AD-23; RF-01, RF-02, RF-03, RF-04, RF-05, RF-43; RN-01(schema), RN-03, RN-04(schema), RN-05(DB layers), RN-06(schema), RN-09(schema), RN-11(seed), RN-12(schema), RN-13(schema); RNF-01, RNF-02, RNF-03, RNF-04, RNF-05, RNF-06, RNF-07(core), RNF-08(core), RNF-09, RNF-10, RNF-12, RNF-13, RNF-14, RNF-15, RNF-16, RNF-17.
**Starting state:** repo contains only docs. Verify: `node -v` (≥ 22), `git status` clean.

### Manual setup 1-A — local tools (do before sub-task 1.2)

1. **Docker Desktop**: download from docker.com → install → open it and wait for "Docker Desktop is running". *Verify:* `docker info` prints server details. If you see "Cannot connect to the Docker daemon", the app isn't running — open it.
2. **Homebrew** (likely present): *Verify:* `brew --version`. If missing, install per brew.sh.
3. **Supabase CLI**: `brew install supabase/tap/supabase`. *Verify:* `supabase --version` prints a version.
4. **psql**: `brew install libpq && brew link --force libpq`. *Verify:* `psql --version`. If "command not found", the link step didn't run.
5. **Node ≥ 22**: *Verify:* `node -v`. Install via brew/nvm if older.

### Sub-tasks

- [x] **1.1 Monorepo scaffold** (M) — npm workspaces `apps/api`, `apps/web`, `packages/shared` (AD-14); strict TS + ESLint in all three (RNF-17); Vitest everywhere (AD-15); root scripts `dev`, `build`, `start`, `test`, `typecheck`, `lint` and **`check`** (= lint+typecheck+test — the plan's green criterion) (RNF-16, RNF-14 single-command dev). Tests: a trivial test per workspace proves the pipeline. Verify: `npm run check` green.
- [x] **1.2 Local Supabase stack + Drizzle wiring** (M) — `supabase init`/config, `supabase start` documented; Drizzle client + drizzle-kit migrations pipeline (AD-03) with `db:migrate` script; **creates `.env` and versioned `.env.example`** (local `DATABASE_URL`, admin migration URL for local use, `REPMA_API_PASSWORD` for the bootstrap script — 1.4). Verify: `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c 'select 1'`.
- [ ] **1.3 Schema migration** (M) — one migration: the 3 enums (`database.md` §5), all 9 tables exactly per §4 — uuid PKs (AD-17), role↔tenant CHECK (RN-01/DP-03), denormalized `email` (§4.2) and `tenant_id` (§7.3 note), `product_sizes` (AD-21), UNIQUEs (`(tenant_id,size_id)`, `(list_id,size_id)`, SKU — RN-04), composite FK `(tenant_id,size_id)`→assortment (RN-12), RESTRICT/CASCADE/SET NULL exactly per §4 (RN-09, RN-13), `quantity_requested > 0` CHECK, `set_updated_at` trigger except the ledger (§6), all §8 indexes. No aging column exists (DP-07 is derived). Tests: migration applies on a fresh DB; constraint smoke tests (unique/CHECK/FK violations).
- [ ] **1.4 Security migration + role bootstrap** (M) — `repma_api` created **NOLOGIN, NOSUPERUSER, no BYPASSRLS** in a versioned migration with the exact GRANT table of §7.1; RLS ENABLE+FORCE on all 9 tables with the §7.3 policies verbatim (no UPDATE/DELETE on the ledger); `REVOKE ALL` + default privileges for `anon`/`authenticated` (§7.4). **Password never in a versioned file**: `npm run db:bootstrap` runs `ALTER ROLE repma_api LOGIN PASSWORD :'pwd'` reading `REPMA_API_PASSWORD` from `.env` (prod uses dashboard SQL — Manual 1-B). Local username is plain `repma_api` (the `.<project-ref>` qualifier is a cloud-pooler thing). Verify: `psql "$DATABASE_URL" -c 'select 1'` connects as `repma_api`, and `psql "$DATABASE_URL" -c 'select count(*) from tenants;'` returns **0** (deny-by-default, no context).
- [ ] **1.5 API skeleton** (M) — Express 5 (AD-05): `app.ts`/`server.ts`, `config/env.ts` Zod fail-fast (RNF-12) validating **only runtime vars** (`DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `PORT`, `FRONTEND_URLS`, `NODE_ENV` — architecture §8; the admin URL is deliberately absent); helmet + CSP, `x-powered-by` off (RNF-04); CORS allowlist + credentials (RNF-05); 100 kb body limits (RNF-06); `trust proxy` (RNF-09); typed `AppError` + central handler + 404 + pino w/ request id; `GET /api/v1/health` with DB ping over the `repma_api` connection (RNF-10). Extends `.env.example`. HTTP conventions (AD-18, error envelope) documented in code. Tests: env fail-fast unit; supertest health 200 (and 503 on broken DB URL).
- [ ] **1.6 Core plumbing** (M) — `core/http`: `validate(zodSchema)` whitelist helper + per-field 400 mapping (RNF-08, AD-13) + pagination helpers; `core/rateLimit`: `RateLimitStore` interface + in-memory limiter with the four families (RNF-07, AD-16); `db/withTenantContext(fn)`: transaction + `set_config(..., true)` GUCs, **fails closed** when a tenant-scoped call has no `tenantId` (AD-19, §5.2 net 1). Tests: unit for validate/limiter; integration for context-set/fail-closed and GUC transaction-scoping.
- [ ] **1.7 Isolation suite A — the cross-tenant sweep** (M) — with fixtures for two tenants: from tenant A's context, read + write attempts against **each of the 4 tenant-scoped tables** of tenant B expect 0 rows/error; **deny-by-default enumerated over all 9 tables** (no context → 0 rows); repository-without-context fails closed (net 1) and raw-query-without-context returns 0 rows (net 2). Blocks the build from now on (RNF-01, RN-03).
- [ ] **1.8 Isolation suite B — policy specifics** (M) — `tenants` SELECT by a store user (own row only; other stores invisible); `user_profiles` visibility exactly per §7.3 (own row, same-store members, platform admins visible; other store's members invisible); `availability_events` WITH CHECK `created_by = uid()` (same-tenant insert attributed to another user fails); platform_admin with `app.role` set but **no** `app.tenant_id` → 0 rows on tenant-scoped tables; non-admin INSERT/UPDATE on `categories`/`products`/`product_sizes`/`tenants` blocked **at the policy layer**; ledger immutability: UPDATE and DELETE on `availability_events` **fail with any error** (grants or RLS — the test asserts failure, not the error class) (RN-05 DB layers).
- [ ] **1.9 Demo seed** (M) — TS seed script (validated by itself, not the API env): users via Supabase Auth admin API + profiles, data via the admin connection (`database.md` §9): 1 admin + 2 stores × (manager+employee), ~6 categories, ~40 products **with sizes** (apparel XS–2XL, footwear subsets of 36–45, "One size" elsewhere; SKUs on sizes — RN-11), **overlapping + exclusive assortments across the two stores**, several sizes out of stock **from first startup** with strictly-alternating event histories whose latest event matches `is_available` (RN-14-shaped), lists across all three statuses incl. a `processing` one with done lines, **an empty draft**, and a `done` one. **`image_url` = NULL for now** (bucket ships in Phase 8; 8.8 backfills). `db:seed` script; idempotent or reset-first. Tests: seed runs on a fresh DB; sanity counts + latest-event/flag coherence assertion.
- [ ] **1.10 Shared permission matrix** (S) — `packages/shared/permissions.ts`: the 10 permissions + matrix exactly per architecture §6, `hasPermission`, role/status/event-type constants mirroring the enums (§5). **Unit snapshot test** so any change is a deliberate two-file edit.
- [ ] **1.11 `authenticate` middleware** (M) — cookie-priority/Bearer token extraction (RF-04); local JWKS verification with `jose`, keys derived from `SUPABASE_URL`, cached (AD-20); per-request profile load under the session-bootstrap policy (§7.3), inactive user or store → 401 (RF-05); identity context `{userId, role, tenantId}` (§5.2 step 1). Tests: valid/expired/garbage token, deactivated user, deactivated store.
- [ ] **1.12 Auth endpoints** (M) — `POST /auth/login` (Supabase password grant via anon key; **per-IP 10/min limiter mounted pre-auth**), HttpOnly `SameSite=Lax` (`Secure` in prod) cookie carrying access+refresh tokens (RF-01, RNF-03, AD-12); `POST /auth/logout` (RF-03); `GET /auth/me` → user, role, store, effective permissions from the matrix (RF-02). Tests: login/logout/me round-trip, uniform 401 for bad credentials vs deactivated (login.md relies on this), rate-limit 429.
- [ ] **1.13 Transparent session refresh** (M) — AD-23/RF-43: expired access token → refresh against Supabase on the request itself, cookie re-issued, request proceeds; failed refresh clears cookie + 401. Tests: expired-token request succeeds with new cookie; revoked refresh → 401 + cleared cookie.
- [ ] **1.14 `tenantContext` + `authorize` middlewares** (M) — explicit per-router mounting (§5.2): store user with foreign `X-Tenant-Id` → 403; platform_admin without header on a tenant-scoped route → 400, with header → validated active tenant; AsyncLocalStorage carrying the context; `authorize(permission)` → uniform 403 (§6). Tests for every branch.
- [ ] **1.15 CI** (M) — GitHub Actions on every PR: npm cache → lint → typecheck → **supabase local stack + migrations + bootstrap + seed** → tests (isolation suite included — red build on any failure) → build (RNF-15, RNF-13, AD-11). Verify: green run on a PR.
- [ ] **1.16 Dockerfile** (S) — multi-stage: build workspaces → slim runtime image (API, which will serve `web/dist` from Phase 2) (RNF-14); `docker build` step added to CI. docker-compose is deliberately not built (architecture lists it as optional; no requirement demands it). Verify: `docker build .` succeeds in CI.
- [ ] **1.17 Production deploy wiring** (S agent + Manual 1-B/1-C) — deploy workflow on merge to `main`: run migrations against prod using `MIGRATIONS_DATABASE_URL` (CI-only secret, validated by the migration script itself) → trigger Render deploy hook; separate **manually-triggered** (`workflow_dispatch`) seed workflow using `MIGRATIONS_DATABASE_URL` + `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` secrets. The API env schema never mentions the admin URL; Render never carries it.

### Manual setup 1-B — Supabase cloud project (during 1.17, in this order)

1. supabase.com → **New project**: name `repma`, nearest region, click "Generate a password" → **save it in your password manager** (this is the `postgres` admin password).
2. Settings → API: copy **Project URL**, **anon key**, **service_role key**, and the **project ref** (the subdomain of the URL).
3. Settings → Database → Connection string → **Session pooler**: copy the URI. Note the username is **tenant-qualified**: `postgres.<project-ref>` — the pooler rejects a bare `postgres`.
4. GitHub repo → Settings → Secrets and variables → Actions → **New repository secret**: `MIGRATIONS_DATABASE_URL` = the session-pooler URI with the admin password (username `postgres.<project-ref>`). Also add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (used only by the seed workflow). *Verify:* run the deploy workflow (push to `main` or re-run) → the migration job is green. "password authentication failed" = wrong password or unqualified username.
5. Migrations have now created `repma_api` (NOLOGIN). Dashboard → SQL Editor → run `ALTER ROLE repma_api WITH LOGIN PASSWORD '<new-password>';` with a **second** generated password; save it. *Verify from your machine:* `psql "postgresql://repma_api.<project-ref>:<pwd>@<pooler-host>:5432/postgres" -c 'select count(*) from tenants;'` → connects and returns **0** (RLS deny-by-default — 0 is success). "password authentication failed" = the ALTER didn't run or the username lacks `.<project-ref>`.
6. Run the **Seed** workflow (Actions → Seed → Run workflow). *Verify:* dashboard Table Editor → `tenants` shows 2 rows. (Your `repma_api` psql still returns 0 without context — that's correct.)

### Manual setup 1-C — Render + deploy hook (after 1-B)

1. render.com → New → **Web Service** → connect the GitHub repo → runtime **Docker** → free/starter instance. **Turn off "Auto-Deploy"** (CI will trigger deploys after tests).
2. Environment → add exactly the runtime vars (`.env.example` is the checklist — everything in it, nothing more): `DATABASE_URL` = the pooler URI with username `repma_api.<project-ref>` and the password from 1-B step 5; `SUPABASE_URL`; `SUPABASE_SERVICE_ROLE_KEY`; `SUPABASE_ANON_KEY`; `FRONTEND_URLS` = the service's own `https://….onrender.com` URL; `NODE_ENV=production`. (`PORT` is injected by Render.) **Never add `MIGRATIONS_DATABASE_URL` here.**
3. Settings → Deploy Hook → copy the URL → GitHub secret `RENDER_DEPLOY_HOOK_URL`. *Verify:* push a trivial commit to `main` → CI green → Render deploys → `curl https://<app>.onrender.com/api/v1/health` returns `{"status":"ok"}` with the DB ping ok. A DB error in Render logs = wrong `DATABASE_URL` (check the qualified username).

**Deliverable:** a deployed API whose `/health` proves the DB path through `repma_api`; a local stack reproducible with `supabase start` + `db:migrate` + `db:bootstrap` + `db:seed`; the isolation suite red-flagging any RLS regression in CI.
**Tests that must pass:** isolation suites A+B, auth middleware/endpoints/refresh/tenantContext integration, env/validate/limiter units, matrix snapshot.
**Closing criterion:** `npm run check` green locally and in CI; prod `/health` 200; all manual verifications above done. — [ ]

---

## Phase 2 — Sign in, shell & activity feed (L)

**Objective:** the web app exists: design tokens, login, permission-based guards and the full app shell, proven end-to-end by the first store vertical — the activity feed (RF-42) — deployed from the same origin as the API.
**Scope:** RF-02(client), RF-06, RF-23, RF-31, RF-32, RF-33, RF-36(states/pagination), RF-42; RNF-11, RNF-19(stack); DP-01(interim), DP-05, AD-10, AD-15(web).
**Starting state:** Phase 1 closed. Verify: `supabase status` up, `npm run check` green, `curl localhost:3000/api/v1/health` ok.
**Manual setup:** none.

- [ ] **2.1 Design foundation** (M) — Tailwind CSS v4 theme mapped from **CSS custom properties** carrying every DESIGN.md token (colors, type scale, spacing, `rounded`, the `layers` z-scale — one source of truth); self-hosted **Inter (400/500/600)** and **Inter Tight (400 only)**; **Material Symbols Rounded subset** pipeline (only DESIGN.md §Iconography's inventory; adding an icon = subset + list); Headless UI installed as the single component stack (RNF-19); base styles (no box-shadow anywhere, focus outlines light/dark, `prefers-reduced-motion`), motion tokens. Tests: web build green + a token smoke test.
- [ ] **2.2 Web core & guards** (M) — `apiClient` (credentials include, `{error:{code,message,details}}` envelope — no Supabase key anywhere in web, DP-05/RNF-02), QueryClient, AuthContext fed by `GET /auth/me` with full-page neutral bootstrap (layout.md §Session bootstrap); `hasPermission` + `<RequirePermission>` from the shared matrix; route guards 1–4 per layout.md; `/unauthorized` per its page doc; `/` → `/login` redirect (DP-01 interim until 9.1); `*` → role home. **Role home constant starts as `/activity` for all roles (interim — flips in 3.7, 5.3, 7.5)**. Tests: RTL+MSW for guards, bootstrap, redirects.
- [ ] **2.3 `/login`** (M) — exactly per `login.md`: shared Zod schema, inline 401/429/network states, intended-URL return, autocomplete, redirect by role home, no-form-flash for authenticated visitors. Tests: all states + redirect logic.
- [ ] **2.4 Shell 1 — spine & nav** (M) — flush sidebar per layout.md/DESIGN §Application Shell: wordmark + logo tile, nav sections **driven by `hasPermission`** with the layout.md table's order/icons (items appear as their routes ship — interim registry), active marker, user menu (name, role label, "Log out" → `POST /auth/logout` → `/login`). Tests: visibility matrix per role, logout flow.
- [ ] **2.5 Shell 2 — collapse & responsive** (M) — collapse/expand with `localStorage` persistence applied pre-paint; **tooltip component** born here (collapsed labels, hover **and** focus); tablet expand-in-place over scrim; mobile fixed header + off-canvas drawer with close button; layer tokens respected (shell band below dialog band). Tests: persistence, drawer/expand behavior.
- [ ] **2.6 API `GET /tenants`** (S) — list, paginated with `search` (RF-06), `tenant:manage`, read limiter, global router (no tenantContext). (`GET /tenants/:id` + writes ship in 7.1.) Integration tests.
- [ ] **2.7 Shell 3 — tenant context block** (M) — RF-33: static store name for manager/employee (no `X-Tenant-Id` sent); platform_admin selector fed by `GET /tenants` (active stores only, filtered client-side; search + "Clear selection"), `localStorage` persistence, `X-Tenant-Id` on tenant-scoped calls, invalidate-all-tenant-queries on switch, "Select a store" placeholder + **picker state** for store routes; collapsed circular tile behavior per layout.md. Tests: header injection, switch invalidation, picker state.
- [ ] **2.8 Shared list kit** (M) — `<PageHeader>` (+subtitle convention), **filter band** (URL-held state, 300ms debounce, reset-to-page-1, responsive stacking), `<DataTable>` (column defs, row nav, row actions stop propagation), `<Pagination>` (envelope-driven, **empty-page recovery** logic — first consumer with deletes tests it in 4.6), `<LoadingState>`/`<EmptyState>`/`<ErrorState>` (RF-36). Component tests.
- [ ] **2.9 API availability router birth — the events feed** (M) — the availability router is created with **`GET /availability/events` registered first** (RF-23: reverse-chronological, paginated, `from`/`to`, author null-safe per RN-09, item identity embedded; `activity:read`; read limiter; tenantContext mounted) and a **route-order assertion test** that will keep it above `GET /availability/:id` forever (architecture §7 note). Integration tests: shape, filters, tenant scoping.
- [ ] **2.10 `/activity`** (M) — per `activity.md`: PageHeader + subtitle, From/To band (local-midnight mapping, swap-if-inverted), DataTable, pagination, empty states. **Interim:** row click → `/availability/:id` ships in 3.7; rows render without navigation until then (named interim). Tests: filters, states.
- [ ] **2.11 Single-service serving** (S) — API serves `web/dist` with SPA fallback for non-`/api` routes, same-origin first-party cookie (RNF-11); Dockerfile builds web; prod verify. Verify: deployed URL → log in as seeded employee → see the store's seeded events.

**Deliverable:** on the production URL: log in as any seeded user, see the branded shell with permission-driven nav and the store's activity feed; platform admin selects a store to view its feed.
**Tests:** all Phase-1 suites + web guard/shell/login/activity suites + feed endpoint integration.
**Closing criterion:** `npm run check` + CI green; prod login + feed verified by hand. — [ ]

---

## Phase 3 — Availability: read & flag (M)

**Objective:** the product's heart — the assortment read as size runs with aging, and the immutable flagging flow (the AD-04 invariant with its concurrency test).
**Scope:** RF-13, RF-18(core), RF-20, RF-21, RF-22, RF-24, RF-35(availability pages); RN-05(single write path), RN-06, RN-07, RN-14; AD-04, AD-22; DP-06(page semantics), DP-07.
**Starting state:** Phase 2 closed. Verify: `npm run check`; log in locally, `/activity` renders seeded events.
**Manual setup:** none.

- [ ] **3.1 API grouped availability listing + categories** (M) — `GET /availability` per RF-18/AD-22: page of **products** with the full nested run (`position` order, per-size `is_available`, `is_active`, latest-event timestamp), product `is_active`; filters `search` (name+SKU), `categoryId`, `outOfStock=true` (product-level select, complete run returned); **default order = aging descending** (oldest current-outage first, then fully-available by name — the only order, no sort param) per database.md §8's query notes. (`productId` filter is added by 6.1 with its consumer.) Plus catalog router birth: `GET /categories` (RF-13, `catalog:read`, read limiter, global router). Integration tests: grouping, each filter, the sort, run-never-split.
- [ ] **3.2 API item read** (S) — `GET /availability/:id` (single size) and `GET /availability/:id/events` (paginated reverse-chronological history, RF-21) — registered **below** the feed route; order test extended. Integration tests incl. cross-tenant 404-indistinguishability (RN-03).
- [ ] **3.3 API events write — the invariant** (M) — `POST /availability/:id/events` `{type}` only (RN-06): service inserts event + updates flag **in one transaction** with the row lock serializing RN-14 (same-state event → 409); `created_by` from context; **shop-floor limiter family** (RNF-07). Tests: invariant (flag = latest event; no events → available, RN-07/RF-24), **concurrency test** (two simultaneous same-type flags → one event, one 409), Zod whitelist rejects `is_available` and any extra payload (RF-22), 403 without `availability:flag`.
- [ ] **3.4 Toast system** (S) — top-right stack, success auto-dismiss ~4s, errors persist, `aria-live`; API-error message mapping; the autosave-silence exception is documented for Phase 4 (RF-36). Tests.
- [ ] **3.5 `<SizeRun>` + aging** (M) — per components.md §`<SizeRun>` and DESIGN §Size run/§Out of stock: 44px sharp tiles, one uniform out-of-stock mark, button-or-span per consumer, wrap behavior; **aging utils**: elapsed figure (`<1 h`/`5 h`/`9 d`/`3 w` unit scale) + DP-07 band → weight mapping, computed at render; `badge-inactive`. Unit tests for bands/units; component tests.
- [ ] **3.6 `/availability`** (M) — per `availability.md`: product lines (thumb placeholder, name, category, run, right-aligned aging figure), filter band (search/category/out-of-stock toggle), pagination, skeletons reserving tile height, inactive badges, tile → `/availability/:id` preserving list URL state. **Interim:** the "Add to assortment" header action ships in 6.3 (named). Tests.
- [ ] **3.7 `/availability/:id` + flag flows** (M) — per `availability-detail.md`: summary card (h1 "Product — size", SKU, `badge-out-of-stock` with elapsed figure or "Available", "since …", category, thumb), history table + pagination, one-tap flag actions with optimistic flip, RN-14 409 reconciliation, invalidations (item, events, list, feed), toasts. Wire `/activity` row navigation (closes 2.10's interim). **Role home flips to `/availability`.** ("Remove from assortment" ships in 6.4 — named interim.) Tests: flows, optimistic revert, 409.

**Deliverable:** the signature demo on prod: log in as an employee, read the store's runs and aging, open a size, flag it out of stock, watch the history, feed and aging react.
**Tests:** invariant + concurrency integration; grouped-listing suite; route-order test; page suites.
**Closing criterion:** `npm run check` + CI green; prod flag flow verified by hand. — [ ]

---

## Phase 4 — Replenishment (L)

**Objective:** the second daily-work vertical: manual lists (DP-06) with per-item autosave, progress checks, and the ProductPicker born in its replenishment flow.
**Scope:** RF-26, RF-27, RF-28, RF-29, RF-30, RF-39(born), RF-40, RF-36(toast exception, undo, empty-page recovery); RN-04(lists), RN-09(cascade), RN-12; DP-06.
**Starting state:** Phase 3 closed. Verify: `npm run check`; flag flow works locally.
**Manual setup:** none.

- [ ] **4.1 Dialog infrastructure** (S) — Headless UI `Dialog` in a **portal at the document root**, `dialog`/`dialog-scrim` layers above the entire shell at every breakpoint (components.md §Modals; mandatory before any modal ships), focus trap/restore; `<FormModal>` (640px) + `<ConfirmModal>` (480px, `button-danger`). Tests.
- [ ] **4.2 API lists read** (M) — `GET /replenishment-lists` (filters `status` multi, `search` on name, `from`/`to`; order `created_at DESC` only; per-list `itemCount`, `productCount` (DISTINCT products), `doneCount` — architecture §7) and `GET /replenishment-lists/:id` (items **ordered by product name, then size `position`**, embedding product name/category, size label, SKU — RF-26). tenantContext + `replenishment:read` + read limiter. Integration tests: filters, counts, detail order.
- [ ] **4.3 API lists write** (S) — `POST /replenishment-lists` (name + optional notes — **no generated origin exists: no endpoint, no parameter**, DP-06), `PATCH /replenishment-lists/:id` (name/notes/status — free transitions, RF-30), `DELETE /replenishment-lists/:id` (cascade, RN-09). `replenishment:manage`, write limiter. Tests incl. cascade.
- [ ] **4.4 API list items** (M) — `POST /replenishment-lists/:id/items` `{sizeId, quantity}` (assortment membership validated first for a clean error, RN-12; duplicate → 409, RN-04; `quantity ≥ 1`), `PATCH /replenishment-lists/:id/items/:itemId` (`quantity` and/or `isDone`, RF-40), `DELETE /replenishment-lists/:id/items/:itemId`. **Shop-floor limiter family** (RNF-07). Tests: RN-12 (incl. inactive-but-in-assortment allowed, RN-08), 409, bounds.
- [ ] **4.5 `/replenishment` index** (M) — per `replenishment.md`: card grid (status badge, delete `stopPropagation`, h2 name, size line with "Empty" case, open-only progress fraction, hairline, provenance, **`icon-button-ink` destination arrow inside the card link** — born here), 3/2/1 columns, filter band (search, multi-status, **one date select with presets + Custom**, swap-if-inverted), pagination. Tests.
- [ ] **4.6 Create & delete flows** (S) — "New list" form modal → `POST` → toast → navigate to detail; delete confirm naming the list (cascade copy) → toast → **empty-page recovery** (first real test of 2.8's logic). Tests.
- [ ] **4.7 `<ProductPicker>` — replenishment flow** (M) — per `product-picker.md`: portal dialog above the shell, category rail (`GET /categories`), 300ms search, image grid with placeholder + size-count caption, **stable maximum height**, selection panel using **`<SizeRun>`** (`run-tile-selected`/`-disabled`), quantity stepper, disabled-set + `onConfirm` contract (no mutations of its own), stays-open-after-confirm, inactive-item rules of the replenishment flow (RN-12/RN-08). Grid source here: `GET /availability` (AD-22 shape). Component tests.
- [ ] **4.8 Detail 1 — header & cards** (M) — per `replenishment-detail.md`: back arrow, inline-editable name (save on blur), status badge + select, filled `button-danger` "Delete list", meta line, Notes card (blur save), **`<ProgressBar>` born here** (label + `done/total` fraction + track, in its own card, hidden when empty, 100% hint "Mark list as done" as suggestion only). Read-only fallback via permissions. Tests.
- [ ] **4.9 Detail 2 — items & autosave** (M) — items table with **DataTable group-header rows** (extension, product groups from the endpoint order), done checkbox (optimistic, silent success — the documented RF-36 exception), quantity input (valid-and-changed blur save, one in-flight PATCH per item), remove with **"Undo" toast**, 404/409 reconciliation. Tests: every autosave flow + error reverts.
- [ ] **4.10 Detail 3 — add items & client filters** (M) — "Add product" picker wiring (`POST …/items`, row appears inside its product group, tile flips disabled, 409 toast; availability state is **not** a filter — DP-06), client-side search/category filters + "Group by category" toggle (URL state, no refetch, header rows vanish when their group is filtered out). Tests.

**Deliverable:** full shop-floor workflow on prod: create a list, add sizes via the picker, check lines off watching the bar, undo a removal, finish and mark done.
**Tests:** list/items integration suites (RN-12/RN-04), all detail flow tests, picker tests.
**Closing criterion:** `npm run check` + CI green; prod walkthrough done. — [ ]

---

## Phase 5 — Home (S)

**Objective:** the store landing that summarizes both worlds without ever connecting them (DP-06): figures card + three bounded evidence blocks.
**Scope:** RF-25, RF-41; DP-06, DP-07(Home).
**Starting state:** Phase 4 closed. Verify: `npm run check`; lists + availability flows work locally.
**Manual setup:** none.

- [ ] **5.1 API `GET /home/summary`** (S) — `{openLists, pendingItems, outOfStock}` exactly per RF-41, three COUNTs in one transaction, tenant-scoped, `availability:read`, read limiter. Tests: figures against fixtures (pendingItems across **all** open lists), tenant scoping.
- [ ] **5.2 Home 1 — header, figures, bounded tables** (M) — greeting header (time-of-day + first name, store · date line, "New list" primary gated `replenishment:manage`); full-width garnet figures card (48px figures, on-dark rules, honest zeros, on-dark skeletons); **bounded `<DataTable>` variant** (capped set, tertiary "View all" bottom-right with true total when truncating; no count on the activity teaser). Tests.
- [ ] **5.3 Home 2 — the three blocks** (M) — per `home.md`: open work (7 rows, status + `done/total` fraction — **no bars on Home** —, `icon-button-ink` inside the row link, "View all (N)" from `openLists`), out-of-stock evidence (10 rows, intact 44px `<SizeRun>`, no thumbs, Waiting figure, "View all (N)" from the availability envelope's **product** total), recent activity (4 rows, RN-09 "—", countless "View all"); per-block permission gating (`replenishment:read`, `activity:read`), per-block empty/error states that never break the page; invalidation wiring from the flag/list flows; "New list" reuses 4.6's modal. **Role home flips to `/home` for store roles** (login.md final for them). Tests.

**Deliverable:** manager/employee land on a live Home whose figures and blocks react to every flow built so far.
**Tests:** summary integration; Home block/permission/empty-state suites.
**Closing criterion:** `npm run check` + CI green; prod Home verified. — [ ]

---

## Phase 6 — Assortment management & store catalog (M)

**Objective:** the manager grows the assortment: picker's assortment flow on `/availability`, corrective removal, and the `/catalog` browse page with its slide-over — the picker's and the slide-over's ownership exactly per the design docs.
**Scope:** RF-15, RF-18(`productId`), RF-19, RF-35(catalog page), RF-39(assortment flow), RF-44; RN-04(assortment), RN-08(additions), RN-13.
**Starting state:** Phase 5 closed. Verify: `npm run check`; Home live locally.
**Manual setup:** none.

- [ ] **6.1 API `GET /products` + `productId` filter** (M) — `GET /products` per RF-15: paginated, filters `categoryId`/`search` (name + size SKU)/`isActive`, **sizes embedded**; `catalog:read`, read limiter. Plus the `productId` (one-or-more) filter on `GET /availability` (RF-18's `/catalog` cross-reference — built with its consumer). Integration tests.
- [ ] **6.2 API assortment writes** (M) — `POST /availability` `{sizeId}` (starts available, no events; inactive product/size rejected RN-08; duplicate → 409 RN-04; `is_available` in body → validation error RF-22) and `DELETE /availability/:id` (only unreferenced — no events, no list lines; else clean 409, RF-44/RN-13). `assortment:manage`, write limiter. Tests incl. both RESTRICT paths.
- [ ] **6.3 Picker assortment flow + `/availability` header action** (M) — "Add to assortment" primary on `/availability` (closes 3.6's interim) opening the **shared picker** in its assortment flow: grid source `GET /products`, inactive products/sizes never offered (RN-08), already-added tiles disabled (RN-04), **no extra fields, closes after confirm**; 409 mapped inline on the size step per `availability.md`. Tests.
- [ ] **6.4 Detail removal** (S) — ghost "Remove from assortment" on `/availability/:id`, rendered only with `assortment:manage` **and** empty history; confirm modal; 409 → toast + refetch (action disappears if events appeared). Closes 3.7's interim. Tests.
- [ ] **6.5 Sheet + `/catalog` list** (M) — the right-anchored **slide-over component** (`sheet`/`sheet-scrim` layers, ink left rule, Escape/scrim close) born here; `/catalog` per `catalog.md`: guard `assortment:manage`, products table (thumb, name, size count, category, status, "In assortment" via the **`productId` cross-reference** with `pageSize` = ids sent), filter band (search/category/`isActive` default Active), pagination; cross-reference failure degrades to "—" + retry without blocking. Nav gains "Catalog" (manager only by permission). Tests.
- [ ] **6.6 `/catalog` slide-over & add flow** (M) — product detail slide-over from row data: image, description, **size list (a list, not a `<SizeRun>` — catalog.md)** with per-size status: "In assortment" + `/availability/:id` link, or "Add to assortment" → `POST /availability` direct (no picker on this page — its only add surface); inactive rules; 409/RN-08 handling. Tests.

**Deliverable:** a manager browses the catalog, adds sizes from both surfaces (picker on `/availability`, slide-over on `/catalog`), and can undo a mistaken addition while it has no history.
**Tests:** products/assortment-write integrations; both add-surface suites; removal suite.
**Closing criterion:** `npm run check` + CI green; prod add/remove verified. — [ ]

---

## Phase 7 — Platform: stores & users (M)

**Objective:** the Platform Admin runs the platform: store CRUD with suspension (PD-03 resolved) and centralized user management with the compensated create.
**Scope:** RF-07, RF-08, RF-09, RF-10, RF-11, RF-12, RF-34(tenants+users); RN-01(API), RN-09(user delete), RN-10; DP-03, DP-04, AD-08, AD-09(API).
**Starting state:** Phase 6 closed. Verify: `npm run check`; store zone complete locally.
**Manual setup:** none.

- [ ] **7.1 API tenants write** (M) — **slug util** (generated from name, unit-tested, RN-10 — reused by 8.1); `POST /tenants`, `GET /tenants/:id`, `PATCH /tenants/:id` incl. `is_active` (RF-07/RF-08; slug 409). Tests incl. deactivated-store users getting 401 (RF-05 already enforced — asserted end-to-end here).
- [ ] **7.2 API users read** (S) — `GET /users` (paginated; `search` on full name **and denormalized email**, store filter — RF-09) and **`GET /users/:id`** (explicitly: it exists in architecture §7). `user:manage`, read limiter. Tests.
- [ ] **7.3 API users create** (M) — `POST /users`: Supabase Auth admin + profile **atomically-or-compensated** (auth user deleted if the profile fails — the failure case is integration-tested, architecture §9); role↔store coherence 400s before the DB CHECK (RN-01). Tests.
- [ ] **7.4 API users edit & delete** (M) — `PATCH /users/:id`: name, role (**manager ↔ employee only**, store immutable, email immutable — RF-11), `is_active`, optional write-only `password` reset via Auth admin; self-deactivate rejected. `DELETE /users/:id`: self-delete rejected (RF-12); deletion cascades the profile via `auth.users` and **leaves availability events with `created_by = NULL`** (RN-09 — asserted). Tests for every rule.
- [ ] **7.5 `/platform/tenants`** (M) — per `platform-tenants.md`: table (no delete anywhere), create modal (name only, slug 409 inline), edit modal (slug read-only), deactivate/reactivate **confirm flow with the consequence copy** (PD-03/RF-05); selector-source invalidation on `is_active` change. Platform nav section appears. **Admin role home flips to `/platform/tenants`** (login.md final). Tests.
- [ ] **7.6 `/platform/users` — list & create** (M) — per `platform-users.md`: table, search + store filter, create modal with **live role↔store coherence** (store required for store roles, hidden+cleared for admin), 409 email inline. Tests.
- [ ] **7.7 `/platform/users` — edit & delete** (M) — edit modal (role select constrained m↔e, store read-only with inactive badge, status toggle disabled on own account, optional password reset field), delete confirm with the RN-09 copy, "(you)" marker, self-protection double layer (hidden UI **and** graceful API 4xx), empty-page recovery. Tests.

**Deliverable:** the admin demo: create a store, staff it, suspend it (its users lose access on next request), reset a password, delete a user and show their events surviving as "—".
**Tests:** tenants/users integrations (compensation, self-rules, RN-09), both page suites.
**Closing criterion:** `npm run check` + CI green; prod admin walkthrough done. — [ ]

---

## Phase 8 — Platform catalog & product images (L)

**Objective:** the catalog stops being seed-only: category/product/size management with soft retirement, size presets, and image upload to the Storage bucket.
**Scope:** RF-14, RF-16, RF-17, RF-37, RF-38, RF-34(catalog); RN-02(writes), RN-08(retire), RN-11; AD-02(storage), AD-07, AD-21(API); RNF-04(img-src), RNF-06(5MB).
**Starting state:** Phase 7 closed. Verify: `npm run check`; platform zone works locally.

- [ ] **8.1 Presets + categories write** (S) — size presets as shared constants (Clothing XS–2XL, Footwear 36–45, "One size" — RF-38, AD-21); `POST /categories`, `PATCH /categories/:id` (slug util reuse, 409; **no delete endpoint** — RF-14). `catalog:manage`, write limiter. Tests.
- [ ] **8.2 API products write** (M) — `POST /products` (**≥1 size required → 400**, sizes array with labels/SKUs/positions — RN-11; no image in this call), `PATCH /products/:id` (fields + `is_active` soft retire, RF-16/RN-08). Tests: sizeless 400, SKU 409, retire keeps assortment/history readable.
- [ ] **8.3 API sizes** (M) — `POST /products/:id/sizes`, `PATCH /products/:id/sizes/:sizeId` (label, SKU — editable, global 409 —, position, `is_active`; **no delete**, RF-37). Tests.
- [ ] **8.4 API image upload** (M) — `POST /products/:id/image`: multipart 5 MB limit (RNF-06), type check, upload via `lib/supabase` Storage to the public `product-images` bucket, URL persisted (RF-17); **local bucket** declared in supabase config so dev/CI need no manual step; **CSP `img-src` extended** with the bucket host (RNF-04). Tests: limit, type, URL persistence.
- [ ] **8.5 `/platform/catalog` — categories tab** (M) — per `platform-catalog.md`: URL-held tabs, categories table (unpaginated), create/edit modal, slug 409 inline, filter-options invalidation. Tests.
- [ ] **8.6 Products tab — table & create** (M) — products table + filters; create modal with the **sizes editor** (preset prefill buttons with overwrite confirm, add/remove rows pre-creation, ≥1 size in the shared schema), **create-then-upload** flow with the partial-failure toast. Tests.
- [ ] **8.7 Products tab — edit, sizes section, retire, image** (M) — edit modal with expandable sizes section (edit label/SKU/position, add sizes, activate/deactivate with confirm — no delete), product retire/reactivate confirms with RN-08 copy, image replacement, per-row SKU 409s. Tests.
- [ ] **8.8 Seed images** (S) — placeholder product images committed to the repo; `db:seed-images` script uploads them and points seed `image_url`s at the bucket (closes 1.9's interim; `database.md` §9 now fully true). Local/CI: runs inside `db:seed`. Prod: run once (documented, idempotent) with the service key exported — see Manual 8-A.

### Manual setup 8-A — production Storage bucket (before verifying 8.4 in prod)

1. Supabase dashboard → **Storage** → New bucket → name **`product-images`** (exact — the API config references it), toggle **Public bucket** on → Save.
2. *Verify:* on the prod app, `/platform/catalog` → edit a product → upload a small image → the thumbnail renders. Failure "Bucket not found" = name mismatch; a broken image with a 4xx in the network tab = the bucket isn't public.
3. Run the documented one-time `db:seed-images` invocation against prod (script validates its own env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MIGRATIONS_DATABASE_URL` — export them for the single run, from your password manager, never into any file). *Verify:* `/availability` on prod shows real thumbs instead of placeholders.

**Deliverable:** the full admin catalog demo: create a product with the Footwear preset, upload its photo, retire a size, and watch the store side respect it (no new additions, history intact).
**Tests:** catalog write integrations (RN-11/409/soft-delete), upload tests, both tab suites.
**Closing criterion:** `npm run check` + CI green; prod upload verified; seed images live. — [ ]

---

## Phase 9 — Polish: landing, README, final audit (S)

**Objective:** close the MVP presentable to a recruiter: the public landing (DP-01 final), the README, and the audit that proves the standing rules held.
**Scope:** DP-01(final), RF-31(complete), RNF-19(a11y review), RNF-07/RNF-08(audit).
**Starting state:** Phase 8 closed. Verify: `npm run check`; full product live.
**Manual setup:** none.

- [ ] **9.1 Landing** (M) — **first write `design/pages/landing.md`** and register it in the pages index (its doc is pending — the reading-list rule); then build `/`: public pitch with visible demo credentials and CTA to `/login`, replacing the interim redirect (DP-01 complete; authenticated visitors still route to their role home). Tests.
- [ ] **9.2 README + docs** (S) — setup from scratch (tools, `supabase start`, migrate/bootstrap/seed, dev), demo credentials (database.md §9), architecture pointers, commands (RNF-16), deploy notes. Update the pending Commands block in `CLAUDE.md`.
- [ ] **9.3 Final audit** (M) — executable where possible: a test enumerating every router → its limiter family (RNF-07); Zod-schema presence per endpoint (RNF-08); dependency rules of architecture §3.2 checked (lint rule or documented review); endpoint/route surface diffed against architecture §7 and the pages index; accessibility pass per DESIGN §Accessibility (focus, aria, contrast, reduced motion) with fixes; stale interims sweep (none may remain). Fix everything found.

**Deliverable:** the finished MVP: a recruiter opens `/`, reads the pitch, logs in with the shown credentials and tours a coherent product.
**Closing criterion:** `npm run check` + CI green; audit findings fixed; **MVP complete**. — [ ]

---

## Phase 10 (optional) — E2E smoke (PD-02) (S)

**Objective:** decide PD-02 by building the minimal smoke: value/cost is finally measurable.
**Starting state:** MVP complete. Verify: `npm run check`.

- [ ] **10.1 Playwright smoke** (M) — login → flag a size out of stock → the event appears in the history (architecture §8's script); runs against the local stack; optional CI job (documented either way). Closing: smoke green; PD-02 recorded as resolved in architecture.md. — [ ]

## Phase 11 (optional · non-MVP) — Feature 003: real-time availability (SSE) (M)

Per `features/003-realtime-availability/spec.md`; purely additive.

- [ ] **11.1 API stream** (M) — `GET /availability/stream` (SSE, tenant-scoped, `activity:read`), publish-after-commit pub/sub behind an interface (AD-16 pattern), excluded from the request limiter, heartbeat/flush notes. Tests: cross-tenant isolation, rollback emits nothing, 403/400 per §5.2. Doc impacts applied (new RF/AD per the feature spec).
- [ ] **11.2 Web EventSource** (M) — one connection per session in the shell, message → documented query invalidations, refetch-on-reconnect. Tests (EventSource mock). Closing: two-browser demo — a flag on one appears on the other within ~1s. — [ ]

## Phase 12 (optional · non-MVP) — Feature 004: installable PWA (S)

Per `features/004-mobile-pwa/spec.md`.

- [ ] **12.1 Manifest + SW** (M) — Vite PWA plugin: precached shell, **network-first `/api` with zero API caching**, offline fallback page, autoUpdate verified against the deploy pipeline. Tests per the spec's acceptance criteria.
- [ ] **12.2 Offline indicator** (S) — shell indicator + failed-mutation toast clarity; doc impacts applied. Closing: installed app demo, offline behavior verified. — [ ]

## Phase 13 (optional · non-MVP) — Feature 005: availability insights (M)

Per `features/005-availability-insights/spec.md`.

- [ ] **13.1 Permission + endpoints** (M) — `insights:read` (matrix + snapshot two-file change), `GET /insights/frequent-outages`, `GET /insights/time-to-restock` (LEAD pairing, fixture-first), `GET /insights/outage-trend`; read-time aggregation only; isolation extended; no-quantities assertion. Doc impacts applied.
- [ ] **13.2 Seed history extension** (S) — backdated events so charts aren't flat (per the spec's notes).
- [ ] **13.3 Page** (M) — **write `design/pages/insights.md` first** + index line; `/insights` with garnet/blue strokes (resolving DESIGN's chart-palette gap for two series); employee 403/no-nav verified. Closing: manager-only insights demo. — [ ]

---

## Traceability — every core-doc ID → owner

*(primary owner first; "+" = where the ID is completed or re-verified)*

**RF** — 01→1.12 · 02→1.12 · 03→1.12 · 04→1.11 · 05→1.11 (+2.3, 7.1) · 06→2.6 · 07→7.1 · 08→7.1 (+7.5) · 09→7.2 · 10→7.3 · 11→7.4 (+7.7) · 12→7.4 (+7.7) · 13→3.1 · 14→8.1 (+8.5) · 15→6.1 · 16→8.2 (+8.6, 8.7) · 17→8.4 (+8.7, 8-A) · 18→3.1 (+6.1 `productId`) · 19→6.2 (+6.3, 6.6) · 20→3.3 (+3.7) · 21→3.2 (+3.7) · 22→3.3 + standing rule (+6.2) · 23→2.9 · 24→3.1/3.3 (+3.5) · 25→5.2/5.3 · 26→4.2 (+4.5, 4.9) · 27→4.3 (+4.6, 5.3) · 28→4.4 (+4.9, 4.10) · 29→4.3 (+4.6) · 30→4.3 (+4.8) · 31→2.2 (+2.3, 9.1) · 32→2.2 + standing rule · 33→2.7 · 34→7.5/7.6/7.7/8.5–8.7 · 35→2.10/3.6/3.7/4.5/5.3/6.5 · 36→2.8 (+3.4 toasts, 4.6 recovery, 4.9 autosave exception) · 37→8.3 (+1.3 schema) · 38→8.1 (+8.6) · 39→4.7 (+6.3) · 40→4.4 (+4.8, 4.9) · 41→5.1 (+5.2) · 42→2.10 · 43→1.13 · 44→6.2 (+6.4).

**RN** — 01→1.3 (+7.3, 7.4) · 02→1.4 (+8.1–8.3) · 03→1.4/1.7 (+3.2) · 04→1.3 (+4.4, 6.2) · 05→1.4/1.8 (+3.3) · 06→1.3 (+3.3) · 07→3.1/3.3 · 08→1.3/1.4 (+6.2, 8.2, 8.3, picker rules 4.7/6.3) · 09→1.3 (+4.3, 7.4, "—" convention 2.10/3.7/4.5) · 10→7.1 (+8.1) · 11→8.2 (+1.9 seed) · 12→1.3 (+4.4) · 13→1.3 (+6.2) · 14→3.3 (+1.9 seed shape).

**RNF** — 01→1.4/1.7/1.8 (+1.15 blocks build) · 02→1.5/2.2 · 03→1.12 · 04→1.5 (+8.4) · 05→1.5 · 06→1.5 (+8.4) · 07→1.6 + standing rule (+9.3 audit) · 08→1.6 + standing rule (+9.3) · 09→1.5 · 10→1.5 · 11→2.11 · 12→1.5 · 13→1.2/1.9/1.15/1.17 · 14→1.16 (+1.1 dev script) · 15→1.15/1.17 · 16→1.1 · 17→1.1 · 18→distributed: unit 1.6/1.10/7.1, integration 1.7/1.8/3.3 + standing rule (c), web 2.2+ every UI sub-task · 19→2.1 (+every UI sub-task, 9.3 a11y).

**DP** — 01→2.2 interim + 9.1 final · 02→1.3/1.4 (+8.1–8.3) · 03→1.3 (+7.1, 7.5) · 04→7.3–7.7 · 05→1.5/2.2 · 06→4.3 (no generation path) + 4.10 (picker) + 5.3 (Home) · 07→3.1/3.5 (+3.7, 5.3; never persisted — 1.3 has no aging column).

**AD** — 01→1.3/1.4 · 02→1.2/1.9/1.11 (+8.4) · 03→1.2 · 04→3.3 (+1.3) · 05→1.5 · 06→1.10 · 07→1.4 (+8.1–8.3) · 08→7.3 · 09→1.3 (+7.4) · 10→2.2 · 11→1.15/1.17 · 12→1.12 · 13→1.6 + standing rule · 14→1.1 · 15→1.1 (+2.2 web) · 16→1.6 · 17→1.3 · 18→1.5 conventions + every PATCH endpoint · 19→1.6 (+1.14) · 20→1.11 · 21→1.3 (+8.3, 8.1 presets) · 22→3.1 (+3.6) · 23→1.13.

**PD** — 02→Phase 10 (optional, decided there) · 03→resolved: 7.1/7.5.

**Out of the MVP** (spec §6, with reasons): quantity-tracked stock (deliberately excluded — quantities can't stay truthful without POS); multi-store membership; public per-store catalog; self-service signup; inter-store transfers; Redis rate limiting + observability metrics (AD-16 keeps the interface); full Playwright E2E beyond the optional smoke (PD-02 = Phase 10). Features **001** (tenant theming) and **002** (audit log) remain `proposed` and unscheduled.
