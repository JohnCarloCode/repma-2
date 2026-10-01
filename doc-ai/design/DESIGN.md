---
version: beta
name: REPMA-design
description: An editorial data tool on warm paper — the Ventriloc language applied to a dense B2B availability & replenishment app. The page floor is warm ash gray (#efefef); white surfaces (tables, cards, modals) are the data layer and separate from it by surface contrast alone — there is not a single box-shadow in the product. Depth is structural, achieved with surface bands, hairlines and, for floating layers, a 1px ink rule. Headings run Inter Tight at weight 400 (never bold) with -0.02em tracking — whisper-weight editorial authority; Inter carries body and UI. Shape speaks three dialects: sharp 0px on every button and field (text buttons, icon buttons, inputs, the size-run tiles — no button anywhere has a radius), a soft 10px radius on cards and modals, and full pills reserved for the naming and navigation vocabulary (badges, nav rows, the tenant selector). Color is rationed: screens read 95% achromatic; garnet ink (#3b1322) is the primary and holds the Ember role — punctuation only (focus, link underlines, data strokes; on the dark surfaces of its own family, where it would vanish, its punctuation — the active-nav marker — renders in on-sidebar white) and never a fill at rest: its filled moments are pointer-driven hovers (the primary button, the destination arrow) and the branded dark surfaces of its own family — and deep blue (#004d98) holds the Brass role of quiet secondary data accent. Primary actions are ink-filled graphite blocks. The dark surfaces are the garnet-ink family: the sidebar, a flush, full-height ink spine (#270812) that anchors the brand like a printed report's binding, and the filter bands (#3b1322, the spine's hover tone) that carry the same ink into each screen's query row. The product signature is untouched: availability read as size runs where every missing size wears the same mark — a dotted-outline tile with one amber dot — and only the elapsed figure says how long (DP-07). Theme colors are tokens from day one so per-tenant theming can be added later without restructuring.

colors:
  # Brand — garnet ink plays Ventriloc's Ember Orange role: functional punctuation,
  # never a fill. Blue plays the Brass role: quiet secondary data accent.
  # The whole dark garnet-ink family below derives mathematically from this primary.
  primary: "#3b1322"            # garnet ink — focus, link underlines, primary data stroke, on light surfaces. NEVER a fill at rest; fills are sanctioned only as pointer-driven hovers (button-primary-hover, icon-button-ink-hover) and as the family's branded dark surfaces (§Colors). On its own family's dark surfaces punctuation renders in on-sidebar instead (same family = no contrast)
  primary-active: "#270812"     # press/darker shade where the primary is interactive (links, selected size tiles) — one step deeper into the family: the spine tone
  secondary: "#004d98"          # deep blue — secondary data strokes, decorative accents, tag text. Never CTAs
  on-dark: "#ffffff"            # content on ink-filled buttons and other dark fills — also the chevron on icon-button-ink, in both its ink and its hover-garnet state

  # Text — graphite scale, never pure black
  ink: "#202020"                # graphite — headlines, body, table cells, the typographic anchor
  body: "#4d4d4d"               # steel — long-form secondary running text
  muted: "#707070"              # slate — sub-labels, table headers, meta text, inactive controls; darkest value that holds WCAG AA (4.5:1) on white AND on the fog table-header fill (§Accessibility)
  muted-soft: "#a8a8a8"         # disabled text (derived: one step lighter than muted)

  # Surfaces — warm paper, not clinical white. White is the DATA surface and
  # floats on the ash floor by contrast alone (see Elevation: zero shadows).
  canvas: "#efefef"             # ash — the page floor, the dominant warm-gray paper
  surface: "#ffffff"            # white — the data layer: tables, cards, modals, inputs
  surface-soft: "#f5f5f5"       # fog — nested fills: table headers, hover rows
  surface-strong: "#ebe6dd"     # ivory — the warm paper wash: icon buttons, the progress track, badge-inactive — the small warm accents
  surface-strong-hover: "#e0d9cb" # ivory deepened one step — hover of icon-button-ivory
  scrim: "#000000"              # modal backdrop, rendered at 50% opacity

  # Dark garnet-ink family (the branded dark surfaces: the flush ink spine and the filter band)
  # — every tone here is a mathematical derivation of {colors.primary}
  sidebar: "#270812"            # deep garnet-ink — sidebar background (the primary darkened one step; = primary-active)
  sidebar-hover: "#3b1322"      # hover fill for inactive sidebar items — the primary itself
  filter-band: "#3b1322"        # dark query band — background of every filter band (the primary itself, like sidebar-hover); controls on it stay white, on-band text uses the on-sidebar pair
  on-sidebar: "#f7eef2"         # sidebar text/icons on dark
  on-sidebar-muted: "#c39aa9"   # inactive sidebar items, section headers
  sidebar-raised: "#4b1a2c"     # hover for controls already resting on sidebar-hover (the tenant selector) — one step lighter into the family
  hairline-on-dark: "rgba(247, 238, 242, 0.14)"  # the on-dark hairline: the Platform section divider in the sidebar, the figures card's internal rules

  # Hairlines & borders — with shadows banned, these carry all internal structure
  hairline: "#e8e8e8"           # mist — default 1px divider inside white surfaces
  hairline-soft: "#f0f0f0"      # lighter divider for long-scrolling lists
  border-strong: "#c1c1c1"      # heavier stroke: input borders, disabled outlines, the dotted out-of-stock outline

  # Semantic (each pair: strong text/icon tone + soft background tone) — unchanged
  success: "#15803d"
  success-soft: "#dcfce7"       # toasts of successful mutations, "done" list status
  warning: "#b45309"
  warning-soft: "#fef3c7"       # "processing" list status, warning banners
  error: "#c13515"              # brick red-orange — deliberately distinct from garnet
  error-hover: "#a82c11"        # hover of button-danger — the error tone deepened one step
  error-soft: "#fde8e4"         # form validation, error toasts, destructive confirms
  info: "#0369a1"
  info-soft: "#e0f2fe"          # informational banners, "draft" list status

  # Out-of-stock (DP-07) needs NO colour token of its own: its one hue is the
  # dot's {colors.warning}, constant at any age, and duration is carried by the
  # elapsed figure's type weight. See §Out of stock.

typography:
  fontFamily: "'Inter', system-ui, sans-serif"                        # body & UI
  fontFamilyHeading: "'Inter Tight', 'Inter', system-ui, sans-serif"  # headings — PolySans substitute (see §Typography)
  figure:
    fontSize: 48px
    fontWeight: 400             # even the largest numeral keeps the 400 identity
    letterSpacing: -0.02em
    lineHeight: 1                # proportional figures — never tabular-nums at this size
  display:
    fontSize: 32px
    fontWeight: 400             # headings are NEVER bold — weight 400 is the identity
    letterSpacing: -0.02em
    lineHeight: 1.15
  h1:
    fontSize: 24px
    fontWeight: 400
    letterSpacing: -0.02em
    lineHeight: 1.2
  h2:
    fontSize: 20px
    fontWeight: 400
    letterSpacing: -0.02em
    lineHeight: 1.25
  body:
    fontSize: 14px
    fontWeight: 400
  body-medium:
    fontSize: 14px
    fontWeight: 500
  caption:
    fontSize: 12px
    fontWeight: 400

# Three shape dialects (§Shape): sharp (0px — everything that acts),
# soft (cards & modals — {rounded.md} on all corners), pill (navigation items & tags).
rounded:
  none: 0px                     # buttons, inputs, toasts, pagination, icon buttons — the acting dialect, no exceptions
  xs: 2px
  sm: 6px
  md: 10px                      # cards and modals — all four corners
  full: 9999px                  # pills: badges, nav items, the tenant context selector — the naming/navigation dialect, never a button

spacing:
  xxs: 2px
  xs: 4px
  sm: 8px
  md: 12px
  base: 16px
  lg: 24px
  xl: 32px
  xxl: 48px
  section: 64px

# Stacking order (§Elevation · Layering). One scale, one source of truth: no component
# invents its own z-index, and nothing in the shell may outrank a dialog.
layers:
  base: 0                       # page content on the canvas
  sticky: 10                    # in-page sticky elements (table headers, filter band)
  shell: 100                    # the sidebar spine / collapsed rail and the mobile header
  shell-overlay: 110            # scrim of the tablet expand-in-place / mobile drawer
  shell-panel: 120              # the expanded sidebar panel or open drawer, above its scrim
  sheet-scrim: 130              # slide-over scrim — above the whole shell band
  sheet: 140                    # right-anchored slide-over panel (catalog product detail)
  popover: 200                  # dropdowns, menus, tooltips — above sheets, below the dialog band
  dialog-scrim: 900             # modal & full-screen-sheet scrim — above the ENTIRE shell
  dialog: 910                   # modal, confirm, ProductPicker sheet
  toast: 1000                   # always reachable, even over a dialog

components:
  # Primary action = ink-filled graphite block, sharp corners, heading face at 400.
  # Garnet NEVER fills a button (Ember discipline).
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-dark}"
    rounded: "{rounded.none}"
    fontFamily: "{typography.fontFamilyHeading}"
    fontWeight: 400
    letterSpacing: -0.02em
    padding: 12px 20px
    height: 44px                # visual height = hit area — buttons and inputs share the size run's rule (§Buttons)
  button-primary-hover:
    backgroundColor: "{colors.primary}"  # the sanctioned pointer-driven garnet fill (§Colors) — ink again the moment the pointer leaves
    textColor: "{colors.on-dark}"
    rounded: "{rounded.none}"
  button-primary-active:
    backgroundColor: "#0a0a0a"  # press: graphite deepens toward black
    textColor: "{colors.on-dark}"
    rounded: "{rounded.none}"
  button-primary-disabled:
    backgroundColor: "{colors.hairline}"
    textColor: "{colors.muted-soft}"
    rounded: "{rounded.none}"
  button-secondary:             # ghost: transparent, 1px ink rule
    backgroundColor: transparent
    textColor: "{colors.ink}"
    border: "1px solid {colors.ink}"
    rounded: "{rounded.none}"
    padding: 11px 19px
    height: 44px
  button-secondary-hover:       # punctuation, not fill: the rule and the label shift garnet
    borderColor: "{colors.primary}"
    textColor: "{colors.primary}"
  button-tertiary-text:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    hoverUnderline: "1px solid {colors.primary}"   # the garnet-underline link (§Colors — Brand)
  button-danger:
    backgroundColor: "{colors.error}"
    textColor: "{colors.on-dark}"
    rounded: "{rounded.none}"
    padding: 12px 20px
    height: 44px
  button-danger-hover:
    backgroundColor: "{colors.error-hover}"
    textColor: "{colors.on-dark}"
  icon-button-ivory:            # renamed from icon-button-circle — square now: it is a button, so it is sharp
    backgroundColor: "{colors.surface-strong}"     # ivory chip — the smallest dose of warm paper
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    visualSize: 32px
    hitArea: 44px
  icon-button-ivory-hover:      # ivory deepens — the chip stays in the paper family, garnet hover fills belong to the ink pair
    backgroundColor: "{colors.surface-strong-hover}"
    textColor: "{colors.ink}"
  # The row's or card's destination, not an action on it: ink fill at rest (same as button-primary).
  # Named for its fill, like its ivory twin: the fill is the whole distinction between the two.
  icon-button-ink:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-dark}"
    rounded: "{rounded.none}"   # sharp like every button; the ink fill is what sets it apart from icon-button-ivory
    visualSize: 32px
    hitArea: 44px
  # The ONE filled-garnet moment in the product: pointer-driven, gone the instant the pointer leaves.
  # Garnet still never fills anything at rest — see §Colors.
  icon-button-ink-hover:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-dark}"
    rounded: "{rounded.none}"
  icon-button-ink-active:
    backgroundColor: "{colors.primary-active}"
    textColor: "{colors.on-dark}"
    rounded: "{rounded.none}"
  sidebar:                      # flush ink spine — NOT a floating panel (§Application Shell)
    backgroundColor: "{colors.sidebar}"
    textColor: "{colors.on-sidebar}"
    width: 256px
    widthCollapsed: 64px
    inset: 0px                  # flush to the viewport's left, top and bottom edges
    rounded: "{rounded.none}"
    shadow: none
    padding: 12px
  mobile-header:                # mobile only (< 744px) — slim fixed band hosting the drawer trigger (§Application Shell)
    backgroundColor: "{colors.filter-band}"   # #3b1322 — the primary's tone worn as a branded dark surface (same family as the spine and the band), not a garnet fill at rest (§Colors)
    textColor: "{colors.on-sidebar}"
    height: 56px
    position: fixed             # pinned to the viewport's top edge, full width; the content area starts below it
    rounded: "{rounded.none}"
    shadow: none
    padding: "0 {spacing.md}"   # 12px horizontal — matches the spine's internal padding
  sidebar-item-active:          # punctuation, not a filled block: bright text + white rule
    backgroundColor: transparent
    textColor: "{colors.on-sidebar}"
    activeMarker: "2px solid {colors.on-sidebar}"  # 16px-wide rule under the label (under the icon when collapsed) — on-sidebar, not primary: the primary IS the spine's family and would vanish here
    rounded: "{rounded.full}"
    padding: 10px 12px
  sidebar-item-inactive:
    backgroundColor: transparent
    textColor: "{colors.on-sidebar-muted}"
    rounded: "{rounded.full}"
    padding: 10px 12px
  sidebar-item-hover:
    backgroundColor: "{colors.sidebar-hover}"
    textColor: "{colors.on-sidebar}"
    rounded: "{rounded.full}"
  tenant-selector:
    backgroundColor: "{colors.sidebar-hover}"
    textColor: "{colors.on-sidebar}"
    border: none
    rounded: "{rounded.full}"   # pill dialect — it is a navigation container
    padding: 8px 12px
  tenant-selector-hover:        # already resting on sidebar-hover, so its hover steps one lighter into the family
    backgroundColor: "{colors.sidebar-raised}"
    textColor: "{colors.on-sidebar}"
  card:                         # soft radius on all corners. No border, no shadow
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    border: none
    rounded: "{rounded.md}"
    padding: 24px
  # Out-of-stock mark (DP-07) — ONE treatment for every out-of-stock mark in the product,
  # consumed by run tiles and by badge-out-of-stock. No fill; the dotted outline plus one
  # amber dot say "missing", and they say it identically at any age.
  out-of-stock-mark:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    border: "1px dotted {colors.border-strong}"
    dotSize: 6px                # leading dot inside the tile, before the label
    dotColor: "{colors.warning}" # the mark's single hue — never graded by age
  # Elapsed figure (DP-07) — the only thing that separates one out-of-stock from another.
  # Escalates by type weight, never by hue.
  aging-figure-fresh:           # < 24h
    fontWeight: 400
    textColor: "{colors.muted}"
  aging-figure-attention:       # 24 h – 7 d (inclusive)
    fontWeight: 500
    textColor: "{colors.ink}"
  aging-figure-escalated:       # > 7 days
    fontWeight: 600
    textColor: "{colors.ink}"
  # A size tile is a BUTTON, so it takes the sharp dialect like every other button (§Shape).
  # It was a pill until the shape rule was closed; only the radius changed — fills, the
  # out-of-stock mark and the 44px geometry are untouched.
  size-run:
    gap: "{spacing.sm}"         # 8px — two 44px targets must stay separable to a fingertip
    tileHeight: 44px            # visual height = hit area: the tile IS the touch target
    tileHitArea: 44px           # no invisible extension needed — the tile fills it
    tileMinWidth: 44px          # "7" and "42" align on a grid, both fully tappable
    tileFontSize: "{typography.body.fontSize}"   # 14px, tabular-nums — legible at arm's length
  run-tile-available:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: 0 14px             # height comes from tileHeight, not from padding
  run-tile-out:                 # {component.out-of-stock-mark}, identical at any age
    rounded: "{rounded.none}"
    padding: 0 12px             # tighter than the available tile: the dot takes the rest
    gap: "{spacing.xxs}"        # dot ↔ label
  run-tile-selected:            # ProductPicker only — garnet as outline punctuation, never fill
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    border: "2px solid {colors.primary}"
    rounded: "{rounded.none}"
  run-tile-disabled:            # ProductPicker only: already added
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.muted-soft}"
    rounded: "{rounded.none}"
  table-header:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.muted}"
    padding: 10px 12px
  table-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    borderBottom: "1px solid {colors.hairline-soft}"
    padding: 8px 12px
    minHeight: 40px
  table-row-hover:
    backgroundColor: "{colors.surface-soft}"
  badge-out-of-stock:           # {component.out-of-stock-mark}, like run-tile-out — one mark; the badge keeps the pill (it names, it is not a button)
    rounded: "{rounded.full}"
    padding: 2px 10px
    gap: "{spacing.xs}"         # dot ↔ "Out of stock" ↔ elapsed figure
  badge-status-draft:
    backgroundColor: "{colors.info-soft}"
    textColor: "{colors.info}"
    rounded: "{rounded.full}"
    padding: 2px 10px
  badge-status-processing:
    backgroundColor: "{colors.warning-soft}"
    textColor: "{colors.warning}"
    rounded: "{rounded.full}"
    padding: 2px 10px
  badge-status-done:
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.success}"
    rounded: "{rounded.full}"
    padding: 2px 10px
  badge-inactive:
    backgroundColor: "{colors.surface-strong}"
    textColor: "{colors.muted}"
    rounded: "{rounded.full}"
    padding: 2px 10px
  toast-success:                # floating layer → 1px rule in its strong tone, no shadow
    backgroundColor: "{colors.success-soft}"
    textColor: "{colors.success}"
    border: "1px solid {colors.success}"
    rounded: "{rounded.none}"
    padding: 12px 16px
  toast-error:
    backgroundColor: "{colors.error-soft}"
    textColor: "{colors.error}"
    border: "1px solid {colors.error}"
    rounded: "{rounded.none}"
    padding: 12px 16px
  text-input:                   # sharp dialect: a ruled box on paper
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    border: "1px solid {colors.border-strong}"
    rounded: "{rounded.none}"
    padding: 12px
    height: 44px                # visual height = hit area, like every control (§Buttons); focus thickens the border to 2px {colors.primary} with 11px padding compensation
  modal:                        # card dialect over the scrim — no shadow, the scrim separates it
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: 24px
  tooltip:                      # the spine tone as a small floating chip — its own dark surface, so it needs no ink rule
    backgroundColor: "{colors.sidebar}"
    textColor: "{colors.on-sidebar}"
    hintColor: "{colors.on-sidebar-muted}"  # optional second line (a run tile's SKU · state)
    fontSize: "{typography.caption.fontSize}"
    fontWeight: 500
    rounded: "{rounded.none}"
    padding: 6px 10px
  sheet:                        # right-anchored slide-over panel — a floating layer, so the ink-rule substitute applies to its one exposed edge
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    width: 420px
    borderLeft: "1px solid {colors.ink}"
    rounded: "{rounded.none}"
    shadow: none
  wordmark:                     # the "REPMA" mark — the one place weight 600 leaves body emphasis (§Typography — Wordmark & logo)
    fontFamily: "{typography.fontFamily}"
    fontSize: 14px
    fontWeight: 600
    letterSpacing: 0.16em       # on the spine; 0.14em on light surfaces (login)
  logo-tile:                    # the 32px sharp garnet "R" beside the wordmark — brand identity, not a control (§Typography — Wordmark & logo)
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-dark}"
    size: 32px
    rounded: "{rounded.none}"
  empty-state:
    backgroundColor: transparent
    textColor: "{colors.muted}"
    padding: 48px 24px
  pagination-button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    border: "1px solid {colors.border-strong}"
    rounded: "{rounded.none}"
    height: 36px
  progress-bar:                 # a printed rule that fills — sharp, garnet as data stroke
    trackColor: "{colors.surface-strong}"
    fillColor: "{colors.primary}"
    height: 10px                # thick enough to read across a room; still a rule, not a tube
    rounded: "{rounded.none}"
    fractionFontSize: "{typography.body.fontSize}"   # 14px tabular-nums — the "0/4" beside the label
  # No chart tokens: Home's interim sparkline and donut were removed with its
  # chart-cards design (spec RF-41) and nothing else charts, so the tokens were
  # deleted rather than left orphaned — same discipline as the old stat-card.
---

## Overview

REPMA is an internal B2B multi-tenant availability & replenishment tool (stores flag which product sizes are out of stock and manage replenishment lists — no stock quantities are tracked). Its visual language is an **editorial data observatory on warm paper**: the page floor is warm ash gray (`{colors.canvas}` — #efefef), white surfaces (`{colors.surface}`) are the **data layer** — tables, cards, modals, inputs — and they separate from the floor by surface contrast alone. **There are no box-shadows anywhere in the product** (§Elevation): depth is structural, carried by surface bands, hairlines and 1px ink rules. The tables are the imagery; nothing decorates them.

The brand is a **garnet-ink palette with Ventriloc discipline**: garnet ink (`{colors.primary}` — #3b1322) plays the Ember Orange role — pure punctuation: focus states, link underlines, the selected-pill outline, the primary data stroke — and **never fills a control at rest**: garnet fills exist in two sanctioned forms only — pointer-driven hovers (`{component.button-primary-hover}`, `{component.icon-button-ink-hover}`), which last exactly as long as the pointer stays, and the branded dark surfaces of its own family, which wear the tone as surface, not accent. On the dark surfaces of its own family (the spine and the filter band) that punctuation renders in `{colors.on-sidebar}` white instead — the active-nav marker — because the primary would vanish against its own derivations. Deep blue (`{colors.secondary}` — #004d98) plays the Brass role: a quiet secondary accent for data strokes and decorative lines, never competing for attention. Primary actions are **ink-filled graphite blocks with sharp corners** — the dark block, not the brand color, is what says "act here". The **dark, branded surfaces are the garnet-ink family**: the **sidebar** (`{colors.sidebar}` — #270812, a deep garnet-ink), a flush, full-height **ink spine** on the left edge — flat, unrounded, unshadowed — that anchors the layout like the binding of a printed report and carries the brand where garnet-as-fill is now forbidden; and the **filter band** (`{colors.filter-band}` — #3b1322, the spine's hover tone), which carries that same ink into the content area — every screen's query row is a dark band with white controls sitting on it.

Type is **whisper-weight editorial**: headings run **Inter Tight at weight 400 — never bold —** with -0.02em tracking; Inter carries body and UI. Shape speaks **three dialects** (§Shape): sharp 0px corners on every button and field — the size-run tiles included, since no button here has a radius —, a soft `{rounded.md}` radius on cards and modals, and full pills kept for the naming and navigation vocabulary (badges, nav rows, the tenant selector).

**Key Characteristics:**
- **Zero box-shadows — a hard rule, not a preference.** If a layer does not separate, fix the surface pairing or add a hairline; never reach for a shadow.
- **Color rationed to punctuation**: screens read 95% achromatic (ash, white, fog, ivory, graphite). Garnet appears in strokes measured in pixels — an underline, a focus ring, a dot, a chart line — plus its family's branded surfaces (spine, filter band, mobile header, Home's figures card) and the pointer-driven hover fills (§Colors). Drop any screen to greyscale and nothing breaks.
- **Warm paper, not clinical white**: ash floor, fog fills, and ivory (`{colors.surface-strong}`) rationed to the small warm accents — icon chips, the progress track, the inactive badge — the paper-stock feel.
- **Headings at weight 400** — authority through precision, not volume. Emphasis inside body text uses weight (500/600) at body size, never a new size and never bold headings.
- Semantic colors are fully separated from brand colors. The error tone (`{colors.error}` — #c13515, a brick red-orange) is deliberately distinct from garnet so validation errors and destructive actions never read as brand.
- Management-app layout: a collapsible flush sidebar spine, **no topbar at tablet width and above** (at mobile width a slim fixed garnet band — `{component.mobile-header}` — hosts the drawer trigger, §Application Shell), and a content area with data tables, cards, and forms.
- **Dense by default**: tight table padding, tabular numbers, tight alignment. The editorial rhythm lives in section-level whitespace and surface bands, not in inflated component padding (§Layout — Spacing).
- **Subtle CSS-only motion** (§Motion): two durations, one easing, hover/enter transitions everywhere interactive — no animation library.
- Every list screen shares the same skeleton: header with title + primary action, search/filter band, data table with pagination, and consistent loading / empty / error states.
- Replenishment and entity status are communicated with soft-background pill badges (list states, inactive entities), not with raw color on text. Out-of-stock is the exception and the product's signature: it is carried by the size run as **one uniform mark** — dotted outline plus an amber dot, the same for every missing size — and what grades by **how long it has held** is the elapsed figure beside the run, never the mark (§Out of stock).
- UI copy ships in English (per spec RNF-19), the same language as this engineering reference.

## Colors

### Brand
- **Garnet ink** (`{colors.primary}` — #3b1322): The brand color, used with Ember discipline — **punctuation only**. Where it lives, on light surfaces: focus outlines, the 1px underline on key inline links, the selected-pill outline in the ProductPicker, the progress-bar fill, the primary chart stroke. On the dark surfaces of its own family (spine, filter band) it cannot punctuate — same family, no contrast — so its marks there render in `{colors.on-sidebar}` white: the 2px active-nav marker, focus on the band. Where it never lives: **any fill at rest on a control**, badges, decorative washes. Fills are sanctioned in exactly two forms. **Pointer-driven hovers**: `{component.button-primary-hover}` and `{component.icon-button-ink-hover}` fill garnet while hovered and return the moment the pointer leaves — a momentary fill under the pointer is still punctuation; a permanent one would be a brand-colored button. Ghost buttons and pagination hover with garnet *strokes* (border + label, `{component.button-secondary-hover}`), never a fill; the ivory chip's hover stays in the paper family (`{component.icon-button-ivory-hover}`). And **the branded dark surfaces of the garnet-ink family** — the spine, the filter band, the mobile header, and Home's figures card (§Surfaces & Borders) — which wear the tone as surface, not accent. Press/darker interactions use `{colors.primary-active}` (the spine tone — one step deeper into the family).
- **Blue** (`{colors.secondary}` — #004d98): The Brass role — secondary data strokes, decorative accent lines, tag text. Never CTAs, never backgrounds.
- **Ink as the action color.** Primary actions are `{colors.ink}` graphite fills; the ghost secondary is a 1px graphite rule. The dark block is the CTA language, freeing garnet to stay rare — and therefore visible.
- The source palette (FC Barcelona) contributed the original bright garnet (#a50044) and a yellow (#edbb00); both are deliberately left out — the bright garnet was deepened into the ink that now carries the brand alone, and the blue stays as the Brass accent.

### Text
- **Ink** (`{colors.ink}` — #202020): Headlines, body, table cells, nav labels. Graphite, never pure black.
- **Body** (`{colors.body}` — #4d4d4d): Long-form secondary text where ink feels heavy.
- **Muted** (`{colors.muted}` — #707070): Sub-labels, table headers, meta text, inactive controls. Pinned to the darkest tone that still reads muted while meeting WCAG AA (4.5:1) on both white and the fog header fill — muted text is still text (§Accessibility).
- **Muted Soft** (`{colors.muted-soft}` — #a8a8a8): Disabled text only.

### Surfaces & Borders
- **Canvas** (#efefef, ash) is the page floor — the dominant warm-gray paper. **Surface** (#ffffff) is the data layer: tables, cards, modals, inputs. White sits ON ash and reads as raised with no shadow and no border — the contrast between the two is the entire elevation system. **Surface Soft** (#f5f5f5, fog) fills table headers and hover rows — the nested tone inside white surfaces. **Surface Strong** (#ebe6dd, ivory) is the warm paper wash: icon buttons, the progress track, the inactive badge — the small warm accents (hover deepens it one step to `{colors.surface-strong-hover}`). It is an accent surface, not a workhorse.
- **Sidebar** (`{colors.sidebar}` — #270812) is the darkest branded surface: a deep garnet-ink derived from the primary (one step deeper — the same tone as `{colors.primary-active}`), with `{colors.on-sidebar}` text, `{colors.on-sidebar-muted}` inactive items, and `{colors.sidebar-hover}` hover fills. It is flat and flush (§Application Shell) — the darkest mass in the system needs no shadow, inset or border to read as a distinct plane. The dark treatment is exclusive to the navigation panel, the controls that live on it (tenant selector, user menu trigger), the **mobile header** (`{component.mobile-header}`, mobile only), the **filter band** below, and **Home's figures card** (`{colors.filter-band}` worn as that page's featured surface — §Screen Skeletons). Rules drawn *on* these dark surfaces use `{colors.hairline-on-dark}` (the Platform section divider, the figures card's internal rules). (Under per-tenant theming, these tones are derived from the tenant's primary.)
- **Filter band** (`{colors.filter-band}` — #3b1322, the spine's hover tone) is the second dark surface: the background of every filter band — list screens and detail-page bands alike. White inputs and selects sit on it with their usual `{colors.border-strong}` rules; the contrast is the separation — the band itself takes no border and no shadow, like every surface. Text sitting directly on the band (a toggle's label, a "Clear" tertiary action) uses `{colors.on-sidebar}` / `{colors.on-sidebar-muted}`, and focus on the band uses the spine's 2px `{colors.on-sidebar}` outline (§Accessibility). Table headers and hover rows stay on fog — the dark tone belongs to the query row only, never to table internals.
- **Hairline** (#e8e8e8, mist) is the default 1px divider **inside** white surfaces: table separators, section rules within a card. **Hairline Soft** (#f0f0f0) divides long lists. **Border Strong** (#c1c1c1) rules input boxes, disabled outlines, and the dotted out-of-stock outline. Surfaces themselves take no border — white-on-ash needs none (cards are borderless); borders belong to controls and to internal structure.
- **Floating layers** (dropdowns, popovers, menus, toasts) substitute the shadow they can no longer have with a **1px rule**: `{colors.ink}` for neutral menus, the strong semantic tone for toasts (§Elevation).

### Semantic
Each semantic color is a pair: a strong tone for text/icons and a soft tone for backgrounds. Pairs are used together in badges, toasts, and banners; the strong tone alone is used for inline text (form errors).

- **Success** (`{colors.success}` / `{colors.success-soft}`): successful mutation toasts, "done" replenishment status.
- **Warning** (`{colors.warning}` / `{colors.warning-soft}`): "processing" replenishment status, warning banners, and — strong tone only, as a 6px dot, never as a fill — the out-of-stock mark (§Out of stock). It marks *that* something is missing, never *for how long*.
- **Error** (`{colors.error}` / `{colors.error-soft}`): form validation, error toasts, destructive confirmation. Brick red-orange, never garnet.
- **Info** (`{colors.info}` / `{colors.info-soft}`): informational banners, "draft" replenishment status. A lighter, clearly-UI blue distinct from the brand blue.

### Out of stock — one mark, one number

**Every out-of-stock size is marked exactly the same way; the only thing that says how bad it is, is the number** (DP-07). A missing size is a missing size: 38 flagged two hours ago and 42 flagged nine days ago wear the identical mark, and the elapsed figure beside the run is what separates them. Six differently-coloured tiles in one run turn a size run into a legend to decode; one repeated mark keeps it a shape to read — "this model is missing 38 and 42" — with the age answered once, by the figure.

**The mark** — `{component.out-of-stock-mark}`, consumed by `{component.run-tile-out}` and by `{component.badge-out-of-stock}`: transparent fill, **1px dotted** `{colors.border-strong}` outline, `{colors.ink}` label, and a 6px `{colors.warning}` dot leading the label. Available sizes are the flat soft-filled `{component.run-tile-available}` with no outline and no dot, so "here" and "missing" separate on **three axes at once** — fill, border style, and that one dot — of which only the dot is chromatic. The amber is the smallest possible amount of colour that still catches the eye across a shop floor: 36px² of hue instead of a filled tile. In a system where all colour is punctuation, this mark is the most important punctuation on any screen — nothing else may dilute it.

**The number** — the elapsed figure escalates over three bands, by type weight only:

| Band | Elapsed since latest `out_of_stock` | Figure |
|---|---|---|
| Fresh | < 24 h | `{component.aging-figure-fresh}` — regular weight, muted. Normal shop-floor churn. |
| Attention | 24 h – 7 d (inclusive) | `{component.aging-figure-attention}` — medium weight, ink. |
| Escalated | > 7 days | `{component.aging-figure-escalated}` — semibold, ink. The heaviest number on the screen. |

Rules:

- **Exactly one hue, and it never grades.** `{colors.warning}` on a 6px dot is the only colour on this axis: the mark takes no fill and the figure takes no semantic colour, so duration escalates by weight alone. Drop the run to greyscale and it still reads — the dotted border and the dot's presence carry it. And 6px of amber never competes with garnet's punctuation role.
- **Not `{colors.error}`, not garnet.** A missing size is not a validation failure and not a brand moment: `{colors.error}` must keep meaning "you did something wrong / this destroys data", and garnet must keep meaning "this is where you are / this is the thread to follow".
- The elapsed figure is **always rendered as text** next to the mark ("9 d"); the mark never carries the duration on its own (§Accessibility). Conversely, the figure never appears without a mark to belong to.
- **Its units are fixed**: `<1 h` under an hour, hours to 23 (`5 h`), days to 21 (`9 d`), weeks beyond (`3 w`). One unit at a time, abbreviated, with a space — never a compound like "1 d 4 h". (The unit scale is display only; the bands of DP-07 are what grade the weight.)
- Exactly one definition of the mark exists (`{component.out-of-stock-mark}`) and one of the figure scale (the `aging-figure-*` tokens); run tiles and `badge-out-of-stock` both consume them. Never re-derive the thresholds in a page doc — reference DP-07.
- The bands still exist as **data**: they grade the emphasis of each evidence line's elapsed figure, and lists sort by the figure descending. They just no longer colour anything, and no aggregate of them appears on Home's summary (spec RF-41 dropped `agedBeyondBand`).
- Restocked and available items carry neither mark nor figure: this axis only measures absence.

## Typography

### Font Families
Two faces, one voice each:

- **Inter Tight** (`{typography.fontFamilyHeading}`) — headings and display text only, **exclusively at weight 400 with -0.02em tracking**. This is the PolySans substitute: PolySans (the reference's custom neo-grotesque) is a paid font, and Inter Tight gives the same tight, neo-grotesque display behavior while sharing metrics DNA with the body face. (Space Grotesk 400 is the sanctioned alternative if more character is wanted later; swapping means changing only `fontFamilyHeading`.) Load weight 400 only — no other weight of this face may ship.
- **Inter** (`{typography.fontFamily}`) — body copy, UI labels, buttons' sibling text, captions, metadata. Weights 400 / 500 / 600. Open source, self-hosted, full Spanish/English coverage, tabular figures (`font-variant-numeric: tabular-nums` on numeric columns — requested quantities, the product's only unit count: availability events carry none, RN-06).

**Headings are never bold.** Not at 32px, not at 20px, not for emphasis. The whisper-weight heading against a dense data screen is the typographic identity of the product; bolding it destroys the editorial restraint. Hierarchy below heading level is carried by Inter's 500/600 at body size, size steps, and the muted/ink text scale — never by bolding a heading token.

### Scale
Deliberately small — seven tokens cover the entire product:

| Token | Face | Size | Weight | Use |
|---|---|---|---|---|
| `{typography.figure}` | Inter Tight | 48px | 400 | Home's summary figures — its only consumer; proportional figures, never `tabular-nums` at this size |
| `{typography.display}` | Inter Tight | 32px | 400 | Page titles (every screen opens with one), Home's greeting, login heading — including a detail header whose title IS the entity's name (`/replenishment/:id`) |
| `{typography.h1}` | Inter Tight | 24px | 400 | Detail-page entity names that sit **inside the summary card** rather than as the header title (`/availability/:id`) — position, not entity-ness, picks the token |
| `{typography.h2}` | Inter Tight | 20px | 400 | Section and card titles, modal headers |
| `{typography.body}` | Inter | 14px | 400 | Default text: table cells, form values, running copy |
| `{typography.body-medium}` | Inter | 14px | 500 | Emphasis within body: table headers, form labels, nav items |
| `{typography.caption}` | Inter | 12px | 400 | Meta text, badge labels, helper and error text |

All Inter Tight tokens carry -0.02em tracking; it is part of the token, not an option. Button labels use Inter Tight 400 at 14px (the acting dialect borrows the heading voice — precise, architectural). Components use `{typography.body}` unless stated otherwise. No additional sizes or weights are introduced without updating this table.

### Wordmark & logo

The brand mark is typographic: **"REPMA"** in Inter 600 at 14px, tracked wide (`{component.wordmark}`) — 0.16em in `{colors.on-sidebar}` on the spine, 0.14em in `{colors.primary}` on light surfaces (the login card). Beside it sits `{component.logo-tile}`: a 32px sharp garnet square carrying a white "R" — the logo mark the collapsed rail reduces to (`shared/layout.md`). The tile is brand identity, not a control: the one at-rest garnet fill that is neither surface nor hover, exempt because nothing about it asks to be pressed. The wordmark is the only place weight 600 appears outside body-size emphasis.

### Iconography

**Material Symbols Rounded**, one axis configuration product-wide: `opsz 20, wght 400, FILL 0, GRAD 0` — outlined, never filled, matching the weight-400 type identity. Icons ship as a subset (only the glyphs actually used are loaded). The inventory, by role:

- **Navigation**: `home`, `list_alt` (Replenishment), `inventory_2` (Availability), `history` (Activity), `menu_book` (Catalog), `storefront` (Stores), `group` (Users), `category` (Global catalog).
- **Shell & chrome**: `menu` (drawer trigger), `close`, `chevron_left` / `chevron_right` (collapse toggle, pagination, the destination chevron), `expand_less` / `expand_more` (selects, menus), `logout`, `person` (user menu), `lock` (unauthorized), `search`, `space_dashboard`.
- **Actions & feedback**: `add`, `edit`, `delete`, `remove`, `check`, `check_circle`, `block` (retire), `restart_alt` (reactivate), `refresh` (retry), `arrow_back`, `swap_vert` (reorder), `error`, `warning`, `info`, `image` (thumb placeholder).

Adding an icon means adding it to the subset **and** to this list; an icon rendering as its ligature text is a missing subset entry, not a font bug.

## Shape

Three dialects, each with a grammatical meaning. Radius is never an aesthetic slider — it declares what kind of thing an element is:

| Dialect | Radius | Applies to |
|---|---|---|
| **Sharp** | `{rounded.none}` — 0px | **Every button and every field**: text buttons, icon buttons (back arrows, row actions), inputs, selects, toasts, pagination, the progress bar, the **size-run tiles**, the sidebar spine itself |
| **Soft** | `{rounded.md}` — 10px on all four corners | Everything that **contains**: cards, modals, the summary panels |
| **Pill** | `{rounded.full}` | The **naming and navigation vocabulary**: badges and tags, sidebar nav rows, the tenant context selector |

Rules:
- **No button has a radius. None, at any size, in any dialect.** If it is a control the user presses to do something or to go somewhere — text button, icon button, size tile — it is 0px. This is the rule that decides every ambiguous case, and it has no exceptions: an earlier revision made the back arrow a circle and the size tiles pills, and both were wrong for the same reason.
- The pill survives only where the shape is **the thing's identity, not its interactivity**: a badge names a state, a nav row names a destination and belongs to the sidebar's own vocabulary, the tenant selector names the store you are in. That some of them are clickable is incidental — you press a button to act on data, you press a nav row to be somewhere else.
- Each element takes exactly one dialect: 0px, `{rounded.md}`, or full pill. No in-between values, no per-corner mixes — with only three radii in the whole product, the contrast between a sharp button and its soft container stays legible.
- The three dialects may meet in one component (a sharp button inside a soft card containing pill badges); that contrast is the rhythm.

## Layout

### Application Shell
- **Sidebar** (`{component.sidebar}`): a **flush ink spine** — full viewport height, glued to the left edge, `{rounded.none}`, **no inset, no shadow, no border**: the darkest surface in the system sitting on warm ash paper is the strongest structural contrast available, and it needs no further separation. **Collapsible**: 256px expanded, 64px icon-only rail collapsed (behavior, toggle, and persistence in `shared/layout.md`). Top to bottom: the product wordmark (logo mark only when collapsed), the **tenant context block** (`{component.tenant-selector}` for Platform Admin; manager/employee see their store name as static `{colors.on-sidebar}` text), then nav sections: store views (Home, Replenishment, Availability, Activity, Catalog — the operating-frequency order and visibility rules of `shared/layout.md` §Navigation) and — for Platform Admin only — a "Platform" section (Stores, Users, Global catalog). Pinned at the bottom: the **user menu** (name, role, logout; initials avatar when collapsed) and the collapse toggle. Items are pill-shaped rows: inactive in `{colors.on-sidebar-muted}`; hover fills `{colors.sidebar-hover}`; the **active item takes no fill** — full-strength `{colors.on-sidebar}` text plus a 16px-wide, 2px `{colors.on-sidebar}` rule under the label (`{component.sidebar-item-active}`), under the icon when collapsed. White punctuation, not a painted block — the primary would vanish against its own family here (§Colors).
- **No topbar at tablet width and above.** The shell carries no top chrome there: every screen opens with its own page header (`{typography.display}` title), so a bar repeating that name would add nothing.
- **Mobile header** (`{component.mobile-header}`, < 744px only): with the spine off-canvas, the shell pins a slim fixed band (56px) to the top edge — full width, flush, `{rounded.none}`, no shadow, on the filter band's garnet (`{colors.filter-band}`, the primary's tone). Its only content is the **hamburger drawer trigger** on the left (an `{colors.on-sidebar}` glyph, 44px hit area): no wordmark, no page title, no actions — the page's own header sits right below and already carries the name. Behavior in `shared/layout.md`.
- **Content area**: `{spacing.lg}` (24px) padding on the ash canvas — `{spacing.base}` (16px) at mobile width — max content width ~1200px on wide screens. At tablet width and above it starts at the top of the viewport (no topbar offset) and directly at the spine's right edge; at mobile width it starts below the fixed mobile header — the product's only vertical offset.

### Spacing System
- Base unit 4px. Tokens: 2 / 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64px.
- The reference system's comfortable marketing scale (80px section gaps, 40px card padding, 20px element gaps) is **compressed roughly ×0.6 while keeping its proportions** — this is a dense management tool, and its editorial air lives at section level, not inside components: card padding `{spacing.lg}` (24px), element gaps `{spacing.md}`–`{spacing.base}` (12–16px), vertical rhythm between page sections `{spacing.xl}` (32px).
- Cards whose body is a table let the table run full-bleed to the card edge (no inner padding around tables). Table cell padding: 8×12px (dense). Gap between tiles inside a size run: `{spacing.sm}` (8px) — with 44px tiles the gap has to keep two adjacent targets distinguishable to a fingertip.
- Where the reference alternates white/ash **section bands** for rhythm, the app equivalent is the alternation of ash canvas ↔ white data surfaces ↔ fog nested fills. Never add a divider or a wrapper where a surface change already draws the boundary.

### Screen Skeletons
- **List screens** (products, users, tenants): page header (`{typography.display}` title + primary action button, right-aligned) → filter band (search input + selects on the dark `{colors.filter-band}` background — §Surfaces & Borders) → data table → pagination row. Deleting the last item of a page navigates back one page (spec RF-36).
- **Availability** is deliberately **not** that skeleton (AD-22). Same header and filter band, but the body is a list of **products**, each one line: product identity, then its `{component.size-run}` of size tiles, then the aging figure. One glance reads a whole size run; the platform-admin CRUD screens stay plain tables and the store's daily screen does not look like them. Detail of a single size still lives at `/availability/:id`, reached by clicking the size's tile — a tile click navigates; flagging happens on that detail.
- **Replenishment** (`/replenishment`) is deliberately **not** that skeleton either. Same header, filter band and pagination row, but the body is a **grid of `{component.card}`**, one card per list: status badge and delete `{component.icon-button-ivory}` on the top row, the list name at `{typography.h2}`, its size ("8 products · 14 sizes") and — only while it is open (`draft` or `processing`) and has items — its check progress, then a `{colors.hairline}` rule and the provenance (creator, then age per §Data conventions) with the `{component.icon-button-ink}` destination arrow in the bottom-right corner. Three columns ≥ 1200px, two ≥ 744px, one below, `{spacing.base}` gap. A list is a work item read as one object; a table would spread that object across five columns nobody compares.
- **Detail screens** (availability item + event history, replenishment list): header → summary card → related table (availability events, list items). The **replenishment list** header carries, in one row: back arrow → entity name → status badge + select → the filled `button-danger` "Delete list", and below it the progress card and then the notes card (see `pages/replenishment-detail.md`). The **availability item** header carries only the back button and the flag action: the item's identity (name — size, SKU, inactive badge) and its availability state live in the summary card (see `pages/availability-detail.md`).
- **Home**: a **greeting header** — time-of-day greeting + first name at `{typography.display}`, a muted store-name · date line beneath, and "New list" as the page's one `{component.button-primary}` on the right → one **full-width figures card** on the family's garnet (`{colors.filter-band}`, soft card radius — the branded dark surface worn as Home's featured moment, §Colors/§Surfaces): three figures in a row at `{typography.figure}` in `{colors.on-dark}` (open lists, items to replenish, sizes out of stock), evenly spaced, separated by vertical 1px `{colors.hairline-on-dark}` rules, each with a `{typography.caption}` label beneath in `{colors.on-sidebar}` → three summary blocks that all wear the **same bounded-table dress** (the shared `<DataTable>` geometry — fog header row, hairline row rules, 8×12 cells — capped set, never paginated inside Home, closed by a tertiary "View all" **bottom-right** stating the true total when it truncates): the open replenishment work as a **7-row table** ("List / Status / Progress", with an `{component.icon-button-ink}` trailing column resolving each row to its list), the out-of-stock products as a **10-row table** ("Product / Sizes / Waiting" — each Sizes cell is the intact `{component.size-run}` with its tiles and marks), and a four-line **recent-activity table** ("Event / When") closing the page. There is still no generic `stat-card` token: the wide card with spaced typographic figures is one specced surface on one page — not a hero, not a reusable dashboard kit. Figures wear `{colors.on-dark}` with labels in `{colors.on-sidebar}`. No ornament: no photos, illustrations, gradients or quick-access tiles anywhere on the page.
- **Forms**: single-column, 480–640px max width, inside a card or modal. Labels above inputs, inline field errors in `{colors.error}` beneath.

## Elevation

**There are no box-shadows in this product. None.** This is the rule that most changes the result, and it is a constraint, not a suggestion: no component, at any layer, in any state, may declare a `box-shadow`. Depth is structural:

- **Surface contrast**: white data surfaces on the ash floor; fog fills nested inside white; the dark spine against everything. If two adjacent layers don't separate, change the surface pairing.
- **Hairlines**: 1px `{colors.hairline}` / `{colors.hairline-soft}` rules divide content *within* a surface (table rows, card sections).
- **The ink rule**: floating layers that leave the page plane — dropdowns, popovers, the tenant-selector menu, the user menu — are white surfaces with a **1px `{colors.ink}` border**. The crisp ink outline is the shadow substitute: it reads as a card laid on top of the page, the way a ghost button reads against paper. Toasts use the same technique with their strong semantic tone as the rule.
- **Modal scrim**: `{colors.scrim}` at 50% opacity behind modals and confirmation dialogs; the modal itself carries no border and no shadow — the scrim is its separation.

### Layering
With no shadows, stacking order is the only thing that says which plane is on top, so it is a **fixed scale** (`layers` tokens above) and not a per-component decision. Two rules decide every case:

- **A dialog outranks the whole shell, at every breakpoint.** Modals, confirms and the ProductPicker render in a portal at the document root at `{layers.dialog}` with their scrim at `{layers.dialog-scrim}` — above the sidebar spine, above the collapsed rail, above the expanded panel and above the fixed mobile header. The shell never floats over an open dialog and the scrim never stops short of an edge: a strip of live chrome beside a modal reads as a broken layer, and on touch it is worse — a header or rail still tappable behind a scrim invites a tap that dismisses nothing.
- **The shell's own overlays stay inside the shell's band.** The tablet expand-in-place panel and the mobile drawer sit at `{layers.shell-panel}` over their scrim at `{layers.shell-overlay}` — above page content, below anything in the dialog band. Opening a dialog from inside a drawer therefore covers the drawer, never the reverse.

Between the two bands sit the intermediate floating layers, in fixed order: the slide-over (`{layers.sheet}` over `{layers.sheet-scrim}` — above the whole shell band) and then popovers (`{layers.popover}` — dropdowns, menus, tooltips, above any sheet so a select inside one can open over it). Everything in both is covered by any dialog.

A portal is what makes this hold: a dialog rendered inside the content area inherits the shell's stacking context and can never escape it, whatever z-index it declares.

## Motion

Micro-interactions are **CSS-only** (transitions + keyframes; no animation library). Two durations and one easing cover the whole product:

| Token | Value | Used for |
|---|---|---|
| Fast | 120ms, `ease-out` | Hover/press feedback: background, border, and text color shifts on buttons, sidebar items, table rows, size tiles, badges, inputs (focus border) |
| Base | 200ms, `cubic-bezier(0.2, 0, 0, 1)` | Everything that appears or changes size: dropdowns and tenant-selector menu (fade + 4px rise), toasts (slide in from the right), modals (fade + scale from 98%), sidebar expand/collapse (width), skeleton shimmer |

Rules:

- Animate only `opacity`, `transform`, `background-color`, `border-color`, `color`, and the sidebar `width` — never layout properties on list content.
- Every interactive element has a hover transition; nothing snaps. Press states switch instantly — feedback on press must feel immediate.
- Loading skeletons use a slow shimmer (1.5s linear loop) instead of static gray blocks.
- No scroll-triggered or decorative animation: motion always answers an interaction.
- `prefers-reduced-motion: reduce` disables all transitions and the shimmer (states swap instantly).

## Components

### Buttons
All buttons are the **sharp dialect** (0px radius) with labels in Inter Tight 400 — precise and architectural, the reference's button voice.
- **`button-primary`** — graphite `{colors.ink}` fill, white text. One per screen ideally: "New product", "Add to assortment", "New list", "Save". The dark block is the CTA language; **garnet never fills a button at rest** — hover fills it garnet (`{component.button-primary-hover}`), the pointer-driven form §Colors sanctions, and press deepens toward black.
- **`button-secondary`** — ghost: transparent, 1px `{colors.ink}` rule, ink text. "Cancel", secondary actions. Works identically on ash and on white. Hover shifts rule and label to garnet (`{component.button-secondary-hover}`) — punctuation, never a fill; pagination hovers the same way.
- **`button-tertiary-text`** — plain ink text; hover reveals a 1px **garnet underline** (the reference's accent-underline link, remapped). "View all", modal close labels.
- **`button-danger`** — error fill, white text; hover deepens to `{colors.error-hover}`. Two places only: the confirm button of a destructive modal, and the **trigger** of a destructive action on a detail header that has no primary action of its own ("Delete list" on `/replenishment/:id` — see its page doc). It is always behind a confirmation modal, and it never appears on a screen that already has a `button-primary`: two filled buttons is two loudest voices.
- **`icon-button-ivory`** — **sharp** (0px) button on `{colors.surface-strong}` (ivory chip): row actions, back arrows. **Visual size 32px, interactive area 44×44px** — the visible square sits centered inside a transparent 44px hit area (padding or pseudo-element), so it meets the touch-target minimum without looking oversized in dense table rows. Hover deepens the ivory one step (`{component.icon-button-ivory-hover}`) — the chip stays in the paper family. It was a circle in an earlier revision; it is square now because §Shape has no exceptions — **a button acts, so it is sharp**, and "it navigates rather than acts" was a distinction the pair below already contradicted.
- **`icon-button-ink`** — ink-filled, sharp 0px corners, white chevron, same 32px visual / 44×44px hit area. It and `icon-button-ivory` are **one pair named on one axis — their fill**, because after §Shape made every button sharp the fill is the only thing that separates them: **ivory = an action on this row, ink = the way out of it**. (It was `icon-button-solid`, a name that described a property its ivory twin shares.) It is the **destination** of the row or card it sits in, never an action on it: the trailing column of a table whose whole row resolves to one place (Home's open-work table) or the bottom-right corner of a card that does (a `/replenishment` list card). It carries a chevron and never a text label. The ivory chip *does* something to its row; this ink block *goes* somewhere. Repeating it down a column or across a grid is allowed precisely because it is one control seen many times rather than many CTAs — and where it coexists with a text CTA, that CTA steps down to `button-secondary` so the screen keeps one loudest voice.
  **Hover fills it garnet** (`{component.icon-button-ink-hover}`, press `-active`), white chevron kept: a pointer-driven garnet fill, legitimate because it exists only under the pointer (the form §Colors sanctions) — the affordance lights up when you reach for it and is ink again the moment you leave. At rest, garnet still fills no control (§Colors).
- Text buttons are **44px tall — visual height = hit area**, the same rule as the size-run tiles: on a shop-floor tool the target you see is the target you tap. Icon buttons keep the 32px-visual-inside-44px-hit-area technique (their chips would look oversized at 44px in dense rows). Every button — text or icon — is `{rounded.none}`. Disabled states: `{colors.hairline}` fill + `{colors.muted-soft}` text (primary/danger) or muted text + `{colors.border-strong}` rule (secondary).

### Navigation
- **`sidebar-item-active` / `sidebar-item-inactive`** — pill-shaped rows, 10×12px padding, icon + label. Active: full-strength `{colors.on-sidebar}` text + the 2px `{colors.on-sidebar}` rule under the label (no fill — the primary would vanish on its own family, §Colors); inactive: `{colors.on-sidebar-muted}` text, transparent, `{colors.sidebar-hover}` pill fill on hover. When the sidebar is collapsed (64px rail), items render icon-only with the label as a tooltip and the active rule under the icon (structure and behavior in `shared/layout.md`). Visibility of items is driven by the shared permission matrix (`hasPermission`), never by role checks.
- **`tenant-selector`** — pill-shaped select-style **control** in the sidebar's tenant context block (pill because it names the store you are in and belongs to the sidebar's vocabulary, §Shape) (dark treatment: `{colors.sidebar-hover}` fill, `{colors.on-sidebar}` text; hover steps one lighter into the family — `{component.tenant-selector-hover}`) showing the active store; opens a floated dropdown (white surface, 1px ink rule — §Elevation; search + store list + "Clear selection", `shared/layout.md`). Platform Admin only; manager/employee see their store name as static text in the same block. Collapsed-rail and drawer behavior in `shared/layout.md`.

### Data Table
- **Dense by default**: 8×12px cell padding, 40px minimum row height on pointer devices (44px on touch). Density is deliberate — an internal tool's tables should maximize rows per screen while staying scannable through alignment, not air. **One documented exception**: any row carrying a `{component.size-run}` (`/availability`, Home's out-of-stock block) is taller, because the run's tiles are full 44px touch targets (§Size run). Reach for the exception only there — never loosen a table to "match".
- **`table-header`** — `{colors.surface-soft}` fog band, muted labels, 10×12px padding.
- **`table-row`** — white, 1px `{colors.hairline-soft}` bottom rule; hover flips to `{colors.surface-soft}` (fast transition, §Motion). Row click navigates to detail where a detail exists.
- Numeric columns (requested quantities) right-aligned with `tabular-nums` — never a stock balance: availability events carry no quantities (RN-06).
- **`pagination-button`** — sharp outlined 36px buttons with page indicator between; disabled at bounds.

### Size run
The signature component: a product's sizes rendered as one horizontal row of **sharp 44px tiles** (`{component.size-run}`), in `position` order, so a whole size run reads at a glance — "this model is missing 38 and 42, and has everything else". It replaces one-table-row-per-size on `/availability` and on Home (AD-22).

- Every tile is `{rounded.none}`: it is a button, and no button in this product has a radius (§Shape). The run reads as a row of squares on a baseline grid — the same rectangular language as the tables and inputs around it. Available sizes: `{component.run-tile-available}` — flat fog fill, no outline, no dot. Out-of-stock sizes: `{component.run-tile-out}` — the single `{component.out-of-stock-mark}` treatment (dotted outline + amber leading dot, no fill), **identical for every missing size whatever its age** (§Out of stock). Age lives in the line's elapsed figure, never in the tile.
- Geometry is uniform across the run: every tile shares `tileHeight` (44px) and `tileMinWidth` (44px), so a tile is never smaller than a fingertip and short labels ("7") and long ones ("One size") sit on the same baseline grid. The out-of-stock dot lives inside the tile's padding box, which the 44px floor absorbs: an out-of-stock tile and an available one of the same label read at the same width instead of the mark widening the run.
- Each tile is a **button** where the context allows an action, at **44×44px minimum with visual size = hit area** — no invisible extension. The run set this rule first and text buttons and inputs now follow it (§Buttons); only icon buttons keep an invisible extension. It is deliberate and the exception to the app's density rule — the size run is the shop-floor gesture, tapped hundreds of times a day on a tablet held in one hand, so the target must be unmissable rather than compact. It costs vertical room on `/availability` and Home; that cost is accepted (§Data Table density does not apply to the run).
- The run shows only the sizes the store carries; it is not the catalog's full size list.
- The same primitive is the **ProductPicker's** size selector (`shared/product-picker.md`), where `{component.run-tile-selected}` (garnet 2px outline — punctuation, not fill) and `{component.run-tile-disabled}` come into play. One component, two consumers — never two look-alikes.
- Long runs wrap rather than scroll horizontally; the aging figure stays right-aligned on the first line.

### Badges
Full-pill (the naming dialect), soft background + strong text, 2×10px padding:
- **`badge-out-of-stock`** — renders "Out of stock" plus the elapsed figure on `/availability/:id`, where the subject is a single size and no run exists. It wears the same `{component.out-of-stock-mark}` as a run tile (dotted outline + amber dot, no fill, no aging grading) — one mark, two hosts. The mark is a **treatment, not a shape**: the radius comes from its host, so it reads pill here and square in the run, and that is not a second mark.
- **`badge-status-draft` / `-processing` / `-done`** — info / warning / success pairs for replenishment list states.
- **`badge-inactive`** — ivory `{colors.surface-strong}` fill + muted text for deactivated products, stores, and users.

### Feedback
- **`toast-success` / `toast-error`** — soft-background toasts with a 1px rule in their strong tone (§Elevation), sharp corners, top-right, auto-dismiss; every mutation reports its outcome through one of these (spec RF-36 — the per-item autosave exception is documented in `shared/components.md` §Toasts).
- **`empty-state`** — centered icon + one-line explanation + (when permitted) a primary action. Used by every list.
- **Loading state** — skeleton rows matching the table geometry; no spinners inside tables.
- **Error state** — inline card with error-soft background, message, and a "Retry" secondary button.
- **`progress-bar`** — a sharp 10px track in `{colors.surface-strong}` with a `{colors.primary}` fill — garnet in its data-stroke role: a printed rule that fills. The fill width animates per §Motion (Base). Always paired with its **compact fraction** (`0/4`, `tabular-nums`) under a **"Progress"** label — never color alone, and never a percentage. It lives inside a `{component.card}` of its own rather than floating on the canvas: the bar is a reading, and a reading sits on the data surface like every other (see `pages/replenishment-detail.md`). Used for replenishment list check progress (behavior in `shared/components.md`).

### Forms & Modals
- **`text-input`** — white, 1px `{colors.border-strong}` rule, **0px radius, 44px height** (visual = hit area, like every control — §Buttons) — a ruled box on paper. Focus: border thickens to 2px in `{colors.primary}` with padding compensation — no glow, no shadow. Post-blur invalid: 1px `{colors.error}` border + inline error text.
- Selects and comboboxes (category, store, product pickers) share input geometry, built on Headless UI; their floated option lists take the 1px ink rule (§Elevation).
- **`modal`** — soft-radius card (`{rounded.md}`) over the scrim, 24px padding, max-width 480px (confirm) / 640px (forms). Header + body + right-aligned action row (secondary then primary).

### Tooltip & slide-over

- **`tooltip`** — the spine tone (`{colors.sidebar}`) as a small floating chip: `{typography.caption}` at weight 500 in `{colors.on-sidebar}`, sharp corners, 6×10px padding, fade-in per §Motion (Fast). An optional second line in `{colors.on-sidebar-muted}` carries a hint (a run tile's SKU · state). Being its own dark surface it needs no ink rule — the one floating layer exempt from §Elevation's substitute. Consumers: collapsed-nav labels, the collapsed tenant tile and user avatar (`shared/layout.md`), size-run tile previews. Sits at `{layers.popover}`; shown on hover **and keyboard focus** (§Accessibility).
- **`sheet`** — a right-anchored slide-over panel (420px, full viewport height) for a detail that does not warrant a route: white surface, sharp corners, and a **1px `{colors.ink}` left rule** — the ink-rule shadow substitute of §Elevation applied to its one exposed edge. It slides in from the right per §Motion (Base) over its own scrim (`{layers.sheet}` / `{layers.sheet-scrim}`), and closes on scrim tap and Escape. It is a reading surface, not a dialog: anything destructive or form-heavy stays in a modal. One consumer today — the catalog's product detail (`pages/catalog.md`); a second consumer must justify itself the way the list-skeleton exceptions do.

## Responsive Behavior

| Name | Width | Key Changes |
|---|---|---|
| Mobile | < 744px | Sidebar becomes an off-canvas drawer (full height, flush — same flat spine treatment) behind the hamburger in the fixed **mobile header** (`{component.mobile-header}` — the content area starts below it); tables allow horizontal scroll or collapse low-priority columns; size runs wrap to as many lines as they need and the aging figure moves under the run; Home's figures card stacks its three figures vertically (its on-dark rules turn horizontal) and the greeting header wraps with "New list" full-width beneath it; forms full-width. |
| Tablet | 744–1128px | Sidebar defaults to the collapsed 64px icon rail with tooltips, flush; expanding overlays the content behind the scrim (see `shared/layout.md`); size runs (44px tiles — the primary touch surface at this width, §Size run) fit on one line up to ~10 sizes and wrap beyond that; tables full. |
| Desktop | > 1128px | Sidebar defaults to expanded (256px), user-collapsible to the 64px rail (persisted); size runs on one line with the aging figure right-aligned, content capped at ~1200px. Tiles keep their 44px geometry here too — one size run, one component, no pointer-only variant. |

Touch targets: text buttons and inputs render at **44px height — visual size = hit area** (§Buttons); icon buttons render at 32px visual size inside a 44×44px hit area (see `{component.icon-button-ivory}`); **size-run tiles render at their full 44×44px — visual size = hit area** (§Size run), the product's most-tapped control; table rows ≥ 44px on touch devices (40px minimum on pointer devices — see §Data Table density).

## Accessibility

- Keyboard navigation is supported for all interactive controls.
- Visible focus states: a 2px `{colors.primary}` outline on light surfaces; on the dark surfaces — the sidebar spine and the filter band — a 2px `{colors.on-sidebar}` outline (garnet does not reach 3:1 against the garnet-ink family). Focus never relies on color alone.
- Semantic HTML is preferred over presentational elements.
- Status is communicated through text/icon + color, never color alone. The out-of-stock mark carries hue on nothing but a 6px dot, and it is redundant: the dotted outline and the absent fill distinguish it from an available tile on their own. Duration never uses colour — the elapsed figure is always text and escalates by weight only (§Out of stock). Both survive greyscale and color-blind vision.
- The active-nav marker (on-sidebar white) is likewise redundant: the active item is also the only full-strength-text item in the nav.
- Weight-400 headings rely on **size** for hierarchy, which survives low vision zoom; heading levels are still expressed in markup (`h1`–`h3`), never by visual size alone.
- Interactive targets provide a minimum 44×44px hit area.
- Form errors are associated with their corresponding fields.
- Modals trap focus and restore focus to the triggering element on close.
- Tables use semantic table markup and accessible headers.
- Contrast must meet WCAG AA for text and interactive states (including the dark sidebar pairs: `on-sidebar` and `on-sidebar-muted` on `sidebar`, and ink on the ivory `{colors.surface-strong}` wash).
- `prefers-reduced-motion` is respected: all transitions and shimmers become instant (§Motion).
- Collapsed-sidebar tooltips are keyboard-accessible (shown on focus, not only hover).

## Future Evolutions

Documented so the design permits them without restructuring; none are in the MVP.

- **Per-tenant theming.** All brand colors are consumed exclusively as CSS custom properties (`--color-primary`, `--color-secondary`) mapped into Tailwind. The blaugrana palette is the default theme. Per-store customization would add a `theme` JSONB column on `tenants` and inject the variables at session load — no component changes required. The garnet-ink family tokens (`sidebar`, `sidebar-hover`, `filter-band`, `on-sidebar`, `on-sidebar-muted`) are derived tones computed from the primary, like `primary-active`. Semantic colors stay fixed (never tenant-configurable) so alerts always read the same. The punctuation discipline is theme-independent: whatever a tenant's primary is, it punctuates and never fills.
- **PolySans.** If the brand ever licenses PolySans (the reference's display face), the swap touches only `{typography.fontFamilyHeading}` — every heading rule (weight 400, -0.02em) already matches its intended use.
- **Dark mode.** Not planned; surfaces are token-based, so it remains possible.

## Known Gaps

- Chart palette beyond garnet (primary stroke) and blue (secondary stroke) is undecided. With Home's chart cards removed (RF-41) the product currently hosts no charts at all, so this is deferred until one is genuinely needed — not pre-solved.
- Print styles for replenishment lists (plausible operational need) are not designed — noting that a zero-shadow, hairline-and-band system is already unusually close to print-ready.
