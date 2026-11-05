-- A removed body measurement's id stays with its owner (ROADMAP Stage 5 item 35c-ii), as a
-- meal's does (0169): the phone sends an entry under its own id until the server has it, and a
-- send it gave up on may still be inside the server when the entry is removed; with the row
-- deleted its id would be free again, and that late save would bring the entry back.
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
CREATE TABLE "body_measurement_removed_ids" (
  "id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "removed_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "body_measurement_removed_ids_user_idx" ON "body_measurement_removed_ids" ("user_id");
