-- database.md §6 — a single trigger function, applied to every table that
-- has `updated_at` (all of them except `availability_events`, the immutable
-- event log). No other logic lives in triggers.
CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER set_updated_at BEFORE UPDATE ON "tenants"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

CREATE TRIGGER set_updated_at BEFORE UPDATE ON "user_profiles"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

CREATE TRIGGER set_updated_at BEFORE UPDATE ON "categories"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

CREATE TRIGGER set_updated_at BEFORE UPDATE ON "products"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

CREATE TRIGGER set_updated_at BEFORE UPDATE ON "product_sizes"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

CREATE TRIGGER set_updated_at BEFORE UPDATE ON "assortment_items"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

CREATE TRIGGER set_updated_at BEFORE UPDATE ON "replenishment_lists"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

CREATE TRIGGER set_updated_at BEFORE UPDATE ON "replenishment_list_items"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
