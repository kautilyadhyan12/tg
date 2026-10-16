-- Refer a friend: the member's gift given (ROADMAP Stage 2 item 20e-ii-b-ii-a; spec Part 3 §16.3).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- One row a gift: given to the member who invited a friend, once a friend, when that friend
-- makes their first payment that stands; then taken off one bill or one sale of the member's,
-- or taken back where the friend's payment was voided or refunded in full before it was used.
CREATE TABLE "gym_referral_member_gifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"friend_entry_id" uuid,
	"lead_id" uuid,
	"member_user_id" uuid,
	"kind" text NOT NULL,
	"percent_bp" integer,
	"amount_minor" integer,
	"currency" text,
	"given_at" timestamp with time zone NOT NULL,
	"given_on" date NOT NULL,
	"by_payment_id" uuid,
	"by_sale_id" uuid,
	"used_at" timestamp with time zone,
	"used_bill_id" uuid,
	"used_sale_id" uuid,
	"used_off_minor" integer,
	"used_currency" text,
	"taken_back_at" timestamp with time zone,
	"taken_back_on" date,
	"taken_back_why" text,
	CONSTRAINT "gym_referral_member_gifts_kind_check" CHECK ("kind" IN ('percent','amount')),
	CONSTRAINT "gym_referral_member_gifts_shape_check" CHECK (CASE WHEN "kind" = 'percent' THEN
        "percent_bp" BETWEEN 1 AND 9999 AND "amount_minor" IS NULL AND "currency" IS NULL
      ELSE
        "amount_minor" BETWEEN 1 AND 99999999 AND "percent_bp" IS NULL AND "currency" ~ '^[A-Z]{3}$'
      END),
	CONSTRAINT "gym_referral_member_gifts_by_check" CHECK ("by_payment_id" IS NULL OR "by_sale_id" IS NULL),
	CONSTRAINT "gym_referral_member_gifts_used_check" CHECK (("used_at" IS NULL) = ("used_off_minor" IS NULL) AND ("used_at" IS NULL) = ("used_currency" IS NULL)
        AND ("used_off_minor" IS NULL OR "used_off_minor" BETWEEN 1 AND 99999999)
        AND ("used_currency" IS NULL OR "used_currency" ~ '^[A-Z]{3}$')
        AND ("used_bill_id" IS NULL OR "used_sale_id" IS NULL)),
	CONSTRAINT "gym_referral_member_gifts_taken_back_check" CHECK (("taken_back_at" IS NULL) = ("taken_back_on" IS NULL) AND ("taken_back_at" IS NULL) = ("taken_back_why" IS NULL)
        AND ("taken_back_why" IS NULL OR "taken_back_why" IN ('voided','refunded'))
        AND ("taken_back_at" IS NULL OR "used_at" IS NULL))
);--> statement-breakpoint
ALTER TABLE "gym_referral_member_gifts" ADD CONSTRAINT "gym_referral_member_gifts_gym_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_referral_member_gifts" ADD CONSTRAINT "gym_referral_member_gifts_friend_fk" FOREIGN KEY ("friend_entry_id") REFERENCES "public"."gym_member_list_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_referral_member_gifts" ADD CONSTRAINT "gym_referral_member_gifts_lead_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."gym_leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_referral_member_gifts" ADD CONSTRAINT "gym_referral_member_gifts_member_fk" FOREIGN KEY ("member_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_referral_member_gifts" ADD CONSTRAINT "gym_referral_member_gifts_by_payment_fk" FOREIGN KEY ("by_payment_id") REFERENCES "public"."gym_member_payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_referral_member_gifts" ADD CONSTRAINT "gym_referral_member_gifts_by_sale_fk" FOREIGN KEY ("by_sale_id") REFERENCES "public"."gym_sales"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_referral_member_gifts" ADD CONSTRAINT "gym_referral_member_gifts_used_bill_fk" FOREIGN KEY ("used_bill_id") REFERENCES "public"."gym_member_bills"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_referral_member_gifts" ADD CONSTRAINT "gym_referral_member_gifts_used_sale_fk" FOREIGN KEY ("used_sale_id") REFERENCES "public"."gym_sales"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gym_referral_member_gifts_friend_uq" ON "gym_referral_member_gifts" USING btree ("gym_id","friend_entry_id") WHERE "taken_back_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "gym_referral_member_gifts_bill_uq" ON "gym_referral_member_gifts" USING btree ("used_bill_id") WHERE "used_bill_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "gym_referral_member_gifts_sale_uq" ON "gym_referral_member_gifts" USING btree ("used_sale_id") WHERE "used_sale_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "gym_referral_member_gifts_waiting_idx" ON "gym_referral_member_gifts" USING btree ("gym_id","member_user_id") WHERE "used_at" IS NULL AND "taken_back_at" IS NULL;--> statement-breakpoint
CREATE INDEX "gym_referral_member_gifts_payment_idx" ON "gym_referral_member_gifts" USING btree ("by_payment_id") WHERE "by_payment_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "gym_referral_member_gifts_by_sale_idx" ON "gym_referral_member_gifts" USING btree ("by_sale_id") WHERE "by_sale_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_member_messages" DROP CONSTRAINT "gym_member_messages_kind_check";--> statement-breakpoint
ALTER TABLE "gym_member_messages" ADD CONSTRAINT "gym_member_messages_kind_check" CHECK ("kind" IN ('payment_overdue','membership_ending','trial_ending','trial_check_in','welcome','birthday','milestone','miss_you','review','class_reminder','group','referral_gift'));--> statement-breakpoint
-- A desk sale the member's gift was taken off keeps it as its discount line, by name, with no
-- discount of the gym's behind it: marked, so every other sale keeps the rule it had.
ALTER TABLE "gym_sales" ADD COLUMN "member_gift" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_sales" DROP CONSTRAINT "gym_sales_discount_check";--> statement-breakpoint
ALTER TABLE "gym_sales" ADD CONSTRAINT "gym_sales_discount_check" CHECK (CASE WHEN "member_gift" THEN "discount_id" IS NULL AND "discount_name" IS NOT NULL AND "discount_minor" BETWEEN 1 AND "unit_price_minor" * "quantity" - 1
        ELSE ("discount_id" IS NULL) = ("discount_name" IS NULL) AND CASE WHEN "discount_id" IS NULL THEN "discount_minor" = 0 ELSE "discount_minor" BETWEEN 1 AND "unit_price_minor" * "quantity" - 1 END END);
