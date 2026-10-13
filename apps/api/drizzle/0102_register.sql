-- The register: products, sales and the gym's tax (ROADMAP Stage 2 item 18b-i; spec Part 3 §14.3).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A sale is what staff say they were handed for a product; the app holds nobody's money.
-- A membership sold at the desk is the notebook's (`gym_member_bills`, `0093`): no row here.

-- The gym's tax on what it sells: a rate in hundredths of a percent (825 is 8.25%), 0 for
-- none, and whether its prices already hold the tax. NULL: not picked, so the gym's
-- country says (`taxIncludedForCountry` in `@app/shared`).
ALTER TABLE "gyms" ADD COLUMN "sales_tax_bp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "gyms" ADD COLUMN "sales_tax_included" boolean;--> statement-breakpoint
ALTER TABLE "gyms" ADD CONSTRAINT "gyms_sales_tax_check" CHECK ("sales_tax_bp" BETWEEN 0 AND 3000);--> statement-breakpoint

CREATE TABLE "gym_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL REFERENCES "gyms"("id") ON DELETE CASCADE,
	"name" text NOT NULL,
	"price_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"taxed" boolean DEFAULT true NOT NULL,
	-- How many are left; NULL where the gym does not count it.
	"stock" integer,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_products_gym_id_uq" UNIQUE ("gym_id", "id"),
	CONSTRAINT "gym_products_name_check" CHECK (char_length("name") BETWEEN 1 AND 80),
	CONSTRAINT "gym_products_price_check" CHECK ("price_minor" BETWEEN 1 AND 99999999),
	CONSTRAINT "gym_products_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "gym_products_stock_check" CHECK ("stock" IS NULL OR "stock" BETWEEN 0 AND 100000)
);--> statement-breakpoint
-- One product of a name on sale at a time; an archived one keeps its name.
CREATE UNIQUE INDEX "gym_products_name_uq" ON "gym_products" ("gym_id", lower("name")) WHERE "archived_at" IS NULL;--> statement-breakpoint

CREATE TABLE "gym_sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL REFERENCES "gyms"("id") ON DELETE CASCADE,
	-- The order sales were recorded in.
	"seq" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
	"request_key" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	-- Who bought it; NULL for a walk-in, and once their record is deleted.
	"entry_id" uuid,
	-- The product as it was named and priced when it was sold: a later change of name,
	-- price or tax never rewrites a sale.
	"item_name" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_minor" integer NOT NULL,
	"net_minor" integer NOT NULL,
	"tax_minor" integer NOT NULL,
	"total_minor" integer NOT NULL,
	"tax_bp" integer NOT NULL,
	"tax_included" boolean NOT NULL,
	"currency" text NOT NULL,
	"method" text NOT NULL,
	-- The gym's own day.
	"sold_on" date NOT NULL,
	"recorded_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	-- Whether the sale took one from the product's stock count, so taking it back returns it.
	"stock_counted" boolean DEFAULT false NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- The same request twice is one sale.
	CONSTRAINT "gym_sales_request_uq" UNIQUE ("gym_id", "request_key"),
	CONSTRAINT "gym_sales_gym_id_uq" UNIQUE ("gym_id", "id"),
	CONSTRAINT "gym_sales_name_check" CHECK (char_length("item_name") BETWEEN 1 AND 80),
	CONSTRAINT "gym_sales_quantity_check" CHECK ("quantity" BETWEEN 1 AND 99),
	CONSTRAINT "gym_sales_amounts_check" CHECK (
		"unit_price_minor" BETWEEN 1 AND 99999999
		AND "net_minor" >= 0 AND "tax_minor" >= 0
		AND "total_minor" BETWEEN 1 AND 99999999
		AND "net_minor" + "tax_minor" = "total_minor"
	),
	CONSTRAINT "gym_sales_tax_check" CHECK ("tax_bp" BETWEEN 0 AND 3000 AND ("tax_bp" > 0 OR "tax_minor" = 0)),
	CONSTRAINT "gym_sales_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "gym_sales_method_check" CHECK ("method" IN ('cash','card_at_desk','bank_transfer')),
	CONSTRAINT "gym_sales_product_fk" FOREIGN KEY ("gym_id", "product_id")
		REFERENCES "gym_products"("gym_id", "id") ON DELETE CASCADE,
	-- Kept to its gym: one gym's sale never names another gym's person.
	CONSTRAINT "gym_sales_entry_fk" FOREIGN KEY ("gym_id", "entry_id")
		REFERENCES "gym_member_list_entries"("gym_id", "id") ON DELETE SET NULL ("entry_id")
);--> statement-breakpoint
-- A day's sales, newest first; and one person's.
CREATE INDEX "gym_sales_day_idx" ON "gym_sales" ("gym_id", "sold_on", "seq");--> statement-breakpoint
CREATE INDEX "gym_sales_entry_idx" ON "gym_sales" ("gym_id", "entry_id", "seq") WHERE "entry_id" IS NOT NULL;
