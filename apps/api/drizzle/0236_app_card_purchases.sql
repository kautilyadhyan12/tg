-- Buy a repeating membership in the app (ROADMAP Stage 2 item 18k-iv). Forward-only.
-- Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A purchase of a repeating line is paid with the card the member saved in the app, charged by Square with the row's own
-- id as its key: it has no payment page, so the page's columns are empty and the card's are kept instead (`card_id`, the
-- customer it is saved on, and `card_brand`/`card_last4` from the start). A row is one or the other, and a charged one is
-- only ever a purchase.
ALTER TABLE "gym_app_payments" ALTER COLUMN "link_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_app_payments" ALTER COLUMN "link_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_app_payments" ALTER COLUMN "order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_app_payments" ALTER COLUMN "url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_app_payments" ADD COLUMN "card_id" text;--> statement-breakpoint
ALTER TABLE "gym_app_payments" ADD COLUMN "card_customer_id" text;--> statement-breakpoint
-- Why Square did not take it, where it said (a decline, the bank asking to confirm): the same press sent again is told the same.
ALTER TABLE "gym_app_payments" ADD COLUMN "charge_code" text;--> statement-breakpoint
ALTER TABLE "gym_app_payments" ADD CONSTRAINT "gym_app_payments_charge_code_check" CHECK ("charge_code" IS NULL OR ("card_id" IS NOT NULL AND "charge_code" ~ '^[A-Z0-9_]{1,60}$'));--> statement-breakpoint
ALTER TABLE "gym_app_payments" DROP CONSTRAINT "gym_app_payments_ids_check";--> statement-breakpoint
ALTER TABLE "gym_app_payments" ADD CONSTRAINT "gym_app_payments_ids_check" CHECK ("account_id" ~ '^[A-Za-z0-9_-]{1,64}$' AND "location_id" ~ '^[A-Za-z0-9_-]{1,64}$' AND ("link_id" IS NULL OR "link_id" ~ '^[A-Za-z0-9_-]{1,64}$') AND ("order_id" IS NULL OR "order_id" ~ '^[A-Za-z0-9_-]{1,192}$') AND ("url" IS NULL OR char_length("url") <= 300) AND ("square_payment_id" IS NULL OR "square_payment_id" ~ '^[A-Za-z0-9_-]{1,192}$') AND ("card_id" IS NULL OR "card_id" ~ '^[A-Za-z0-9_:-]{1,192}$') AND ("card_customer_id" IS NULL OR "card_customer_id" ~ '^[A-Za-z0-9_-]{1,192}$'));--> statement-breakpoint
ALTER TABLE "gym_app_payments" ADD CONSTRAINT "gym_app_payments_way_check" CHECK (
  CASE WHEN "card_id" IS NULL
    THEN "card_customer_id" IS NULL AND "link_key" IS NOT NULL AND "link_id" IS NOT NULL AND "order_id" IS NOT NULL AND "url" IS NOT NULL
    ELSE "card_customer_id" IS NOT NULL AND "membership_type_id" IS NOT NULL AND "card_brand" IS NOT NULL
      AND "link_key" IS NULL AND "link_id" IS NULL AND "order_id" IS NULL AND "url" IS NULL
  END);
