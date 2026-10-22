-- UPI for gyms in India (ROADMAP Stage 2 item 18r; spec Part 3 §14.8).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
-- Renumbered from 0154 when 18y's `0154_bill_day` merged first.
--
-- A payment the member made to the gym's own UPI ID or QR code, recorded by hand as cash is:
-- on a bill, a fee, a sale, and the refunds of each. Only a gym in India records it; the server
-- refuses it elsewhere.
ALTER TABLE "gym_member_payments" DROP CONSTRAINT "gym_member_payments_method_check";--> statement-breakpoint
ALTER TABLE "gym_member_payments" ADD CONSTRAINT "gym_member_payments_method_check" CHECK ("method" IN ('cash','upi','card_at_desk','bank_transfer','link','company','terminal'));--> statement-breakpoint
ALTER TABLE "gym_member_refunds" DROP CONSTRAINT "gym_member_refunds_method_check";--> statement-breakpoint
ALTER TABLE "gym_member_refunds" ADD CONSTRAINT "gym_member_refunds_method_check" CHECK ("method" IN ('cash','upi','card_at_desk','bank_transfer'));--> statement-breakpoint
ALTER TABLE "gym_sales" DROP CONSTRAINT "gym_sales_method_check";--> statement-breakpoint
ALTER TABLE "gym_sales" ADD CONSTRAINT "gym_sales_method_check" CHECK ("method" IN ('cash','upi','card_at_desk','bank_transfer','terminal'));--> statement-breakpoint
ALTER TABLE "gym_sale_refunds" DROP CONSTRAINT "gym_sale_refunds_method_check";--> statement-breakpoint
ALTER TABLE "gym_sale_refunds" ADD CONSTRAINT "gym_sale_refunds_method_check" CHECK ("method" IN ('cash','upi','card_at_desk','bank_transfer'));
