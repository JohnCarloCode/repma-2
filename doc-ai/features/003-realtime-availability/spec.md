# Feature 003 — Real-time availability updates (SSE)

> Status: proposed
> Date: 2026-08-22

## Context and motivation

Availability is flagged from the shop floor by several people at once: when one employee marks size 42 out of stock, a colleague looking at `/availability` or Home on another device still sees it available until a manual refresh. Pushing availability events to connected clients turns the app from "a page you reload" into a live operational tool — and it fits the existing model naturally: the immutable event ledger (AD-04, RN-05) is already the single source of "something changed".

## Scope

- New endpoint `GET /api/v1/availability/stream`: **Server-Sent Events**, tenant-scoped (§5.2), guarded by `activity:read` — it streams the same store-wide event data as RF-23, so it takes the same permission; no matrix change.
- The availability service publishes each event **after its transaction commits** (event insert + flag update, RN-05) to an in-process pub/sub keyed by `tenant_id`. Message payload: the event as RF-23 returns it (item id, size, product, type, who, when).
- Frontend: one `EventSource` per session (opened by the shell for holders of the permission). On message, invalidate the affected React Query caches — availability list/item/events, Home summary and blocks, activity feed — so every screen reconciles through its existing queries; no client-side state duplication.
- Reconnection: native `EventSource` retry + a full invalidation on reconnect (events missed while offline are picked up by the refetch; the stream is a nudge, not a source of truth).
- The pub/sub lives behind a small interface (same pattern as `RateLimitStore`, AD-16): in-memory for the single-service deploy (RNF-11), replaceable by Redis pub/sub if the app ever scales horizontally. The limitation is documented, not solved speculatively.

## Out of scope

- WebSockets: nothing here is bidirectional; SSE is simpler, proxy-friendly and needs no library.
- Real-time for replenishment lists: list edits are single-author sessions (autosave, RF-28); no concurrent-view problem exists yet.
- Missed-event replay / `Last-Event-ID` handling: the refetch-on-reconnect strategy makes it unnecessary.
- Presence, typing indicators or any collaboration UI.

## Impact on existing documentation

- `core/spec.md`: new RF under §3.5 (the stream endpoint and the client behavior); RNF note on the in-memory pub/sub limitation (next to the rate-limit one).
- `core/architecture.md`: new AD-xx (SSE over WebSocket/polling, publish-after-commit, pub/sub interface); add the route to the API surface (§7). No permission changes.
- `core/database.md`: no schema change — the ledger already carries everything.
- `design/`: no new page; a short note in `shared/components.md` if a "live" reconnect indicator is added (optional).

## Acceptance criteria

- Given two authenticated clients of the same tenant, when one records an event (RF-20), the other receives an SSE message within ~1s and its availability views reconcile without user action.
- Given clients of two different tenants, an event in tenant A is never delivered to tenant B (isolation test at the pub/sub and endpoint level, same rigor as RNF-01).
- A client without `activity:read` or without a resolvable tenant gets 403/400 on the stream, consistent with §5.2.
- Events are published only after commit: a rolled-back transaction emits nothing (integration test).
- Frontend test: an incoming message triggers the documented invalidations (MSW/EventSource mock).

## Implementation notes (optional)

Build after the MVP is complete — it touches nothing structural, purely additive. Care points: Render/proxy buffering (`X-Accel-Buffering: no`, flush headers), heartbeat comment every ~30s to keep the connection alive, and excluding the stream route from the request-scoped rate limiter (one long-lived request, not N reads).
