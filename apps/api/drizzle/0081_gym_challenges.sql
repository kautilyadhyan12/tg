-- A gym's challenges (ROADMAP Stage 2 item 19d-i; spec Part 3 §15.6).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A challenge's first and last day are days on the gym's own calendar, both counted.
-- `counts` is which of the leaderboard's checked facts it counts; `target` is the number
-- to reach, null where the most wins. Nothing of a board is stored: it is worked out from
-- the visits and workouts each time it is read (§15.5). `counts` 'own' is the gym's own
-- count: `unit` is its word for what is counted, staff type each person's number
-- (`gym_challenge_scores`), and `lowest_wins` turns the order round for a fastest time.
CREATE TABLE "gym_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL REFERENCES "gyms"("id") ON DELETE CASCADE,
	"challenge_key" uuid NOT NULL,
	"name" text NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"prize" text DEFAULT '' NOT NULL,
	"counts" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"target" integer,
	"who" text NOT NULL,
	"unit" text DEFAULT '' NOT NULL,
	"lowest_wins" boolean DEFAULT false NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_challenges_gym_id_uq" UNIQUE ("gym_id", "id"),
	CONSTRAINT "gym_challenges_key_uq" UNIQUE ("gym_id", "challenge_key"),
	CONSTRAINT "gym_challenges_name_check" CHECK (char_length("name") BETWEEN 1 AND 80),
	CONSTRAINT "gym_challenges_details_check" CHECK (char_length("details") <= 500),
	CONSTRAINT "gym_challenges_prize_check" CHECK (char_length("prize") <= 120),
	CONSTRAINT "gym_challenges_counts_check" CHECK ("counts" IN ('gym_days','workout_days','own')),
	CONSTRAINT "gym_challenges_who_check" CHECK ("who" IN ('everyone','joined')),
	CONSTRAINT "gym_challenges_days_check" CHECK ("ends_on" >= "starts_on" AND "ends_on" - "starts_on" < 366),
	CONSTRAINT "gym_challenges_target_check" CHECK (
		"target" IS NULL OR ("counts" = 'own' AND "target" BETWEEN 1 AND 1000000) OR ("counts" <> 'own' AND "target" BETWEEN 1 AND "ends_on" - "starts_on" + 1)
	),
	CONSTRAINT "gym_challenges_unit_check" CHECK (char_length("unit") <= 30 AND ("counts" = 'own') = ("unit" <> '')),
	CONSTRAINT "gym_challenges_lowest_check" CHECK (NOT "lowest_wins" OR ("counts" = 'own' AND "target" IS NULL))
);--> statement-breakpoint
CREATE INDEX "gym_challenges_ends_idx" ON "gym_challenges" ("gym_id", "ends_on");--> statement-breakpoint
-- Who joined a challenge people join. One row a person a challenge: joining twice is once.
CREATE TABLE "gym_challenge_people" (
	"gym_id" uuid NOT NULL REFERENCES "gyms"("id") ON DELETE CASCADE,
	"challenge_id" uuid NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_challenge_people_pk" PRIMARY KEY ("challenge_id", "user_id"),
	CONSTRAINT "gym_challenge_people_challenge_fk" FOREIGN KEY ("gym_id", "challenge_id") REFERENCES "gym_challenges" ("gym_id", "id") ON DELETE CASCADE
);--> statement-breakpoint
CREATE INDEX "gym_challenge_people_user_idx" ON "gym_challenge_people" ("user_id");--> statement-breakpoint
-- A person's number in a challenge of the gym's own count, typed by staff. One a person a
-- challenge; who typed it is in the audit log.
CREATE TABLE "gym_challenge_scores" (
	"gym_id" uuid NOT NULL REFERENCES "gyms"("id") ON DELETE CASCADE,
	"challenge_id" uuid NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"value" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_challenge_scores_pk" PRIMARY KEY ("challenge_id", "user_id"),
	CONSTRAINT "gym_challenge_scores_challenge_fk" FOREIGN KEY ("gym_id", "challenge_id") REFERENCES "gym_challenges" ("gym_id", "id") ON DELETE CASCADE,
	CONSTRAINT "gym_challenge_scores_value_check" CHECK ("value" BETWEEN 1 AND 1000000)
);--> statement-breakpoint
CREATE INDEX "gym_challenge_scores_user_idx" ON "gym_challenge_scores" ("user_id");
