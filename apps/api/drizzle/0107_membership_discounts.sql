-- The same discounts on memberships (ROADMAP Stage 2 item 18b-ii-b; spec Part 3 §14.3).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.

-- What a discount is for: products (all, or the ones in `gym_discount_products`), membership
-- types (all, or the ones in `gym_discount_membership_types`), or both. A discount made
-- before this is for products alone, as it was. `membership_payments` is how often it
-- comes off a repeating membership: its first payment only, or every payment.
ALTER TABLE "gym_discounts" ADD COLUMN "for_products" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_discounts" ADD COLUMN "for_memberships" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_discounts" ADD COLUMN "all_membership_types" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_discounts" ADD COLUMN "membership_payments" text;--> statement-breakpoint
ALTER TABLE "gym_discounts" ADD CONSTRAINT "gym_discounts_applies_check" CHECK (
	("for_products" OR "for_memberships")
	AND ("for_products" OR "all_products")
	AND ("for_memberships" OR "all_membership_types")
	AND ("for_memberships" = ("membership_payments" IS NOT NULL))
	AND ("membership_payments" IS NULL OR "membership_payments" IN ('first','every'))
);--> statement-breakpoint

-- The membership types a discount is limited to. Both keys carry the gym.
CREATE TABLE "gym_discount_membership_types" (
	"gym_id" uuid NOT NULL,
	"discount_id" uuid NOT NULL,
	"membership_type_id" uuid NOT NULL,
	CONSTRAINT "gym_discount_membership_types_pk" PRIMARY KEY ("discount_id", "membership_type_id"),
	CONSTRAINT "gym_discount_membership_types_discount_fk" FOREIGN KEY ("gym_id", "discount_id")
		REFERENCES "gym_discounts"("gym_id", "id") ON DELETE CASCADE,
	CONSTRAINT "gym_discount_membership_types_type_fk" FOREIGN KEY ("gym_id", "membership_type_id")
		REFERENCES "gym_membership_types"("gym_id", "id") ON DELETE CASCADE
);--> statement-breakpoint
CREATE INDEX "gym_discount_membership_types_gym_idx" ON "gym_discount_membership_types" ("gym_id");--> statement-breakpoint
CREATE INDEX "gym_discount_membership_types_type_idx" ON "gym_discount_membership_types" ("membership_type_id");--> statement-breakpoint

-- A membership given with a discount keeps it: which one, its name as it was, what it took
-- off each discounted payment, and which payments those are. With 'every', `price_minor`
-- is already the price after the discount, so every bill opened from it carries it; with
-- 'first', `price_minor` stays the full price and only the bill opened when it was given
-- carried the discount.
ALTER TABLE "gym_held_memberships" ADD COLUMN "discount_id" uuid;--> statement-breakpoint
ALTER TABLE "gym_held_memberships" ADD COLUMN "discount_name" text;--> statement-breakpoint
ALTER TABLE "gym_held_memberships" ADD COLUMN "discount_minor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_held_memberships" ADD COLUMN "discount_payments" text;--> statement-breakpoint
ALTER TABLE "gym_held_memberships" ADD CONSTRAINT "gym_held_memberships_discount_check" CHECK (
	("discount_id" IS NULL) = ("discount_name" IS NULL)
	AND ("discount_id" IS NULL) = ("discount_payments" IS NULL)
	AND CASE WHEN "discount_id" IS NULL THEN "discount_minor" = 0
		ELSE "discount_minor" BETWEEN 1 AND 99999999 AND "discount_payments" IN ('first','every')
			AND ("discount_payments" = 'every' OR "kind" = 'recurring') END
);--> statement-breakpoint
ALTER TABLE "gym_held_memberships" ADD CONSTRAINT "gym_held_memberships_discount_fk" FOREIGN KEY ("gym_id", "discount_id")
	REFERENCES "gym_discounts"("gym_id", "id");--> statement-breakpoint
CREATE INDEX "gym_held_memberships_discount_idx" ON "gym_held_memberships" ("gym_id", "discount_id") WHERE "discount_id" IS NOT NULL;
