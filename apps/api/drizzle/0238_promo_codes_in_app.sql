-- A promo code typed in the app (ROADMAP Stage 2 item 18k-v; Kd, 2026-11-13). Forward-only.
-- Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A gym ticks which of its promo codes members may type in the app (`in_app`), and whether a code is used once per member
-- (`once_per_member`, at the desk and in the app). Both off for a discount made before this job: it works as it did.
-- A purchase in the app names the discount it is bought with (`discount_id`): while its page is open, or its card is being
-- charged, that discount keeps one use for it, so nobody takes its last use meanwhile, and staff cannot change it.
ALTER TABLE "gym_discounts" ADD COLUMN "in_app" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_discounts" ADD COLUMN "once_per_member" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_discounts" ADD CONSTRAINT "gym_discounts_in_app_check" CHECK (
	(NOT "in_app" OR ("code" IS NOT NULL AND "for_memberships" AND NOT "referral_gift"))
	AND (NOT "once_per_member" OR "code" IS NOT NULL)
);--> statement-breakpoint
ALTER TABLE "gym_app_payments" ADD COLUMN "discount_id" uuid;--> statement-breakpoint
UPDATE "gym_app_payments" SET "discount_id" = ("bought"->'discount'->>'id')::uuid
	WHERE "membership_type_id" IS NOT NULL AND jsonb_typeof("bought"->'discount') = 'object';--> statement-breakpoint
ALTER TABLE "gym_app_payments" ADD CONSTRAINT "gym_app_payments_discount_fk" FOREIGN KEY ("gym_id", "discount_id")
	REFERENCES "gym_discounts"("gym_id", "id");--> statement-breakpoint
ALTER TABLE "gym_app_payments" ADD CONSTRAINT "gym_app_payments_discount_check" CHECK ("discount_id" IS NULL OR "membership_type_id" IS NOT NULL);--> statement-breakpoint
CREATE INDEX "gym_app_payments_discount_idx" ON "gym_app_payments" USING btree ("gym_id", "discount_id") WHERE "state" = 'open' AND "discount_id" IS NOT NULL;
