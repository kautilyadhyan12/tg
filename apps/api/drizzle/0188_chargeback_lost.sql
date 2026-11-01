-- A lost chargeback (ROADMAP 18d-iv-e-ii-a). `lost_written_at`: its money has been written as gone back, once. `charges_restarted_at`:
-- staff started automatic charges again. A refund's reason `chargeback` is written by the app; nobody picks it.
ALTER TABLE "gym_square_disputes" ADD COLUMN "lost_written_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gym_square_disputes" ADD COLUMN "charges_restarted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gym_square_disputes" ADD COLUMN "charges_restarted_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "gym_member_refunds" DROP CONSTRAINT "gym_member_refunds_reason_check";--> statement-breakpoint
ALTER TABLE "gym_member_refunds" ADD CONSTRAINT "gym_member_refunds_reason_check" CHECK ("reason" IN ('paid_twice','charged_too_much','leaving','other','chargeback'));
