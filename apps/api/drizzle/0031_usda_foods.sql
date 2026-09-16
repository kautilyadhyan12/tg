-- THE USDA FOOD TABLE (ROADMAP 7a-iii-a; RULINGS 2026-09-16). Forward-only.
--
-- Hand-written, for the recorded reason `0016`-`0030` were: `drizzle/meta/`
-- stops at `0012_snapshot.json`, so `drizzle-kit generate` re-emits everything
-- since. Its journal entry is part of this commit.
--
-- WHAT CHANGES. Two new tables hold every food of the two USDA FoodData Central
-- releases the food checker already reads — SR Legacy 2018-04 (7,793 foods) and
-- FNDDS 2024-10-31 (5,432), 13,225 together (counted 2026-09-16 by
-- `tools/usda-files.ts`, which both the checker and the importer read them
-- with). The data is public domain, CC0 1.0, and the app credits USDA under the
-- search results, which is the only thing they ask in return.
--
-- PUBLIC DATA: NO OWNER, NO TENANCY. Unlike every other table here these rows
-- belong to nobody — there is no user_id, so there is no tenancy WHERE to get
-- wrong. `apps/api/tools/import-usda.ts` is the only writer; every reader is a
-- search or a lookup by id. A person's own meals still live in `meal_logs` and
-- are still fetched with their owner.
--
-- ONE ROW PER FOOD, KEYED BY USDA'S OWN ID. `fdc_id` is unique across both
-- releases (SR runs from 167512, the survey release from 2705383), so it is the
-- primary key and the importer's upsert key: running the importer twice changes
-- nothing.
--
-- A FIGURE THE RELEASE LACKS IS NULL, NEVER A ZERO. Seventeen nutrients per
-- 100 g in USDA's own units (kcal, g, mg, µg). "Not measured" and "measured as
-- none" are different answers and a nutrition app must not confuse them: FNDDS
-- carries all seventeen for 5,431 of its 5,432 foods, SR Legacy 7,231 to 7,713
-- of 7,793 (vitamin D 5,185; counted 2026-09-16). 7a-v shows the twelve beyond
-- the macros; this migration is where they are stored.
--
-- `serving_grams` / `serving_unit` ARE NOT NULL. The food search's contract
-- gives every food a serving, so the importer resolves it once: the first
-- household measure of `food_portion.csv` that has a gram weight, else 100 g by
-- the gram. `usda_food_portions` keeps the whole list for 7a-iv's piece and cup
-- weights.
--
-- `first_word` and `word_count` come from the description and are stored rather
-- than computed per query: 7a-iii-b matches on the description's first word,
-- and the search orders the fewest-worded description first. Both are written
-- by the importer, so the rule that makes them is a pure function with a table
-- test rather than SQL nobody can test.
--
-- `search` IS A GENERATED COLUMN, so it can never drift from the description it
-- indexes. `to_tsvector(regconfig, text)` is immutable, which is what a STORED
-- generated column requires; the one-argument form is not, and would be
-- rejected here.
CREATE TABLE "usda_foods" (
	"fdc_id" integer PRIMARY KEY NOT NULL,
	"release" text NOT NULL,
	"description" text NOT NULL,
	"first_word" text NOT NULL,
	"word_count" integer NOT NULL,
	"kcal" double precision,
	"protein_g" double precision,
	"carbs_g" double precision,
	"fat_g" double precision,
	"fiber_g" double precision,
	"sugars_g" double precision,
	"sat_fat_g" double precision,
	"mono_fat_g" double precision,
	"poly_fat_g" double precision,
	"cholesterol_mg" double precision,
	"sodium_mg" double precision,
	"potassium_mg" double precision,
	"calcium_mg" double precision,
	"iron_mg" double precision,
	"magnesium_mg" double precision,
	"vitamin_d_ug" double precision,
	"vitamin_c_mg" double precision,
	"serving_grams" double precision NOT NULL,
	"serving_unit" text NOT NULL,
	"search" tsvector GENERATED ALWAYS AS (to_tsvector('english', "description")) STORED,
	CONSTRAINT "usda_foods_release_check" CHECK ("release" IN ('sr_legacy', 'fndds')),
	CONSTRAINT "usda_foods_word_count_check" CHECK ("word_count" > 0),
	CONSTRAINT "usda_foods_serving_grams_check" CHECK ("serving_grams" > 0)
);
--> statement-breakpoint
-- A household measure of one food: "1 cup · 246 g". `amount` is the release's
-- own number where it gives one (SR Legacy) and NULL where the measure's text
-- carries it instead (the survey release writes "1 cup" in one field and leaves
-- `amount` empty). `seq_num` is USDA's own ordering — the survey release does
-- not write its rows in that order, so "the food's first measure" means the
-- lowest `seq_num`, not the first line of the file.
CREATE TABLE "usda_food_portions" (
	"fdc_id" integer NOT NULL,
	"seq_num" integer NOT NULL,
	"amount" double precision,
	"unit" text NOT NULL,
	"gram_weight" double precision NOT NULL,
	CONSTRAINT "usda_food_portions_pkey" PRIMARY KEY ("fdc_id", "seq_num"),
	CONSTRAINT "usda_food_portions_gram_weight_check" CHECK ("gram_weight" > 0)
);
--> statement-breakpoint
ALTER TABLE "usda_food_portions" ADD CONSTRAINT "usda_food_portions_fdc_id_usda_foods_fdc_id_fk"
	FOREIGN KEY ("fdc_id") REFERENCES "public"."usda_foods"("fdc_id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint
-- The search box's index. GIN over the generated tsvector serves both a whole
-- word and the prefix the last typed word becomes ("cappucc:*").
CREATE INDEX "usda_foods_search_idx" ON "usda_foods" USING gin ("search");
