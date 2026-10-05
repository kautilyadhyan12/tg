-- Booking a class, and its waitlist (ROADMAP Stage 2 item 17c-i; spec Part 3 §13.4).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- The gym's own booking settings, each at its starting value (RULINGS 2026-09-21): booking
-- opens 7 days before, cancelling is free until 2 hours before, a freed place is handed to
-- the first in line while the class is more than 1 day away, the waitlist holds 20.
ALTER TABLE "gyms" ADD COLUMN "booking_opens_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "gyms" ADD COLUMN "booking_free_cancel_minutes" integer DEFAULT 120 NOT NULL;--> statement-breakpoint
ALTER TABLE "gyms" ADD COLUMN "waitlist_handover_minutes" integer DEFAULT 1440 NOT NULL;--> statement-breakpoint
ALTER TABLE "gyms" ADD COLUMN "waitlist_max" integer DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE "gyms" ADD CONSTRAINT "gyms_booking_settings_check" CHECK (
	"booking_opens_days" BETWEEN 1 AND 56
	AND "booking_free_cancel_minutes" BETWEEN 0 AND 10080
	AND "waitlist_handover_minutes" BETWEEN 0 AND 10080
	AND "waitlist_max" BETWEEN 0 AND 100
);--> statement-breakpoint

-- What a booking's class key points at, with its gym.
ALTER TABLE "gym_class_sessions" ADD CONSTRAINT "gym_class_sessions_gym_id_uq" UNIQUE ("gym_id", "id");--> statement-breakpoint

-- One person's booking of one class. `seq` is the order rows were made in, which is the
-- waitlist's order. A class with a booking cannot be deleted from under it (no cascade on
-- the class): a pack's charge would go with it.
-- `entry_id`: the person's record on the gym's list when they booked; it lets go when the
-- record is deleted. `held_membership_id`: the membership the booking is on, the one a
-- pack's class is given back to. `request_key` is the request that made the row and
-- `claim_key` the request that claimed its place from the waitlist: either one arriving
-- again finds the booking and changes nothing.
CREATE TABLE "gym_class_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
	"gym_id" uuid NOT NULL REFERENCES "gyms"("id") ON DELETE CASCADE,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id"),
	"entry_id" uuid,
	"held_membership_id" uuid REFERENCES "gym_held_memberships"("id") ON DELETE SET NULL,
	"status" text NOT NULL,
	"pack_charged" boolean DEFAULT false NOT NULL,
	"request_key" uuid NOT NULL,
	"claim_key" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"booked_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "gym_class_bookings_session_fk" FOREIGN KEY ("gym_id", "session_id") REFERENCES "gym_class_sessions" ("gym_id", "id"),
	CONSTRAINT "gym_class_bookings_entry_fk" FOREIGN KEY ("gym_id", "entry_id") REFERENCES "gym_member_list_entries" ("gym_id", "id") ON DELETE SET NULL ("entry_id"),
	CONSTRAINT "gym_class_bookings_request_uq" UNIQUE ("gym_id", "request_key"),
	CONSTRAINT "gym_class_bookings_claim_uq" UNIQUE ("gym_id", "claim_key"),
	CONSTRAINT "gym_class_bookings_status_check" CHECK ("status" IN ('booked','waitlisted','cancelled','late_cancelled','attended','no_show')),
	CONSTRAINT "gym_class_bookings_booked_check" CHECK ("status" NOT IN ('booked','attended','no_show','late_cancelled') OR "booked_at" IS NOT NULL),
	CONSTRAINT "gym_class_bookings_cancelled_check" CHECK (("status" IN ('cancelled','late_cancelled')) = ("cancelled_at" IS NOT NULL)),
	CONSTRAINT "gym_class_bookings_pack_check" CHECK (NOT "pack_charged" OR "booked_at" IS NOT NULL)
);--> statement-breakpoint
-- One booking a person a class at a time; a cancelled one is history and they may book again.
CREATE UNIQUE INDEX "gym_class_bookings_live_uq" ON "gym_class_bookings" ("session_id", "user_id") WHERE "status" IN ('booked','waitlisted','attended','no_show');--> statement-breakpoint
CREATE INDEX "gym_class_bookings_session_idx" ON "gym_class_bookings" ("gym_id", "session_id", "status", "seq");--> statement-breakpoint
CREATE INDEX "gym_class_bookings_user_idx" ON "gym_class_bookings" ("user_id", "gym_id");--> statement-breakpoint
CREATE INDEX "gym_class_bookings_entry_idx" ON "gym_class_bookings" ("gym_id", "entry_id") WHERE "entry_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "gym_class_bookings_held_idx" ON "gym_class_bookings" ("held_membership_id") WHERE "held_membership_id" IS NOT NULL;
