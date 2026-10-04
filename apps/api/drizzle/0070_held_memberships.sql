-- A person's membership (ROADMAP Stage 2 item 17a-ii; spec Part 3 §13.2).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- gym_held_memberships  one membership a gym's record of a person holds.

-- What a held membership's type key points at, with its gym, so it cannot name another
-- gym's type.
ALTER TABLE "gym_membership_types" ADD CONSTRAINT "gym_membership_types_gym_id_uq" UNIQUE ("gym_id", "id");--> statement-breakpoint

-- Held by the RECORD (`entry_id`), so a person without the app can hold one. The kind, the
-- price and the term are the type's as they were when it was given: a later change to the
-- type moves nobody's dates. `frozen_days` is how many days it has been frozen in all: its
-- periods are counted from the start day and these days are added after, so every later date
-- moves by exactly the days frozen. `paid_periods` is how many periods are marked paid, and
-- `paid_floor` the count it was given with, which a mark is never taken back below; `renews`
-- is false once a repeating membership was cancelled at the end of what is paid. The end day, the renewal day and what is owed are worked out from these by
-- `heldMembershipView` in `@app/shared`, never stored.
-- `status` is the last one written: an `active` row past its last day reads as ended, so
-- nothing reads `status` without that rule.
-- `request_key` is made by the screen once a form: the same one arriving twice is one row.
CREATE TABLE "gym_held_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL REFERENCES "gyms"("id") ON DELETE CASCADE,
	"entry_id" uuid NOT NULL,
	"membership_type_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"kind" text NOT NULL,
	"price_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"term_count" integer,
	"term_unit" text,
	"pack_classes" integer,
	"pack_days" integer,
	"starts_on" date NOT NULL,
	"frozen_days" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"frozen_on" date,
	"cancelled_on" date,
	"paid_periods" integer DEFAULT 0 NOT NULL,
	"paid_floor" integer DEFAULT 0 NOT NULL,
	"renews" boolean NOT NULL,
	"classes_left" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_held_memberships_request_uq" UNIQUE ("gym_id", "request_key"),
	CONSTRAINT "gym_held_memberships_kind_check" CHECK ("kind" IN ('recurring','one_time','pack','trial')),
	CONSTRAINT "gym_held_memberships_price_check" CHECK ("price_minor" BETWEEN 0 AND 99999999),
	CONSTRAINT "gym_held_memberships_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "gym_held_memberships_status_check" CHECK ("status" IN ('active','frozen','ended','cancelled')),
	-- The same shape a type has (`gym_membership_types_shape_check`).
	CONSTRAINT "gym_held_memberships_shape_check" CHECK (
		CASE WHEN "kind" = 'pack' THEN
			"pack_classes" IS NOT NULL AND "pack_classes" BETWEEN 1 AND 500
			AND "pack_days" IS NOT NULL AND "pack_days" BETWEEN 1 AND 730
			AND "term_count" IS NULL AND "term_unit" IS NULL
			AND "classes_left" IS NOT NULL AND "classes_left" BETWEEN 0 AND "pack_classes"
		ELSE
			"term_count" IS NOT NULL AND "term_count" BETWEEN 1 AND 365
			AND "term_unit" IS NOT NULL AND "term_unit" IN ('day','week','month','year')
			AND NOT ("kind" = 'recurring' AND "term_unit" = 'day')
			AND "pack_classes" IS NULL AND "pack_days" IS NULL AND "classes_left" IS NULL
		END
	),
	CONSTRAINT "gym_held_memberships_frozen_days_check" CHECK ("frozen_days" BETWEEN 0 AND 36500),
	CONSTRAINT "gym_held_memberships_frozen_check" CHECK (("status" = 'frozen') = ("frozen_on" IS NOT NULL)),
	CONSTRAINT "gym_held_memberships_cancelled_check" CHECK (("status" = 'cancelled') = ("cancelled_on" IS NOT NULL)),
	CONSTRAINT "gym_held_memberships_paid_check" CHECK ("paid_floor" >= 0 AND "paid_periods" >= "paid_floor" AND ("kind" = 'recurring' OR ("paid_periods" <= 1 AND "paid_floor" = 0)) AND ("price_minor" > 0 OR "paid_periods" = 0)),
	-- Only a repeating membership renews.
	CONSTRAINT "gym_held_memberships_renews_check" CHECK ("kind" = 'recurring' OR NOT "renews")
);--> statement-breakpoint
-- A record deleted for good takes its memberships; a merge moves them first
-- (`memberList/repo.ts`, `moveHeldMemberships`).
ALTER TABLE "gym_held_memberships" ADD CONSTRAINT "gym_held_memberships_entry_fk" FOREIGN KEY ("gym_id", "entry_id") REFERENCES "public"."gym_member_list_entries"("gym_id", "id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- A type somebody holds is archived, never deleted.
ALTER TABLE "gym_held_memberships" ADD CONSTRAINT "gym_held_memberships_type_fk" FOREIGN KEY ("gym_id", "membership_type_id") REFERENCES "public"."gym_membership_types"("gym_id", "id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- A person's memberships, read whole on their page.
CREATE INDEX "gym_held_memberships_entry_idx" ON "gym_held_memberships" ("gym_id", "entry_id");--> statement-breakpoint
-- Who holds a type (17a-iii), and the type key's own index.
CREATE INDEX "gym_held_memberships_type_idx" ON "gym_held_memberships" ("gym_id", "membership_type_id");
