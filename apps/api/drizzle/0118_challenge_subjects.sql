-- What a challenge is about, and who counts it (ROADMAP Stage 2 item 19d-iii-a-i; spec Part 3
-- §15.10.2). Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of
-- this commit.
--
-- `counts` gives way to `subject` (from the list in `packages/shared/src/challengeSubjects.ts`),
-- `measure` (the number the app counts for it; null where the staff count) and `counted_by`.
-- Every challenge already made is moved onto the list as it was counted:
--   gym_days → gym_visits · days · app;  workout_days → workouts · days · app;  own → own · null · staff.
-- A value outside those three leaves `subject` null, and the NOT NULL below stops the migration.
-- `subject` and `measure` are held to a shape here and to the list by the request's schema, so
-- a subject added later needs no migration of its own. The target, unit and lowest-wins
-- checks say again, in these terms, what they said of `counts`.
ALTER TABLE "gym_challenges" ADD COLUMN "subject" text;--> statement-breakpoint
ALTER TABLE "gym_challenges" ADD COLUMN "measure" text;--> statement-breakpoint
ALTER TABLE "gym_challenges" ADD COLUMN "counted_by" text;--> statement-breakpoint
UPDATE "gym_challenges" SET
	"subject" = CASE "counts" WHEN 'gym_days' THEN 'gym_visits' WHEN 'workout_days' THEN 'workouts' WHEN 'own' THEN 'own' END,
	"measure" = CASE "counts" WHEN 'gym_days' THEN 'days' WHEN 'workout_days' THEN 'days' END,
	"counted_by" = CASE "counts" WHEN 'gym_days' THEN 'app' WHEN 'workout_days' THEN 'app' WHEN 'own' THEN 'staff' END;--> statement-breakpoint
ALTER TABLE "gym_challenges" ALTER COLUMN "subject" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_challenges" ALTER COLUMN "counted_by" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_challenges" DROP CONSTRAINT "gym_challenges_target_check";--> statement-breakpoint
ALTER TABLE "gym_challenges" DROP CONSTRAINT "gym_challenges_unit_check";--> statement-breakpoint
ALTER TABLE "gym_challenges" DROP CONSTRAINT "gym_challenges_lowest_check";--> statement-breakpoint
ALTER TABLE "gym_challenges" DROP CONSTRAINT "gym_challenges_counts_check";--> statement-breakpoint
ALTER TABLE "gym_challenges" DROP COLUMN "counts";--> statement-breakpoint
ALTER TABLE "gym_challenges" ADD CONSTRAINT "gym_challenges_subject_check" CHECK (
	"subject" ~ '^[a-z][a-z_]{0,39}$' AND ("measure" IS NULL OR "measure" ~ '^[a-z][a-z_]{0,39}$')
);--> statement-breakpoint
ALTER TABLE "gym_challenges" ADD CONSTRAINT "gym_challenges_counted_by_check" CHECK (
	"counted_by" IN ('app','staff') AND ("counted_by" = 'staff') = ("measure" IS NULL)
);--> statement-breakpoint
ALTER TABLE "gym_challenges" ADD CONSTRAINT "gym_challenges_target_check" CHECK (
	"target" IS NULL OR ("target" BETWEEN 1 AND 1000000 AND ("measure" IS DISTINCT FROM 'days' OR "teams" <> 'none' OR "target" <= "ends_on" - "starts_on" + 1))
);--> statement-breakpoint
ALTER TABLE "gym_challenges" ADD CONSTRAINT "gym_challenges_unit_check" CHECK (char_length("unit") <= 30 AND ("counted_by" = 'staff') = ("unit" <> ''));--> statement-breakpoint
ALTER TABLE "gym_challenges" ADD CONSTRAINT "gym_challenges_lowest_check" CHECK (NOT "lowest_wins" OR ("counted_by" = 'staff' AND "target" IS NULL));
