-- Refund a sale at the desk (ROADMAP Stage 2 item 18p; rulings/2026-10-16-18p.md). Forward-only.
-- Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- One row a refund noted against a product sale: how much went back, how, why, and how many of
-- what was sold went back on the shelf. The sale stays. A refund voided keeps its row, marked,
-- as a membership's does (`gym_member_refunds`). Its receipt number is the gym's one count's.
CREATE TABLE "gym_sale_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"method" text NOT NULL,
	"reason" text NOT NULL,
	"restocked" integer DEFAULT 0 NOT NULL,
	"request_key" uuid NOT NULL,
	"refunded_on" date NOT NULL,
	"recorded_by" uuid,
	"undone_at" timestamp with time zone,
	"undone_by" uuid,
	"void_reason" text,
	"receipt_number" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_sale_refunds_receipt_uq" UNIQUE("gym_id","receipt_number"),
	CONSTRAINT "gym_sale_refunds_request_uq" UNIQUE("gym_id","request_key"),
	CONSTRAINT "gym_sale_refunds_receipt_check" CHECK ("receipt_number" >= 1),
	CONSTRAINT "gym_sale_refunds_amount_check" CHECK ("amount_minor" BETWEEN 1 AND 99999999),
	CONSTRAINT "gym_sale_refunds_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "gym_sale_refunds_method_check" CHECK ("method" IN ('cash','card_at_desk','bank_transfer')),
	CONSTRAINT "gym_sale_refunds_reason_check" CHECK ("reason" IN ('returned','charged_too_much','faulty','other')),
	CONSTRAINT "gym_sale_refunds_restocked_check" CHECK ("restocked" BETWEEN 0 AND 99),
	CONSTRAINT "gym_sale_refunds_void_reason_check" CHECK (
		"void_reason" IS NULL OR ("undone_at" IS NOT NULL AND "void_reason" IN ('mistake','wrong_amount','other'))
	)
);--> statement-breakpoint
ALTER TABLE "gym_sale_refunds" ADD CONSTRAINT "gym_sale_refunds_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_sale_refunds" ADD CONSTRAINT "gym_sale_refunds_sale_fk" FOREIGN KEY ("gym_id","sale_id") REFERENCES "public"."gym_sales"("gym_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_sale_refunds" ADD CONSTRAINT "gym_sale_refunds_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_sale_refunds" ADD CONSTRAINT "gym_sale_refunds_undone_by_users_id_fk" FOREIGN KEY ("undone_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gym_sale_refunds_sale_idx" ON "gym_sale_refunds" USING btree ("gym_id","sale_id");--> statement-breakpoint
CREATE INDEX "gym_sale_refunds_day_idx" ON "gym_sale_refunds" USING btree ("gym_id","refunded_on");
