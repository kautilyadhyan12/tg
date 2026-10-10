-- A gym's notebook: bills and payments (ROADMAP Stage 2 item 18a-i; spec Part 3 §14.2).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A bill is one period of one held membership; a payment is what staff recorded against
-- it. The app holds nobody's money. Whether a bill reads Due or Overdue is worked out on
-- the gym's own day and is stored nowhere.

-- How many days after its due date an unpaid bill reads Overdue: the gym's own number.
ALTER TABLE "gyms" ADD COLUMN "bills_overdue_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "gyms" ADD CONSTRAINT "gyms_bills_overdue_days_check" CHECK ("bills_overdue_days" BETWEEN 0 AND 60);--> statement-breakpoint

-- What a bill's key points at, with its gym.
ALTER TABLE "gym_held_memberships" ADD CONSTRAINT "gym_held_memberships_gym_id_uq" UNIQUE ("gym_id", "id");--> statement-breakpoint

CREATE TABLE "gym_member_bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL REFERENCES "gyms"("id") ON DELETE CASCADE,
	"held_membership_id" uuid NOT NULL,
	"period_index" integer NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"due_on" date NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- One bill a membership a period: the nightly run and a member of staff opening the
	-- same one at the same instant leave one.
	CONSTRAINT "gym_member_bills_period_uq" UNIQUE ("held_membership_id", "period_index"),
	CONSTRAINT "gym_member_bills_gym_id_uq" UNIQUE ("gym_id", "id"),
	CONSTRAINT "gym_member_bills_period_check" CHECK ("period_index" BETWEEN 0 AND 100000),
	CONSTRAINT "gym_member_bills_amount_check" CHECK ("amount_minor" BETWEEN 1 AND 99999999),
	CONSTRAINT "gym_member_bills_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "gym_member_bills_status_check" CHECK ("status" IN ('open','paid','void','refunded')),
	CONSTRAINT "gym_member_bills_membership_fk" FOREIGN KEY ("gym_id", "held_membership_id")
		REFERENCES "gym_held_memberships"("gym_id", "id") ON DELETE CASCADE
);--> statement-breakpoint
CREATE INDEX "gym_member_bills_open_idx" ON "gym_member_bills" ("gym_id", "due_on") WHERE "status" = 'open';--> statement-breakpoint

CREATE TABLE "gym_member_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL REFERENCES "gyms"("id") ON DELETE CASCADE,
	"bill_id" uuid NOT NULL,
	-- The order payments were recorded in.
	"seq" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"method" text NOT NULL,
	"provider" text,
	"provider_payment_id" text,
	"request_key" uuid NOT NULL,
	"paid_on" date NOT NULL,
	"recorded_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"undone_at" timestamp with time zone,
	"undone_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- The same request twice is one payment.
	CONSTRAINT "gym_member_payments_request_uq" UNIQUE ("gym_id", "request_key"),
	CONSTRAINT "gym_member_payments_amount_check" CHECK ("amount_minor" BETWEEN 1 AND 99999999),
	CONSTRAINT "gym_member_payments_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "gym_member_payments_method_check" CHECK ("method" IN ('cash','card_at_desk','bank_transfer','link','company')),
	CONSTRAINT "gym_member_payments_provider_check" CHECK (
		("method" = 'company') = ("provider" IS NOT NULL)
		AND ("provider" IS NULL) = ("provider_payment_id" IS NULL)
		AND ("provider" IS NULL OR (char_length("provider") BETWEEN 1 AND 40 AND char_length("provider_payment_id") BETWEEN 1 AND 200))
	),
	CONSTRAINT "gym_member_payments_bill_fk" FOREIGN KEY ("gym_id", "bill_id")
		REFERENCES "gym_member_bills"("gym_id", "id") ON DELETE CASCADE
);--> statement-breakpoint
-- A payment company's own id for a payment (18d): the same event twice is one row.
CREATE UNIQUE INDEX "gym_member_payments_provider_uq" ON "gym_member_payments" ("provider", "provider_payment_id") WHERE "provider" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "gym_member_payments_bill_idx" ON "gym_member_payments" ("gym_id", "bill_id");--> statement-breakpoint

-- A sixteenth privilege, `billing.members`: record what a member paid their gym. Owner and
-- manager by default. The list below is `ORG_PRIVILEGES` in `@app/shared`, and
-- `db.migration.test.ts` reads the deployed predicate against it.
ALTER TABLE "gym_staff" DROP CONSTRAINT "gym_staff_privileges_check";--> statement-breakpoint
ALTER TABLE "gym_staff" ADD CONSTRAINT "gym_staff_privileges_check" CHECK ("gym_staff"."privileges" IS NULL OR "gym_staff"."privileges" <@ ARRAY['members.read','codes.invite','codes.manage','members.confirm','members.remove','staff.manage','org.manage','billing.manage','attendance.read','schedule.manage','attendance.mark','leaderboard.manage','memberships.manage','posts.manage','reports.read','billing.members']::text[]);--> statement-breakpoint

-- Until now "Mark paid" needed `members.confirm`. Everybody who holds that tick keeps the
-- power under its new name: a stored set, an invitation still waiting, and a gym's own
-- saved role. A NULL set reads its role's defaults, which gain it in the code.
UPDATE "gym_staff"
SET "privileges" = array_append("privileges", 'billing.members')
WHERE "privileges" IS NOT NULL
  AND "privileges" @> ARRAY['members.confirm']::text[]
  AND NOT ("privileges" @> ARRAY['billing.members']::text[]);--> statement-breakpoint

UPDATE "gym_staff_invites"
SET "privileges" = array_append("privileges", 'billing.members')
WHERE "state" = 'pending'
  AND "privileges" @> ARRAY['members.confirm']::text[]
  AND NOT ("privileges" @> ARRAY['billing.members']::text[]);--> statement-breakpoint

UPDATE "gym_staff_roles"
SET "privileges" = array_append("privileges", 'billing.members')
WHERE "privileges" @> ARRAY['members.confirm']::text[]
  AND NOT ("privileges" @> ARRAY['billing.members']::text[]);
