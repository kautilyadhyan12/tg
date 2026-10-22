-- Move to another membership (ROADMAP Stage 2 item 18x; Kd, `rulings/2026-10-22-18x.md`).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- The membership a new one replaced, set when staff changed one for the other: the old one
-- reads "Changed to …" and the new one "Changed from …". Same gym, never itself; a record
-- deleted for good takes both rows with it, so the key only ever clears on its own.
ALTER TABLE "gym_held_memberships" ADD COLUMN "replaces_id" uuid;--> statement-breakpoint
ALTER TABLE "gym_held_memberships" ADD CONSTRAINT "gym_held_memberships_replaces_fk"
  FOREIGN KEY ("gym_id", "replaces_id") REFERENCES "gym_held_memberships" ("gym_id", "id") ON DELETE SET NULL ("replaces_id");--> statement-breakpoint
ALTER TABLE "gym_held_memberships" ADD CONSTRAINT "gym_held_memberships_replaces_check" CHECK ("replaces_id" IS NULL OR "replaces_id" <> "id");--> statement-breakpoint
CREATE INDEX "gym_held_memberships_replaces_idx" ON "gym_held_memberships" ("gym_id", "replaces_id") WHERE "replaces_id" IS NOT NULL;--> statement-breakpoint
-- What the membership it replaced had paid for the days not yet used, before tax, taken off
-- the new one's first bill: not inside `amount_minor`, which is what is left to pay.
ALTER TABLE "gym_member_bills" ADD COLUMN "change_credit_minor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_member_bills" ADD CONSTRAINT "gym_member_bills_change_credit_check" CHECK (
  "change_credit_minor" BETWEEN 0 AND 99999999
  AND ("change_credit_minor" = 0 OR "period_index" IS NOT NULL)
);
