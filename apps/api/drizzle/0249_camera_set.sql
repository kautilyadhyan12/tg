-- A set counted by the camera (spec Part 2 §13.3 and §13.5; ROADMAP Stage 5 job 64b-i). Forward-only. Hand-written, as
-- `0016` onwards are; its journal entry is part of this commit.
--
-- Two new columns, empty on every old row: the camera's own count beside the set's (in the set's own unit, reps or whole
-- seconds, as `target`), and whether the person left the camera to count the rest themselves or the camera stopped.
-- The camera's form facts go in the columns the old save route already fills (`avg_form_score`, `rep_scores`,
-- `fault_counts`, `watched_ms`, `tempo_ms_avg`, `rom_stats`, `view`, `engine_version`, `definition_version`), with
-- `mode` 'engine', so every old reader (XP, the badges, the gym's numbers) reads a camera set as it reads the web's.
--
-- Every row already kept passes the new checks: the phone's save (0244 on) wrote only 'hand' and 'timer' sets, each
-- 'log_only'; the old route's rows have `counted` empty.
ALTER TABLE "workout_sets" ADD COLUMN "camera_done" integer;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD COLUMN "left_camera" text;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_camera_done_check" CHECK ("workout_sets"."camera_done" >= 0);--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_left_camera_check" CHECK ("workout_sets"."left_camera" IN ('chosen','camera_stopped'));--> statement-breakpoint
-- The camera's facts go with a camera set alone, and a camera set is always the engine's, with its own count.
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_camera_facts_check" CHECK (("workout_sets"."counted" IS DISTINCT FROM 'camera' AND "workout_sets"."camera_done" IS NULL AND "workout_sets"."left_camera" IS NULL) OR ("workout_sets"."counted" = 'camera' AND "workout_sets"."camera_done" IS NOT NULL AND "workout_sets"."mode" = 'engine' AND "workout_sets"."engine_version" IS NOT NULL));--> statement-breakpoint
-- A set counted by hand or by timer is nobody's analysis: it can never carry a form score (the log-only check).
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_hand_is_log_only_check" CHECK ("workout_sets"."counted" NOT IN ('hand','timer') OR "workout_sets"."mode" = 'log_only');--> statement-breakpoint
-- Widened by one case, narrowed by none: a set the camera COUNTED for an exercise with no camera file of its own carries
-- no score evidence and no definition, and names the engine that counted it. Anything carrying score evidence still names
-- its engine and its definition, as before.
ALTER TABLE "workout_sets" DROP CONSTRAINT "workout_sets_engine_provenance_check";--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_engine_provenance_check" CHECK (("workout_sets"."avg_form_score" IS NULL AND "workout_sets"."rep_scores" IS NULL AND "workout_sets"."fault_counts" = '{}'::jsonb AND ("workout_sets"."mode" IS DISTINCT FROM 'engine' OR ("workout_sets"."counted" = 'camera' AND "workout_sets"."engine_version" IS NOT NULL))) OR ("workout_sets"."engine_version" IS NOT NULL AND "workout_sets"."definition_version" IS NOT NULL));
