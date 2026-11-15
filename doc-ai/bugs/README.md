# Bugs — index

Only bugs that **revealed something about the system** get documented (an RLS failure, a ledger invariant violation, a race condition…). Routine bugs are fixed in the commit and generate no doc.

One bug = one flat file `NNN-name.md` (copied from `_template.md`). Written once, never rewritten.

| ID | Bug | Status | Doc |
|---|---|---|---|
| 001 | RLS deny-by-default leaked catalog (reused connection, `''` GUC) and admin profiles without context | fixed | [001](001-rls-deny-by-default-leaks.md) |

Statuses: `open` → `fixed` / `not reproducible`.
