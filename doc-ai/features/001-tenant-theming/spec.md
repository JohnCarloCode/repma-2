# Feature 001 — Per-tenant theming (configurable primary/secondary colors)

> Status: proposed
> Date: 2026-08-16

## Context and motivation

Every store sees the same blaugrana brand. Letting each tenant configure its primary and secondary colors makes the platform feel white-label and showcases the token-based design system. `DESIGN.md` §Future Evolutions already anticipates this: brand colors are consumed exclusively as CSS custom properties so this feature requires no component changes.

## Scope

- New `theme` JSONB column on `tenants` (nullable; `NULL` = default theme — garnet ink `#3b1322` / blue `#004d98`, the tokens in `DESIGN.md`). Shape: `{ "primary": "#3b1322", "secondary": "#004d98" }`.
- `PATCH /tenants/:id` accepts `theme` (Zod: valid hex colors, whitelist of the two keys).
- `GET /auth/me` returns the effective theme of the user's store (or of the selected store for platform_admin).
- Frontend injects `--color-primary` / `--color-secondary` at session load and on tenant-selector change; the whole derived garnet-ink family (`primary-active`, `sidebar`, `sidebar-hover`, `filter-band`, `on-sidebar`, `on-sidebar-muted`) is computed from the primary, per `DESIGN.md` §Future Evolutions.
- Theme editor UI in `/platform/tenants` edit modal (two color pickers + live preview + "Reset to default theme").

## Out of scope

- Configuring semantic colors (success/warning/error/info) — fixed forever so alerts always read the same (DESIGN.md).
- Logos, fonts or any theming beyond the two brand colors.
- Contrast validation beyond a minimal check (warn if the chosen primary fails WCAG AA against white).
- Manager self-service theming: only the Platform Admin edits it (consistent with DP-04's centralization philosophy).

## Impact on existing documentation

- `core/spec.md`: new RF for theme configuration under §3.2 (Tenants).
- `core/architecture.md`: no new AD needed — covered by the existing token decision in `design/DESIGN.md`.
- `core/database.md`: `tenants.theme jsonb` column (migration; no RLS change — same row, same policies).
- `design/DESIGN.md`: move "Per-tenant theming" from Future Evolutions to implemented; document derived-tone computation.
- `design/pages/platform-tenants.md`: add the theme editor to the edit modal.

## Acceptance criteria

- Given a tenant with no `theme`, the UI renders the default blaugrana palette.
- Given a tenant with `theme` set, its manager/employee see the custom colors on login; platform_admin sees them when selecting that store.
- Invalid hex or unknown keys in `PATCH /tenants/:id` → 400 with field issues.
- Semantic colors are unchanged regardless of theme.
- Tests: Zod schema unit tests; integration test of PATCH + `/auth/me` returning the theme; frontend test that CSS variables update on tenant switch.

## Implementation notes (optional)

Small feature (~1 day). Riskiest bit is deriving the garnet-ink family tones from an arbitrary tenant primary (`DESIGN.md` §Future Evolutions) — compute with a tiny color utility, no dependency. No RLS or permission changes: reuses `tenant:manage`.
