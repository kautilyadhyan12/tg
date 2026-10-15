-- Refer a friend (ROADMAP Stage 2 item 20e-ii-a; spec Part 3 §16.3).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A business's own offer: its switch, the member's gift (a percentage or an amount off their
-- next payment, given by the app itself, 20e-ii-b) and the friend's gift (one of the
-- business's own discounts, with a promo code the app made). Either may be left out;
-- switched on, at least one is set.
CREATE TABLE "gym_referral_settings" (
	"gym_id" uuid PRIMARY KEY NOT NULL,
	"switched_on" boolean DEFAULT false NOT NULL,
	"member_gift_kind" text,
	"member_percent_bp" integer,
	"member_amount_minor" integer,
	"member_currency" text,
	"friend_discount_id" uuid,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_referral_settings_member_gift_check" CHECK (CASE
		WHEN "member_gift_kind" IS NULL THEN "member_percent_bp" IS NULL AND "member_amount_minor" IS NULL AND "member_currency" IS NULL
		WHEN "member_gift_kind" = 'percent' THEN "member_percent_bp" BETWEEN 1 AND 9999 AND "member_amount_minor" IS NULL AND "member_currency" IS NULL
		WHEN "member_gift_kind" = 'amount' THEN "member_amount_minor" BETWEEN 1 AND 99999999 AND "member_percent_bp" IS NULL AND "member_currency" ~ '^[A-Z]{3}$'
		ELSE false END),
	CONSTRAINT "gym_referral_settings_gift_check" CHECK (NOT "switched_on" OR "member_gift_kind" IS NOT NULL OR "friend_discount_id" IS NOT NULL)
);--> statement-breakpoint
ALTER TABLE "gym_referral_settings" ADD CONSTRAINT "gym_referral_settings_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_referral_settings" ADD CONSTRAINT "gym_referral_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_referral_settings" ADD CONSTRAINT "gym_referral_settings_friend_discount_fk" FOREIGN KEY ("gym_id","friend_discount_id") REFERENCES "public"."gym_discounts"("gym_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Each member's own invite link at one business: a random code of 16 letters and digits
-- (80 bits), made the first time the member asks for it, and the same one after that.
CREATE TABLE "gym_referral_links" (
	"gym_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_referral_links_pk" PRIMARY KEY ("gym_id","user_id"),
	CONSTRAINT "gym_referral_links_code_uq" UNIQUE ("code"),
	CONSTRAINT "gym_referral_links_code_check" CHECK ("code" ~ '^[a-z2-7]{16}$')
);--> statement-breakpoint
ALTER TABLE "gym_referral_links" ADD CONSTRAINT "gym_referral_links_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_referral_links" ADD CONSTRAINT "gym_referral_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- The member whose link a lead came by, and when. Written only when the form makes a new
-- lead; a lead that was already there is never changed by the form.
ALTER TABLE "gym_leads" ADD COLUMN "referred_by" uuid;--> statement-breakpoint
ALTER TABLE "gym_leads" ADD COLUMN "referred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gym_leads" ADD CONSTRAINT "gym_leads_referred_by_users_id_fk" FOREIGN KEY ("referred_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_leads" ADD CONSTRAINT "gym_leads_referred_check" CHECK ("referred_by" IS NULL OR "referred_at" IS NOT NULL);--> statement-breakpoint
CREATE INDEX "gym_leads_referred_by_idx" ON "gym_leads" USING btree ("gym_id","referred_by") WHERE "referred_by" IS NOT NULL;
