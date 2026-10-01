-- database.md §7 — the runtime role, its minimal grants, RLS on all 9 tables
-- with the policies verbatim, and closing the PostgREST perimeter.
-- No password is set here (NOLOGIN): sub-task 1.4's `db:bootstrap` script
-- gives it LOGIN + a password from an untracked env var.

-- §7.1 — connection role
CREATE ROLE repma_api NOLOGIN NOSUPERUSER NOBYPASSRLS;

GRANT USAGE ON SCHEMA public TO repma_api;

GRANT SELECT, INSERT, UPDATE ON tenants TO repma_api;
GRANT SELECT, INSERT, UPDATE ON user_profiles TO repma_api;
GRANT SELECT, INSERT, UPDATE ON categories TO repma_api;
GRANT SELECT, INSERT, UPDATE ON products TO repma_api;
GRANT SELECT, INSERT, UPDATE ON product_sizes TO repma_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON assortment_items TO repma_api;
GRANT SELECT, INSERT ON availability_events TO repma_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON replenishment_lists TO repma_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON replenishment_list_items TO repma_api;
--> statement-breakpoint

-- §7.3 — RLS, ENABLE + FORCE on all 9 tables (FORCE subjects even an owner
-- without BYPASSRLS). No table has a universal permissive policy.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories FORCE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;
ALTER TABLE product_sizes ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_sizes FORCE ROW LEVEL SECURITY;
ALTER TABLE assortment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE assortment_items FORCE ROW LEVEL SECURITY;
ALTER TABLE availability_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_events FORCE ROW LEVEL SECURITY;
ALTER TABLE replenishment_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE replenishment_lists FORCE ROW LEVEL SECURITY;
ALTER TABLE replenishment_list_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE replenishment_list_items FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- Policies read the session context with current_setting(..., true) (missing_ok):
-- unset or empty -> NULL -> every comparison is false -> deny-by-default (§7.2).
-- uid()/rol()/tid() are expressed inline, as the doc specifies, not as DB functions.

-- tenants: a store sees its own record; only the Platform Admin writes; never deleted.
CREATE POLICY tenants_select ON tenants
  FOR SELECT
  USING (
    current_setting('app.role', true) = 'platform_admin'
    OR id = nullif(current_setting('app.tenant_id', true), '')::uuid
  );

CREATE POLICY tenants_insert ON tenants
  FOR INSERT
  WITH CHECK (current_setting('app.role', true) = 'platform_admin');

CREATE POLICY tenants_update ON tenants
  FOR UPDATE
  USING (current_setting('app.role', true) = 'platform_admin')
  WITH CHECK (current_setting('app.role', true) = 'platform_admin');
--> statement-breakpoint

-- user_profiles: own row, same-store members, every platform admin; only the
-- Platform Admin writes; no DELETE policy (cascades from auth.users, not RLS).
CREATE POLICY user_profiles_select ON user_profiles
  FOR SELECT
  USING (
    current_setting('app.role', true) = 'platform_admin'
    OR id = nullif(current_setting('app.user_id', true), '')::uuid
    OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    OR role = 'platform_admin'
  );

CREATE POLICY user_profiles_insert ON user_profiles
  FOR INSERT
  WITH CHECK (current_setting('app.role', true) = 'platform_admin');

CREATE POLICY user_profiles_update ON user_profiles
  FOR UPDATE
  USING (current_setting('app.role', true) = 'platform_admin')
  WITH CHECK (current_setting('app.role', true) = 'platform_admin');
--> statement-breakpoint

-- categories / products / product_sizes: readable by any authenticated
-- context; only the Platform Admin writes; no DELETE policy (soft delete).
CREATE POLICY categories_select ON categories
  FOR SELECT
  USING (current_setting('app.user_id', true) IS NOT NULL);

CREATE POLICY categories_insert ON categories
  FOR INSERT
  WITH CHECK (current_setting('app.role', true) = 'platform_admin');

CREATE POLICY categories_update ON categories
  FOR UPDATE
  USING (current_setting('app.role', true) = 'platform_admin')
  WITH CHECK (current_setting('app.role', true) = 'platform_admin');

CREATE POLICY products_select ON products
  FOR SELECT
  USING (current_setting('app.user_id', true) IS NOT NULL);

CREATE POLICY products_insert ON products
  FOR INSERT
  WITH CHECK (current_setting('app.role', true) = 'platform_admin');

CREATE POLICY products_update ON products
  FOR UPDATE
  USING (current_setting('app.role', true) = 'platform_admin')
  WITH CHECK (current_setting('app.role', true) = 'platform_admin');

CREATE POLICY product_sizes_select ON product_sizes
  FOR SELECT
  USING (current_setting('app.user_id', true) IS NOT NULL);

CREATE POLICY product_sizes_insert ON product_sizes
  FOR INSERT
  WITH CHECK (current_setting('app.role', true) = 'platform_admin');

CREATE POLICY product_sizes_update ON product_sizes
  FOR UPDATE
  USING (current_setting('app.role', true) = 'platform_admin')
  WITH CHECK (current_setting('app.role', true) = 'platform_admin');
--> statement-breakpoint

-- assortment_items: full tenant isolation on every command.
CREATE POLICY assortment_items_select ON assortment_items
  FOR SELECT
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY assortment_items_insert ON assortment_items
  FOR INSERT
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY assortment_items_update ON assortment_items
  FOR UPDATE
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY assortment_items_delete ON assortment_items
  FOR DELETE
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

-- availability_events: tenant-isolated, author-attributed INSERT, no
-- UPDATE/DELETE policy at all -> immutable event log (AD-04).
CREATE POLICY availability_events_select ON availability_events
  FOR SELECT
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY availability_events_insert ON availability_events
  FOR INSERT
  WITH CHECK (
    tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
    AND created_by = nullif(current_setting('app.user_id', true), '')::uuid
  );
--> statement-breakpoint

-- replenishment_lists / replenishment_list_items: full tenant isolation on
-- every command.
CREATE POLICY replenishment_lists_select ON replenishment_lists
  FOR SELECT
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY replenishment_lists_insert ON replenishment_lists
  FOR INSERT
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY replenishment_lists_update ON replenishment_lists
  FOR UPDATE
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY replenishment_lists_delete ON replenishment_lists
  FOR DELETE
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY replenishment_list_items_select ON replenishment_list_items
  FOR SELECT
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY replenishment_list_items_insert ON replenishment_list_items
  FOR INSERT
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY replenishment_list_items_update ON replenishment_list_items
  FOR UPDATE
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

CREATE POLICY replenishment_list_items_delete ON replenishment_list_items
  FOR DELETE
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

-- §7.4 — closing the perimeter: Supabase's auto-generated REST API
-- (PostgREST, roles anon/authenticated) is not a door to this data.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
