-- Your runs (ROADMAP Stage 5 item 37c-i). Forward-only. Hand-written, as `0016` onwards are; its
-- journal entry is part of this commit. Written as 0221 and renumbered 0222, as another folder's 0221 merged first.
--
-- `shape` is the run's route made small for the picture beside it in the list (`runShape.ts`), worked
-- out when the run is saved; a run saved before gets its own the first time the list reads it.
-- `run_removed_ids` keeps a deleted run's id with its owner, as `meal_removed_ids` does a meal's: a
-- phone may still be sending the run, and a save under a removed id keeps nothing.
ALTER TABLE "runs" ADD COLUMN "shape" text;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_shape_check" CHECK (char_length("shape") BETWEEN 1 AND 4000);--> statement-breakpoint
CREATE TABLE "run_removed_ids" (
  "id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "removed_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "run_removed_ids_user_idx" ON "run_removed_ids" ("user_id");
