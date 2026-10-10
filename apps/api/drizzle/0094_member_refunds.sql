-- A gym's notebook: a bill cancelled by staff, and a refund noted (ROADMAP Stage 2 item
-- 18a-ii; spec Part 3 §14.2). Forward-only. Hand-written, as `0016` onwards are; its
-- journal entry is part of this commit.

-- Who cancelled a bill, on which of the gym's days, and why (picked from a list). All
-- three stay NULL on a bill cancelled with its membership.
ALTER TABLE "gym_member_bills" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "gym_member_bills" ADD COLUMN "voided_on" date;--> statement-breakpoint
ALTER TABLE "gym_member_bills" ADD COLUMN "voided_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "gym_member_bills" ADD CONSTRAINT "gym_member_bills_void_check" CHECK (
	("void_reason" IS NULL) = ("voided_on" IS NULL)
	AND ("void_reason" IS NOT NULL OR "voided_by" IS NULL)
	AND ("void_reason" IS NULL OR ("status" = 'void' AND "void_reason" IN ('mistake','not_charging','other')))
);--> statement-breakpoint

-- The few bills staff cancelled, for the Members list, which reads them for a whole gym.
CREATE INDEX "gym_member_bills_staff_void_idx" ON "gym_member_bills" ("gym_id") WHERE "status" = 'void' AND "void_reason" IS NOT NULL;--> statement-breakpoint

-- What a refund's key points at, with its gym.
ALTER TABLE "gym_member_payments" ADD CONSTRAINT "gym_member_payments_gym_id_uq" UNIQUE ("gym_id", "id");--> statement-breakpoint

-- A refund is the gym's note that it gave money back for a payment. The app moves no
-- money. One taken back keeps its row, marked, as a payment does.
CREATE TABLE "gym_member_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL REFERENCES "gyms"("id") ON DELETE CASCADE,
	"payment_id" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"method" text NOT NULL,
	"reason" text NOT NULL,
	"request_key" uuid NOT NULL,
	"refunded_on" date NOT NULL,
	"recorded_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"undone_at" timestamp with time zone,
	"undone_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- The same request twice is one refund.
	CONSTRAINT "gym_member_refunds_request_uq" UNIQUE ("gym_id", "request_key"),
	CONSTRAINT "gym_member_refunds_amount_check" CHECK ("amount_minor" BETWEEN 1 AND 99999999),
	CONSTRAINT "gym_member_refunds_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "gym_member_refunds_method_check" CHECK ("method" IN ('cash','card_at_desk','bank_transfer')),
	CONSTRAINT "gym_member_refunds_reason_check" CHECK ("reason" IN ('paid_twice','charged_too_much','leaving','other')),
	CONSTRAINT "gym_member_refunds_payment_fk" FOREIGN KEY ("gym_id", "payment_id")
		REFERENCES "gym_member_payments"("gym_id", "id") ON DELETE CASCADE
);--> statement-breakpoint
CREATE INDEX "gym_member_refunds_payment_idx" ON "gym_member_refunds" ("gym_id", "payment_id");
