-- A gym's events (ROADMAP Stage 2 item 19c-i; spec Part 3 §15.4).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- An event's day and time are kept as the gym's own clock reads them (`starts_on`,
-- `start_minute`), and as the instants worked out from them in the gym's time zone when it
-- was saved (`starts_at`, `ends_at`), which is what "coming" and "ended" compare against.
-- Its poster, where it has one, is one file in the photo store under `poster_key`.
CREATE TABLE "gym_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL REFERENCES "gyms"("id") ON DELETE CASCADE,
	"event_key" uuid NOT NULL,
	"name" text NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"place" text DEFAULT '' NOT NULL,
	"starts_on" date NOT NULL,
	"start_minute" smallint NOT NULL,
	"ends_on" date NOT NULL,
	"end_minute" smallint NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"places" integer,
	"poster_id" uuid,
	"poster_key" text,
	"poster_type" text,
	"poster_bytes" integer,
	"poster_width" integer,
	"poster_height" integer,
	"cancelled_at" timestamp with time zone,
	"created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_events_gym_id_uq" UNIQUE ("gym_id", "id"),
	CONSTRAINT "gym_events_event_key_uq" UNIQUE ("gym_id", "event_key"),
	CONSTRAINT "gym_events_poster_key_uq" UNIQUE ("poster_key"),
	CONSTRAINT "gym_events_name_check" CHECK (char_length("name") BETWEEN 1 AND 80),
	CONSTRAINT "gym_events_details_check" CHECK (char_length("details") <= 2000),
	CONSTRAINT "gym_events_place_check" CHECK (char_length("place") <= 120),
	CONSTRAINT "gym_events_minutes_check" CHECK ("start_minute" BETWEEN 0 AND 1439 AND "end_minute" BETWEEN 0 AND 1439),
	CONSTRAINT "gym_events_order_check" CHECK ("ends_at" > "starts_at"),
	CONSTRAINT "gym_events_places_check" CHECK ("places" IS NULL OR "places" BETWEEN 1 AND 10000),
	CONSTRAINT "gym_events_poster_whole_check" CHECK (
		num_nulls("poster_id", "poster_key", "poster_type", "poster_bytes", "poster_width", "poster_height") IN (0, 6)
	),
	CONSTRAINT "gym_events_poster_type_check" CHECK ("poster_type" IS NULL OR "poster_type" IN ('image/jpeg','image/png','image/webp')),
	CONSTRAINT "gym_events_poster_size_check" CHECK ("poster_bytes" IS NULL OR "poster_bytes" BETWEEN 1 AND 2097152),
	CONSTRAINT "gym_events_poster_width_check" CHECK ("poster_width" IS NULL OR "poster_width" BETWEEN 1 AND 8000),
	CONSTRAINT "gym_events_poster_height_check" CHECK ("poster_height" IS NULL OR "poster_height" BETWEEN 1 AND 8000)
);--> statement-breakpoint
CREATE INDEX "gym_events_coming_idx" ON "gym_events" ("gym_id", "ends_at");
