CREATE TYPE "public"."availability_event_type" AS ENUM('out_of_stock', 'restock');--> statement-breakpoint
CREATE TYPE "public"."replenishment_status" AS ENUM('draft', 'processing', 'done');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('platform_admin', 'manager', 'employee');--> statement-breakpoint
-- "auth"."users" is owned and already created by Supabase Auth (AD-02) — not
-- created here. `authUsers` in schema/authUsers.ts exists only so
-- user_profiles.id can carry a typed FK to it (see that FK below).
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid NOT NULL,
	"description" text,
	"image_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_sizes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"label" text NOT NULL,
	"sku" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_sizes_sku_unique" UNIQUE("sku"),
	CONSTRAINT "product_sizes_product_id_label_unique" UNIQUE("product_id","label")
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"role" "user_role" NOT NULL,
	"tenant_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profiles_email_unique" UNIQUE("email"),
	CONSTRAINT "user_profiles_role_tenant_coherence" CHECK (("user_profiles"."role" = 'platform_admin' AND "user_profiles"."tenant_id" IS NULL) OR ("user_profiles"."role" IN ('manager', 'employee') AND "user_profiles"."tenant_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "assortment_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"size_id" uuid NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assortment_items_tenant_id_size_id_unique" UNIQUE("tenant_id","size_id")
);
--> statement-breakpoint
CREATE TABLE "availability_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"assortment_item_id" uuid NOT NULL,
	"type" "availability_event_type" NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "replenishment_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "replenishment_status" DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "replenishment_list_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"size_id" uuid NOT NULL,
	"quantity_requested" integer NOT NULL,
	"is_done" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "replenishment_list_items_list_id_size_id_unique" UNIQUE("list_id","size_id"),
	CONSTRAINT "replenishment_list_items_quantity_requested_check" CHECK ("replenishment_list_items"."quantity_requested" > 0)
);
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_sizes" ADD CONSTRAINT "product_sizes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assortment_items" ADD CONSTRAINT "assortment_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assortment_items" ADD CONSTRAINT "assortment_items_size_id_product_sizes_id_fk" FOREIGN KEY ("size_id") REFERENCES "public"."product_sizes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_events" ADD CONSTRAINT "availability_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_events" ADD CONSTRAINT "availability_events_assortment_item_id_assortment_items_id_fk" FOREIGN KEY ("assortment_item_id") REFERENCES "public"."assortment_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_events" ADD CONSTRAINT "availability_events_created_by_user_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replenishment_lists" ADD CONSTRAINT "replenishment_lists_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replenishment_lists" ADD CONSTRAINT "replenishment_lists_created_by_user_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replenishment_list_items" ADD CONSTRAINT "replenishment_list_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replenishment_list_items" ADD CONSTRAINT "replenishment_list_items_list_id_replenishment_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."replenishment_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replenishment_list_items" ADD CONSTRAINT "replenishment_list_items_tenant_size_fk" FOREIGN KEY ("tenant_id","size_id") REFERENCES "public"."assortment_items"("tenant_id","size_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "products_category_id_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "product_sizes_product_id_idx" ON "product_sizes" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "user_profiles_tenant_id_idx" ON "user_profiles" USING btree ("tenant_id") WHERE "user_profiles"."tenant_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "assortment_items_out_of_stock_idx" ON "assortment_items" USING btree ("tenant_id") WHERE NOT "assortment_items"."is_available";--> statement-breakpoint
CREATE INDEX "availability_events_item_created_at_idx" ON "availability_events" USING btree ("assortment_item_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "availability_events_tenant_created_at_idx" ON "availability_events" USING btree ("tenant_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "replenishment_lists_tenant_created_at_idx" ON "replenishment_lists" USING btree ("tenant_id","created_at" desc);