# Feature 007 — Product catalog import / export

> Status: proposed
> Date: 2026-11-17

## Context and motivation

The global catalog (DP-02, RF-13..17) is edited one category or product at a time in `/platform/catalog`. A real chain onboards hundreds of products, so typing them in is the main blocker to adopting the platform; and there is no way to take the catalog out for review, backup or use in other tools. Import / export of the catalog solves both with one file format.

## Scope

- **Export** (Platform Admin): download the whole global catalog as CSV — one row per product with SKU, name, category, active flag, catalog order (RF-46) and its sizes. Images are referenced by file name, not embedded.
- **Import** (Platform Admin): upload a CSV in the same format. A **dry-run preview** comes first: rows to create, rows to update (matched by SKU), rows rejected with the reason per row. Nothing is written until the admin confirms.
- Import creates missing categories by name, creates or updates products by SKU and replaces their size list. It never deletes: products absent from the file are left untouched (deactivation stays an explicit action, as today).
- New endpoints under the existing catalog routes, global (no `X-Tenant-Id`): `GET /products/export` and `POST /products/import` (with a `dryRun` flag). Both guarded by the existing `catalog:manage` permission.
- UI: "Export" and "Import" buttons in the Catalog admin page header (`/platform/catalog`), the import flow as a modal with the preview table.

## Out of scope

- Per-store assortment import/export (it is tenant data, a different permission and RLS surface).
- Availability events or replenishment lists: the import never touches them (DP-06, RN-05).
- Product images upload through the import (images keep their current upload flow).
- Excel (.xlsx) or JSON formats; scheduled or API-key based sync with an ERP.

## Impact on existing documentation

- `core/spec.md`: new RF under §3.4 Global catalog (export, import with dry run, create-or-update by SKU, no deletes).
- `core/architecture.md`: API surface (two endpoints) and the permission reuse (`catalog:manage`); AD for streaming the export and validating the import with the same Zod schemas as the create/update endpoints.
- `core/database.md`: no schema change expected (SKU must already be unique per product; confirm).
- `design/pages/platform-catalog.md`: header actions and the import modal with its preview.

Always reference by ID (RN-05, AD-04…), never copy content.

## Acceptance criteria

- Given a catalog, when the admin exports, then the CSV re-imports with zero changes (round trip is idempotent).
- Given a valid file, when the admin imports in dry-run mode, then nothing is written and the preview counts match the real result of confirming.
- Given rows with an unknown category format, a duplicate SKU in the file or an invalid size, then those rows are rejected with a per-row reason and the valid ones can still be applied.
- Given a manager or employee, when calling either endpoint, then 403.
- Import runs in one transaction: a failure leaves the catalog unchanged.
- Tests: unit tests of the CSV parser/validator; integration tests of dry run vs apply, idempotent re-import and the 403s; a frontend test of the preview modal.

## Implementation notes (optional)

Open decisions: how sizes are encoded in one cell (e.g. `XS|S|M|L|XL|2XL`), whether a file may carry the catalog order or the import appends at the end of each category, and a maximum file size / row count. Keep it one CSV; avoid a generic import framework.
