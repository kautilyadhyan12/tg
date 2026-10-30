-- Our own copy of the packaged-food lists (ROADMAP Stage 5 33b-iii-a; rulings/2026-10-30-33b-iii-a.md).
-- Public data with no owner, as `usda_foods` is. Filled by `tools/import-packaged-foods.ts` once per
-- environment and kept current by the nightly update; empty until then, and a lookup then finds nothing.
-- Two tables, so Open Food Facts' licence stays on its own list. Forward-only. Hand-written, as `0016`
-- onwards are; its journal entry is part of this commit.
CREATE TABLE "off_products" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kcal" real NOT NULL,
	"protein_g" real,
	"carbs_g" real,
	"fat_g" real,
	"fiber_g" real,
	"sugars_g" real,
	"sat_fat_g" real,
	"unsat_fat_g" real,
	"sodium_mg" real,
	"potassium_mg" real,
	"calcium_mg" real,
	"iron_mg" real,
	"magnesium_mg" real,
	"vitamin_d_ug" real,
	"serving_size" text,
	"quantity" text,
	"numbers_fit" boolean NOT NULL,
	"allergens" text[] NOT NULL,
	"traces" text[] NOT NULL,
	"listed_as_typed" text[] NOT NULL,
	CONSTRAINT "off_products_kcal_check" CHECK ("kcal" >= 0 AND "kcal" <= 1000)
);
CREATE TABLE "usda_branded_products" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kcal" real NOT NULL,
	"protein_g" real,
	"carbs_g" real,
	"fat_g" real,
	"fiber_g" real,
	"sugars_g" real,
	"sat_fat_g" real,
	"unsat_fat_g" real,
	"sodium_mg" real,
	"potassium_mg" real,
	"calcium_mg" real,
	"iron_mg" real,
	"magnesium_mg" real,
	"vitamin_d_ug" real,
	"serving_size" text,
	"quantity" text,
	"numbers_fit" boolean NOT NULL,
	CONSTRAINT "usda_branded_products_kcal_check" CHECK ("kcal" >= 0 AND "kcal" <= 1000)
);
CREATE TABLE "off_daily_files" (
	"name" text PRIMARY KEY NOT NULL,
	"to_second" integer NOT NULL,
	"products" integer NOT NULL,
	"written" integer NOT NULL,
	"removed" integer NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
