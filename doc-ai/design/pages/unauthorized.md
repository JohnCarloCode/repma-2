# Unauthorized — `/unauthorized`

> Guard: public (any session state) · Zone: system
> API: none (reads the already-loaded auth context; no calls of its own)

## Purpose
Landing for permission-guard redirects (RF-31/RF-32): a user with a session tried a route their permission set doesn't allow (`../shared/layout.md` §Route guards, rule 2). Explains the situation and offers a way back.

## Layout
Per `../shared/layout.md`: **with a session it renders inside the app shell** (the sidebar stays, so the user keeps their navigation); **without a session, bare** — centered content on `canvas`, same framing as `/login` but without the card form. Content: centered `empty-state` pattern (DESIGN.md) — icon, `h1` heading, one-line body, one action link.

## Content
- Heading (h1): "Unauthorized access".
- Body (one line, muted): "You don't have permission to view this page."
- Single action, `button-primary` styled link to the user's role home:
  - platform_admin → `/platform/tenants`, label "Go to stores".
  - manager / employee → `/home`, label "Go to Home".
  - No session → `/login`, label "Sign in" (rare: direct navigation without session; guards normally send 401s to `/login`).

## States
None beyond the static render — no queries, so no loading/empty/error states.

## Flows
1. A route guard detects a missing permission and redirects here (client-side, no API call).
2. User clicks the home link → normal client navigation; the target route's own guard applies as usual.

## Edge cases
- **Direct URL visit with full permissions**: page still renders (it makes no permission claim of its own); the home link simply takes them back.
- **API 403 on an action** does NOT navigate here — that surfaces as an error toast (`../shared/layout.md` §Route guards); this page is only for route-level denials.
- Not listed in the sidebar; the sidebar shows no active item while here.
