# REPMA — AI Guide

REPMA is a multi-tenant availability & replenishment platform: a Platform Admin manages stores, users and a global catalog (products with sizes); each store (manager/employee) manages its assortment, flags which sizes are out of stock (immutable availability-event log — stock quantities are never counted) and keeps manual replenishment lists — never generated from those flags (DP-06: availability and replenishment are independent). Project goal: demonstrate engineering quality (TS, Express, Postgres+RLS, React, testing, CI/CD).

## Working rules

- **Never commit or open a PR unless explicitly asked.** Leave changes in the working tree.
- **No over-engineering.** Do what is optimal for the real goal: no speculative abstractions, extra layers or "just in case" generalizations. Complexity must be justified by an existing requirement (same principle as architecture.md §3.1).
- Before implementing, think through the full path to the goal and pick the simplest one that achieves it well — not the first one that works nor the most sophisticated.

## Documentation map — read ONLY what you need

| Document | Read it when... |
|---|---|
| `doc-ai/core/spec.md` | You need requirements (RF-xx), business rules (RN-xx) or product decisions (DP-xx) |
| `doc-ai/core/architecture.md` | You need technical decisions (AD-xx), layers, API surface, RBAC/permissions |
| `doc-ai/core/database.md` | You touch the schema, RLS, indexes or the seed |
| `doc-ai/core/plan/` | You need the phased build plan: `plan.md` is the roadmap/tracker (phases checked off as they close), `journal.md` the session-by-session execution diary, `prompts_plan.md` the prompts that create the plan and execute its phases |
| `doc-ai/design/DESIGN.md` | You touch UI: design system, tokens, tone |
| `doc-ai/design/shared/` | You touch the app shell (`layout.md`) or shared UI patterns (`components.md`) |
| `doc-ai/design/pages/README.md` | Page index → open only the `.md` of the page you're touching |
| `doc-ai/features/README.md` | Feature index → open only the feature you're working on |
| `doc-ai/bugs/README.md` | Index of documented bugs (only those that revealed something about the system) |

## Documentation rules

- `core/` is what the system **IS**: it gets updated when reality changes. `features/` and `bugs/` are what **HAPPENED**: written once, never rewritten. `core/plan/` is the exception inside core: the build roadmap — living execution state, updated as phases close. Decisions made while executing it go to the core docs (new AD/RF/RN), never into the plan.
- Always reference by ID (`RN-05`, `AD-04`, `RF-21`); never copy a rule's content into another doc.
- New feature → copy `doc-ai/features/_template.md` to `doc-ai/features/NNN-name/spec.md` (sequential NNN) and add a line to the index.
- Bug worth documenting → copy `doc-ai/bugs/_template.md` to `doc-ai/bugs/NNN-name.md` and add a line to the index.
- New UI page → create its `.md` in `doc-ai/design/pages/` BEFORE implementing it and register it in the index.

## Invariants that are never broken

- Availability only changes via immutable events; no endpoint edits `is_available` directly, and the app never shows a current stock quantity (RN-05).
- No operation crosses tenants: RLS + isolation tests block the build (RNF-01).
- Authorization by **permission**, never `role === 'x'` outside the matrix (`packages/shared/permissions.ts`).
- The app's UI language is English (product requirement, RNF-19), as are code, docs and comments.

## Commands

_(pending: will be filled in once the monorepo exists — `dev`, `build`, `test`, `typecheck`, `lint` from the root, RNF-16)_
