ALTER TABLE "products" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Existing products keep the order they were shown in until now: by name, within their category (RF-46).
UPDATE "products" p SET "position" = o.rn - 1
FROM (SELECT "id", row_number() OVER (PARTITION BY "category_id" ORDER BY "name", "id") AS rn FROM "products") o
WHERE p."id" = o."id";
