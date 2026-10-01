# Pages — index

One page = one `.md` in this directory, created BEFORE implementing it. Section template: purpose, layout, components, actions by permission, states (loading/empty/error), flows.

Guards by **permission**, not by role (RF-32): every store page except `/catalog` is visible to all three roles, and what changes are the actions inside them; `/catalog` is guarded by `assortment:manage`, the only store permission a role lacks (see `../../core/architecture.md` §6).

Reminder: the app's UI language is English (RNF-19), same as the page docs and the copy they describe.

## Public zone

| Route | Page | Description | Doc |
|---|---|---|---|
| `/` | Landing | Product pitch for recruiters: what REPMA is, features, CTA to login with visible demo credentials. In scope, **built in the final polish phase** (DP-01); until then `/` redirects to `/login`. Its `.md` is created before that phase | _pending_ |
| `/login` | Login | Email + password; redirects by role | [login.md](login.md) |

## Store zone (manager, employee, platform_admin with a selected store)

| Route | Page | Description | Doc |
|---|---|---|---|
| `/home` | Home | Store landing: greeting header + figures card, out-of-stock products as size runs with aging, a 7-row table of open replenishment lists (RF-25) | [home.md](home.md) |
| `/replenishment` | Replenishment lists | Card grid filtered by name, status and creation date; create manually — never derived from availability (DP-06) — and delete (all store roles) | [replenishment.md](replenishment.md) |
| `/replenishment/:id` | List detail | Edit name/notes/status, manage items grouped by product (optional category grouping), per-item done checks with progress bar, client-side filters | [replenishment-detail.md](replenishment-detail.md) |
| `/availability` | Availability | The store's assortment by product, each with its size run and aging (AD-22, DP-07); a tile opens its item detail, where flagging lives (RF-20); add sizes (manager) | [availability.md](availability.md) |
| `/availability/:id` | Availability item detail | Summary card with "Product — size", availability state and category; immutable event history ("Out of stock"/"Restocked"); flag actions; remove from assortment while it has no history (RF-44) | [availability-detail.md](availability-detail.md) |
| `/activity` | Activity | Store-wide availability-events feed, paginated with date filters (RF-42); `activity:read`, held by all roles | [activity.md](activity.md) |
| `/catalog` | Catalog | Manager-only (`assortment:manage`): browse the global catalog with filters and add sizes to the assortment | [catalog.md](catalog.md) |

## Platform zone (platform_admin only)

| Route | Page | Description | Doc |
|---|---|---|---|
| `/platform/tenants` | Store management | Create, edit, activate/deactivate (never delete, RN-08) | [platform-tenants.md](platform-tenants.md) |
| `/platform/users` | User management | CRUD with store filter; role↔store coherence (RN-01) | [platform-users.md](platform-users.md) |
| `/platform/catalog` | Catalog management | Categories + products tabs; image ≤5MB; soft delete | [platform-catalog.md](platform-catalog.md) |

## System

| Route | Page | Description | Doc |
|---|---|---|---|
| `/unauthorized` | 403 | Permission guard blocked the route; link back to role home | [unauthorized.md](unauthorized.md) |
| `*` | — | Redirect to the role home (`/platform/tenants` for platform_admin, `/home` for store roles; `/login` without session); not a page of its own | — |

## Cross-cutting (lives in `../shared/`, not here)

- [layout.md](../shared/layout.md) — shell: flush sidebar spine (no topbar on tablet/desktop; fixed mobile header hosts the drawer trigger), navigation by permission, Platform Admin store selector
- [components.md](../shared/components.md) — shared patterns: paginated table, loading/empty/error states, toasts, badges
- [product-picker.md](../shared/product-picker.md) — visual product & size selector (images + category navigation), used by every add-product flow
