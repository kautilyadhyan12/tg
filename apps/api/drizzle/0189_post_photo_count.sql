-- How many photos a post was made with, kept when the post is removed: a member's ten photos a day
-- count those on removed posts too (ROADMAP Stage 5 item 17's security pass). Forward-only.
-- Hand-written, as `0016` onwards are; its journal entry is part of this commit.
ALTER TABLE "gym_posts" ADD COLUMN "photo_count" integer NOT NULL DEFAULT 0;--> statement-breakpoint
UPDATE "gym_posts" p SET "photo_count" = (SELECT count(*)::int FROM "gym_post_photos" ph WHERE ph."gym_id" = p."gym_id" AND ph."post_id" = p."id");
