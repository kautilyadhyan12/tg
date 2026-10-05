-- A post five people have reported is hidden until staff decide (ROADMAP 19b-vi; spec Part 3
-- §15.3). The moment is kept on the post, so a reporter whose account is later deleted
-- does not bring the post back: only Keep clears it.
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
ALTER TABLE "gym_posts" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
UPDATE "gym_posts" p SET "hidden_at" = now()
WHERE p."removed_at" IS NULL
  AND (SELECT count(*) FROM "gym_post_reports" r WHERE r."gym_id" = p."gym_id" AND r."post_id" = p."id" AND r."closed_at" IS NULL) >= 5;
