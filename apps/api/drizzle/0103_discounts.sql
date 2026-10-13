-- Discounts and promo codes on products (ROADMAP Stage 2 item 18b-ii-a; spec Part 3 §14.3).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.

-- One discount a gym offers: a percentage (hundredths of a percent) or a fixed amount in
-- one money, optionally between two of the gym's own days, optionally a limited number of
-- times. `uses` counts the sales made with it that still stand; it is moved in the sale's
-- own transaction. Archived, never deleted: a sale keeps pointing at it.
CREATE TABLE "gym_discounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL REFERENCES "gyms"("id") ON DELETE CASCADE,
	"name" text NOT NULL,
	-- The promo code a customer asks for it by; NULL where staff pick it by name.
	"code" text,
	"kind" text NOT NULL,
	"percent_bp" integer,
	"amount_minor" integer,
	"currency" text,
	"starts_on" date,
	"ends_on" date,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	-- false: only the products in `gym_discount_products`.
	"all_products" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_discounts_gym_id_uq" UNIQUE ("gym_id", "id"),
	CONSTRAINT "gym_discounts_name_check" CHECK (char_length("name") BETWEEN 1 AND 60),
	CONSTRAINT "gym_discounts_code_check" CHECK ("code" IS NULL OR "code" ~ '^[A-Z0-9]{3,20}$'),
	CONSTRAINT "gym_discounts_kind_check" CHECK ("kind" IN ('percent','amount')),
	CONSTRAINT "gym_discounts_shape_check" CHECK (
		CASE WHEN "kind" = 'percent' THEN
			"percent_bp" IS NOT NULL AND "percent_bp" BETWEEN 1 AND 10000
			AND "amount_minor" IS NULL AND "currency" IS NULL
		ELSE
			"amount_minor" IS NOT NULL AND "amount_minor" BETWEEN 1 AND 99999999
			AND "percent_bp" IS NULL AND "currency" IS NOT NULL AND "currency" ~ '^[A-Z]{3}$'
		END
	),
	CONSTRAINT "gym_discounts_days_check" CHECK ("starts_on" IS NULL OR "ends_on" IS NULL OR "ends_on" >= "starts_on"),
	CONSTRAINT "gym_discounts_uses_check" CHECK ("uses" >= 0 AND ("max_uses" IS NULL OR "max_uses" BETWEEN 1 AND 100000))
);--> statement-breakpoint
-- One discount of a name, and one of a promo code, in use at a time.
CREATE UNIQUE INDEX "gym_discounts_name_uq" ON "gym_discounts" ("gym_id", lower("name")) WHERE "archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "gym_discounts_code_uq" ON "gym_discounts" ("gym_id", "code") WHERE "archived_at" IS NULL AND "code" IS NOT NULL;--> statement-breakpoint

-- The products a discount is limited to. Both keys carry the gym, so a discount never
-- names another gym's product.
CREATE TABLE "gym_discount_products" (
	"gym_id" uuid NOT NULL,
	"discount_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	CONSTRAINT "gym_discount_products_pk" PRIMARY KEY ("discount_id", "product_id"),
	CONSTRAINT "gym_discount_products_discount_fk" FOREIGN KEY ("gym_id", "discount_id")
		REFERENCES "gym_discounts"("gym_id", "id") ON DELETE CASCADE,
	CONSTRAINT "gym_discount_products_product_fk" FOREIGN KEY ("gym_id", "product_id")
		REFERENCES "gym_products"("gym_id", "id") ON DELETE CASCADE
);--> statement-breakpoint
CREATE INDEX "gym_discount_products_gym_idx" ON "gym_discount_products" ("gym_id");--> statement-breakpoint
CREATE INDEX "gym_discount_products_product_idx" ON "gym_discount_products" ("product_id");--> statement-breakpoint

-- A sale made with a discount keeps it: which one, its name as it was, and what it took
-- off. `unit_price_minor` stays the product's own price; `net_minor`, `tax_minor` and
-- `total_minor` are what was charged after the discount, and something is always left.
ALTER TABLE "gym_sales" ADD COLUMN "discount_id" uuid;--> statement-breakpoint
ALTER TABLE "gym_sales" ADD COLUMN "discount_name" text;--> statement-breakpoint
ALTER TABLE "gym_sales" ADD COLUMN "discount_minor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_sales" ADD CONSTRAINT "gym_sales_discount_check" CHECK (
	("discount_id" IS NULL) = ("discount_name" IS NULL)
	AND CASE WHEN "discount_id" IS NULL THEN "discount_minor" = 0
		ELSE "discount_minor" BETWEEN 0 AND "unit_price_minor" * "quantity" - 1 END
);--> statement-breakpoint
ALTER TABLE "gym_sales" ADD CONSTRAINT "gym_sales_discount_fk" FOREIGN KEY ("gym_id", "discount_id")
	REFERENCES "gym_discounts"("gym_id", "id") ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX "gym_sales_discount_idx" ON "gym_sales" ("gym_id", "discount_id") WHERE "discount_id" IS NOT NULL;
