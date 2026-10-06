-- Personal training (ROADMAP Stage 2 item 17e-i; spec Part 3 §13.5).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
-- Written as `0077`; renumbered when `0077_post_hidden_at` merged first.
--
-- gym_trainers          a member of staff who takes personal training, and their session length;
-- gym_trainer_hours     the hours they offer, by weekday, on the gym's own clock;
-- gym_pt_appointments   one session booked for one person on the gym's list.

-- The exclusion constraints below compare a uuid for equality inside a GiST index,
-- which Postgres does through this extension (part of Postgres itself, nothing installed).
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint

-- A membership type says whether it includes personal training. "Every class" does not.
ALTER TABLE "gym_membership_types" ADD COLUMN "includes_pt" boolean DEFAULT false NOT NULL;--> statement-breakpoint

CREATE TABLE "gym_trainers" (
	"gym_id" uuid NOT NULL REFERENCES "gyms"("id") ON DELETE CASCADE,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"offers" boolean DEFAULT true NOT NULL,
	"session_minutes" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_trainers_pk" PRIMARY KEY ("gym_id", "user_id"),
	CONSTRAINT "gym_trainers_minutes_check" CHECK ("session_minutes" BETWEEN 10 AND 240 AND "session_minutes" % 5 = 0)
);--> statement-breakpoint

-- ISO weekday, Monday 1 to Sunday 7, as `gym_class_schedules` counts them. Minutes are
-- from midnight on the gym's clock. Two ranges of one trainer on one weekday never overlap.
CREATE TABLE "gym_trainer_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"weekday" integer NOT NULL,
	"from_minute" integer NOT NULL,
	"to_minute" integer NOT NULL,
	CONSTRAINT "gym_trainer_hours_trainer_fk" FOREIGN KEY ("gym_id", "user_id") REFERENCES "gym_trainers" ("gym_id", "user_id") ON DELETE CASCADE,
	CONSTRAINT "gym_trainer_hours_weekday_check" CHECK ("weekday" BETWEEN 1 AND 7),
	CONSTRAINT "gym_trainer_hours_range_check" CHECK ("from_minute" >= 0 AND "from_minute" < "to_minute" AND "to_minute" <= 1440),
	CONSTRAINT "gym_trainer_hours_no_overlap" EXCLUDE USING gist (
		"gym_id" WITH =, "user_id" WITH =, "weekday" WITH =, int4range("from_minute", "to_minute") WITH &&
	)
);--> statement-breakpoint

-- `entry_id` is the person's record on the gym's list, so somebody without the app can be
-- booked; it and `trainer_user_id` let go when the record or the account is deleted, and the
-- row stays, since a pack may have been charged for it. `held_membership_id` is the
-- membership it was booked on, the one a pack's session is given back to. `request_key` is
-- the request that made the row: the same request again finds it and changes nothing.
--
-- The EXCLUDE constraint is the rule itself: one trainer is never in two sessions at once.
-- A cancelled session holds no time. One person in two sessions at once is refused by the
-- booking rule and not here: two records of one person, joined later, may each hold one.
CREATE TABLE "gym_pt_appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL REFERENCES "gyms"("id") ON DELETE CASCADE,
	"trainer_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"entry_id" uuid,
	"held_membership_id" uuid REFERENCES "gym_held_memberships"("id") ON DELETE SET NULL,
	"local_date" date NOT NULL,
	"local_start_minute" integer NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"minutes" integer NOT NULL,
	"status" text NOT NULL,
	"pack_charged" boolean DEFAULT false NOT NULL,
	"request_key" uuid NOT NULL,
	"booked_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "gym_pt_appointments_entry_fk" FOREIGN KEY ("gym_id", "entry_id") REFERENCES "gym_member_list_entries" ("gym_id", "id") ON DELETE SET NULL ("entry_id"),
	CONSTRAINT "gym_pt_appointments_request_uq" UNIQUE ("gym_id", "request_key"),
	CONSTRAINT "gym_pt_appointments_status_check" CHECK ("status" IN ('booked','cancelled','late_cancelled','attended','no_show')),
	CONSTRAINT "gym_pt_appointments_cancelled_check" CHECK (("status" IN ('cancelled','late_cancelled')) = ("cancelled_at" IS NOT NULL)),
	CONSTRAINT "gym_pt_appointments_time_check" CHECK ("minutes" BETWEEN 10 AND 240 AND "minutes" % 5 = 0 AND "ends_at" > "starts_at" AND "local_start_minute" BETWEEN 0 AND 1439),
	CONSTRAINT "gym_pt_appointments_trainer_no_overlap" EXCLUDE USING gist (
		"gym_id" WITH =, "trainer_user_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&
	) WHERE ("status" IN ('booked','attended','no_show'))
);--> statement-breakpoint
CREATE INDEX "gym_pt_appointments_trainer_idx" ON "gym_pt_appointments" ("gym_id", "trainer_user_id", "starts_at");--> statement-breakpoint
CREATE INDEX "gym_pt_appointments_entry_idx" ON "gym_pt_appointments" ("gym_id", "entry_id", "starts_at") WHERE "entry_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "gym_pt_appointments_held_idx" ON "gym_pt_appointments" ("held_membership_id") WHERE "held_membership_id" IS NOT NULL;
