-- YOUR OWN RING NUMBERS (ROADMAP 7a-iv-e; RULINGS 2026-09-17). Forward-only,
-- one new table.
--
-- Hand-written, for the recorded reason `0016`-`0031` were: `drizzle/meta/`
-- stops at `0012_snapshot.json`, so `drizzle-kit generate` re-emits everything
-- since. Its journal entry is part of this commit.
--
-- WHAT CHANGES. The macro rings gain a switch — App's plan · My own — and this
-- table holds the answer: `source` is the set the person picked, and the four
-- columns are the numbers they typed for themselves. "Gym's plan" joins the
-- CHECK at Stage 2 item 10, when a gym can write one; an option with nothing
-- behind it is not offered, so it is not here yet.
--
-- ONE ROW PER PERSON, WRITTEN ONLY WHEN THEY TOUCH THE SWITCH. No backfill and
-- no row for anybody else: an absent row IS "the app's plan", which is what
-- everyone has today, so nothing changes for a person who never opens it.
-- `source` still carries the default 'app' for a row that exists because the
-- numbers were typed and then switched away from.
--
-- SWITCHING BACK KEEPS THE NUMBERS (RULINGS 2026-09-17: "can be switched
-- back"), so 'app' does not clear the four columns — a person who tries the
-- app's plan for a week and switches back finds their own numbers as they left
-- them, not a blank box.
--
-- THE NUMBERS ARE NOT THE RULE. The calorie floor (1,200 kcal) and "a plan with
-- no calorie cut takes no typed calories below what keeps the weight" are
-- computed on every read against the person's own plan, in
-- `src/modules/nutrition/targets.ts`. They are deliberately NOT CHECKs here:
-- both depend on answers that change under a stored row — the health question,
-- a birthday, a heavier body — so a CHECK would freeze today's answer into the
-- table and hand the app a second, staler rule. The rules below are rails: the
-- range a day of eating can occupy at all (the contract's own
-- OWN_TARGETS_MAX_KCAL and OWN_TARGETS_MAX_MACRO_G), the four numbers standing
-- or falling together, and 'own' never stored without them.
--
-- ON DELETE CASCADE like `user_health_screenings`, and for the same reason it
-- is not the mechanism: §5.2 anonymises the users row rather than deleting it,
-- so the Day-14 purge deletes this table by hand (modules/privacy/repo.ts) and
-- the cascade is defence in depth. The table is on both privacy lists — deleted
-- at Day 14 and in the export — because a person's own calorie and macro
-- targets are their own data, on `user_fitness_profiles`' footing.
CREATE TABLE "user_nutrition_targets" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"source" text DEFAULT 'app' NOT NULL,
	"kcal" integer,
	"protein_g" integer,
	"carbs_g" integer,
	"fat_g" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_nutrition_targets_source_check" CHECK ("source" IN ('app','own')),
	CONSTRAINT "user_nutrition_targets_numbers_together_check" CHECK (
		("kcal" IS NULL AND "protein_g" IS NULL AND "carbs_g" IS NULL AND "fat_g" IS NULL)
		OR ("kcal" IS NOT NULL AND "protein_g" IS NOT NULL AND "carbs_g" IS NOT NULL AND "fat_g" IS NOT NULL)
	),
	CONSTRAINT "user_nutrition_targets_own_needs_numbers_check" CHECK ("source" <> 'own' OR "kcal" IS NOT NULL),
	CONSTRAINT "user_nutrition_targets_kcal_check" CHECK ("kcal" BETWEEN 0 AND 20000),
	CONSTRAINT "user_nutrition_targets_macros_check" CHECK (
		"protein_g" BETWEEN 0 AND 2000 AND "carbs_g" BETWEEN 0 AND 2000 AND "fat_g" BETWEEN 0 AND 2000
	)
);--> statement-breakpoint
ALTER TABLE "user_nutrition_targets"
	ADD CONSTRAINT "user_nutrition_targets_user_id_users_id_fk"
	FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
