-- A fee for a late cancel or a no-show, for personal training (ROADMAP Stage 2 item 18h-ii;
-- after 18h-i's `0136`). Forward-only. Hand-written, as `0016` onwards are; its journal
-- entry is part of this commit.
--
-- The gym's two amounts for a session, in minor units of its money, apart from the
-- classes': 0 is off, and both start at 0.
ALTER TABLE "gyms" ADD COLUMN "pt_late_cancel_fee_minor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "gyms" ADD COLUMN "pt_no_show_fee_minor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "gyms" ADD CONSTRAINT "gyms_pt_fees_check" CHECK ("pt_late_cancel_fee_minor" BETWEEN 0 AND 99999999 AND "pt_no_show_fee_minor" BETWEEN 0 AND 99999999);--> statement-breakpoint
-- A session's fee is a bill with no period, as a class's is, naming the session while it
-- stands. A fee is for a class or for a session, never both.
ALTER TABLE "gym_member_bills" ADD COLUMN "pt_appointment_id" uuid;--> statement-breakpoint
ALTER TABLE "gym_member_bills" ADD CONSTRAINT "gym_member_bills_pt_appointment_fk" FOREIGN KEY ("pt_appointment_id") REFERENCES "public"."gym_pt_appointments"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "gym_member_bills" ADD CONSTRAINT "gym_member_bills_pt_fee_check" CHECK (
  ("pt_appointment_id" IS NULL OR "fee" IS NOT NULL)
  AND ("pt_appointment_id" IS NULL OR "class_booking_id" IS NULL)
);--> statement-breakpoint
-- One fee a session that stands: the same press twice, or two staff at one instant, open one.
CREATE UNIQUE INDEX "gym_member_bills_pt_fee_uq" ON "gym_member_bills" USING btree ("pt_appointment_id") WHERE "pt_appointment_id" IS NOT NULL AND "status" <> 'void';--> statement-breakpoint
-- A session's fee looked up, a waived one too, from the trainer's week and the member's list.
CREATE INDEX "gym_member_bills_pt_appointment_idx" ON "gym_member_bills" USING btree ("pt_appointment_id") WHERE "pt_appointment_id" IS NOT NULL;
