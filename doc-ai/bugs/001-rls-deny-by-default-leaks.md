# Bug 001 — RLS deny-by-default leaked catalog and admin profiles without context

> Status: fixed
> Date: 2026-11-14

## Symptom

A query on the `repma_api` connection with **no request context** must see 0 rows on every table (`database.md` §7.3, `architecture.md` §5.2 net 2). Actual:

- `categories`, `products`, `product_sizes`: all rows visible on a pooled connection that had previously run a context transaction (0 rows on a fresh connection).
- `user_profiles`: every `platform_admin` profile visible on **any** connection, fresh or reused.

## Reproduction

As `repma_api`, with at least one category and one platform admin profile present:

```sql
select count(*) from user_profiles;   -- 1 (the admin), expected 0
begin; select set_config('app.user_id', '<uuid>', true); commit;
select count(*) from categories;      -- all rows, expected 0
```

Covered by `apps/api/src/db/isolation.integration.test.ts` → "deny-by-default" (fresh and reused connection).

## Root cause

Two independent defects in migration `0002_security_rls.sql`, both from §7.3's formulas taken literally:

1. Once a custom GUC has been set on a connection, Postgres keeps it defined after the transaction ends and `current_setting('app.x', true)` returns `''`, not `NULL`. The tenant-scoped policies already wrapped it in `nullif(..., '')`, but the catalog SELECT policies used `current_setting('app.user_id', true) IS NOT NULL`, which is true for `''`. Found during 1.6 (journal).
2. The `user_profiles` SELECT policy's `OR role = 'platform_admin'` branch does not reference the context at all, so it is permissive for a context-less query — contradicting §7.3's "no table has a universal permissive policy".

## Fix

Migration `0003_deny_by_default_empty_guc.sql` (`ALTER POLICY`, 0002 left untouched): the catalog SELECT policies use `nullif(current_setting('app.user_id', true), '') IS NOT NULL`; the `user_profiles` admin branch becomes `role = 'platform_admin' AND uid() IS NOT NULL`. `database.md` §7.2/§7.3 now state the `''`-safe `uid()`/`tid()` and the corrected policy. The isolation suite (sub-task 1.7, RNF-01) enumerates all 9 tables on both a fresh and a reused connection, with a platform admin profile in the fixtures.

## Lesson

"Unset" has two shapes in Postgres (`NULL` and `''`), and pooled connections reach the second one in normal operation: every context read in a policy must go through `nullif(..., '')`. And every policy branch must depend on the context — deny-by-default (RNF-01, §7.3) is only proven by enumerating every table without context, on a reused connection, with a row of every kind present.
