-- What a gym sells: its membership types (ROADMAP Stage 2 item 17a-i; spec Part 3 §13.1).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- gym_membership_types         one line of a gym's price list;
-- gym_membership_type_classes  the classes a type covers, where it does not cover all.

-- `price_minor` is whole minor units of `currency`, which the server stamps from the gym's
-- country when the type is made (`MEMBER_CURRENCY` in `@app/shared`) and never changes.
-- `term_count`/`term_unit` are a repeating type's billing period and a one-time type's or a
-- trial's length; a pack holds `pack_classes` to use within `pack_days` (a day pass is 1 and 1).
-- `covers_all_classes` false means the set in `gym_membership_type_classes`.
-- `archived_at`, never a delete: a person's membership (17a-ii) points at its type.
CREATE TABLE "gym_membership_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"price_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"term_count" integer,
	"term_unit" text,
	"pack_classes" integer,
	"pack_days" integer,
	"access" text NOT NULL,
	"weekly_bookings" integer,
	"covers_all_classes" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_membership_types_name_len_check" CHECK (char_length("gym_membership_types"."name") BETWEEN 1 AND 80),
	CONSTRAINT "gym_membership_types_kind_check" CHECK ("gym_membership_types"."kind" IN ('recurring','one_time','pack','trial')),
	CONSTRAINT "gym_membership_types_price_check" CHECK ("gym_membership_types"."price_minor" BETWEEN 0 AND 99999999),
	CONSTRAINT "gym_membership_types_currency_check" CHECK ("gym_membership_types"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "gym_membership_types_access_check" CHECK ("gym_membership_types"."access" IN ('all_classes','weekly_bookings','gym_only')),
	CONSTRAINT "gym_membership_types_weekly_check" CHECK (("gym_membership_types"."access" = 'weekly_bookings') = ("gym_membership_types"."weekly_bookings" IS NOT NULL) AND ("gym_membership_types"."weekly_bookings" IS NULL OR "gym_membership_types"."weekly_bookings" BETWEEN 1 AND 50)),
	CONSTRAINT "gym_membership_types_shape_check" CHECK (
		CASE WHEN "gym_membership_types"."kind" = 'pack' THEN
			"gym_membership_types"."pack_classes" IS NOT NULL
			AND "gym_membership_types"."pack_classes" BETWEEN 1 AND 500
			AND "gym_membership_types"."pack_days" IS NOT NULL
			AND "gym_membership_types"."pack_days" BETWEEN 1 AND 730
			AND "gym_membership_types"."term_count" IS NULL
			AND "gym_membership_types"."term_unit" IS NULL
			AND "gym_membership_types"."access" = 'all_classes'
		ELSE
			"gym_membership_types"."term_count" IS NOT NULL
			AND "gym_membership_types"."term_count" BETWEEN 1 AND 365
			AND "gym_membership_types"."term_unit" IS NOT NULL
			AND "gym_membership_types"."term_unit" IN ('day','week','month','year')
			AND NOT ("gym_membership_types"."kind" = 'recurring' AND "gym_membership_types"."term_unit" = 'day')
			AND "gym_membership_types"."pack_classes" IS NULL
			AND "gym_membership_types"."pack_days" IS NULL
		END
	)
);--> statement-breakpoint
ALTER TABLE "gym_membership_types" ADD CONSTRAINT "gym_membership_types_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- The live list, read whole and ordered by name.
CREATE INDEX "gym_membership_types_gym_idx" ON "gym_membership_types" ("gym_id","archived_at");--> statement-breakpoint
-- One live type of a name per gym, whatever its capitals: 17a-iii links a file's word to a
-- type by name, and two requests adding the same type at once make one.
CREATE UNIQUE INDEX "gym_membership_types_live_name_uq" ON "gym_membership_types" ("gym_id", lower("name")) WHERE "archived_at" IS NULL;--> statement-breakpoint

-- `gym_id` rides on the row so every read and write carries the gym in its WHERE; the
-- write takes each class from the same gym (`memberships/repo.ts`).
CREATE TABLE "gym_membership_type_classes" (
	"membership_type_id" uuid NOT NULL,
	"class_type_id" uuid NOT NULL,
	"gym_id" uuid NOT NULL,
	CONSTRAINT "gym_membership_type_classes_pk" PRIMARY KEY("membership_type_id","class_type_id")
);--> statement-breakpoint
ALTER TABLE "gym_membership_type_classes" ADD CONSTRAINT "gym_membership_type_classes_type_fk" FOREIGN KEY ("membership_type_id") REFERENCES "public"."gym_membership_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_membership_type_classes" ADD CONSTRAINT "gym_membership_type_classes_class_fk" FOREIGN KEY ("class_type_id") REFERENCES "public"."gym_class_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_membership_type_classes" ADD CONSTRAINT "gym_membership_type_classes_gym_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gym_membership_type_classes_gym_idx" ON "gym_membership_type_classes" ("gym_id");--> statement-breakpoint
CREATE INDEX "gym_membership_type_classes_class_idx" ON "gym_membership_type_classes" ("class_type_id");--> statement-breakpoint

-- A thirteenth privilege, `memberships.manage`: owner and manager by default, and the owner can
-- tick it for anyone on staff (Kd, 2026-10-04). The list below is `ORG_PRIVILEGES` in
-- `@app/shared`, and `db.migration.test.ts` reads the deployed predicate against it.
ALTER TABLE "gym_staff" DROP CONSTRAINT "gym_staff_privileges_check";--> statement-breakpoint
ALTER TABLE "gym_staff" ADD CONSTRAINT "gym_staff_privileges_check" CHECK ("gym_staff"."privileges" IS NULL OR "gym_staff"."privileges" <@ ARRAY['members.read','codes.invite','codes.manage','members.confirm','members.remove','staff.manage','org.manage','billing.manage','attendance.read','schedule.manage','attendance.mark','leaderboard.manage','memberships.manage']::text[]);--> statement-breakpoint

-- Every owner and manager row holding its own ticks gets it, as `0067` did for
-- `leaderboard.manage`. A trainer's row, a NULL set (which reads the role's defaults), and a
-- person on one of the gym's own roles (whose ticks the owner chose) are left alone.
UPDATE "gym_staff"
SET "privileges" = array_append("privileges", 'memberships.manage')
WHERE "privileges" IS NOT NULL
  AND "role" IN ('owner','manager')
  AND "role_name" IS NULL
  AND NOT ("privileges" @> ARRAY['memberships.manage']::text[]);--> statement-breakpoint

-- A manager's invitation still waiting gets it too. A gym's own saved roles, and an
-- invitation to one of them, are left alone: their ticks are the owner's own choice.
UPDATE "gym_staff_invites"
SET "privileges" = array_append("privileges", 'memberships.manage')
WHERE "state" = 'pending'
  AND "role" = 'manager'
  AND "role_name" IS NULL
  AND NOT ("privileges" @> ARRAY['memberships.manage']::text[]);
