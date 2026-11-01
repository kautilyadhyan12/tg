CREATE TABLE "member_label_foods" (
  "id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "code" text,
  "name" text NOT NULL,
  "unit" text NOT NULL,
  "kcal" double precision NOT NULL,
  "protein_g" double precision NOT NULL,
  "carbs_g" double precision NOT NULL,
  "fat_g" double precision NOT NULL,
  "serving_amount" double precision,
  "contains" text[] NOT NULL DEFAULT '{}',
  "may_contain" text[] NOT NULL DEFAULT '{}',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "removed_at" timestamptz,
  CONSTRAINT "member_label_foods_unit_check" CHECK ("unit" IN ('g','ml')),
  CONSTRAINT "member_label_foods_kcal_check" CHECK ("kcal" >= 0 AND "kcal" <= 1000),
  CONSTRAINT "member_label_foods_macros_check" CHECK ("protein_g" BETWEEN 0 AND 100 AND "carbs_g" BETWEEN 0 AND 100 AND "fat_g" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "member_label_foods_user_code_idx" ON "member_label_foods" ("user_id", "code") WHERE "code" IS NOT NULL AND "removed_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "member_label_foods_user_idx" ON "member_label_foods" ("user_id");
