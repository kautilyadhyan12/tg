-- A run's elevation gain (ROADMAP Stage 5 item 37b-ii). Forward-only. Hand-written, as `0016` onwards
-- are; its journal entry is part of this commit. Written as 0218 and renumbered 0219 when another
-- folder's 0218 merged first.
--
-- `climb_m` is the metres the run climbed, worked out by the server from its saved line and the height
-- map it keeps (`packages/shared/src/runClimb.ts`). `climb_state` says where that stands: `done` with a
-- number; `none` where the map has no heights (the sea, a country the map leaves out); `waiting` when a
-- piece of the map could not be had yet, worked out again by the worker. Rows from before keep nulls.
ALTER TABLE "runs" ADD COLUMN "climb_m" integer;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "climb_state" text;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_climb_check" CHECK (
  ("climb_state" IS NULL AND "climb_m" IS NULL)
  OR ("climb_state" = 'done' AND "climb_m" >= 0)
  OR ("climb_state" IN ('none', 'waiting') AND "climb_m" IS NULL)
);--> statement-breakpoint
CREATE INDEX "runs_climb_waiting_idx" ON "runs" ("created_at") WHERE "climb_state" = 'waiting';
