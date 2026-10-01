# REPMA

**Multi-tenant availability & replenishment platform for retail chains.**

REPMA lets a platform operator run multiple independent stores on top of one shared product catalog. Each store tracks, in real time, which product sizes are out of stock on the shop floor — without ever counting or faking a stock quantity — and keeps its own manual replenishment lists. Built as an engineering showcase: multi-tenancy, RBAC, an immutable event ledger, PostgreSQL Row-Level Security, and a fully tested, CI/CD-deployed full-stack TypeScript app.

[![Status](https://img.shields.io/badge/status-pre--implementation-blueviolet)]()
[![Stack](https://img.shields.io/badge/stack-TypeScript%20·%20Express%20·%20React%20·%20PostgreSQL-blue)]()
[![License](https://img.shields.io/badge/license-private-lightgrey)]()

---

## What it does

- A **Platform Admin** manages stores (tenants), users, and a **global catalog** of products — each product with its own sizes (e.g. "Nike Air Max", sizes 36–45).
- Each **store** builds its own **assortment** from that catalog and flags which sizes are currently unavailable — anywhere in the store, stockroom included.
- Availability is never a guessed quantity. It's an **append-only event ledger** (`out_of_stock` / `restock`); the current state is always derived, never hand-edited.
- **Aging matters more than the flag itself**: a size missing for 2 hours and one missing for 9 days wear the identical mark — only the elapsed time escalates, by weight, never by color.
- **Replenishment lists are manual and independent** — never generated from out-of-stock flags. A stockroom that has nothing left can't restock itself; a list is staff noting what the sales floor needs brought out.
- One store's data is **never** visible to another — enforced in the database, not just in application code.

## Why it exists

The goal isn't feature count — it's demonstrating production-grade engineering on a real-shaped B2B problem: defense-in-depth multi-tenancy, declarative authorization, an immutable domain model, and a clean, proportionate architecture with no speculative abstractions.

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React 19, Vite, TanStack Query, Tailwind CSS v4, Headless UI |
| Backend | Node.js, Express 5, TypeScript (strict) |
| Database | PostgreSQL via Supabase, accessed directly with **Drizzle ORM** |
| Isolation | Shared schema + `tenant_id` + **PostgreSQL RLS, enforced and forced** — defense in depth even if a query forgets to filter |
| Identity & storage | Supabase Auth (JWT) and Supabase Storage, reached only through the API — the frontend holds no secrets |
| Validation | Zod schemas shared end-to-end via `packages/shared` |
| Testing | Vitest everywhere; API integration tests run against a real local Postgres + RLS |
| CI/CD | GitHub Actions (lint, typecheck, test, build, Docker) → auto-deploy to Render on merge to `main` |

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

**Monorepo** (npm workspaces): `apps/api`, `apps/web`, `packages/shared`.

Every request's tenant and role flow through a single `AsyncLocalStorage` context into a transaction-scoped Postgres session — RLS policies enforce isolation at the database itself, so no layer has to "remember" to filter by tenant.

## Roles

| Role | Scope | Can do |
|---|---|---|
| **Platform Admin** | Whole platform | Manage stores, users, and the global catalog. Operate inside any store via a store selector. |
| **Manager** | Their store | Manage assortment, flag availability, manage replenishment lists, review activity. |
| **Employee** | Their store | Flag availability, manage replenishment lists, review activity. Reads the catalog only through in-flow pickers. |

All authorization is **permission-based**, resolved from a single matrix (`packages/shared/permissions.ts`) — code never checks `role === 'x'`.

## Invariants

These hold everywhere in the system, by design:

- Availability changes only through immutable events — no endpoint edits a flag directly, and no screen ever shows a stock quantity.
- No operation crosses tenants — blocked by RLS and covered by an isolation test suite that fails the build on any regression.
- Authorization is always by permission, never by role comparison.
- UI, code, docs and comments ship in English.

## Documentation

The full product and engineering spec lives in [`doc-ai/`](./doc-ai), organized as living documentation:

| Doc | Covers |
|---|---|
| [`doc-ai/core/spec.md`](./doc-ai/core/spec.md) | Requirements (RF-xx), business rules (RN-xx), product decisions (DP-xx) |
| [`doc-ai/core/architecture.md`](./doc-ai/core/architecture.md) | Architecture decisions (AD-xx), layers, API surface, RBAC |
| [`doc-ai/core/database.md`](./doc-ai/core/database.md) | Schema, RLS policies, indexes, seed data |
| [`doc-ai/core/plan/plan.md`](./doc-ai/core/plan/plan.md) | Phased build roadmap and progress tracker |
| [`doc-ai/design/DESIGN.md`](./doc-ai/design/DESIGN.md) | Design system: tokens, components, tone |
| [`doc-ai/features/`](./doc-ai/features/README.md) | Feature specs, written once per feature |
| [`doc-ai/bugs/`](./doc-ai/bugs/README.md) | Documented bugs that revealed something about the system |

`core/` describes what the system **is** and is updated as reality changes; `features/` and `bugs/` describe what **happened** and are never rewritten.

## Project status

Pre-implementation — architecture, data model, and design system are fully specified; the monorepo scaffold is next (`plan.md`, Phase 1, sub-task 1.1).

## Getting started

```bash
# once the monorepo exists:
npm install
npm run check   # lint + typecheck + tests across all workspaces
npm run dev
```

Local development requires Docker (for the Supabase stack), the Supabase CLI, and Node ≥ 22 — see Phase 1's manual setup in `doc-ai/core/plan/plan.md`.
