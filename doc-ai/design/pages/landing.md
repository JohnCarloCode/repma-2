# Landing — `/`

> Guard: public (any session state) · Zone: public
> API: none (static content; the size demo is local state and never calls the API)

## Purpose
Marketing entry point of the demo: explains what REPMA is and sends visitors to `/login` (which lists the demo accounts). Not part of the product shell, no data, no queries. A visitor who already has a session can still use "Try the demo" → `/login`, which redirects to their role home (login.md).

## Layout
NO app shell. Single scrolling page, always **light** (it ignores the app theme), max content width 1232px:
1. **Header** — sticky bar that, after scrolling 90px, floats as a rounded navy pill (CSS `animation-timeline: scroll(root)`): brand, section links (Home, Product, How it works, Roles; hidden under 860px), "Try the demo" button.
2. **Hero** — headline with the blinking owl, lede, two CTAs ("Try the demo" → `/login`, "See the product" → `#product`), typed line, framed home GIF, three fact chips.
3. **Problem + size demo** (`#problem`) — statement, then the interactive lab: three products × six sizes (toggle buttons, `aria-pressed`) and an event log (latest 6; each tap prepends a "Marked out of stock"/"Marked available" event) with a "units not tracked" tally (RN-05 flavour: no quantities).
4. **Screens strip** (`#screens`) — four screenshots (Home, Availability, Replenishment, Catalog) in an endless horizontal strip that scrolls by itself (three copies of the set, wrapping invisibly); it pauses on hover, focus, touch and manual scroll, and does not move for `prefers-reduced-motion`. No arrow buttons.
5. **Features** (`#product`) — three alternating copy + media rows (flag-a-size GIF, replenishment GIF, catalog-per-store GIF).
6. **How it works** (`#how`) — three numbered steps.
7. **Any shop** (`#any-shop`) — the demo is clothing but the product fits restaurants, cafés and any retail chain; multi-tenant, several businesses side by side.
8. **Roles** (`#roles`) — permission table (platform admin / manager / employee).
9. **Final CTA** and **footer** (navy, rounded top, oversized wordmark).

The page also has a **Contact me** button (header link, footer link and a secondary button next to "Try the demo" in the final CTA) that opens a native `<dialog>` with LinkedIn and email links; there is no contact section.

## Design exception
The landing is the one place that does not consume the design tokens of `DESIGN.md`: it has its own palette (navy ink, blue, garnet, panel greys) as CSS variables defined on `.landing` in `apps/web/src/styles/landing.css`. Every selector in that file is scoped under `.landing` and its keyframes are prefixed `landing-`, so nothing leaks into the app and the token tests (`theme.test.ts`, `contrast.test.ts`) are unaffected. Fonts are the app's self-hosted Inter and JetBrains Mono.

## Media
All under `apps/web/public/landing/`, referenced as `/landing/<file>`: `shot-*.jpg` (screens, 3200x2000), and four GIFs recorded from the app (Playwright, 1200px wide, 15 fps, looping): `hero-home.gif` (Home as the Downtown manager), `flag-size.gif` (search, mark a size out of stock, restock it), `replenishment-lists.gif` (tick an item and edit its quantity in "Jersey wall restock"), `catalog-stores.gif` (platform admin switching store in the sidebar on `/catalog`, Evergreen category). Swapping a GIF or image = replacing the file with the same name. Logos reuse `public/logo.svg` and `public/logo-blink.svg`.

## Accessibility
Real links/buttons with labels; decorative images `alt=""`; the typed line exposes its full text via `aria-label`; strip and table are focusable regions; CSS animation is disabled under `prefers-reduced-motion`. Known limitation: the GIFs are plain `<img>` and cannot be paused by CSS, so they keep playing for those users.

## States
Static: no loading/empty/error states. The page renders after the session bootstrap like every route.
