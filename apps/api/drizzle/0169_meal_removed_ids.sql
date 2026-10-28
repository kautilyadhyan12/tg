-- A removed meal's id stays with its owner (ROADMAP Stage 5 item 32b-i, round one's finding 5).
-- The phone sends a meal under its own id until the server has it (32a), and removes it only
-- after that; but a send the phone gave up on may still be inside the server, and with the row
-- deleted its id is free again, so that late save would bring the meal back. A removal now
-- leaves its id here, under the same lock a save takes, and a save under a removed id keeps
-- nothing. Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of
-- this commit.
CREATE TABLE "meal_removed_ids" (
  "id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "removed_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "meal_removed_ids_user_idx" ON "meal_removed_ids" ("user_id");
