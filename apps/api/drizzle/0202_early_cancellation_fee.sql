-- An early cancellation fee on a minimum term (ROADMAP Stage 2 item 18v-ii-b; Kd, 2026-11-04,
-- `rulings/2026-11-04-18v-ii-a.md`). Forward-only. Hand-written, as `0016` onwards are; its journal
-- entry is part of this commit.
--
-- A line of the price list with a minimum term may hold an early cancellation fee
-- (`leave_fee_minor`). A membership given from it copies it, as it copies the term. Staff ending it
-- inside the term with that fee set `left_early`, and the fee is a fee bill of the membership
-- (`fee` 'leave_early', `fee_for` the type's name, `covers_from` the day it was ended).
ALTER TABLE "gym_membership_types" ADD COLUMN "leave_fee_minor" integer;--> statement-breakpoint
ALTER TABLE "gym_membership_types" ADD CONSTRAINT "gym_membership_types_leave_fee_check" CHECK ("leave_fee_minor" IS NULL OR ("contract_periods" IS NOT NULL AND "leave_fee_minor" BETWEEN 1 AND 99999999));--> statement-breakpoint
ALTER TABLE "gym_held_memberships" ADD COLUMN "leave_fee_minor" integer;--> statement-breakpoint
ALTER TABLE "gym_held_memberships" ADD COLUMN "left_early" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_held_memberships" ADD CONSTRAINT "gym_held_memberships_leave_fee_check" CHECK (("leave_fee_minor" IS NULL OR ("contract_periods" IS NOT NULL AND "leave_fee_minor" BETWEEN 1 AND 99999999)) AND (NOT "left_early" OR ("leave_fee_minor" IS NOT NULL AND ("status" IN ('cancelled','ended') OR NOT "renews" OR "stops_after" IS NOT NULL))));--> statement-breakpoint
ALTER TABLE "gym_member_bills" DROP CONSTRAINT "gym_member_bills_fee_check";--> statement-breakpoint
ALTER TABLE "gym_member_bills" ADD CONSTRAINT "gym_member_bills_fee_check" CHECK (
  ("period_index" IS NULL) = ("fee" IS NOT NULL)
  AND ("fee" IS NULL OR ("fee" IN ('late_cancel','no_show','freeze','leave_early') AND char_length("fee_for") BETWEEN 1 AND 80 AND "covers_from" IS NOT NULL))
  AND ("fee" IS NOT NULL OR "fee_for" IS NULL)
  AND ("class_booking_id" IS NULL OR "fee" IS NOT NULL)
  AND ("fee" NOT IN ('freeze','leave_early') OR ("class_booking_id" IS NULL AND "pt_appointment_id" IS NULL))
);--> statement-breakpoint
-- One early cancellation fee a membership: the same press twice, or two staff at one instant, open
-- one. A waived one counts, so it is never opened again.
CREATE UNIQUE INDEX "gym_member_bills_leave_fee_uq" ON "gym_member_bills" USING btree ("held_membership_id") WHERE "fee" = 'leave_early' AND ("status" <> 'void' OR "void_reason" = 'waived');
