-- A fee while frozen (ROADMAP Stage 2 item 18z; Kd, `rulings/2026-10-22-18z.md`).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- The gym's freeze fee, charged for each month a renewing membership is frozen. 0, as every gym
-- is today, charges nothing.
ALTER TABLE "gyms" ADD COLUMN "freeze_fee_minor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "gyms" ADD CONSTRAINT "gyms_freeze_fee_check" CHECK ("freeze_fee_minor" BETWEEN 0 AND 99999999);--> statement-breakpoint
-- What this freeze charges a month, set when it was frozen: the gym's fee then, or 0 where staff
-- froze it with no fee. Read only while the membership is frozen; a later change to the gym's fee
-- moves nobody already frozen.
ALTER TABLE "gym_held_memberships" ADD COLUMN "freeze_fee_minor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_held_memberships" ADD CONSTRAINT "gym_held_memberships_freeze_fee_check" CHECK ("freeze_fee_minor" BETWEEN 0 AND 99999999);--> statement-breakpoint
-- A freeze fee is a fee bill of the frozen membership: `fee_for` the type's name, `covers_from`
-- and `covers_to` the month it is for.
ALTER TABLE "gym_member_bills" DROP CONSTRAINT "gym_member_bills_fee_check";--> statement-breakpoint
ALTER TABLE "gym_member_bills" ADD CONSTRAINT "gym_member_bills_fee_check" CHECK (
  ("period_index" IS NULL) = ("fee" IS NOT NULL)
  AND ("fee" IS NULL OR ("fee" IN ('late_cancel','no_show','freeze') AND char_length("fee_for") BETWEEN 1 AND 80 AND "covers_from" IS NOT NULL))
  AND ("fee" IS NOT NULL OR "fee_for" IS NULL)
  AND ("class_booking_id" IS NULL OR "fee" IS NOT NULL)
  AND ("fee" <> 'freeze' OR ("class_booking_id" IS NULL AND "pt_appointment_id" IS NULL))
);--> statement-breakpoint
-- One freeze fee a month of a membership: the freeze and the hourly run at one instant, or the run
-- twice, open one. A waived one counts, so it is never opened again; one taken off by an unfreeze
-- does not, so a membership frozen again that day is charged again.
CREATE UNIQUE INDEX "gym_member_bills_freeze_fee_uq" ON "gym_member_bills" USING btree ("held_membership_id","covers_from") WHERE "fee" = 'freeze' AND ("status" <> 'void' OR "void_reason" = 'waived');
--> statement-breakpoint
-- A freeze fee whose month began on or after the day the freeze ended (an unfreeze or a cancel):
-- never owed, paid or not, so voiding its payment takes it off instead of owing it again.
ALTER TABLE "gym_member_bills" ADD COLUMN "freeze_stopped" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_member_bills" ADD CONSTRAINT "gym_member_bills_freeze_stopped_check" CHECK (NOT "freeze_stopped" OR "fee" = 'freeze');
