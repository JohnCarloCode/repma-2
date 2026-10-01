# Feature 004 — Installable mobile PWA

> Status: proposed
> Date: 2026-08-22

## Context and motivation

The primary users are staff walking a shop floor with a phone in one hand: flagging a size out of stock (RF-20) and checking off replenishment lines (RF-40) happen standing in an aisle, not at a desk. The design system already commits to touch (44px hit areas, drawer navigation, wrapping size runs — `DESIGN.md` §Responsive Behavior); making the app installable and resilient on flaky store Wi-Fi is the missing operational step.

## Scope

- Web app manifest (name, icons, `display: standalone`, theme color from the design tokens) + install prompt handling; served by the API like the rest of the static build (RNF-11).
- Service worker with a deliberately small strategy:
  - **Precache the app shell** (build assets) — instant loads on repeat visits.
  - **Network-first for all `/api` calls** with no API response caching in the MVP of this feature: availability data must never be stale-served silently (a cached "available" flag contradicts the page's whole purpose, DP-06/DP-07).
  - An **offline fallback page** ("You're offline — REPMA needs a connection") when navigation fails.
- A visible offline indicator in the shell (`shared/layout.md`) so a failed flag is understood as connectivity, not a bug.
- Lighthouse PWA installability passing in CI (optional gate, documented either way).

## Out of scope

- **Offline mutation queue / background sync.** Deferred deliberately: queued availability events replayed later would reorder the ledger's "latest event wins" semantics (RN-05, RN-07) — out-of-order flags from two offline devices need conflict rules the product has not defined. Not worth the risk for the MVP of this feature.
- Push notifications (no notification product exists; see feature 003 for real-time while the app is open).
- Native wrappers (Capacitor etc.).
- Caching API responses for offline reading.

## Impact on existing documentation

- `core/spec.md`: new RNF under §4.2 (installability, offline fallback behavior).
- `core/architecture.md`: minor — static serving of manifest/SW alongside the SPA (RNF-11); a note that the SW never caches `/api`.
- `core/database.md`: none.
- `design/shared/layout.md`: the offline indicator; app icon/splash derived from the wordmark.

## Acceptance criteria

- The app is installable (valid manifest + SW) and opens standalone to `/login` or `/home` per session state.
- With no connection, navigating shows the offline fallback page; regaining connection recovers without a manual reload.
- A mutation attempted offline fails with a clear toast (not a silent spinner) and the offline indicator is visible.
- `/api` responses are never served from SW cache (test: flag an item, verify no cached availability payload is replayed).
- A new deploy activates the updated SW without users being stuck on an old shell (update-on-reload strategy, tested manually and documented).

## Implementation notes (optional)

Small feature (~1–2 days) if kept to this scope; the real danger is scope creep into offline-first, which is explicitly out. Use Vite's PWA plugin (generates manifest + Workbox SW) rather than a hand-rolled service worker. SW update flow is the classic footgun — pick `autoUpdate` and verify it against the deploy pipeline (RNF-15).
