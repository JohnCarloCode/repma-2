# Landing — `/`

> Guard: public (any session state) · Zone: public
> API: none (static content)

## Purpose
Marketing entry point of the demo: explains what REPMA is and sends visitors to `/login` (which lists the demo accounts). Not part of the product shell, no data, no queries. A visitor who already has a session can still use "Try the demo" → `/login`, which redirects to their role home (login.md).

## Layout
NO app shell. Single scrolling page, always **light** (it ignores the app theme), max content width 1232px:
1. **Header** — sticky bar that, after scrolling 90px, floats as a rounded navy pill with a 12px margin to the screen edges (CSS `animation-timeline: scroll(root)`): brand, section links (Home, Product, How it works, Roles; hidden under 860px), "Try the demo" button.
2. **Hero** — headline with the blinking owl, a one-sentence lede, two CTAs ("Try the demo" → `/login`, "See the product" → `#product`), framed home GIF.
3. **How it works** (`#how`) — light-blue band, three numbered steps as bordered cards (soft shadow; on hover the border turns blue and the card lifts 4px).
4. **Features** (`#product`) — three alternating copy + media rows (flag-a-size GIF, replenishment GIF, catalog-per-store GIF), no bullet lists.
5. **Any shop** (`#any-shop`) — blue band: the demo is clothing but the product fits restaurants, cafés and any retail chain; multi-tenant, several businesses side by side.
6. **Roles** (`#roles`) — permission table (platform admin / manager / employee).
7. **Final CTA** and **footer** (navy, rounded top, oversized wordmark).

Sections are separated by generous vertical space (120–240px); screen frames are slim (8px).

The page also has a **Contact me** button (header link, footer link and a secondary button next to "Try the demo" in the final CTA) that opens a native `<dialog>` with LinkedIn and email links; there is no contact section.

## Design exception
The landing is the one place that does not consume the design tokens of `DESIGN.md`: it has its own palette (navy ink, blue, garnet, panel greys) as CSS variables defined on `.landing` in `apps/web/src/styles/landing.css`. Every selector in that file is scoped under `.landing` and its keyframes are prefixed `landing-`, so nothing leaks into the app and the token tests (`theme.test.ts`, `contrast.test.ts`) are unaffected. Fonts are the app's self-hosted Inter and JetBrains Mono.

## Media
All under `apps/web/public/landing/`, referenced as `/landing/<file>`: `shot-*.jpg` (screens, 3200x2000; currently unused by the page), and four GIFs recorded from the app (Playwright, 1200px wide, 15 fps, looping): `hero-home.gif` (Home as the Downtown manager), `flag-size.gif` (search, mark a size out of stock, restock it), `replenishment-lists.gif` (tick an item and edit its quantity in "Jersey wall restock"), `catalog-stores.gif` (platform admin switching store in the sidebar on `/catalog`, Evergreen category). Swapping a GIF or image = replacing the file with the same name. Logos reuse `public/logo.svg` and `public/logo-blink.svg`.

## Accessibility
Real links/buttons with labels; decorative images `alt=""`; the table is a focusable region; CSS animation is disabled under `prefers-reduced-motion`. Known limitation: the GIFs are plain `<img>` and cannot be paused by CSS, so they keep playing for those users.

## States
Static: no loading/empty/error states. The page renders after the session bootstrap like every route.
