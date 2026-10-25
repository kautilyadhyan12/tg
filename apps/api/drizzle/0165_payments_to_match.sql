-- Payments to match (ROADMAP Stage 2 item 18d-iii-b-ii-a; spec Part 3 §14.8). Forward-only. Hand-written,
-- as `0016` onwards are; its journal entry is part of this commit.
--
-- A payment from Square Point of Sale that waits (0164) is matched by staff to a bill (`recorded`, as one
-- the app recorded by itself), or marked as not a bill payment (`not_bill`: `other`, a shop sale or
-- anything else; `by_hand`, one already recorded on a bill by hand), which keeps why it was waiting, so
-- Undo puts it back as it was. `entered_minor`: the part staff entered as an amount, without what Square
-- added on top, where it can be told (every line typed, one payment for the whole sale): what Match puts
-- on the bill. `refunded_minor`: what Square had given back of it when it was last read.
-- `customer_name`, `customer_email`, `customer_phone`: what Square has of the customer added to the sale,
-- where that customer is linked to nobody here, so staff can tell who it is. `device_name`: the name the
-- gym gave the Square device that took it, so each desk matches its own.
--
-- Nothing taken in Square Point of Sale goes on a bill by itself any more (Kd, 2026-10-25, "one press"):
-- where one bill fits, the payment waits `ready`; a sale of shop items for somebody owing at least that
-- much this week waits `shop_items`.
ALTER TABLE "gym_square_app_payments" DROP CONSTRAINT "gym_square_app_payments_state_check";--> statement-breakpoint
ALTER TABLE "gym_square_app_payments" ADD CONSTRAINT "gym_square_app_payments_state_check" CHECK ("state" IN ('recorded','waiting','shop_sale','not_bill'));--> statement-breakpoint
ALTER TABLE "gym_square_app_payments" DROP CONSTRAINT "gym_square_app_payments_reason_check";--> statement-breakpoint
ALTER TABLE "gym_square_app_payments" ADD CONSTRAINT "gym_square_app_payments_reason_check" CHECK (("state" IN ('waiting','not_bill')) = ("reason" IS NOT NULL) AND ("reason" IS NULL OR "reason" IN ('ready','no_customer','not_linked','several_people','mixed_sale','sale_unread','square_tax','no_bill','too_early','several_bills','busy','maybe_twice','other_location','several_gyms','not_this_bill','refunded','shop_items')));--> statement-breakpoint
ALTER TABLE "gym_square_app_payments" ADD COLUMN "not_bill" text;--> statement-breakpoint
ALTER TABLE "gym_square_app_payments" ADD COLUMN "entered_minor" integer;--> statement-breakpoint
ALTER TABLE "gym_square_app_payments" ADD COLUMN "refunded_minor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_square_app_payments" ADD COLUMN "customer_name" text;--> statement-breakpoint
ALTER TABLE "gym_square_app_payments" ADD COLUMN "customer_email" text;--> statement-breakpoint
ALTER TABLE "gym_square_app_payments" ADD COLUMN "customer_phone" text;--> statement-breakpoint
ALTER TABLE "gym_square_app_payments" ADD COLUMN "device_name" text;--> statement-breakpoint
ALTER TABLE "gym_square_app_payments" ADD CONSTRAINT "gym_square_app_payments_not_bill_check" CHECK (("state" = 'not_bill') = ("not_bill" IS NOT NULL) AND ("not_bill" IS NULL OR "not_bill" IN ('other','by_hand')));--> statement-breakpoint
ALTER TABLE "gym_square_app_payments" ADD CONSTRAINT "gym_square_app_payments_money_check" CHECK (("entered_minor" IS NULL OR "entered_minor" BETWEEN 1 AND 999999999) AND "refunded_minor" BETWEEN 0 AND 999999999);--> statement-breakpoint
ALTER TABLE "gym_square_app_payments" ADD CONSTRAINT "gym_square_app_payments_customer_check" CHECK (("customer_name" IS NULL OR char_length("customer_name") BETWEEN 1 AND 200) AND ("customer_email" IS NULL OR char_length("customer_email") BETWEEN 1 AND 320) AND ("customer_phone" IS NULL OR char_length("customer_phone") BETWEEN 1 AND 40));--> statement-breakpoint
ALTER TABLE "gym_square_app_payments" ADD CONSTRAINT "gym_square_app_payments_device_check" CHECK ("device_name" IS NULL OR char_length("device_name") BETWEEN 1 AND 100);--> statement-breakpoint
--
-- The payments that hold a person's card on file: asked for each bill the app is about to charge.
CREATE INDEX "gym_square_app_payments_waiting_idx" ON "gym_square_app_payments" USING btree ("gym_id","entry_id") WHERE "state" = 'waiting' AND "entry_id" IS NOT NULL;
