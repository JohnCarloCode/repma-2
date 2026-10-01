# Feature 002 — Platform audit log

> Status: proposed
> Date: 2026-08-16

## Context and motivation

There is no record of *who did what* at the platform level (user created, tenant deactivated, product retired…). The availability event log (AD-04) audits availability changes only. A platform-wide audit log gives the Platform Admin traceability over administrative actions — a business audit trail, distinct from technical logging (pino, architecture.md §8).

## Scope

- New **global** table `audit_events`: `id`, `actor_id` (FK user_profiles, SET NULL), `actor_role`, `action` (e.g. `user.created`, `tenant.deactivated`, `product.retired`), `entity_type`, `entity_id`, `tenant_id` (nullable — set when the action happened inside a store context), `metadata jsonb`, `created_at`. Append-only ledger like `availability_events`: no UPDATE/DELETE grants, no UPDATE/DELETE policies.
- RLS: SELECT only for `rol() = 'platform_admin'`; INSERT for any authenticated context (services write their own events). **No tenant-scoping** — this is deliberately a global table, so it does NOT break the "platform admin has no cross-tenant bypass" rule (database.md §7.3): that rule protects tenant-scoped tables, and this one is global-by-design like `tenants` or `user_profiles`.
- Services emit events on administrative mutations: users CRUD, tenants create/edit/deactivate, catalog create/edit/retire, replenishment list delete. Availability events are NOT duplicated here (their own immutable log already covers them).
- `GET /audit-events`: paginated, filters `action`, `actorId`, `tenantId`, `entityType`, `from`/`to` dates. New permission `audit:read` (platform_admin only) in the shared matrix.
- New page `/platform/logs` ("Audit log"): filter band (all the above) + table (date, actor, action label, entity, store, metadata expandable). Sidebar item under "Platform", gated by `audit:read`. UI copy in English (RNF-19). Page doc in `design/pages/platform-logs.md` when built.

## Out of scope

- Auditing reads (only mutations are audited).
- Auditing availability flags (already covered by their own immutable event log, AD-04; the page may link to it).
- Retention/archival policies, export to CSV, real-time streaming.
- Managers seeing their own store's audit trail (possible later: scope SELECT policy by `tenant_id`).

## Impact on existing documentation

- `core/spec.md`: new RF family (audit) + new RN ("administrative mutations emit an immutable audit event").
- `core/architecture.md`: new permission `audit:read` in the matrix (§6); new API family (§7); possibly a new AD documenting the event-emission approach (in-service, same transaction).
- `core/database.md`: new table + RLS policies + indexes (`(created_at DESC)`, `(actor_id)`, `(tenant_id)`).
- `design/pages/README.md`: new row for `/platform/logs`.

## Acceptance criteria

- Every scoped administrative mutation writes exactly one audit event, in the same transaction (a failed mutation writes nothing).
- Audit events are immutable: no grant nor policy allows UPDATE/DELETE (isolation-suite coverage like the availability event log).
- Only `platform_admin` can read them (manager/employee → 403 on the endpoint, no sidebar item).
- Filters combine correctly and paginate per the standard envelope.
- Deleting a user keeps their events (`actor_id` SET NULL, actor rendered as "—", consistent with RN-09's philosophy).

## Implementation notes (optional)

Medium feature (~2-3 days). Key decision: emit events in-service within the mutation's transaction (simple, consistent) vs middleware-based (magic, harder to attach entity metadata) — recommend in-service. Do it AFTER the MVP is stable; touching every service is cheap but noisy in review.
