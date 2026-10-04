-- Fixing a visit (ROADMAP Stage 2 item 19a-iv; spec Part 3 §12.5, §15.5).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A visit staff add on a later day has no known hour: `added_later`, which is also its
-- `slot_key` (`gym_attendance_slot_key_agrees_check`), so a person has at most one a day.
ALTER TABLE "gym_attendance" DROP CONSTRAINT "gym_attendance_hours_status_check";--> statement-breakpoint
ALTER TABLE "gym_attendance" ADD CONSTRAINT "gym_attendance_hours_status_check" CHECK ("gym_attendance"."hours_status" IN ('in_session','open_24h','outside_hours','closed_day','hours_unset','added_later'));--> statement-breakpoint
ALTER TABLE "gym_attendance" ADD CONSTRAINT "gym_attendance_added_later_check" CHECK ("gym_attendance"."hours_status" <> 'added_later' OR "gym_attendance"."method" = 'staff');--> statement-breakpoint

-- A visit staff removed: taken out of `gym_attendance`, so nothing counts it, and kept
-- here under its own id with who removed it and when, for the person's "what counted".
CREATE TABLE "gym_attendance_removed" (
	"id" uuid PRIMARY KEY NOT NULL,
	"gym_id" uuid NOT NULL REFERENCES "gyms"("id") ON DELETE CASCADE,
	"user_id" uuid REFERENCES "users"("id"),
	"entry_id" uuid,
	"device_id" uuid,
	"marked_by_user_id" uuid REFERENCES "users"("id"),
	"day" date NOT NULL,
	"marked_at" timestamp with time zone NOT NULL,
	"method" text NOT NULL,
	"hours_status" text NOT NULL,
	"removed_by_user_id" uuid NOT NULL REFERENCES "users"("id"),
	"removed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_attendance_removed_who_check" CHECK ("user_id" IS NOT NULL OR "entry_id" IS NOT NULL),
	-- The same two lists as `gym_attendance`: a value added there is added here in the same
	-- migration, or a removal of such a visit is refused (`db.migration.test.ts` compares them).
	CONSTRAINT "gym_attendance_removed_method_check" CHECK ("method" IN ('manual','qr','pass','key_tag','staff')),
	CONSTRAINT "gym_attendance_removed_hours_status_check" CHECK ("hours_status" IN ('in_session','open_24h','outside_hours','closed_day','hours_unset','added_later')),
	-- As `gym_attendance_entry_fk`: a record deleted for good takes the rows only it holds.
	CONSTRAINT "gym_attendance_removed_entry_fk" FOREIGN KEY ("gym_id", "entry_id") REFERENCES "gym_member_list_entries" ("gym_id", "id") ON DELETE CASCADE,
	CONSTRAINT "gym_attendance_removed_device_fk" FOREIGN KEY ("gym_id", "device_id") REFERENCES "gym_checkin_devices" ("gym_id", "id")
);--> statement-breakpoint
CREATE INDEX "gym_attendance_removed_gym_user_idx" ON "gym_attendance_removed" ("gym_id", "user_id", "day");--> statement-breakpoint
CREATE INDEX "gym_attendance_removed_gym_entry_idx" ON "gym_attendance_removed" ("gym_id", "entry_id", "day") WHERE "entry_id" IS NOT NULL;
