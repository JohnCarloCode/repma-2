# Login — `/login`

> Guard: public · Zone: public
> API: `POST /api/v1/auth/login`, `GET /api/v1/auth/me` (session bootstrap after success)

## Purpose
Single entry point to the application (DP-01: everything is behind login, no signup, no password recovery). Used by every role: platform_admin, manager, employee. Authenticates via email/password and establishes the HttpOnly cookie session (RF-01) — the page never sees or stores a token (AD-12).

## Layout
NO app shell (per `../shared/layout.md`: public pages don't use it). A single centered card (`card` from DESIGN.md) on the `canvas` background, max-width ~400px, vertically centered. Inside: product wordmark, heading at `display` size (per DESIGN.md typography table: "login heading"), then the form. Space below the card is reserved for a future demo-credentials hint when the landing page is built — leave the slot, do not design the landing.

## Content
Form (single column, per DESIGN.md §Forms):

| Field | Type | Validation (Zod, shared schema from `packages/shared`) |
|---|---|---|
| Email | `text-input`, type=email, autocomplete=email | required, valid email format |
| Password | `text-input`, type=password, autocomplete=current-password | required, non-empty |

- Heading: "Sign in". Submit: `button-primary`, full-width, label "Sign in"; pending label "Signing in…" (disabled while pending).
- No "Forgot your password?" link, no signup link (DP-01 — users are created by the Platform Admin, RF-10; a forgotten password is reset by the Platform Admin, RF-11).
- Inline error area between the fields and the submit button for non-field errors (401/429), rendered in `error` tone.

## States
- **Field validation**: per `../shared/components.md` Forms — validate on submit, then per-field on blur. Messages: "Enter a valid email address", "Password is required".
- **Submitting**: submit button disabled + pending label. Fields stay enabled (user can correct a typo before response).
- **Credential error (401)**: single generic inline message — "Incorrect email or password." Same message for wrong credentials, deactivated user, or deactivated store (RF-05): the API returns a uniform 401 and the UI must never reveal which case it was.
- **Rate limited (429, RNF-07: login capped at 10/min)**: friendly inline message — "Too many attempts. Wait a minute and try again." Not a toast, not a raw error code.
- **Network/5xx**: inline "Could not sign in. Try again." No toasts on this page — errors render inline in the card.
- Already authenticated user visiting `/login`: redirect immediately to their role home (see Flows), no form flash.

## Flows

### Successful login
1. Submit → client-side Zod validation → `POST /api/v1/auth/login` (`credentials: include`).
2. On 200 the API sets the HttpOnly session cookie (RF-01, RNF-03); the response body carries no token the page needs.
3. The client refreshes the auth context (`GET /auth/me`, RF-02 — user, role, store, effective permissions) and redirects:
   - **return-to-intended-URL first**: if the guard that sent the user here preserved an intended URL (`../shared/layout.md` §Route guards, rule 1), navigate there — provided the fresh session's permissions allow it; otherwise fall through to the role home.
   - **platform_admin** → `/platform/tenants`.
   - **manager / employee** → `/home`.
4. No success toast — the navigation itself is the feedback.

### Failed login
1. 400 (validation) → inline field errors mapped by name (`../shared/components.md` Forms).
2. 401 → generic message above; password field cleared, focus returned to it.
3. 429 → rate-limit message above; submit stays enabled (the server is the authority on when retries succeed).

## Edge cases
- **Intended URL pointing to a route the logged-in role can't access**: after login the route guard resolves it normally → `/unauthorized` per `../shared/layout.md`; the login page doesn't pre-filter beyond falling back to the role home when it can check cheaply.
- **Intended URL is `/login` or external**: ignored; use role home. Only same-origin app paths are honored.
- **Session expires mid-use**: any 401 from the API clears the auth context and lands here with the current URL preserved as intended URL (guard rule 1).
- **platform_admin redirect target**: `/platform/tenants`, not `/home` — Home is a store view and the admin may have no store selected yet (picker state exists but is a worse landing).
- **Autofill**: correct `autocomplete` attributes so password managers work; this is the only credential surface in the product.
- **Enter key** submits from either field (native form submit).
