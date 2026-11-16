---
version: 2.0
name: REPMA-design
description: A technical dashboard for a dense B2B availability & replenishment app — dark by default, with an equivalent light theme. It should feel like a control room, not a social app — a "Power BI dashboard" simplified for the store floor, read on a laptop or a tablet. Dark theme: near-black floor (#121212), charcoal cards (#1E1E1E) with a 1px #2C2C2E border and 16px radius; light theme: the same structure on #F4F4F6 / #FFFFFF. Zero shadows in both. Inter for UI, JetBrains Mono for every figure. Color is functional: one configurable brand accent (garnet by default) for actions, focus and data strokes; red for alerts (out of stock); green for live/normal states.

# ─────────────────────────────────────────────────────────────────────────────
# THE ACCENT IS CONFIGURABLE. Exactly one value is the brand: {colors.accent}.
# Every other accent tone is DERIVED from it (CSS color-mix), so changing the
# brand means changing one line. Nothing in the product hard-codes a garnet hex.
# ─────────────────────────────────────────────────────────────────────────────
colors:
  # Brand (configurable) — default garnet
  accent: "#8E1B3B"             # THE one configurable value. Fills: primary buttons, active nav pill, logo tile, selected states
  accent-hover: "color-mix(in oklab, {colors.accent} 85%, white)"   # hover of accent fills
  accent-active: "color-mix(in oklab, {colors.accent} 80%, black)"  # press of accent fills
  accent-bright: "color-mix(in oklab, {colors.accent} 55%, white)"  # accent as TEXT/STROKE on dark: links, focus ring, chart line, KPI highlight (#C18293 with the default)
  accent-soft: "color-mix(in oklab, {colors.accent} 22%, transparent)" # tinted backgrounds: selected row, active nav, chart area gradient start
  on-accent: "#FFFFFF"          # text/icons on accent fills
  on-alert: "#121212"           # text on alert fills (danger button): white on #FF453A is only 3.4:1

  # Surfaces — DARK theme (default). The light theme overrides these in `colors-light` below.
  canvas: "#121212"             # page background
  surface: "#1E1E1E"            # cards, tables, modals, sidebar, inputs
  surface-hover: "#242424"      # row hover, menu item hover
  surface-raised: "#2C2C2E"     # nested fills: table header, input on card, icon buttons, progress track
  border: "#2C2C2E"             # 1px borders of cards, row dividers, chart grid lines
  border-strong: "#3A3A3C"      # input borders, the dotted out-of-stock outline
  scrim: "rgba(0, 0, 0, 0.6)"   # modal backdrop

  # Text
  text: "#FFFFFF"               # primary text, values
  text-secondary: "#98989D"     # labels, table headers, meta, inactive nav
  text-disabled: "#5A5A5E"

  # Semantic
  alert: "#FF453A"              # out of stock, destructive actions, errors
  alert-soft: "#3A1C1C"         # alert box background
  live: "#32D74B"               # "live"/normal/available/done states
  live-soft: "#16301C"
  warning: "#FFD60A"            # "processing" list status, non-blocking warnings
  warning-soft: "#332B0A"
  info: "#64D2FF"               # "draft" list status, informational notes
  info-soft: "#0E2A36"

# LIGHT theme — same token names, different values (§Themes). Applied by a theme class on the
# app root; the accent stays the same configurable value, only its derivations change.
colors-light:
  on-alert: "#FFFFFF"
  canvas: "#F4F4F6"
  surface: "#FFFFFF"
  surface-hover: "#F2F2F4"
  surface-raised: "#EAEAED"
  border: "#E3E3E7"
  border-strong: "#C4C4CA"
  text: "#1C1C1E"
  text-secondary: "#62626A"
  text-disabled: "#A1A1A8"
  alert: "#D70015"
  alert-soft: "#FDE9EA"
  live: "#197A35"
  live-soft: "#E5F4EA"
  warning: "#8A5A00"
  warning-soft: "#FFF3D1"
  info: "#0A6A9C"
  info-soft: "#E2F1F9"
  accent-hover: "color-mix(in oklab, {colors.accent} 88%, black)"
  accent-bright: "color-mix(in oklab, {colors.accent} 92%, black)"   # on light, the readable accent is a slightly DARKER one
  accent-soft: "color-mix(in oklab, {colors.accent} 12%, transparent)"

typography:
  fontFamily: "'Inter', system-ui, sans-serif"
  fontFamilyMono: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace"   # every number that is data
  kpi:
    fontFamily: "{typography.fontFamilyMono}"
    fontSize: 32px
    fontWeight: 700
    lineHeight: 1.1
  display:                      # page title
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.25
  h2:                           # card / section title
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  body-medium:
    fontSize: 14px
    fontWeight: 500
  label:                        # KPI labels, table headers — uppercase optional only in table headers
    fontSize: 12px
    fontWeight: 500
    letterSpacing: 0.02em
  caption:
    fontSize: 12px
    fontWeight: 400
  data:                         # SKUs, sizes, elapsed figures, counts inside tables
    fontFamily: "{typography.fontFamilyMono}"
    fontSize: 13px
    fontWeight: 500

rounded:
  sm: 8px                       # buttons, inputs, size tiles, icon buttons, toasts
  md: 16px                      # cards, modals, sheets, alert boxes
  full: 9999px                  # badges, nav items, tenant selector

spacing:                        # multiples of 8 (4 allowed only inside dense components)
  xs: 4px
  sm: 8px
  base: 16px
  card: 20px                    # card inner padding
  lg: 24px
  xl: 32px
  xxl: 48px

layers:                         # one z-index scale; nothing in the shell outranks a dialog
  base: 0
  sticky: 10
  shell: 100
  shell-overlay: 110
  shell-panel: 120
  sheet-scrim: 130
  sheet: 140
  popover: 200
  dialog-scrim: 900
  dialog: 910
  toast: 1000

motion:
  fast: 120ms                   # hover, focus, press
  base: 200ms                   # enter/leave of menus, sheets, modals
  easing: "cubic-bezier(0.2, 0, 0, 1)"

components:
  card:
    backgroundColor: "{colors.surface}"
    border: "1px solid {colors.border}"
    rounded: "{rounded.md}"
    padding: 20px
  kpi-strip:                    # ONE full-width card holding N figures, separated by vertical 1px {colors.border} rules
    extends: card
    valueStyle: "{typography.kpi} {colors.text}"        # value on top
    labelStyle: "{typography.caption} {colors.text-secondary}"   # label beneath, sentence case
    divider: "1px solid {colors.border}"
    accentValue: "{colors.accent-bright}"   # optional: the ONE figure the screen is about
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    hover: "{colors.accent-hover}"
    active: "{colors.accent-active}"
    rounded: "{rounded.sm}"
    height: 44px
    padding: 0 16px
    fontWeight: 500
  button-secondary:
    backgroundColor: transparent
    textColor: "{colors.text}"
    border: "1px solid {colors.border-strong}"
    hover: "background {colors.surface-hover}"
    rounded: "{rounded.sm}"
    height: 44px
  button-danger:
    backgroundColor: "{colors.alert}"
    textColor: "{colors.on-alert}"
    rounded: "{rounded.sm}"
    height: 44px
  button-text:
    textColor: "{colors.accent-bright}"
    hover: underline
  icon-button:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    hover: "{colors.surface-hover}"
    rounded: "{rounded.sm}"
    visualSize: 32px
    hitArea: 44px
  text-input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.text}"
    placeholder: "{colors.text-secondary}"
    border: "1px solid {colors.border-strong}"
    focus: "1px solid {colors.accent-bright} + 3px ring {colors.accent-soft}"
    rounded: "{rounded.sm}"
    height: 44px
  sidebar:
    backgroundColor: "{colors.surface}"
    borderRight: "1px solid {colors.border}"
    width: 248px
    widthCollapsed: 72px
  sidebar-item:
    textColor: "{colors.text-secondary}"
    hover: "background {colors.surface-hover}, text {colors.text}"
    rounded: "{rounded.full}"
    height: 44px
  sidebar-item-active:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.text}"
    iconColor: "{colors.accent-bright}"
  mobile-header:
    backgroundColor: "{colors.surface}"
    borderBottom: "1px solid {colors.border}"
    height: 56px
  filter-band:                  # search + selects above a table — a neutral card, like the list cards
    backgroundColor: "{colors.surface}"
    border: "1px solid {colors.border}"
    rounded: "{rounded.md}"
    padding: 16px
    gap: 12px
    controls: "{colors.canvas} well, 1px {colors.border-strong}, 44px high"   # like the form inputs
  table-header:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-secondary}"
    font: "{typography.label}"
    borderBottom: "1px solid {colors.border}"
    padding: 10px 16px
  table-row:
    borderBottom: "1px solid {colors.border}"
    hover: "{colors.surface-hover}"
    padding: 10px 16px
    minHeight: 44px
  alert-box:
    backgroundColor: "{colors.alert-soft}"
    textColor: "{colors.alert}"
    borderLeft: "4px solid {colors.alert}"
    rounded: "{rounded.md}"
    padding: 16px
  out-of-stock-mark:            # DP-07 — ONE mark for every missing size, at any age
    backgroundColor: transparent
    textColor: "{colors.text}"
    border: "1px dashed {colors.border-strong}"
    dotSize: 6px
    dotColor: "{colors.alert}"
  aging-figure-fresh:           # < 24h
    font: "{typography.data}"
    fontWeight: 400
    textColor: "{colors.text-secondary}"
  aging-figure-attention:       # 24h – 7d
    font: "{typography.data}"
    fontWeight: 600
    textColor: "{colors.text}"
  aging-figure-escalated:       # > 7d
    font: "{typography.data}"
    fontWeight: 700
    textColor: "{colors.alert}"
  size-run:
    gap: 8px
    tileHeight: 44px
    tileMinWidth: 44px
    tileFont: "{typography.data}"
  run-tile-available:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
  run-tile-out:
    extends: out-of-stock-mark
    rounded: "{rounded.sm}"
  run-tile-selected:            # ProductPicker only
    backgroundColor: "{colors.accent-soft}"
    border: "2px solid {colors.accent-bright}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
  run-tile-disabled:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-disabled}"
    rounded: "{rounded.sm}"
  badge:                        # pill, soft background + strong text of the same semantic pair
    rounded: "{rounded.full}"
    padding: 2px 10px
    font: "{typography.label}"
  badge-status-draft: { backgroundColor: "{colors.info-soft}", textColor: "{colors.info}" }
  badge-status-processing: { backgroundColor: "{colors.warning-soft}", textColor: "{colors.warning}" }
  badge-status-done: { backgroundColor: "{colors.live-soft}", textColor: "{colors.live}" }
  badge-inactive: { backgroundColor: "{colors.surface-raised}", textColor: "{colors.text-secondary}" }
  badge-out-of-stock: { extends: out-of-stock-mark, rounded: "{rounded.full}" }
  badge-live: { backgroundColor: "{colors.live-soft}", textColor: "{colors.live}", leadingDot: "pulsing 6px {colors.live}" }
  progress-bar:
    trackColor: "{colors.surface-raised}"
    fillColor: "{colors.accent-bright}"
    height: 8px
    rounded: "{rounded.full}"
  toast:
    backgroundColor: "{colors.surface}"
    border: "1px solid {colors.border}"
    borderLeft: "4px solid <semantic tone>"
    rounded: "{rounded.sm}"
  modal:
    backgroundColor: "{colors.surface}"
    border: "1px solid {colors.border}"
    rounded: "{rounded.md}"
    padding: 24px
  sheet:
    backgroundColor: "{colors.surface}"
    borderLeft: "1px solid {colors.border}"
    width: 420px
  tooltip:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    font: "{typography.caption}"
    rounded: "{rounded.sm}"
  logo-tile:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    size: 32px
    rounded: "{rounded.sm}"
  chart:                        # no chart exists today (RF-41); these rules apply the day one does
    grid: "1px {colors.border}"
    line: "2px {colors.accent-bright}"
    area: "linear-gradient({colors.accent-soft} → transparent)"
    secondarySeries: "{colors.live}"
---

## Overview

REPMA is an internal B2B multi-tenant availability & replenishment tool: stores flag which product sizes are out of stock and keep manual replenishment lists — no stock quantities are ever shown (RN-05). The visual language is a **dark technical dashboard**: it must convey *technical reliability* and *control*. It is not a social app and not a game. Think of a Power BI dashboard simplified for a store manager on a laptop or an employee holding a tablet on the shop floor.

**Key characteristics**
- **Dark by default, light available** (§Themes). Same tokens, same structure, two value sets. Dark is the default because it suits long data reading and makes figures stand out.
- **Cards are the unit.** 16px radius, 20px padding, 1px `{colors.border}` border. **No box-shadows anywhere** — separation is surface contrast + 1px borders.
- **Numbers are monospaced.** Every figure that is data (KPIs, counts, sizes, SKUs, elapsed times) uses JetBrains Mono, so columns align and values read like instrument readouts.
- **Color is functional, never decorative**: the configurable accent = "act here / this is the thread"; red = alert (out of stock, destructive); green = live / available / done. Everything else is grayscale.
- **Dense but breathable**: 8px spacing grid, 44px touch targets on the shop-floor components (size run, icon buttons).
- UI copy ships in English (RNF-19).

## Colors

### Brand accent — configurable
The brand is **one token: `{colors.accent}`** (default garnet `#8E1B3B`). All accent tones (`accent-hover`, `accent-active`, `accent-bright`, `accent-soft`) are derived from it with CSS `color-mix()`, so the whole product re-brands by changing a single value.

Implementation contract (visual only, no runtime feature implied):
- The accent lives as **one CSS custom property** (`--color-accent`) in the single theme file (`apps/web/src/styles/theme.css`, which maps every token of this document to Tailwind); derived tones are custom properties computed from it. Components consume only the derived variables — never a literal hex.
- Two roles, never swapped: **`accent` fills** (primary button, logo tile, accent badges — always with `{colors.on-accent}` text) and **`accent-bright` strokes/text** (links, focus ring, active nav icon, progress fill, chart line, highlighted KPI). A dark garnet is unreadable as text on `#121212`; that is why `accent-bright` exists.
- Contrast is verified for the default (on-accent on accent ≈ 8.9:1; accent-bright on surface ≈ 5.5:1). **Whoever changes the accent must re-check both ratios** (§Accessibility).

### Themes
Two themes share every token name: `colors` (dark, default) and `colors-light`. The theme is a class on the app root (`repma-dark` / `repma-light`) that swaps the variable values; components never know which theme is active. The accent is the same configurable value in both — only its derived tones change (on light, `accent-bright` is a slightly darker accent, because a lightened garnet would not read on white). How the user picks a theme is not specified by any RF yet; until it is, the app ships dark and the light set exists as tokens.

### Surfaces, borders, text
`canvas` → `surface` → `surface-raised` is the whole depth scale. Row hover uses `surface-hover`. Borders are `border` (1px, everywhere) and `border-strong` (inputs, the out-of-stock outline). Text is white (`text`) or gray (`text-secondary`) — never another color for plain text.

### Semantic
| Tone | Use | Never |
|---|---|---|
| `alert` #FF453A | Out-of-stock mark dot, escalated elapsed figure, alert boxes, destructive buttons, form errors | Brand or decoration |
| `live` #32D74B | "Live"/normal states, available, `done` list status | Primary actions |
| `warning` #FFD60A | `processing` list status, non-blocking warnings | Out of stock |
| `info` #64D2FF | `draft` list status, informational notes | Links (links are `accent-bright`) |

Each semantic tone has a `-soft` pair for backgrounds; text on a soft background is always its strong pair.

### Out of stock — one mark, one number
**Every out-of-stock size wears exactly the same mark; only the elapsed figure says how long** (DP-07).

- **The mark** (`{components.out-of-stock-mark}`): transparent fill, 1px **dashed** `border-strong` outline, white label and a 6px `alert` dot before it. Available sizes are flat `surface-raised` tiles with no outline and no dot — "here" and "missing" differ by fill, border style and the dot, so the run still reads in grayscale.
- **The number**: the elapsed figure (mono, always rendered as text, e.g. `9 d`) escalates by band — fresh < 24h (regular, gray), attention 24h–7d (semibold, white), escalated > 7d (bold, `alert`). Units: `<1 h`, `5 h`, `9 d`, `3 w` — one unit, never compound, always floored: hours under a day, days under three weeks, weeks beyond. Thresholds live only in DP-07.
- One definition of the mark and one of the figure scale exist; run tiles and `badge-out-of-stock` consume them. Restocked/available items carry neither.

## Typography
- **Inter** for all UI: page titles 24px semibold, card titles 18px semibold, body 14px regular, labels 12px medium.
- **JetBrains Mono** (fallback Fira Code) for data: KPI values 32px bold; sizes, SKUs, counts, elapsed figures 13px medium inside tables and runs. `font-variant-numeric: tabular-nums` everywhere numbers stack.
- **Wordmark**: "REPMA" in Inter 14px semibold, letter-spacing 0.14em, next to the 32px `logo-tile` (accent fill, white "R").

### Iconography
**Material Symbols Rounded**, one configuration product-wide: `opsz 20, wght 400, FILL 0, GRAD 0` (outlined). Shipped as a subset — only the glyphs below are loaded; adding an icon means adding it to the subset **and** to this list (subset = `apps/web/src/styles/icons.json` + `npm run icons -w web`, which regenerates the self-hosted font).
- Navigation: `home`, `list_alt` (Replenishment), `inventory_2` (Availability), `history` (Activity), `menu_book` (Catalog), `storefront` (Stores), `group` (Users), `category` (Global catalog).
- Chrome: `menu`, `close`, `chevron_left` / `chevron_right`, `expand_less` / `expand_more`, `logout`, `person`, `lock`, `search`, `space_dashboard`.
- Actions & feedback: `add`, `edit`, `delete`, `remove`, `check`, `check_circle`, `block` (retire), `restart_alt` (reactivate), `refresh` (retry), `arrow_back`, `swap_vert`, `error`, `warning`, `info`, `image`.
- Don't use generic decorative icons (lightbulbs, sparkles, rockets).

## Shape
- `rounded.sm` 8px — everything you act on: buttons, inputs, icon buttons, size tiles, toasts.
- `rounded.md` 16px — containers: cards, modals, sheets, alert boxes.
- `rounded.full` — things that name or navigate: badges, nav items, tenant selector.

## Layout

### Application Shell
- **Sidebar** (`{components.sidebar}`): full height, `surface` with a right border; 248px expanded / 72px collapsed (icon rail with tooltips). Top to bottom: logo + wordmark, tenant selector (platform admin) or store name, navigation, Platform section (admin), user menu at the bottom. Active item = `accent-soft` pill with `accent-bright` icon. Behavior and persistence: `shared/layout.md`.
- **No topbar ≥ 744px.** Each page opens with its own header. **Mobile (< 744px)**: fixed 56px `mobile-header` with the drawer trigger; the sidebar becomes an off-canvas drawer.
- **Content area**: 24px padding (16px mobile), max width 1440px.

### Grid & spacing
- **12-column grid**, 24px gutters. Spacing in multiples of 8px (8 / 16 / 24 / 32 / 48). 4px only inside dense components.
- Vertical rhythm between page sections: 24px. Card padding 20px; tables inside a card run full-bleed to its edges.

### Screen Skeletons
- **Dashboard pattern (Home)**: greeting header (title + store · date line, "New list" primary on the right) → one full-width **KPI strip** (`{components.kpi-strip}`: the three RF-41 figures in one card, separated by vertical rules) → open replenishment work → out-of-stock products → recent activity, **each a full-width block, stacked**. Content and data: `pages/home.md`.
- **List screens** (products, users, tenants, activity): page header (title + primary action right) → filter band → table card → pagination. Deleting the last item of a page navigates back one page (RF-36).
- **Availability** (AD-22): same header and filter band, but the body is a list of products, one row each: identity, its size run, the elapsed figure right-aligned. A tile click opens `/availability/:id`.
- **Replenishment**: same header, filter band and pagination; body is a responsive grid of list cards (status badge, name, size summary, progress bar, provenance).
- **Detail screens**: header with back button → summary card → related table card.
- **Forms**: single column, 480–640px, inside a card or modal; labels above inputs, errors in `alert` beneath.

## Elevation
**No box-shadows. None.** Depth = surface step (`canvas` → `surface` → `surface-raised`) + 1px `border`. Floating layers (menus, popovers, tooltips) are `surface`/`surface-raised` with a 1px `border-strong` border. Modals sit on `{colors.scrim}`.

### Layering
Use only the `layers` scale. Dialog scrims sit above the entire shell; toasts above everything.

## Motion
Two durations (`fast` 120ms for hover/focus/press, `base` 200ms for enter/leave), one easing. CSS only. The `badge-live` dot may pulse; nothing else loops. Respect `prefers-reduced-motion` (all transitions → 0ms, no pulse).

## Components

### Buttons
Primary = `accent` fill, white text, 8px radius, 44px high (buttons and inputs share the 44px touch rule). Secondary = transparent with `border-strong`. Danger = `alert` fill with `on-alert` text (dark ink on the dark theme's bright red, white on the light theme's deep red). Text buttons = `accent-bright` with underline on hover. One primary per screen. Icon buttons: 32px visual, 44px hit area.

### Navigation
Pills in the sidebar; active = `accent-soft` background, white label, `accent-bright` icon. Hover = `surface-hover`.

### Data Table
Header row in `label` style, `text-secondary`. Rows separated by `border-bottom: 1px solid {colors.border}`; hover background `surface-hover`. Numbers in mono, right-aligned. Min row height 44px.

### Size run
The signature component: a product's sizes as one row of 44×44px tiles (8px gap, 8px radius) in `position` order, wrapping on long runs. Available = `run-tile-available`; missing = `run-tile-out` (§Out of stock), identical whatever its age. The same primitive is the ProductPicker's size selector, with `run-tile-selected` (accent-bright 2px outline on accent-soft) and `run-tile-disabled`. One component, two consumers.

### KPI strip
One full-width card; its figures sit side by side, evenly spaced, separated by vertical 1px `border` rules. Each figure: value (32px mono bold) on top, label (12px, gray, sentence case) beneath. No icons, deltas or sparklines. At most one value per screen in `accent-bright`. Below 744px the figures stack and the rules turn horizontal.

### Badges
Pills with soft background + strong text of the same tone. List status: draft = info, processing = warning, done = live. Inactive = neutral. Out of stock = the mark.

### Alerts & feedback
- **Alert box**: `alert-soft` background, `alert` text, 4px left border in `alert`.
- **Toasts**: `surface` card with a 4px left border in the semantic tone; top-center stack (behavior: `shared/components.md` §Toasts).
- **Empty / loading / error states**: centered in the card, gray text, one action. Loading uses `surface-raised` skeleton blocks, no spinners over data.

### Forms & modals
Inputs sit on `canvas` inside cards so they read as wells. Focus: `accent-bright` border + 3px `accent-soft` ring. Modals: `modal` card on scrim, title 18px semibold, actions bottom-right.

### Tooltip & slide-over
Tooltip: `surface-raised`, 12px text, 8px radius. Slide-over (`sheet`): right-anchored, 420px, `surface` with left border.

## Responsive Behavior
| Width | Shell | Dashboard grid |
|---|---|---|
| ≥ 1280px | Sidebar expanded | KPI strip in one row; blocks stacked full width |
| 744–1279px | Sidebar collapsed (rail) | KPI strip in one row; blocks stacked full width |
| < 744px | Mobile header + drawer | KPI strip figures stacked; filter band controls stacked; tables become card lists |

Size-run tiles never shrink below 44px; they wrap.

## Accessibility
- Text ≥ 4.5:1, UI strokes ≥ 3:1 against their background. Defaults pass in both themes — `apps/web/src/styles/contrast.test.ts` computes the WCAG ratio of every text/background pair the UI uses (accent tones resolved through their `color-mix`) from `theme.css`, in both themes, so a token change that breaks one fails the build; **a new accent must be re-verified in both themes** for `on-accent`/`accent` and `accent-bright`/`surface`.
- Focus is always visible (accent-bright ring). Never rely on color alone: the out-of-stock mark also changes border style and always shows its elapsed figure as text; statuses always carry a label.
- Touch targets ≥ 44px on shop-floor interactions.

## Do's and Don'ts
- ✅ Use cards with 16px radius and 1px border as the only container.
- ✅ Use monospace for every data figure.
- ✅ Keep the accent configurable: consume derived variables, never a hex.
- ✅ If a chart is ever added: area charts with an `accent-soft` gradient to smooth spikes, gridlines in `border`, no thick outlines.
- ❌ Don't use pastel colors or decorative tints; in the light theme, structure comes from the same grays and borders as in dark.
- ❌ Don't use box-shadows, gradients on surfaces, or decorative illustrations.
- ❌ Don't show a stock quantity anywhere (RN-05) — KPIs count items, sizes or lists, never units in stock.
- ❌ Don't use red for anything that isn't an alert, or the accent for status.

## Known Gaps
- Per-tenant accent configuration is proposed in `features/001-tenant-theming`: with this document it reduces to injecting one `--color-accent` per tenant. Until it ships, the accent is set in the theme file.
