-- Teams in a challenge (ROADMAP Stage 2 item 19d-ii-a; spec Part 3 §15.6).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- `teams`: 'none' people are in it alone · 'staff' the gym's staff put people in teams ·
-- 'members' people pick their own. A team's number is its people's numbers added together,
-- worked out each time it is read; nothing of it is stored. A team's target is not bound
-- by the challenge's days, since several people's days are added.
ALTER TABLE "gym_challenges" ADD COLUMN "teams" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_challenges" ADD CONSTRAINT "gym_challenges_teams_check" CHECK ("teams" IN ('none','staff','members'));--> statement-breakpoint
ALTER TABLE "gym_challenges" DROP CONSTRAINT "gym_challenges_target_check";--> statement-breakpoint
ALTER TABLE "gym_challenges" ADD CONSTRAINT "gym_challenges_target_check" CHECK (
	"target" IS NULL
	OR (("counts" = 'own' OR "teams" <> 'none') AND "target" BETWEEN 1 AND 1000000)
	OR ("counts" <> 'own' AND "teams" = 'none' AND "target" BETWEEN 1 AND "ends_on" - "starts_on" + 1)
);--> statement-breakpoint
-- A challenge's teams, in the gym's order. The name is at most 40 characters as a person
-- counts them; the check allows the code points an emoji takes.
CREATE TABLE "gym_challenge_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL REFERENCES "gyms"("id") ON DELETE CASCADE,
	"challenge_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_challenge_teams_challenge_fk" FOREIGN KEY ("gym_id", "challenge_id") REFERENCES "gym_challenges" ("gym_id", "id") ON DELETE CASCADE,
	CONSTRAINT "gym_challenge_teams_of_uq" UNIQUE ("challenge_id", "id"),
	CONSTRAINT "gym_challenge_teams_name_check" CHECK (char_length("name") BETWEEN 1 AND 160),
	CONSTRAINT "gym_challenge_teams_position_check" CHECK ("position" BETWEEN 0 AND 7)
);--> statement-breakpoint
CREATE INDEX "gym_challenge_teams_challenge_idx" ON "gym_challenge_teams" ("gym_id", "challenge_id");--> statement-breakpoint
-- Who is in which team. One row a person a challenge: a person is in one team at most, and
-- only in a team of that same challenge.
CREATE TABLE "gym_challenge_team_people" (
	"gym_id" uuid NOT NULL REFERENCES "gyms"("id") ON DELETE CASCADE,
	"challenge_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_challenge_team_people_pk" PRIMARY KEY ("challenge_id", "user_id"),
	CONSTRAINT "gym_challenge_team_people_challenge_fk" FOREIGN KEY ("gym_id", "challenge_id") REFERENCES "gym_challenges" ("gym_id", "id") ON DELETE CASCADE,
	CONSTRAINT "gym_challenge_team_people_team_fk" FOREIGN KEY ("challenge_id", "team_id") REFERENCES "gym_challenge_teams" ("challenge_id", "id") ON DELETE CASCADE
);--> statement-breakpoint
CREATE INDEX "gym_challenge_team_people_user_idx" ON "gym_challenge_team_people" ("user_id");--> statement-breakpoint
CREATE INDEX "gym_challenge_team_people_team_idx" ON "gym_challenge_team_people" ("team_id");
