-- Record a run on the phone (ROADMAP Stage 5 item 37a). Forward-only. Hand-written, as `0016`
-- onwards are; its journal entry is part of this commit. Written as 0208 and renumbered 0210 when
-- 0208 and 0209 of two other folders merged first.
--
-- What the person gives a run when they save it (its name, how it felt from 1 to 10, a private
-- note), and the numbers the server works out from its points beside the ones `runs` already keeps:
-- `duration_s` is the moving time; `elapsed_s` is Start to Finish; a stretch faster than anybody
-- has run is left out and kept apart (`left_out_m`, `left_out_s`); `run_calc_version` names the
-- rules that made them (`packages/shared/src/runMaths.ts`), and `kcal_calc_version` takes the same
-- number, the calories being theirs. `name` is the person's own ("Morning Run"); `route_name`
-- stays the place a route is named for, filled by the routes job. Rows from before keep nulls.
ALTER TABLE "runs" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "effort" smallint;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "elapsed_s" integer;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "left_out_m" integer;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "left_out_s" integer;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "run_calc_version" smallint;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_effort_check" CHECK ("effort" BETWEEN 1 AND 10);--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_name_check" CHECK (char_length("name") BETWEEN 1 AND 60);--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_note_check" CHECK (char_length("note") BETWEEN 1 AND 1000);--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_numbers_check" CHECK ("duration_s" >= 0 AND "distance_m" >= 0 AND "elapsed_s" >= "duration_s" AND "left_out_m" >= 0 AND "left_out_s" >= 0);
