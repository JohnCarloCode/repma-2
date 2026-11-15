-- database.md §7.2/§7.3 — deny-by-default must hold whatever state the
-- pooled connection is in (bug 001). Once a custom GUC has been set on a
-- connection, after that transaction current_setting('app.x', true) returns
-- '' — not NULL — so every context check reads it through nullif(..., ''),
-- as the tenant-scoped policies of 0002 already do.

-- categories / products / product_sizes: `uid() IS NOT NULL` was true for ''
-- on a reused connection, exposing the catalog to a context-less query.
ALTER POLICY categories_select ON categories
  USING (nullif(current_setting('app.user_id', true), '') IS NOT NULL);

ALTER POLICY products_select ON products
  USING (nullif(current_setting('app.user_id', true), '') IS NOT NULL);

ALTER POLICY product_sizes_select ON product_sizes
  USING (nullif(current_setting('app.user_id', true), '') IS NOT NULL);
--> statement-breakpoint

-- user_profiles: the `role = 'platform_admin'` branch did not depend on the
-- context at all, so platform admins' profiles were readable with no context.
-- Visible to any authenticated context (§7.3 design notes), never to none.
ALTER POLICY user_profiles_select ON user_profiles
  USING (
    current_setting('app.role', true) = 'platform_admin'
    OR id = nullif(current_setting('app.user_id', true), '')::uuid
    OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    OR (role = 'platform_admin' AND nullif(current_setting('app.user_id', true), '') IS NOT NULL)
  );
