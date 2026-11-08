-- The gym's meal plan as a choice in Recommended For You (ROADMAP Stage 5 item 31g; spec Part 6 §16.6).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A pick of the gym's plan names the gym: a member of two gyms picks one of them. The gym's row going
-- takes the pick with it, and the person is back to the choice the app starts at.
ALTER TABLE "recommended_choices" ADD COLUMN "gym_id" uuid REFERENCES "gyms"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "recommended_choices" DROP CONSTRAINT "recommended_choices_choice_check";--> statement-breakpoint
ALTER TABLE "recommended_choices" ADD CONSTRAINT "recommended_choices_choice_check" CHECK ("choice" IN ('suggested','mine','gym'));--> statement-breakpoint
ALTER TABLE "recommended_choices" ADD CONSTRAINT "recommended_choices_gym_check" CHECK (("choice" = 'gym') = ("gym_id" IS NOT NULL));
