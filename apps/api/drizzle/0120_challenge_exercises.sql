-- The exercise a challenge is about (ROADMAP Stage 2 item 19d-iii-a-ii; spec Part 3 §15.10.2).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A challenge about an exercise (`subject` 'exercise') has one row here for the exercise the
-- gym picked from the library; up to ten from 19d-iii-c. Rows, never an array of ids, so each
-- names a real exercise. No challenge made before this has one: nothing is moved.
CREATE TABLE "gym_challenge_exercises" (
	"gym_id" uuid NOT NULL,
	"challenge_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	CONSTRAINT "gym_challenge_exercises_pk" PRIMARY KEY ("challenge_id", "exercise_id")
);--> statement-breakpoint
ALTER TABLE "gym_challenge_exercises" ADD CONSTRAINT "gym_challenge_exercises_challenge_fk" FOREIGN KEY ("gym_id", "challenge_id") REFERENCES "public"."gym_challenges"("gym_id", "id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_challenge_exercises" ADD CONSTRAINT "gym_challenge_exercises_exercise_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;
