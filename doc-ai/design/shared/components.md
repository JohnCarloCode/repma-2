# components — Shared patterns

> Behavior spec for the shared components every page reuses (RF-36). Visual definitions live in `../DESIGN.md` (§Components); this doc defines behavior, props and conventions. Implemented once in `apps/web/src/components/`, consumed by features — never reimplemented per page. UI copy is English (RNF-19).

## `<RequirePermission p="...">`

Wrapper that renders children only if `hasPermission(session, p)` (shared matrix). Used for both routes (guard) and inline actions (buttons, menu items). Nothing in `features/` ever checks `role === 'x'`.

## List screen skeleton

Every list page (catalog, users, tenants) composes the same pieces in the same order — page header → filter band → `<DataTable>` → `<Pagination>`.

**Two documented exceptions**, both keeping the page header, the filter band and the pagination row while replacing the table body:

- **`/availability`** (AD-22): the body is not a `<DataTable>` of sizes — it is a list of products, each rendering a `<SizeRun>` (DESIGN.md §Size run). One glance reads a whole size run, and a flat size table would split a run across pages.
- **`/replenishment`** (`../pages/replenishment.md`): the body is a **grid of list cards**. A replenishment list is a work item, not a row of attributes — its status, its size, its creator and its age are read together as one object and then acted on, never compared down a column.

Both are deliberate and for the same underlying reason: the platform-admin CRUD screens should look like plain tables, and the store's daily screens should not look like them. Both stay contained to one page and keep the band and the pagination. Do not generalise them to another page without a reason of the same kind.

### `<PageHeader>`
Title (display token, per DESIGN.md §Typography) + optional primary action button (right-aligned, permission-gated). One primary action max per screen. There is no topbar at tablet width and above (`./layout.md`), so this is the only header on the screen there; at mobile width the shell's **fixed mobile header** sits above it and hosts the drawer trigger (`./layout.md` — No topbar · Mobile header).

- `<PageHeader>` carries **no navigation trigger at any width** — the hamburger belongs to the shell's mobile header, not to the page.
- Optional **subtitle**: one `{typography.body}` line in `{colors.text-secondary}` directly under the title — the store name (store zone; platform pages drop it) plus the result set's headline count from the list envelope's `total` ("Centro Store · 42 products", "6 stores on the platform"). It renders only once the data is there (no skeleton of its own) and reflects the active filters, so it always describes what the list below actually holds. Each page doc states its exact wording; pages without one simply omit it.
- Detail pages use their own header (entity name + badge + actions) instead of `<PageHeader>`; their back arrow is the first item of the row.

### Filter band
Search input + selects on the `{components.filter-band}`: a neutral card — `{colors.surface}`, 1px `{colors.border}`, `{rounded.md}`, 16px padding — like the replenishment list cards (DESIGN.md). The controls are `{colors.canvas}` wells with a 1px `{colors.border-strong}` border, 44px high; toggles sit inside a control-styled box. Focus is the standard `{colors.accent-bright}` ring. Behavior:
- Search debounced 300ms; resets to page 1 on change.
- **Filter and page state live in the URL** (query params) — shareable, survives refresh and back navigation. The page is `page`; each filter is its own param named after the API param it feeds (`search`, `from`, …); an empty filter and page 1 are left out of the URL. Every filter change — and "Clear filters" — drops `page`. Implemented once as `useListParams` (`apps/web/src/components/list/`); a URL update keeps the router state the page was opened with (e.g. a detail's back-arrow target).
- **Responsive**: desktop lays the controls out inline; on mobile the band stacks — search full-width on top, selects wrapping below it. Same rule on every page that uses the band.
- **Date ranges** (`/activity`, `/replenishment`'s "Custom…"): calendar days in the URL as `yyyy-mm-dd`, sent as local-midnight bounds in the browser's timezone — start of "From", end of "To", both inclusive; a backwards pair is swapped, never queried as an empty range; keyboard entry commits only once the year is complete. Implemented once as `DateField` + `dayBounds`/`orderedRange` (`apps/web/src/components/list/DateField.tsx`).
- Detail pages may reuse the band to filter an **already-loaded set client-side** (e.g. replenishment list items): same visuals and URL-state convention, no refetch — filtering only changes what is shown, never the underlying set.

### `<DataTable>`
- Column defs with header, cell renderer, alignment (numeric columns right-aligned, tabular-nums).
- **Width**: a table never clips its last columns. A cell holding one unbreakable value (an email) lets it wrap anywhere (`[overflow-wrap:anywhere]` on the cell content) so the row fits; as a fallback the card scrolls horizontally (`overflow-x-auto`) rather than hiding overflow.
- Row click navigates to detail where a detail route exists; row action buttons (`icon-button`) stop propagation. Where the detail is not a route (a slide-over), the row calls back instead: **Code** `onRowClick={(row) => …}` on `<DataTable>` gives the same interactive row (focusable, click / Enter, hover) without navigating; `rowHref` wins when both are given. First consumer: `/catalog`'s product sheet (`../pages/catalog.md`).
- **Group header rows** (optional): a full-width `{colors.surface-raised}` row in `body-medium` naming the group of the rows beneath it — the items table on `/replenishment/:id` is the consumer (product groups by default, category groups with its toggle — see `../pages/replenishment-detail.md`). A group whose rows are all filtered out renders no header row. **Code**: `group={(row) => ({ key, label })}` on `<DataTable>` (`components/list/DataTable.tsx`): a header row (`th scope="colgroup"` spanning every column) precedes each run of consecutive rows sharing a `key` — the consumer orders the rows so groups are adjacent; headers derive from the rows passed, so filtering rows out removes their header for free. Kept below 744px (it stacks as a block).
- **Destination affordance** (optional): where a row — or a card — resolves to exactly one place and that exit should be visible rather than merely discoverable, it carries an `{components.icon-button}` with a chevron: `{colors.surface-raised}` square, `{colors.accent-bright}` chevron on hover. It sits in the last column of a table row (Home's open-work table) or the bottom-right corner of a card (`/replenishment` list cards), and is rendered **inside that row's or card's own link**, never as a sibling button: one tab stop, one accessible name, no destination duplicated for assistive tech. It is a signpost for a target that already existed, never a second action, so it never coexists with an action pointing elsewhere — a delete button on the same card stays a separate target with its own hover, and hovering one never lights the other.
- **Bounded (unpaginated) use**: the same geometry serves summary blocks that show a capped set instead of a page — all three Home blocks (open work, out of stock, recent activity). Everything is identical except that `<Pagination>` is replaced by a tertiary "View all" **bottom-right, right-aligned under the last row** — stating the true total ("View all (9)") when the set truncates. The count applies to bounded **work** sets (open lists, out-of-stock products); a teaser of an unbounded feed — Home's recent activity — carries no count, because a feed's total bounds no work. The header row does not render on its own: an empty result replaces the whole table with its `<EmptyState>`. **Code**: `viewAll={{ to, total? }}` on `<DataTable>` renders the link (`button-text`, `textButtonClass`) under the card; `viewAllLabel(shown, total)` adds "(N)" only when `total > rows shown` — omit `total` for a feed teaser. The empty-state swap is the consumer's (it renders `<EmptyState>` instead of the table). `<LoadingState rows>` sets the skeleton's row count to the block's bound. A row with `rowHref` is the `group/row` hover group: the destination chevron is a plain `aria-hidden` cell content (not a `<RowAction>`, which is a separate button target) styled `group-hover/row:text-accent-bright`.
- **Below 744px** (DESIGN.md §Responsive Behavior: tables become card lists) the header row is hidden and each row stacks as a block, one line per cell, labelled with its column header.
- Sorting out of scope for the MVP (spec defines no sort params).

### `<Pagination>`
- Driven by API response `{ items, page, pageSize, total }` (default 20, max 100).
- **Empty-page recovery (RF-36)**: after a delete leaves the current page empty and `page > 1`, refetch on `page - 1`. The same rule covers a stale or shared URL pointing past the end: an empty page `> 1` moves to the last page that holds rows (`min(page - 1, ceil(total / pageSize))`, at least 1) in one step, replacing the history entry so Back never returns to the empty page.

## Async states — one component each, used everywhere

| Component | When | Behavior |
|---|---|---|
| `<LoadingState>` | query pending | Static `{colors.surface-raised}` skeleton rows matching table geometry (lists) or skeleton cards (Home/detail). No shimmer — DESIGN.md §Motion lets nothing but the live dot loop — and no spinners inside tables. |
| `<EmptyState>` | success + 0 items | Icon + one-line explanation + primary action if the user has permission for it. Distinguish "no data yet" from "no results for these filters" (offer "Clear filters"). |
| `<ErrorState>` | query error | Inline card + "Retry" (refetches). Never a blank screen. A page may name the failure and swap Retry for its own way out where retrying cannot help — a detail's 404: "Item not found" + a link back to its list. |

## Toasts

- Every mutation reports its outcome: success toast on success, error toast with the API message on failure (RF-36). **One documented exception**: the per-item autosave mutations on `/replenishment/:id` (add item, done check, quantity — RF-28/RF-40) are silent on success — the visible state change (the new row, the check, the bar, the disabled tile) is the feedback, and toasting every tap of a shop-floor session would be noise. Errors always toast, autosaved or not.
- API errors arrive as `{ error: { code, message, details? } }`; the toast shows `message`. Validation errors (400 with `details`) render inline at the field level instead — the toast is only for non-field errors.
- **Error mapping** (one function, `errorMessage` in `apps/web/src/lib/toast.tsx`): API messages are written for users (English, RNF-19), so a 4xx envelope's `message` is shown **verbatim** — 400, 403, 404, 409 (e.g. RN-14's "This size is already out of stock"). Replaced by own copy: **401** → "Your session has expired. Sign in again." (the session is cleared and the guard sends the user to `/login` — layout.md §Session bootstrap); **429** (RNF-07) → "Too many requests. Wait a minute and try again."; **5xx**, a non-envelope answer and any non-API error → "Something went wrong. Try again." (nothing the user can act on, and no internals leak). A network failure (no HTTP answer) keeps the apiClient's "Network error. Check your connection and try again."
- Top-center stack at `{layers.toast}`, newest last, 16px from the top (max 360px wide; on mobile at most the viewport minus 128px, so it sits over the mobile header without covering its menu button; below tablet only the newest toast shows — a second one would grow the stack down onto the page header's action — and older ones reappear as newer ones are dismissed). Not top-right: an error toast persists until dismissed, and at top-right it sat exactly on the page header's primary action (e.g. "Mark restocked" right after an RN-14 409), blocking it. Auto-dismiss: success ~4s; errors persist until dismissed (close `icon-button`, "Dismiss notification"). Mounted once above the router, so a toast raised right before a navigation (create → detail, delete → index) survives it. Portalled to `<body>`, outside the app root: an open dialog makes the app root inert and hidden from assistive tech, so a toast raised while a modal is open (a form modal's non-400 error) is still announced and dismissable above it — and dismissing it doesn't close the modal.
- **Accessibility**: the stack is an always-mounted `aria-live="polite"` region ("Notifications"), so the first toast is announced; each error toast is `role="alert"` (assertive).
- **API**: `const toast = useToast(); toast.success(message); toast.error(errorOrMessage)` — `error` takes the caught error (mapped as above) or a ready message. Consumers call it from the mutation's own callbacks; there is no global mutation-error toast, because 400s on forms go inline and the autosave exception above stays silent on success. **Action toasts**: `toast.success(message, { label, onAction })` adds one text button (underlined, `accent-bright` underline) before the close button; using it dismisses the toast and runs `onAction`. A success toast with an action stays **6 s** instead of ~4 s (`ACTION_DISMISS_MS`) so the action can be reached. Its consumer is "Item removed" + "Undo" on `/replenishment/:id`.

## Modals & confirms

- Built on Headless UI `Dialog` (focus trap + restore per DESIGN.md §Accessibility).
- Rendered in a portal at the document root at `{layers.dialog}`, scrim at `{layers.dialog-scrim}` — above the **entire** shell at every breakpoint (DESIGN.md §Elevation · Layering): above the fixed mobile header on mobile, and above the collapsed rail, the expanded panel and its scrim on tablet. The scrim and the dialog cover the shell, never slide beneath it.
- The portal is not optional: a dialog rendered inside the content area inherits the shell's stacking context and cannot escape it, no matter what z-index it declares. If chrome shows through beside an open dialog, the bug is the missing portal, not a low z-index.
- **Form modal** (max-w 640px): create/edit forms that don't warrant a page. Submit → mutation → on success: close + toast + query invalidation; on 400: inline field errors, stays open.
- **Confirm modal** (max-w 480px): every destructive action (delete user, delete list). Message names the entity ("Delete the list “Weekly replenishment”?"); confirm button is `button-danger`. The benign side of a toggle (reactivate) confirms with `button-primary` instead.
- **Behavior (both)**: actions bottom-right, Cancel first; initial focus on the first focusable element — the first field of a form, Cancel in a confirm (never the destructive button); Escape, a scrim click or Cancel close it, focus returns to the trigger. While the mutation is pending the primary action shows its pending label, both actions are disabled and the modal can't be dismissed. A form modal's non-field error renders as an `alert` beneath the fields.
- **Code**: `apps/web/src/components/Modal.tsx` — `<FormModal>`, `<ConfirmModal>` and the shared `<Modal>` base (scrim + `modal` card + title, sized by the caller) for dialogs with their own layout (`<ProductPicker>`). `sheetOnMobile` turns the panel into a full-screen sheet below 744px (no gutter, no radius, `100dvh`); from tablet up the caller's `className` sets both width and height.

## Image preview
A product image thumb (`<ProductThumb>`) comes in two tiers: **64px on list rows** (the default — `/availability` lines, replenishment list items, `/catalog` and Platform products tables) and **120px on detail surfaces** (the `/availability/:id` summary card — 88px below 744px so the heading keeps its width — and `/catalog`'s slide-over). The image is `object-contain` on the box's `{colors.surface-raised}` fill with its border and `{rounded.sm}` corners, so a garment is never cropped. It is a button ("Enlarge image of <product>", `cursor-zoom-in`) that opens the image enlarged in a dialog: `{colors.scrim}` backdrop with a background blur over whatever is behind, the image centered at its natural ratio (`object-contain`, up to 800px wide and 85% of the viewport height, `{rounded.md}`), and a 44px round close button (`close` icon, "Close") on its top-right corner. The X, a click outside the image or Escape closes it, and focus returns to the thumb. Clicks and keys inside it never reach the thumb's ancestors, so a thumb in a clickable row (`/catalog`) opens only the preview. A thumb inside another control (the picker's product tiles) passes `zoom={false}` and stays a plain image; a product without an image shows its initials placeholder, never a button.

## Slide-over (sheet)

- Right-anchored panel for a detail that is not a route (DESIGN.md §Tooltip & slide-over, `components.sheet`): full height, 420px wide (the full viewport width below that), `surface` with a 1px `border` left rule, no radius; enters from the right (`motion.base`).
- Same Headless UI `Dialog` base as modals: portalled to the document root, focus trapped while open (initial focus on the first focusable element) and restored to the trigger on close; Escape and a scrim click close it. The app root is inert beneath it.
- Layers: scrim at `{layers.sheet-scrim}`, panel at `{layers.sheet}` — above the whole shell (mobile header, rail, expanded panel and its scrim), **below** popovers, dialogs and toasts, so a confirm opened from a sheet stacks above it.
- **Code**: `apps/web/src/components/Sheet.tsx` — `<Sheet open onClose title footer?>{body}</Sheet>`: the title is the dialog's accessible name (18px, `text-h2`); the body scrolls; `footer` (optional) is pinned under it, right-aligned above a `border` rule — the caller renders its own actions there (e.g. the "Close" tertiary). First consumer: `/catalog`'s product detail (`../pages/catalog.md`).

## Forms

- Zod schemas from `packages/shared` (the same ones the API validates with) drive client-side validation — validate on submit, then per-field on blur.
- Field errors inline beneath the input (error tone); API 400 `details` map back onto fields by name.
- Submit button disabled while the mutation is pending, with pending label ("Saving…").
- **Code**: the `text-input` class strings (`textInputClass` 44px, `textAreaClass` multi-line) live in `apps/web/src/components/form.ts`; label above the control (`text-label`), an optional field says so in the label ("Notes (optional)"), the error is a caption in `alert` tied by `aria-describedby`, the control `aria-invalid`.

## `<ProgressBar>`

Visual per DESIGN.md `progress-bar` (8px `{colors.surface-raised}` pill track, `{colors.accent-bright}` fill, animated width). Behavior:

- Renders as a labelled block, never a bare bar: the **"Progress"** label with the **compact fraction `0/4`** (`tabular-nums`) on the same line, and the track full-width beneath it. The fraction is the strict `done/total` form — no unit, no "done", no percentage: the label already says what it is, and the numbers are read at a glance on a shop floor.
- The consumer places that block inside a `{components.card}` (see `pages/replenishment-detail.md`) — the component owns the label, fraction and bar, not the container.
- The fraction is never decorative: the bar alone never carries the information (accessibility: `role="progressbar"` with `aria-valuenow/min/max` and the fraction as accessible text).
- Driven by already-loaded data; updates immediately on the mutation's optimistic state, reconciled on refetch.
- Not rendered when the set is empty (`0/0` is noise, not progress).
- **Code**: `apps/web/src/components/ProgressBar.tsx` — `<ProgressBar done total />`; returns `null` when `total` is 0. `role="progressbar"` labelled by its "Progress" label, `aria-valuenow`=done / `aria-valuemax`=total / `aria-valuetext`="done/total".

## `<SizeRun>`

Renders a product's sizes as one row of **44px tiles** with `{rounded.sm}` corners (visual per DESIGN.md §Size run — a tile is a button, so it takes the button radius). Behavior:

- Receives the product's sizes in `position` order with each one's `is_available` and latest-event timestamp; derives each elapsed figure and its band per DP-07 at render time (nothing is precomputed server-side). The band affects **only the figure's weight** — every out-of-stock tile renders the same mark.
- Tiles are **links** where the consumer passes a destination (`/availability`, Home — navigation is a link, optionally carrying router state such as the list's URL state), **buttons** where it passes an action (the ProductPicker's selection: `onSelect`, `selectedSizeId`, `disabledSizeIds` + `disabledLabel`, keyed on `sizeId`; `run-tile-selected` = `aria-pressed`, `run-tile-disabled` = disabled with the label in its tooltip and accessible name; button tiles never render the out-of-stock mark or its age, and an inactive size stays selectable with its muted label), plain spans where it passes neither — so the same component serves the read-only case without a variant of its own.
- Each tile names its state as text for assistive tech ("42, out of stock 5 h", "38, available", plus ", inactive"), and hovering/focusing it shows a tooltip (above the tile) with label · SKU · state and `badge-inactive` when the size is inactive. An inactive size's label is muted (`text-secondary`); its mark, if out of stock, is unchanged.
- The elapsed figure and band come from one util (`apps/web/src/lib/aging.ts`), also used by the consumers' line figure (earliest outage in the run) and `badge-out-of-stock`.
- The component owns no navigation or mutation: `/availability` and Home wire the per-size link (`/availability/:id`) into it, the ProductPicker wires selection into it. Flagging is never wired into a run — it lives on the item detail (RF-20).
- Long runs wrap; the run never scrolls horizontally on its own.
- Tiles carry the product's **largest touch target: 44×44px visual = hit area** (DESIGN.md §Size run). The component never renders a smaller pointer-device variant — one geometry everywhere — so consuming layouts must budget the extra row height rather than shrinking the run.

## `<ProductPicker>`

The visual product & size selector used by every "add a product to X" flow (assortment, replenishment items). Full spec in [product-picker.md](product-picker.md) — never use a plain select/combobox to pick products.

## Badges

Semantic pills defined in DESIGN.md (badges keep the pill dialect — they name a state, they are not buttons, §Shape): `badge-out-of-stock` (renders **"Out of stock"** plus its elapsed figure in the same uniform out-of-stock mark as a run tile — dashed outline + red `{colors.alert}` dot, no fill; used on `/availability/:id`, where the subject is one size and there is no run to carry the state), `badge-status-draft/-processing/-done` (list states), `badge-inactive` (deactivated products/stores/users). Always icon-or-text + color, never color alone. Code: `<ListStatusBadge status>` (`apps/web/src/components/ListStatusBadge.tsx`, labels from §Data conventions), `<InactiveBadge>`.

## `<Tooltip>`

Short text label for an element whose own text is hidden (the collapsed sidebar's nav items, avatar and tenant tile — `./layout.md` §Collapse / expand). Visual: DESIGN.md `components.tooltip` with the floating-layer border (§Elevation).

- Shown on pointer hover **and** keyboard focus; hidden on leave/blur and on Escape. `content = null` disables it (same trigger, labels visible).
- Placed to the right of the trigger, vertically centered (or above it, for size tiles); portalled to the document root at `{layers.popover}` so a scrolling ancestor (the nav list) never clips it. A trigger inside a dialog (the ProductPicker's tiles) takes `{layers.dialog}` instead — appended to `<body>` after the dialog's portal, it paints above the panel; `popover` would sit beneath it.
- Supplementary only: the trigger keeps its own accessible name (e.g. the visually hidden label), so the tooltip is not wired as `aria-describedby` and is never announced twice. Never put information in a tooltip that is not otherwise available.

## Data conventions

- Dates: relative for < 24h ("14 min ago" under an hour, whole hours "2 h ago" beyond), otherwise `dd/mm/yyyy HH:mm`. Always render from `timestamptz` in the browser's timezone.
- Quantities (replenishment `quantity_requested` only): tabular-nums, right-aligned. Availability events carry no quantities (RN-06) — the app NEVER shows a current stock quantity.
- Where the subject **is** a single size (`/availability/:id`, replenishment list items, activity rows), name it "Nike Air Max — 42" (product name — size label), with the size SKU where SKU is shown. Products with a single size labeled "One size" omit the label.
- Where the subject is a **product with its run** (`/availability`, Home), the product is named once and the sizes are the tiles — never repeat the product name per size.
- Out-of-stock duration renders as a compact elapsed figure next to the mark ("2 h", "6 d", "3 w"), always as text. The **figure** is what escalates with the bands of DP-07 (weight only — treatment in DESIGN.md §Out of stock); the mark itself is identical at any age. Never render the mark without the figure, and never restate the thresholds here.
- Event type labels: `out_of_stock` → "Out of stock", `restock` → "Restocked" (never "Replenishment", which is reserved for replenishment lists).
- Author/creator of a deleted user (`created_by` null, RN-09): always "—", never a placeholder name.
- List status labels: `draft` → "Draft", `processing` → "In progress", `done` → "Done".
- Role labels: `platform_admin` → "Platform Admin", `manager` → "Manager", `employee` → "Employee".
- Deactivated entities (products, sizes, stores, users): the status label is always **"Inactive"** (`badge-inactive`), on every page. "Retire" / "Reactivate" are action verbs (`/platform/catalog` row actions and confirm copy), never status labels.
