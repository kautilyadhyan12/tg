-- The time zone a run was run in (ROADMAP Stage 5 job 37o; the running faults of 2026-11-20, E1).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A run's day and month in Your runs, its calendar and its records were worked out in the zone the person has now:
-- somebody who moved from London to Delhi saw last month's late runs move to the next day. A run now keeps the
-- person's zone as it was saved, a name Postgres knows (set by the save, checked against pg_timezone_names), and its
-- day is read in it. Empty where no zone was known: the zone the person has now is used, as before.
--
-- Older runs take the zone their person has today, the best the server knows, so they stop moving from now on.
ALTER TABLE "runs" ADD COLUMN "time_zone" text;
--> statement-breakpoint
UPDATE "runs" SET "time_zone" = "users"."timezone" FROM "users" WHERE "users"."id" = "runs"."user_id" AND "users"."timezone" IN (SELECT "name" FROM pg_timezone_names);
