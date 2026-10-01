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
- Optional **subtitle**: one `{typography.body}` line in `{colors.muted}` directly under the title — the store name (store zone; platform pages drop it) plus the result set's headline count from the list envelope's `total` ("Centro Store · 42 products", "6 stores on the platform"). It renders only once the data is there (no skeleton of its own) and reflects the active filters, so it always describes what the list below actually holds. Each page doc states its exact wording; pages without one simply omit it.
- Detail pages use their own header (entity name + badge + actions) instead of `<PageHeader>`; their back arrow is the first item of the row.

### Filter band
Search input + selects on the dark `filter-band` surface (#3b1322, the sidebar's hover tone — DESIGN.md §Surfaces & Borders). The controls themselves stay white (`text-input` geometry unchanged); any text directly on the band (toggle labels, a "Clear" tertiary action) uses the on-sidebar tones, and focus on the band is the spine's 2px `on-sidebar` outline. Behavior:
- Search debounced 300ms; resets to page 1 on change.
- **Filter and page state live in the URL** (query params) — shareable, survives refresh and back navigation.
- **Responsive**: desktop lays the controls out inline; on mobile the band stacks — search full-width on top, selects wrapping below it. Same rule on every page that uses the band.
- Detail pages may reuse the band to filter an **already-loaded set client-side** (e.g. replenishment list items): same visuals and URL-state convention, no refetch — filtering only changes what is shown, never the underlying set.

### `<DataTable>`
- Column defs with header, cell renderer, alignment (numeric columns right-aligned, tabular-nums).
- Row click navigates to detail where a detail route exists; row action buttons (icon-button-ivory) stop propagation.
- **Group header rows** (optional): a full-width `{colors.surface-soft}` row in `body-medium` naming the group of the rows beneath it — the items table on `/replenishment/:id` is the consumer (product groups by default, category groups with its toggle — see `../pages/replenishment-detail.md`). A group whose rows are all filtered out renders no header row.
- **Destination affordance** (optional): where a row — or a card — resolves to exactly one place and that exit should be visible rather than merely discoverable, it carries an `{component.icon-button-ink}`: ink-filled square, white chevron, garnet on hover. It sits in the last column of a table row (Home's open-work table) or the bottom-right corner of a card (`/replenishment` list cards), and is rendered **inside that row's or card's own link**, never as a sibling button: one tab stop, one accessible name, no destination duplicated for assistive tech. It is a signpost for a target that already existed, never a second action, so it never coexists with an action pointing elsewhere — a delete button on the same card stays a separate target with its own hover, and hovering one never lights the other.
- **Bounded (unpaginated) use**: the same geometry serves summary blocks that show a capped set instead of a page — all three Home blocks (open work, out of stock, recent activity). Everything is identical except that `<Pagination>` is replaced by a tertiary "View all" **bottom-right, right-aligned under the last row** — stating the true total ("View all (9)") when the set truncates. The count applies to bounded **work** sets (open lists, out-of-stock products); a teaser of an unbounded feed — Home's recent activity — carries no count, because a feed's total bounds no work. The header row does not render on its own: an empty result replaces the whole table with its `<EmptyState>`.
- Sorting out of scope for the MVP (spec defines no sort params).

### `<Pagination>`
- Driven by API response `{ items, page, pageSize, total }` (default 20, max 100).
- **Empty-page recovery (RF-36)**: after a delete leaves the current page empty and `page > 1`, refetch on `page - 1`.

## Async states — one component each, used everywhere

| Component | When | Behavior |
|---|---|---|
| `<LoadingState>` | query pending | Skeleton rows matching table geometry (lists) or skeleton cards (Home/detail), with shimmer (DESIGN.md §Motion). No spinners inside tables. |
| `<EmptyState>` | success + 0 items | Icon + one-line explanation + primary action if the user has permission for it. Distinguish "no data yet" from "no results for these filters" (offer "Clear filters"). |
| `<ErrorState>` | query error | Inline card + "Retry" (refetches). Never a blank screen. |

## Toasts

- Every mutation reports its outcome: success toast on success, error toast with the API message on failure (RF-36). **One documented exception**: the per-item autosave mutations on `/replenishment/:id` (add item, done check, quantity — RF-28/RF-40) are silent on success — the visible state change (the new row, the check, the bar, the disabled tile) is the feedback, and toasting every tap of a shop-floor session would be noise. Errors always toast, autosaved or not.
- API errors arrive as `{ error: { code, message, details? } }`; the toast shows `message`. Validation errors (400 with `details`) render inline at the field level instead — the toast is only for non-field errors.
- Top-right, auto-dismiss (success ~4s; errors persist until dismissed).

## Modals & confirms

- Built on Headless UI `Dialog` (focus trap + restore per DESIGN.md §Accessibility).
- Rendered in a portal at the document root at `{layers.dialog}`, scrim at `{layers.dialog-scrim}` — above the **entire** shell at every breakpoint (DESIGN.md §Elevation · Layering): above the fixed mobile header on mobile, and above the collapsed rail, the expanded panel and its scrim on tablet. The scrim and the dialog cover the shell, never slide beneath it.
- The portal is not optional: a dialog rendered inside the content area inherits the shell's stacking context and cannot escape it, no matter what z-index it declares. If chrome shows through beside an open dialog, the bug is the missing portal, not a low z-index.
- **Form modal** (max-w 640px): create/edit forms that don't warrant a page. Submit → mutation → on success: close + toast + query invalidation; on 400: inline field errors, stays open.
- **Confirm modal** (max-w 480px): every destructive action (delete user, delete list). Message names the entity ("Delete the list “Weekly replenishment”?"); confirm button is `button-danger`.

## Forms

- Zod schemas from `packages/shared` (the same ones the API validates with) drive client-side validation — validate on submit, then per-field on blur.
- Field errors inline beneath the input (error tone); API 400 `details` map back onto fields by name.
- Submit button disabled while the mutation is pending, with pending label ("Saving…").

## `<ProgressBar>`

Visual per DESIGN.md `progress-bar` (sharp 10px `surface-strong` track, garnet fill, animated width). Behavior:

- Renders as a labelled block, never a bare bar: the **"Progress"** label with the **compact fraction `0/4`** (`tabular-nums`) on the same line, and the track full-width beneath it. The fraction is the strict `done/total` form — no unit, no "done", no percentage: the label already says what it is, and the numbers are read at a glance on a shop floor.
- The consumer places that block inside a `{component.card}` (see `pages/replenishment-detail.md`) — the component owns the label, fraction and bar, not the container.
- The fraction is never decorative: the bar alone never carries the information (accessibility: `role="progressbar"` with `aria-valuenow/min/max` and the fraction as accessible text).
- Driven by already-loaded data; updates immediately on the mutation's optimistic state, reconciled on refetch.
- Not rendered when the set is empty (`0/0` is noise, not progress).

## `<SizeRun>`

Renders a product's sizes as one row of **sharp 44px tiles** (visual per DESIGN.md §Size run — a tile is a button, so it has no radius). Behavior:

- Receives the product's sizes in `position` order with each one's `is_available` and latest-event timestamp; derives each elapsed figure and its band per DP-07 at render time (nothing is precomputed server-side). The band affects **only the figure's weight** — every out-of-stock tile renders the same mark.
- Tiles are buttons where the consumer passes an action, plain spans where it does not — so the same component serves the read-only case without a variant of its own.
- The component owns no navigation or mutation: `/availability` and Home wire the per-size link (`/availability/:id`) into it, the ProductPicker wires selection into it. Flagging is never wired into a run — it lives on the item detail (RF-20).
- Long runs wrap; the run never scrolls horizontally on its own.
- Tiles carry the product's **largest touch target: 44×44px visual = hit area** (DESIGN.md §Size run). The component never renders a smaller pointer-device variant — one geometry everywhere — so consuming layouts must budget the extra row height rather than shrinking the run.

## `<ProductPicker>`

The visual product & size selector used by every "add a product to X" flow (assortment, replenishment items). Full spec in [product-picker.md](product-picker.md) — never use a plain select/combobox to pick products.

## Badges

Semantic pills defined in DESIGN.md (badges keep the pill dialect — they name a state, they are not buttons, §Shape): `badge-out-of-stock` (renders **"Out of stock"** plus its elapsed figure in the same uniform out-of-stock mark as a run tile — dotted outline + amber dot, no fill; used on `/availability/:id`, where the subject is one size and there is no run to carry the state), `badge-status-draft/-processing/-done` (list states), `badge-inactive` (deactivated products/stores/users). Always icon-or-text + color, never color alone.

## Data conventions

- Dates: relative for < 24h ("2 h ago"), otherwise `dd/mm/yyyy HH:mm`. Always render from `timestamptz` in the browser's timezone.
- Quantities (replenishment `quantity_requested` only): tabular-nums, right-aligned. Availability events carry no quantities (RN-06) — the app NEVER shows a current stock quantity.
- Where the subject **is** a single size (`/availability/:id`, replenishment list items, activity rows), name it "Nike Air Max — 42" (product name — size label), with the size SKU where SKU is shown. Products with a single size labeled "One size" omit the label.
- Where the subject is a **product with its run** (`/availability`, Home), the product is named once and the sizes are the tiles — never repeat the product name per size.
- Out-of-stock duration renders as a compact elapsed figure next to the mark ("2 h", "6 d", "3 w"), always as text. The **figure** is what escalates with the bands of DP-07 (weight only — treatment in DESIGN.md §Out of stock); the mark itself is identical at any age. Never render the mark without the figure, and never restate the thresholds here.
- Event type labels: `out_of_stock` → "Out of stock", `restock` → "Restocked" (never "Replenishment", which is reserved for replenishment lists).
- Author/creator of a deleted user (`created_by` null, RN-09): always "—", never a placeholder name.
- List status labels: `draft` → "Draft", `processing` → "In progress", `done` → "Done".
- Role labels: `platform_admin` → "Platform Admin", `manager` → "Manager", `employee` → "Employee".
- Deactivated entities (products, sizes, stores, users): the status label is always **"Inactive"** (`badge-inactive`), on every page. "Retire" / "Reactivate" are action verbs (`/platform/catalog` row actions and confirm copy), never status labels.
