-- Running records (ROADMAP Stage 5 item 37c-ii). Forward-only. Hand-written, as `0016` onwards are; its
-- journal entry is part of this commit. Written as 0223 and renumbered 0224, as another folder's 0223 merged first.
--
-- Each run's fastest 1 km, mile, 5 km and 10 km in whole seconds, worked out from its points when it is
-- saved (`runMaths.ts`, `fastestStretch`); null where it did not cover the distance, and for a run saved
-- before this, whose second-by-second times were not kept.
ALTER TABLE "runs" ADD COLUMN "best_1k_s" integer;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "best_mile_s" integer;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "best_5k_s" integer;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "best_10k_s" integer;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_bests_check" CHECK ("best_1k_s" > 0 AND "best_mile_s" > 0 AND "best_5k_s" > 0 AND "best_10k_s" > 0);
