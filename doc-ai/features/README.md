# Features — index

One feature = one `NNN-name/` directory with at least `spec.md` (copied from `_template.md`). `plan.md` and `notes.md` only when size justifies them. Feature docs are written once and never rewritten: they are the record of what happened.

| ID | Feature | Status | Doc |
|---|---|---|---|
| 001 | Per-tenant theming (configurable primary/secondary colors) | proposed | [001-tenant-theming/spec.md](001-tenant-theming/spec.md) |
| 002 | Platform audit log (`/platform/logs`, admin-only, filterable) | proposed | [002-audit-log/spec.md](002-audit-log/spec.md) |
| 003 | Real-time availability updates (SSE, tenant-scoped stream) | proposed | [003-realtime-availability/spec.md](003-realtime-availability/spec.md) |
| 004 | Installable mobile PWA (app shell, offline fallback — no offline mutations) | proposed | [004-mobile-pwa/spec.md](004-mobile-pwa/spec.md) |
| 005 | Availability insights (`/insights`, analytics computed from the event ledger) | proposed | [005-availability-insights/spec.md](005-availability-insights/spec.md) |

Statuses: `proposed` → `in development` → `done` / `discarded`.
