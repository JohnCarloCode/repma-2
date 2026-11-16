# Users — `/platform/users`

> Guard: `user:manage` · Zone: platform
> API: `GET /users`, `POST /users`, `PATCH /users/:id`, `DELETE /users/:id`; `GET /tenants` (store select/filter options)

## Purpose
Platform Admin management of all users — platform and store users (RF-09..12, DP-04). Platform-zone page: no `X-Tenant-Id` header on any call (architecture.md §5.2).

## Layout
Standard list screen skeleton (../shared/layout.md, DESIGN.md §Screen Skeletons): `<PageHeader>` "Users" + primary action "New user" → filter band → `<DataTable>` → `<Pagination>`.

## Content

### Table
| Column | Source | Notes |
|---|---|---|
| Name | `full_name` | body-medium |
| Email | `email` (denormalized on the profile at creation — `database.md` §4.2; never editable) | muted |
| Role | `role` | Role labels per ../shared/components.md |
| Store | tenant name | "—" for `platform_admin` (RN-01) |
| Status | `is_active` | "Active" / `badge-inactive` "Inactive" |

Row actions (`icon-button`): "Edit", "Delete". **Delete is hidden on the current admin's own row** (RF-12; compare row id with session user id); Edit stays available — RF-12 only forbids self-delete and self-deactivate, so the admin can still edit their own profile — with the `is_active` toggle disabled inside the modal.

### Filter band
- Search ("Search users…" — matches name and email, RF-09) + store select ("All stores" default, options from `GET /tenants`). Both in URL, per ../shared/components.md.

### Create modal — "New user"
Form modal (max-w 640px): **Email**, **Password**, **Full name**, **Role** (select: role labels), **Store** (select of active stores).
- Role↔store coherence (RN-01, mirrors the DB CHECK): Store is **required** when Role is Manager/Employee; when Role is "Platform Admin" the Store field is **hidden and its value cleared** — never submitted.

### Edit modal — "Edit user"
Fields: Full name, Role (Manager ↔ Employee only for store users; a Platform Admin's role is not convertible — the select is disabled for them, RN-01), Store (**read-only text** — fixed at creation, RN-01/RF-11; "—" for Platform Admin), Status ("Active user" toggle), and **Reset password** — an optional password input, empty by default: left empty it is never submitted; filled, the same `PATCH` carries the new password (a write-only reset via Supabase Auth admin, RF-11 — the current password is never shown, and there is no self-service change or email recovery). Email is not editable (RF-11). Moving a user to another store — or into/out of the platform role — is deactivate + create new.

## Actions by permission
| Action | Permission | Behavior |
|---|---|---|
| View list | `user:manage` | Route guard |
| New user | `user:manage` | Create modal → `POST /users` |
| Edit | `user:manage` | Edit modal → `PATCH /users/:id`; the `is_active` toggle is disabled on the admin's own account (RF-12) |
| Delete | `user:manage` | Confirm modal (`button-danger`) → `DELETE /users/:id`; hidden on the admin's own row (RF-12) |

## States
Defaults from ../shared/components.md apply. Page-specific:
- Empty with store filter active: "This store has no users" + "Clear filters".
- The current admin's own row: Delete hidden and the `is_active` toggle disabled (RF-12 — editing their own profile fields stays possible); a muted "(you)" marker after the name is recommended for clarity.

## Flows

### Create user
1. "New user" → modal. Selecting Role drives Store visibility/requirement live.
2. Submit → `POST /users { email, password, fullName, role, tenantId? }` (`tenantId` omitted for platform_admin).
3. Success: close, toast "User created", invalidate users list. Creation is atomic-or-compensated server-side (RF-10) — from the UI it is a single success/failure; no partial state to represent.
4. 409 (email already registered): inline error on Email "A user with this email already exists".
5. 400: inline field errors (including any role/store coherence rejection, though the UI should make it unreachable).

### Edit user
1. Row "Edit" → modal prefilled. Submit → `PATCH /users/:id`.
2. Success: close, toast "User updated", invalidate list. `tenantId` is never submitted (the store is immutable, RF-11); role changes stay within manager ↔ employee (RN-01).
3. Error 400: inline; other errors: error toast.

### Delete user
1. Row "Delete" → confirm modal naming the user: "Delete the user “Ana García”? They will permanently lose access. The availability events they recorded will be kept." (RN-09 — deletion never touches the availability events they created).
2. Confirm → `DELETE /users/:id`.
3. Success: toast "User deleted", invalidate list, empty-page recovery per ../shared/components.md.
4. Error: error toast with the API message.

### Deactivate (via edit)
`is_active: false` → user gets 401 on their next request (RF-05); no immediate-logout UI concern here.

## Edge cases
- **Self-protection is double-layered (RF-12)**: the UI hides/disables self-delete and self-deactivate, AND the API's 4xx (attempted via a stale UI or a second session) still surfaces gracefully as an error toast — never an unhandled state.
- Store select options: creation offers **active** stores only. The edit modal shows the store as read-only text (RF-11) — with `badge-inactive` "Inactive" beside it when the store is deactivated — so it renders faithfully whatever the store's state.
- Users belonging to a deactivated store remain listed and editable; they cannot operate (RF-05) but their `is_active` flag is independent.
- Deleting a user who authored availability events: allowed; the event log keeps the rows with `created_by = NULL` (RN-09) — the events UI elsewhere renders the author as "—" (shared data convention, `../shared/components.md`).
- Role changes are manager ↔ employee only and never touch the store (RN-01: the store is fixed at creation). Moving a user to another store — or into/out of the platform role — is deactivate + create new; the deactivated user's name keeps rendering on their events (RN-09), which is the point of the rule.

## As built (7.6)
List + create (`pages/PlatformUsersPage.tsx`, route guard `user:manage`, not store-scoped; nav "Users" shipped). Edit/delete row actions: see §As built (7.7).
- Table: Name (+ muted "(you)" when the row id is the session user's), Email (muted), Role (role labels), Store (`tenant.name`, "—" for a Platform Admin), Status ("Active" / `badge-inactive`). No Created column (not in the table spec). A deactivated store is not badged in the table — the badge belongs to the edit modal (§Edge cases); the Status column is the user's own flag.
- Query key `['users', { page, search, tenantId }]` (global); create invalidates the `['users']` prefix. URL params `search`, `tenantId`, `page`.
- Store options (filter and create select) reuse the sidebar selector's source query (`['tenants','selector']`, `GET /tenants?pageSize=100`), so every tenants write already refreshes them. The **filter lists every store, inactive ones labelled "Name (inactive)"** — their users stay listed; the **create select lists active stores only**.
- Empty states: search active → "No results for this search"; store filter alone → "This store has no users"; both with "Clear filters". No filters → "No users yet" + "New user".
- Create modal: Email, Password (`type=password`, `new-password`), Full name, Role ("Select a role" placeholder), Store ("Select a store"). Client validation is `createUserBody` (blank selects = absent): errors mapped by issue path, validate on submit then on blur; the body sent is the parsed one (email trimmed + lowercased, name trimmed). Picking Platform Admin hides Store and clears it — switching back to a store role starts blank — so `tenantId` is never sent for an admin. 409 → inline on Email (API message); 400 `details` whose path is a form field → inline on that field (several at once); any other error (or a 400 with no mappable detail) → toast. Success → toast "User created", close, reset. Cancel resets the form.

## As built (7.7)
Edit + delete row actions (`pages/PlatformUsersPage.tsx`).
- Row actions: last column, right-aligned — "Edit <name>" on every row, "Delete <name>" on every row but the admin's own (a 44px spacer there keeps Edit aligned).
- Edit modal ("Edit user", "Save changes"/"Saving…"; remounted per opening so it starts from the row): Email (read-only input), Full name, Role (options Manager/Employee for store users; a disabled select showing "Platform Admin" for an admin target), Store (read-only text, `badge-inactive` beside it when `tenant.isActive` is false, "—" for an admin), "Active user" checkbox (disabled on the own account, with the caption "You cannot deactivate your own account."), "Reset password (optional)" (`type=password`, `new-password`, hint "Leave empty to keep the current password.").
- Body = **changed fields only** (name compared trimmed; password only when filled), validated with `updateUserBody` — so email/tenantId are never sent and an unchanged role is never re-sent. Nothing changed → the modal closes without a request (the API rejects an empty body). Client errors inline, validate on submit then on blur.
- Outcomes: 200 → toast "User updated", `['users']` invalidated, plus `['auth','me']` when the target is the admin themself (the shell shows their name). 400 `details` on a form field → inline. 404 (deleted meanwhile) → toast, modal closes, list re-read. Anything else — incl. the self-rule 409s from a stale UI — → toast with the API message, modal stays open.
- Delete: `ConfirmModal` "Delete user" with the §Delete user RN-09 copy, `button-danger` "Delete user"/"Deleting…". Settled either way → `['users']` re-read and close; 204 → toast "User deleted" (an emptied page > 1 recovers via `useEmptyPageRecovery`, RF-36); any error (404 already deleted, 409 self-delete) → toast with the API message.
- Form helpers: `FormField` now takes the control's `id` (+ optional `hint`) and 400-detail mapping is one `inlineDetails` helper, both shared by the create and edit modals; each modal keeps its own field set and validation.
