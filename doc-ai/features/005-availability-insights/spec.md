# Feature 005 — Availability insights (analytics from the event ledger)

> Status: proposed
> Date: 2026-08-22

## Context and motivation

The immutable event ledger (AD-04) currently answers only "what is out of stock now and since when" (DP-07). But the history it already stores can answer the manager's better questions: *which sizes go out of stock most often*, *how long does this store take to restock*, *is the situation improving*. This feature turns the ledger from an engineering pattern into visible product value — with zero schema changes, because the data is already there.

## Scope

- New store page `/insights`, guarded by a **new permission `insights:read`** (manager + platform_admin; not employee — it is retrospective management reading, not shop-floor work). One line in the type + matrix cells + snapshot update, exactly the evolution path §6 of `architecture.md` was designed for.
- New endpoint family, tenant-scoped, computed on read from `availability_events` (nothing precomputed, nothing stored — same philosophy as aging, `database.md` §10):
  - `GET /api/v1/insights/frequent-outages`: sizes ranked by count of `out_of_stock` events in a period (`from`/`to`, default last 90 days), with product/size identity. "What keeps running out."
  - `GET /api/v1/insights/time-to-restock`: median and p90 of the `out_of_stock → next restock` interval per period, plus the N currently-open longest gaps. "How fast do we recover."
  - `GET /api/v1/insights/outage-trend`: count of `out_of_stock` events per week over the period. "Are we getting better."
- All figures are **counts and durations — never stock quantities** (RN-05/RN-06 hold: events carry no quantities at all, so the only things to aggregate are occurrences and intervals).
- Charts use the palette already reserved in `DESIGN.md`: garnet primary stroke, blue secondary (this feature resolves the "chart palette" Known Gap for exactly these two series; anything needing more hues is out of scope).

## Out of scope

- Cross-tenant / platform-wide analytics (breaks the mental model of RN-03 for now; a platform_admin view over all stores is a separate future feature).
- Forecasting, alerts or recommendations ("you should reorder X") — REPMA has no quantity or sales data to base them on.
- Precomputed aggregates, materialized views or scheduled jobs: at MVP volumes these are read-time `GROUP BY`s over an indexed table; complexity must wait for a real performance requirement (§3.1).
- CSV export (nice, cheap, but a separate decision).

## Impact on existing documentation

- `core/spec.md`: new RFs under a new §3.8 (insights); note in §2 that employee lacks `insights:read`.
- `core/architecture.md`: `insights:read` in the matrix (§6) and the new family in the API surface (§7); a minor AD if p90/median definitions need pinning.
- `core/database.md`: no schema change; §8 note — the existing `(tenant_id, created_at DESC)` index on `availability_events` serves the period scans; time-to-restock pairing may justify revisiting `(assortment_item_id, created_at DESC)` usage, documented when measured.
- `design/pages/`: new `insights.md` (create BEFORE implementing, per the pages rule) + a line in the pages index; `DESIGN.md` Known Gaps updated (chart palette resolved for two series).

## Acceptance criteria

- Given seeded history, each endpoint returns correct figures for a hand-computable fixture (unit-tested aggregation queries against real Postgres).
- Isolation: tenant A's insights never include tenant B's events (extends the RNF-01 suite to the new family).
- An employee gets 403 on `/insights` routes and never sees the nav item (matrix snapshot updated — the two-file change §6 prescribes).
- No response contains a stock quantity; durations and counts only (explicit assertion in tests, RN-05).
- Periods with no events return honest zeros/empty series, and the page renders them as designed states, not errors.

## Implementation notes (optional)

Medium feature (~3–4 days with the page). Build after the MVP: it consumes the ledger, so the richer the seeded/real history, the better the demo — worth extending the seed (`database.md` §9) with a few weeks of backdated events so charts aren't flat on first run. The time-to-restock pairing (each `out_of_stock` with its next `restock` per item) is the only non-trivial query — window function (`LEAD` over `created_at` partitioned by item), worth writing first with its fixture.
