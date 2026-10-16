-- Refer a friend: the member's gift as free days, and what money off comes off (ROADMAP Stage 2
-- item 20e-ii-b-ii-b; spec Part 3 §16.3). Forward-only. Hand-written, as `0016` onwards are;
-- its journal entry is part of this commit.
--
-- A membership keeps the free days it was given and the period they go before: that period and
-- every later one start so many days later, and nothing before it moves.
ALTER TABLE "gym_held_memberships" ADD COLUMN "gift_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_held_memberships" ADD COLUMN "gift_from" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_held_memberships" ADD CONSTRAINT "gym_held_memberships_gift_days_check" CHECK ("gift_days" BETWEEN 0 AND 36500 AND "gift_from" >= 0);--> statement-breakpoint
-- The offer: what its money off comes off, and free days instead, the money then being for a
-- member who has no membership.
ALTER TABLE "gym_referral_settings" ADD COLUMN "member_gift_on" text DEFAULT 'membership' NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_referral_settings" ADD COLUMN "member_days" integer;--> statement-breakpoint
ALTER TABLE "gym_referral_settings" ADD CONSTRAINT "gym_referral_settings_member_on_check" CHECK ("member_gift_on" IN ('membership','products'));--> statement-breakpoint
ALTER TABLE "gym_referral_settings" ADD CONSTRAINT "gym_referral_settings_member_days_check" CHECK ("member_days" IS NULL OR ("member_days" BETWEEN 1 AND 90 AND "member_gift_kind" IS NOT NULL));--> statement-breakpoint
-- A gift given: what its money comes off, or the free days it added to which membership.
ALTER TABLE "gym_referral_member_gifts" ADD COLUMN "gift_on" text DEFAULT 'membership' NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_referral_member_gifts" ADD COLUMN "days" integer;--> statement-breakpoint
ALTER TABLE "gym_referral_member_gifts" ADD COLUMN "days_from" integer;--> statement-breakpoint
ALTER TABLE "gym_referral_member_gifts" ADD COLUMN "used_membership_id" uuid;--> statement-breakpoint
ALTER TABLE "gym_referral_member_gifts" ADD CONSTRAINT "gym_referral_member_gifts_used_membership_fk" FOREIGN KEY ("used_membership_id") REFERENCES "public"."gym_held_memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_referral_member_gifts" ADD CONSTRAINT "gym_referral_member_gifts_on_check" CHECK ("gift_on" IN ('membership','products'));--> statement-breakpoint
ALTER TABLE "gym_referral_member_gifts" DROP CONSTRAINT "gym_referral_member_gifts_used_check";--> statement-breakpoint
ALTER TABLE "gym_referral_member_gifts" ADD CONSTRAINT "gym_referral_member_gifts_used_check" CHECK (CASE WHEN "days" IS NULL THEN
        ("used_at" IS NULL) = ("used_off_minor" IS NULL) AND ("used_at" IS NULL) = ("used_currency" IS NULL)
        AND ("used_off_minor" IS NULL OR "used_off_minor" BETWEEN 1 AND 99999999)
        AND ("used_currency" IS NULL OR "used_currency" ~ '^[A-Z]{3}$')
        AND ("used_bill_id" IS NULL OR "used_sale_id" IS NULL)
        AND "days_from" IS NULL AND "used_membership_id" IS NULL
      ELSE
        "days" BETWEEN 1 AND 90 AND "days_from" >= 0
        AND "used_off_minor" IS NULL AND "used_currency" IS NULL AND "used_bill_id" IS NULL AND "used_sale_id" IS NULL
      END);--> statement-breakpoint
CREATE INDEX "gym_referral_member_gifts_membership_idx" ON "gym_referral_member_gifts" USING btree ("used_membership_id") WHERE "used_membership_id" IS NOT NULL;
