<p align="center"><img src="apps/web/public/logo.svg" alt="REPMA owl logo" width="120"></p>

# REPMA

**Multi-tenant availability & replenishment platform for retail chains.**

REPMA lets a platform operator run multiple independent stores on top of one shared product catalog. Each store flags which product sizes are out of stock on the shop floor — without ever counting or faking a stock quantity — and keeps its own manual replenishment lists. Built as an engineering showcase: multi-tenancy, RBAC, an immutable event ledger, PostgreSQL Row-Level Security, and a fully tested, CI/CD-deployed full-stack TypeScript app.

[![Stack](https://img.shields.io/badge/stack-TypeScript%20·%20Express%20·%20React%20·%20PostgreSQL-blue)]()

## Live demo

**<https://repma.onrender.com>** — the demo accounts are listed below. It runs on Render's free tier, so the first request after a while asleep can take up to a minute (cold start).

| Account | Role |
|---|---|
| `admin@repma.demo` | Platform Admin (all stores; pick a store in the sidebar to operate inside it) |
| `manager.downtown@repma.demo` · `manager.north@repma.demo` | Manager of Downtown Store / North Store |
| `employee.downtown@repma.demo` · `employee.north@repma.demo` | Employee of Downtown Store / North Store |

Password for all of them: **`repma-demo-2026`** (demo-only, public by design; the seed resets it — `doc-ai/core/database.md` §9).

---

## What it does

- A **Platform Admin** manages stores (tenants), users, and a **global catalog** of products — each product with its own sizes (e.g. "Nike Air Max", sizes 36–45) and an image.
- Each **store** builds its own **assortment** from that catalog and flags which sizes are currently unavailable — anywhere in the store, stockroom included.
- Availability is never a guessed quantity. It's an **append-only event ledger** (`out_of_stock` / `restock`); the current state is always derived, never hand-edited.
- **Aging matters more than the flag itself**: a size missing for 2 hours and one missing for 9 days wear the identical mark — only the elapsed time escalates, by weight, never by color.
- **Replenishment lists are manual and independent** — never generated from out-of-stock flags. A stockroom that has nothing left can't restock itself; a list is staff noting what the sales floor needs brought out.
- One store's data is **never** visible to another — enforced in the database, not just in application code.

## Engineering highlights

Each point links to where it is specified — the docs are the source of truth, not this summary.

| Highlight | Where |
|---|---|
| Shared schema + `tenant_id` + Postgres RLS **enabled and forced**; the API connects as a non-owner, non-`BYPASSRLS` role and sets the tenant per transaction | AD-01, [architecture §5](./doc-ai/core/architecture.md), [database §7](./doc-ai/core/database.md) |
| Cross-tenant isolation suites that fail the build on any regression | RNF-01 ([spec §4.1](./doc-ai/core/spec.md)), `apps/api/src/db/isolation.integration.test.ts` |
| Immutable availability-event ledger; no endpoint edits `is_available`, no screen shows a quantity | AD-04, RN-05, RF-22 |
| Permission-based authorization from one matrix shared by API and web (never `role === 'x'`) | [architecture §6](./doc-ai/core/architecture.md), `packages/shared/src/permissions.ts` |
| HttpOnly-cookie session managed by the API (transparent refresh); the browser never holds a Supabase token or secret | AD-12, AD-23 |
| Zod schemas shared end-to-end; strict request validation and one error envelope | RNF-08, [architecture §7–8](./doc-ai/core/architecture.md) |
| Per-family rate limiting, CORS allowlist, CSP, upload type/size checks by magic bytes | RNF-04–RNF-07 ([spec §4.1](./doc-ai/core/spec.md)) |
| Layered API (`router → controller → service → repository`), one module per aggregate | [architecture §3](./doc-ai/core/architecture.md) |
| CI on every PR, migrate-then-deploy on merge to `main`, single Docker image | AD-11, RNF-14, RNF-15 |

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 19, Vite, React Router, TanStack Query, Tailwind CSS v4, Headless UI |
| Backend | Node.js 22, Express 5, TypeScript (strict) |
| Database | PostgreSQL via Supabase, accessed directly with **Drizzle ORM** (versioned migrations) |
| Identity & storage | Supabase Auth (JWT) and Supabase Storage, reached only through the API |
| Validation | Zod schemas shared end-to-end via `packages/shared` |
| Testing | Vitest everywhere; API integration tests against a real local Postgres + RLS; web tests with Testing Library + MSW |
| CI/CD | GitHub Actions → Render (Docker) |

## Architecture at a glance

```
┌──────────────┐  fetch /api/v1/*  ┌────────────────────┐   drizzle (repma_api role,   ┌─────────────────────┐
│  apps/web    │  HttpOnly cookie  │  apps/api          │   RLS enforced, per-tx       │  Supabase           │
│  React + Vite│ ────────────────► │  Express 5 + TS    │   tenant context)            │  · Postgres (data)  │
│  + RQ +      │ ◄──────────────── │  routes → services │ ────────────────────────────►│  · Auth  (identity) │
│  Tailwind    │       JSON        │  → repositories     │   supabase-js (admin):       │  · Storage (images) │
└──────────────┘                   └────────────────────┘   JWT verify, users, images   └─────────────────────┘
        ▲                                    │
        └──────── packages/shared — Zod schemas + API types, shared api ↔ web ─────────┘
```

In production the API also serves the built web app (`apps/web/dist`) from the same origin, so the session cookie stays first-party. Roles and their permissions: [spec §2](./doc-ai/core/spec.md) and [architecture §6](./doc-ai/core/architecture.md).

---

## Local setup from scratch

### Required tools

| Tool | Version used | Check |
|---|---|---|
| Node.js | 22 (`.nvmrc`; `engines` requires ≥ 22) | `node -v` |
| Docker Desktop (running) | any recent | `docker info` |
| Supabase CLI | 2.119.0 (the version CI pins) | `supabase --version` |
| `psql` (optional, for poking at the DB) | any | `psql --version` |

### Steps

```bash
# 1. Install dependencies (the root postinstall builds packages/shared)
npm ci

# 2. Start the local Supabase stack (Postgres, Auth, Storage — incl. the
#    `product-images` bucket declared in supabase/config.toml)
supabase start

# 3. Create the API env file
cp apps/api/.env.example apps/api/.env
```

Fill `apps/api/.env` (it is git-ignored):

- `REPMA_API_PASSWORD` — any password you make up; put the same value in place of `<REPMA_API_PASSWORD>` in `DATABASE_URL`.
- `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` — from `supabase status -o env` (`ANON_KEY`, `SERVICE_ROLE_KEY`). `SUPABASE_URL` (`API_URL`) and `MIGRATIONS_DATABASE_URL` (`DB_URL`) already match the local defaults.

```bash
# 4. Database: schema + RLS, then give the repma_api role LOGIN, then demo data
npm run db:migrate -w api
npm run db:bootstrap -w api
npm run db:seed -w api      # demo stores, users, catalog, history, lists + seed product images

# 5. Run API (:3000) and web (:5173, proxies /api to the API)
npm run dev
```

Open <http://localhost:5173> and sign in with any demo account above. The seed is re-runnable: it rebuilds the demo stores' data and resets the demo users' passwords.

## Commands

All from the repository root (RNF-16).

| Command | What it does |
|---|---|
| `npm run dev` | Builds `shared`, then runs shared (watch) + API (`tsx watch`) + web (Vite) |
| `npm run build` | Builds shared, API and web |
| `npm start` | Runs the built API (serves `apps/web/dist` when present) |
| `npm run check` | **Lint + typecheck + test — the green criterion** |
| `npm run lint` / `npm run typecheck` / `npm run test` | Each step on its own, across all workspaces |
| `npm run db:migrate -w api` | Applies Drizzle migrations (`MIGRATIONS_DATABASE_URL`) |
| `npm run db:generate -w api` | Generates a new migration from the Drizzle schema |
| `npm run db:bootstrap -w api` | Gives `repma_api` LOGIN with `REPMA_API_PASSWORD` (local only; prod: Manual 1-B) |
| `npm run db:seed -w api` | Demo data + seed product images (local/CI; prod via the *Seed* workflow) |
| `npm run db:seed-images -w api` | Only the seed-image step (see [production](#seed-images-in-production-one-time)) |
| `npm run icons -w web` | Regenerates the self-hosted icon font subset from `apps/web/src/styles/icons.json` (DESIGN.md §Iconography; needs network) |

## Testing

- `npm run check` is the bar: every workspace's Vitest suite, plus ESLint and `tsc`.
- API `*.integration.test.ts` files (RLS isolation, every endpoint, the seed) hit the **local Supabase stack** through `apps/api/.env` — run `supabase start` and the migrate/bootstrap/seed steps first, or they fail.
- Web tests run in jsdom with MSW; unhandled requests fail the test.

## CI/CD and deployment

Production is **Supabase** (database, auth, storage) + **Render** (one Docker web service built from the `Dockerfile`).

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` (CI) | every pull request | lint → typecheck → local Supabase stack + migrate/bootstrap/seed → tests → build; Docker image build in parallel |
| `deploy.yml` (Deploy) | push to `main` | the same CI on the merged commit → production migrations from the runner → Render deploy hook (Render auto-deploy is off) |
| `seed.yml` (Seed) | manual (`workflow_dispatch`, type `seed` to confirm) | runs `db:seed` against production — **wipes and rebuilds the demo stores' data** and resets demo passwords |

One-time production setup is in [`plan.md`](./doc-ai/core/plan/plan.md): **Manual 1-B** (Supabase project, GitHub secrets, `repma_api` password via the dashboard), **Manual 1-C** (Render service, runtime env from `.env.example`, deploy hook) and **Manual 8-A** (the `product-images` bucket + the seed images below). `MIGRATIONS_DATABASE_URL` is a CI-only secret — never on Render.

### Seed images in production (one time)

After creating the production `product-images` bucket (plan Manual 8-A), run the image step once from your machine — it touches only the seed products' `image_url` and the bucket's `seed/` folder, and is safe to repeat. Export the three values for this shell only, straight from your password manager; never write them to a file:

```bash
read -rs MIGRATIONS_DATABASE_URL      # session-pooler URI, admin password (postgres.<project-ref>)
read -rs SUPABASE_SERVICE_ROLE_KEY
export MIGRATIONS_DATABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_URL=https://<project-ref>.supabase.co
npm run db:seed-images -w api
unset MIGRATIONS_DATABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_URL
```

Set all three: exported values win over `apps/api/.env`, and a missing one falls back to the local value there — the script refuses to run when the database and the Supabase URL point to different environments, but a wrong service key is only caught when the upload fails. (The manual *Seed* workflow also runs this step, but it resets the demo stores' data too.)

---

## Documentation

The full product and engineering spec lives in [`doc-ai/`](./doc-ai). [`CLAUDE.md`](./CLAUDE.md) has the map of what to read when; the main entries:

| Doc | Covers |
|---|---|
| [`doc-ai/core/spec.md`](./doc-ai/core/spec.md) | Requirements (RF-xx), business rules (RN-xx), product decisions (DP-xx), non-functional (RNF-xx) |
| [`doc-ai/core/architecture.md`](./doc-ai/core/architecture.md) | Architecture decisions (AD-xx), layers, API surface, RBAC, route map |
| [`doc-ai/core/database.md`](./doc-ai/core/database.md) | Schema, RLS policies, indexes, seed |
| [`doc-ai/core/plan/`](./doc-ai/core/plan/plan.md) | Phased build roadmap (`plan.md`) and session diary (`journal.md`) |
| [`doc-ai/design/DESIGN.md`](./doc-ai/design/DESIGN.md) | Design system: tokens, components, tone; per-page docs in `design/pages/` |
| [`doc-ai/features/`](./doc-ai/features/README.md) · [`doc-ai/bugs/`](./doc-ai/bugs/README.md) | Feature specs and documented bugs, written once |

## Repository structure

```text
apps/
  api/            Express API — src/{config,core,db,lib,modules}, scripts/ (db:bootstrap, db:seed, db:seed-images)
    src/db/       Drizzle schema, migrations, withTenantContext, seed (+ seed images)
  web/            React SPA — src/{pages,components,auth,tenant,lib,styles,test}, scripts/ (icons)
packages/
  shared/         Zod schemas, API types, permission matrix, enums, size presets
supabase/         Local stack config (config.toml)
doc-ai/           Product, architecture, database, design and plan docs
.github/workflows CI, Deploy, Seed
Dockerfile        Single production image (API + built web)
```
