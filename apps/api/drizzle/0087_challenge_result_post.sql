-- A challenge's result, posted to Updates when it ends (ROADMAP Stage 2 item 19d-ii-b; spec Part 3 §15.6).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- The post names the challenge; who won is worked out each time the post is read and is
-- never stored in it. One post a challenge for ever: a removed post keeps its row, so the
-- result is not posted again.
ALTER TABLE "gym_posts" ADD COLUMN "challenge_id" uuid;--> statement-breakpoint
ALTER TABLE "gym_posts" ADD CONSTRAINT "gym_posts_challenge_fk" FOREIGN KEY ("gym_id", "challenge_id") REFERENCES "gym_challenges" ("gym_id", "id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "gym_posts" ADD CONSTRAINT "gym_posts_challenge_gyms_check" CHECK ("challenge_id" IS NULL OR NOT "by_member");--> statement-breakpoint
CREATE UNIQUE INDEX "gym_posts_challenge_uq" ON "gym_posts" ("gym_id", "challenge_id") WHERE "challenge_id" IS NOT NULL;
