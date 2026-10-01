# Feature NNN — Feature name

> Status: proposed | in development | done | discarded
> Date: YYYY-MM-DD

## Context and motivation

Why this feature exists. What problem it solves or what value it adds. 2-4 lines.

## Scope

Exactly what it includes, in bullets. If it touches the API, list the new/modified endpoints. If it touches the DB, describe the schema change (and its migration).

## Out of scope

What it does NOT include even if it seems related. Prevents scope creep.

## Impact on existing documentation

- `core/spec.md`: new RF/RN? Does any existing one change?
- `core/architecture.md`: new AD-xx decision? New permissions in the matrix?
- `core/database.md`: schema/RLS/index changes?
- `design/pages/`: new or modified pages? (create/update their .md)

Always reference by ID (RN-05, AD-04…), never copy content.

## Acceptance criteria

Verifiable list: "given X, when Y, then Z". Include the tests that must exist (unit / integration / frontend).

## Implementation notes (optional)

Risks, suggested order, open decisions. If the feature is large, move this to `plan.md`.
