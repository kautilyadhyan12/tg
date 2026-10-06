-- "I'm coming" on a gym's event (ROADMAP Stage 2 item 19c-ii; spec Part 3 §15.4).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- One person's place at one event, as `gym_class_bookings` keeps a class's: `seq` is the
-- order rows were made in, which is the waitlist's order. `entry_id`: the person's record
-- on the gym's list when they said so; it lets go when the record is deleted.
-- `request_key` is the request that made the row and `claim_key` the request that claimed
-- its place from the waitlist: either one arriving again finds the place and changes nothing.
CREATE TABLE "gym_event_places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
	"gym_id" uuid NOT NULL REFERENCES "gyms"("id") ON DELETE CASCADE,
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id"),
	"entry_id" uuid,
	"status" text NOT NULL,
	"request_key" uuid NOT NULL,
	"claim_key" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"coming_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "gym_event_places_event_fk" FOREIGN KEY ("gym_id", "event_id") REFERENCES "gym_events" ("gym_id", "id") ON DELETE CASCADE,
	CONSTRAINT "gym_event_places_entry_fk" FOREIGN KEY ("gym_id", "entry_id") REFERENCES "gym_member_list_entries" ("gym_id", "id") ON DELETE SET NULL ("entry_id"),
	CONSTRAINT "gym_event_places_request_uq" UNIQUE ("gym_id", "request_key"),
	CONSTRAINT "gym_event_places_claim_uq" UNIQUE ("gym_id", "claim_key"),
	CONSTRAINT "gym_event_places_status_check" CHECK ("status" IN ('coming','waitlisted','cancelled')),
	CONSTRAINT "gym_event_places_coming_check" CHECK ("status" <> 'coming' OR "coming_at" IS NOT NULL),
	CONSTRAINT "gym_event_places_cancelled_check" CHECK (("status" = 'cancelled') = ("cancelled_at" IS NOT NULL))
);--> statement-breakpoint
-- One place a person an event at a time; a cancelled one is history and they may come again.
CREATE UNIQUE INDEX "gym_event_places_live_uq" ON "gym_event_places" ("event_id", "user_id") WHERE "status" IN ('coming','waitlisted');--> statement-breakpoint
CREATE INDEX "gym_event_places_event_idx" ON "gym_event_places" ("gym_id", "event_id", "status", "seq");--> statement-breakpoint
CREATE INDEX "gym_event_places_user_idx" ON "gym_event_places" ("user_id", "gym_id");--> statement-breakpoint
CREATE INDEX "gym_event_places_entry_idx" ON "gym_event_places" ("gym_id", "entry_id") WHERE "entry_id" IS NOT NULL;
