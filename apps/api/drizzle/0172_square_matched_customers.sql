-- Match once for the rest, first half (ROADMAP Stage 2 item 18d-iii-b-ii-c-i; spec Part 3 §14.8). Forward-only. Hand-written, as
-- `0016` onwards are; its journal entry is part of this commit.
--
-- `gym_square_old_customers`: a customer of a record besides the one `gym_square_customers` keeps. It holds the old customers a
-- record was at a merge in Square (0167: `merged_at`) and now the customers staff matched to the record from a payment
-- (`matched_at`): a person can have a second customer in Square (Square makes one from a card payment), and a payment under it
-- is theirs all the same. Exactly one of the two is set, so a later job can take a matched one back (Unlink) without touching a
-- merged one.
--
-- `gym_square_app_payments.sale_reason`: why the payment waits because of what was sold, whoever paid (mixed sale, unread, paid in
-- parts, Square's tax). The take-in stopped at "not linked" and lost it; kept now, a payment that waited for want of its customer
-- being known says the right reason once the customer is linked. The payments already waiting for want of a customer, whose sale
-- was not kept, wait as an unread sale (staff choose the bill), the safe side.
--
-- `gym_square_app_payments.link_result`: what Match did about Square's customer on the payment, so the same press sent twice is
-- answered the same. Null: nothing was asked.
ALTER TABLE "gym_square_old_customers" ALTER COLUMN "merged_at" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "gym_square_old_customers" ADD COLUMN "matched_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "gym_square_old_customers" ADD CONSTRAINT "gym_square_old_customers_how_check" CHECK (("merged_at" IS NULL) <> ("matched_at" IS NULL));
--> statement-breakpoint
ALTER TABLE "gym_square_app_payments" ADD COLUMN "sale_reason" text;
--> statement-breakpoint
ALTER TABLE "gym_square_app_payments" ADD COLUMN "link_result" text;
--> statement-breakpoint
ALTER TABLE "gym_square_app_payments" ADD CONSTRAINT "gym_square_app_payments_sale_reason_check" CHECK ("sale_reason" IS NULL OR "sale_reason" IN ('mixed_sale','sale_unread','paid_in_parts','square_tax'));
--> statement-breakpoint
ALTER TABLE "gym_square_app_payments" ADD CONSTRAINT "gym_square_app_payments_link_result_check" CHECK ("link_result" IS NULL OR "link_result" IN ('linked','also','taken','gone','merged','unchecked','past'));
--> statement-breakpoint
UPDATE "gym_square_app_payments" SET "sale_reason" = 'sale_unread'
WHERE "state" = 'waiting' AND "reason" = 'not_linked' AND "entry_id" IS NULL AND "entered_minor" IS NULL;
