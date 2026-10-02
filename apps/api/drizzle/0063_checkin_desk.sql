-- Check-in at the front desk (ROADMAP Stage 2 item 16a; spec Part 3 §12.3, §12.6).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A gym's desk devices: each has a key that can only check people in, opened once from a
-- one-time link, and both are stored as SHA-256 hashes. A visit now hangs on the member's
-- RECORD, so a person without the app is counted: `user_id` becomes optional beside the
-- new `entry_id`, and a scan names the device that read it.
CREATE TABLE "gym_checkin_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL REFERENCES "gyms"("id") ON DELETE CASCADE,
	"name" text NOT NULL,
	"key_hash" text,
	"link_hash" text,
	"link_expires_at" timestamp with time zone,
	"created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"last_seen_at" timestamp with time zone,
	"switched_off_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_checkin_devices_gym_id_uq" UNIQUE ("gym_id", "id"),
	CONSTRAINT "gym_checkin_devices_name_check" CHECK (char_length("name") BETWEEN 1 AND 60),
	CONSTRAINT "gym_checkin_devices_key_hash_check" CHECK ("key_hash" IS NULL OR "key_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "gym_checkin_devices_link_hash_check" CHECK ("link_hash" IS NULL OR "link_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "gym_checkin_devices_link_pairing_check" CHECK (("link_hash" IS NULL) = ("link_expires_at" IS NULL)),
	-- A device switched off holds no key and no link: nothing it was given still works.
	CONSTRAINT "gym_checkin_devices_off_check" CHECK ("switched_off_at" IS NULL OR ("key_hash" IS NULL AND "link_hash" IS NULL))
);--> statement-breakpoint
CREATE UNIQUE INDEX "gym_checkin_devices_key_hash_uq" ON "gym_checkin_devices" ("key_hash") WHERE "key_hash" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "gym_checkin_devices_link_hash_uq" ON "gym_checkin_devices" ("link_hash") WHERE "link_hash" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "gym_checkin_devices_gym_idx" ON "gym_checkin_devices" ("gym_id", "created_at");--> statement-breakpoint

ALTER TABLE "gym_attendance" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_attendance" ALTER COLUMN "marked_by_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_attendance" ADD COLUMN "entry_id" uuid;--> statement-breakpoint
ALTER TABLE "gym_attendance" ADD COLUMN "device_id" uuid;--> statement-breakpoint
-- Deleting a record for good deletes the visits only it holds; a visit that also names
-- an app account is let go of the record first (`memberList/repo.ts` `deleteEntry`).
ALTER TABLE "gym_attendance" ADD CONSTRAINT "gym_attendance_entry_fk" FOREIGN KEY ("gym_id", "entry_id") REFERENCES "gym_member_list_entries" ("gym_id", "id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "gym_attendance" ADD CONSTRAINT "gym_attendance_device_fk" FOREIGN KEY ("gym_id", "device_id") REFERENCES "gym_checkin_devices" ("gym_id", "id");--> statement-breakpoint
ALTER TABLE "gym_attendance" DROP CONSTRAINT "gym_attendance_method_check";--> statement-breakpoint
ALTER TABLE "gym_attendance" ADD CONSTRAINT "gym_attendance_method_check" CHECK ("method" IN ('manual','qr','pass','key_tag','staff'));--> statement-breakpoint
ALTER TABLE "gym_attendance" ADD CONSTRAINT "gym_attendance_who_check" CHECK ("user_id" IS NOT NULL OR "entry_id" IS NOT NULL);--> statement-breakpoint
-- A desk's scan names its device and no person marked it; anything else names who did.
ALTER TABLE "gym_attendance" ADD CONSTRAINT "gym_attendance_how_check" CHECK (
	("method" IN ('pass','key_tag') AND "device_id" IS NOT NULL AND "marked_by_user_id" IS NULL)
	OR ("method" IN ('manual','qr','staff') AND "device_id" IS NULL AND "marked_by_user_id" IS NOT NULL)
);--> statement-breakpoint
-- One visit a record a period, as `gym_attendance_gym_user_day_slot_uq` is for an account.
CREATE UNIQUE INDEX "gym_attendance_gym_entry_day_slot_uq" ON "gym_attendance" ("gym_id", "entry_id", "day", "slot_key") WHERE "entry_id" IS NOT NULL;
