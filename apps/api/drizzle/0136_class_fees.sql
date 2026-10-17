-- A fee for a late cancel or a no-show, for classes (ROADMAP Stage 2 item 18h-i; Kd,
-- `rulings/2026-10-17-18h-i.md`). Forward-only. Hand-written, as `0016` onwards are; its
-- journal entry is part of this commit.
--
-- The gym's two amounts, in minor units of its money: 0 is off, and both start at 0.
ALTER TABLE "gyms" ADD COLUMN "class_late_cancel_fee_minor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "gyms" ADD COLUMN "class_no_show_fee_minor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "gyms" ADD CONSTRAINT "gyms_class_fees_check" CHECK ("class_late_cancel_fee_minor" BETWEEN 0 AND 99999999 AND "class_no_show_fee_minor" BETWEEN 0 AND 99999999);--> statement-breakpoint
-- A fee is a bill of the membership the booking used, with no period: `period_index` is
-- null on it alone. It keeps what it was for (the class's name; its day in `covers_from`
-- and `covers_to`) after the booking itself is gone.
ALTER TABLE "gym_member_bills" ALTER COLUMN "period_index" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_member_bills" ADD COLUMN "fee" text;--> statement-breakpoint
ALTER TABLE "gym_member_bills" ADD COLUMN "fee_for" text;--> statement-breakpoint
ALTER TABLE "gym_member_bills" ADD COLUMN "class_booking_id" uuid;--> statement-breakpoint
ALTER TABLE "gym_member_bills" ADD CONSTRAINT "gym_member_bills_class_booking_fk" FOREIGN KEY ("class_booking_id") REFERENCES "public"."gym_class_bookings"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "gym_member_bills" ADD CONSTRAINT "gym_member_bills_fee_check" CHECK (
  ("period_index" IS NULL) = ("fee" IS NOT NULL)
  AND ("fee" IS NULL OR ("fee" IN ('late_cancel','no_show') AND char_length("fee_for") BETWEEN 1 AND 80 AND "covers_from" IS NOT NULL))
  AND ("fee" IS NOT NULL OR "fee_for" IS NULL)
  AND ("class_booking_id" IS NULL OR "fee" IS NOT NULL)
);--> statement-breakpoint
-- Staff waive a fee: a reason of its own, on a fee alone.
ALTER TABLE "gym_member_bills" DROP CONSTRAINT "gym_member_bills_void_check";--> statement-breakpoint
ALTER TABLE "gym_member_bills" ADD CONSTRAINT "gym_member_bills_void_check" CHECK (
  ("void_reason" IS NULL) = ("voided_on" IS NULL)
  AND ("void_reason" IS NOT NULL OR "voided_by" IS NULL)
  AND ("void_reason" IS NULL OR ("status" = 'void' AND "void_reason" IN ('mistake','not_charging','other','waived')))
  AND ("void_reason" <> 'waived' OR "fee" IS NOT NULL)
);--> statement-breakpoint
-- One fee a booking that stands: the same press twice, or a cancel and a run at one
-- instant, open one.
CREATE UNIQUE INDEX "gym_member_bills_class_fee_uq" ON "gym_member_bills" USING btree ("class_booking_id") WHERE "class_booking_id" IS NOT NULL AND "status" <> 'void';
