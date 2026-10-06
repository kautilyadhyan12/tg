-- A trainer's time off (ROADMAP Stage 2 item 17e-iii-b; spec Part 3 §13.5).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- Whole days of the gym's (`from_date` to `to_date`, both minutes null) or some hours of one
-- day. `starts_at` and `ends_at` are that time as instants in the gym's zone, worked out when
-- it is added: what a booking and the free times are compared with. It goes with the
-- trainer's row. `request_key` is the request that made it: the same request again adds nothing.
-- Two times off of one trainer may overlap; nothing is counted from them.
CREATE TABLE "gym_trainer_time_off" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"from_minute" integer,
	"to_minute" integer,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"request_key" uuid NOT NULL,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_trainer_time_off_trainer_fk" FOREIGN KEY ("gym_id", "user_id") REFERENCES "gym_trainers" ("gym_id", "user_id") ON DELETE CASCADE,
	CONSTRAINT "gym_trainer_time_off_request_uq" UNIQUE ("gym_id", "request_key"),
	CONSTRAINT "gym_trainer_time_off_days_check" CHECK ("to_date" >= "from_date"),
	CONSTRAINT "gym_trainer_time_off_hours_check" CHECK (
		("from_minute" IS NULL AND "to_minute" IS NULL)
		OR ("from_minute" IS NOT NULL AND "to_minute" IS NOT NULL AND "from_date" = "to_date"
			AND "from_minute" >= 0 AND "from_minute" < "to_minute" AND "to_minute" <= 1440)
	),
	CONSTRAINT "gym_trainer_time_off_span_check" CHECK ("ends_at" > "starts_at")
);--> statement-breakpoint
CREATE INDEX "gym_trainer_time_off_trainer_idx" ON "gym_trainer_time_off" ("gym_id", "user_id", "ends_at");
