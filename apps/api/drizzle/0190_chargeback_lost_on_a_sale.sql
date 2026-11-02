-- A lost chargeback on a sale (ROADMAP 18d-iv-e-ii-b). A sale's refund may carry the reason `chargeback`, written by the app. Part of a
-- basket waits for staff to choose the product on a row of `gym_square_refunds` that no refund at Square stands behind.
ALTER TABLE "gym_sale_refunds" DROP CONSTRAINT "gym_sale_refunds_reason_check";--> statement-breakpoint
ALTER TABLE "gym_sale_refunds" ADD CONSTRAINT "gym_sale_refunds_reason_check" CHECK ("reason" IN ('returned','charged_too_much','faulty','other','chargeback'));--> statement-breakpoint
ALTER TABLE "gym_square_refunds" DROP CONSTRAINT "gym_square_refunds_reason_check";--> statement-breakpoint
ALTER TABLE "gym_square_refunds" ADD CONSTRAINT "gym_square_refunds_reason_check" CHECK ("reason" IN ('paid_twice','charged_too_much','leaving','other','returned','faulty','chargeback'));--> statement-breakpoint
ALTER TABLE "gym_square_refunds" DROP CONSTRAINT "gym_square_refunds_taken_up_check";--> statement-breakpoint
ALTER TABLE "gym_square_refunds" ADD CONSTRAINT "gym_square_refunds_taken_up_check" CHECK (("reason" = 'chargeback' AND "state" = 'done' AND "outcome" = 'completed' AND "square_refund_id" IS NULL) OR ("reason" <> 'chargeback' AND ("state" = 'pending' OR COALESCE("outcome" IN ('completed','failed'), false)) = ("square_refund_id" IS NOT NULL)));
