ALTER TABLE "categories" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Existing categories keep the order they were shown in until now: by name (RF-45).
UPDATE "categories" c SET "position" = o.rn - 1
FROM (SELECT "id", row_number() OVER (ORDER BY "name", "id") AS rn FROM "categories") o
WHERE c."id" = o."id";
