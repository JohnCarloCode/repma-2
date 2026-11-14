# Feature 001 — Per-tenant theming (configurable brand accent)

> Status: proposed
> Date: 2026-08-16

## Context and motivation

Every store sees the same default accent. Letting each tenant configure its brand accent makes the platform feel white-label and showcases the token-based design system. `DESIGN.md` already anticipates this (§Known Gaps): the brand is one token, `{colors.accent}`, consumed exclusively as the `--color-accent` CSS custom property, with every accent tone derived from it via `color-mix()` — so this feature requires no component changes.

## Scope

- New `theme` JSONB column on `tenants` (nullable; `NULL` = default accent from `DESIGN.md`). Shape: `{ "accent": "#8E1B3B" }`.
- `PATCH /tenants/:id` accepts `theme` (Zod: valid hex color, whitelist of the single `accent` key).
- `GET /auth/me` returns the effective theme of the user's store (or of the selected store for platform_admin).
- Frontend injects `--color-accent` at session load and on tenant-selector change; the derived tones (`accent-hover`, `accent-active`, `accent-bright`, `accent-soft`) follow automatically through `color-mix()` in both themes — no client-side color math.
- Theme editor UI in `/platform/tenants` edit modal (one color picker + live preview + "Reset to default accent").

## Out of scope

- Configuring functional colors (alert red, `live` green, neutrals) — fixed forever so alerts always read the same (DESIGN.md).
- Logos, fonts or any theming beyond the accent.
- Contrast validation beyond a minimal check (warn if `on-accent` text on the chosen accent, or `accent-bright` on the surfaces, fails WCAG AA).
- Manager self-service theming: only the Platform Admin edits it (consistent with DP-04's centralization philosophy).

## Impact on existing documentation

- `core/spec.md`: new RF for theme configuration under §3.2 (Tenants).
- `core/architecture.md`: no new AD needed — covered by the existing token decision in `design/DESIGN.md`.
- `core/database.md`: `tenants.theme jsonb` column (migration; no RLS change — same row, same policies).
- `design/DESIGN.md`: remove the per-tenant accent entry from Known Gaps; note the per-tenant override of `--color-accent`.
- `design/pages/platform-tenants.md`: add the theme editor to the edit modal.

## Acceptance criteria

- Given a tenant with no `theme`, the UI renders the default accent.
- Given a tenant with `theme` set, its manager/employee see the custom colors on login; platform_admin sees them when selecting that store.
- Invalid hex or unknown keys in `PATCH /tenants/:id` → 400 with field issues.
- Functional colors are unchanged regardless of theme.
- Tests: Zod schema unit tests; integration test of PATCH + `/auth/me` returning the theme; frontend test that CSS variables update on tenant switch.

## Implementation notes (optional)

Small feature (~1 day). Tone derivation is already solved by `color-mix()` in the token layer; the riskiest bit is readability of an arbitrary accent — hence the contrast warning. No RLS or permission changes: reuses `tenant:manage`.
