-- An indoor run, on a treadmill or inside the house, with no GPS (ROADMAP Stage 5 job 37q-i).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A run is outdoors or indoors. Indoors its distance is worked out from the steps the phone counted and the person's
-- height (`indoorRun.ts`), or is the distance a treadmill showed, typed after Finish, when somebody could have run that
-- far in that time. Kept for an indoor run: its steps, the distance they made from the height alone (what a treadmill's
-- distance teaches the person's step length from), and the treadmill's distance, only when it was taken. Such a run has
-- no route, no shape and no best efforts, so it never sets a running record.
--
-- Every run saved before this one was recorded outdoors: the default says so, and the three new columns stay empty.
ALTER TABLE "runs" ADD COLUMN "kind" text DEFAULT 'outdoor' NOT NULL;
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "steps" integer;
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "steps_m" integer;
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "treadmill_m" integer;
--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_kind_check" CHECK ("runs"."kind" IN ('outdoor', 'indoor'));
--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_indoor_check" CHECK (("runs"."kind" = 'outdoor' AND "runs"."steps" IS NULL AND "runs"."steps_m" IS NULL AND "runs"."treadmill_m" IS NULL) OR ("runs"."kind" = 'indoor' AND "runs"."steps" >= 0 AND "runs"."steps_m" >= 0 AND ("runs"."treadmill_m" IS NULL OR "runs"."treadmill_m" > 0) AND "runs"."polyline" IS NULL AND "runs"."shape" IS NULL AND "runs"."best_1k_s" IS NULL AND "runs"."best_mile_s" IS NULL AND "runs"."best_5k_s" IS NULL AND "runs"."best_10k_s" IS NULL));
--> statement-breakpoint
CREATE INDEX "runs_user_treadmill_idx" ON "runs" USING btree ("user_id","started_at" DESC) WHERE "runs"."treadmill_m" IS NOT NULL;
