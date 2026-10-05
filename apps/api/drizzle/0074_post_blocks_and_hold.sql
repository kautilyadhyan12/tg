-- Block, and the bad-words hold, on a gym's Updates (ROADMAP Stage 2 item 19b-ii-b; spec
-- Part 3 §15.3).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A member's post that held a bad word waits for staff: `held_at` is when it was held,
-- `allowed_at` when staff let it through. Until then only its writer and staff see it.
ALTER TABLE "gym_posts" ADD COLUMN "held_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gym_posts" ADD COLUMN "allowed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gym_posts" ADD COLUMN "allowed_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "gym_posts" ADD CONSTRAINT "gym_posts_allowed_was_held_check" CHECK ("allowed_at" IS NULL OR "held_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "gym_posts" ADD CONSTRAINT "gym_posts_held_is_member_check" CHECK ("held_at" IS NULL OR "by_member");--> statement-breakpoint
ALTER TABLE "gym_posts" ADD CONSTRAINT "gym_posts_waiting_not_pinned_check" CHECK ("held_at" IS NULL OR "allowed_at" IS NOT NULL OR "pinned_at" IS NULL);--> statement-breakpoint
CREATE INDEX "gym_posts_waiting_idx" ON "gym_posts" ("gym_id", "held_at") WHERE "held_at" IS NOT NULL AND "allowed_at" IS NULL AND "removed_at" IS NULL;--> statement-breakpoint

-- One member has blocked another at this gym: `user_id` no longer sees
-- `blocked_user_id`'s posts or reactions there. The blocked person is never told.
CREATE TABLE "gym_post_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL REFERENCES "gyms"("id") ON DELETE CASCADE,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"blocked_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_post_blocks_one_each_uq" UNIQUE ("gym_id", "user_id", "blocked_user_id"),
	CONSTRAINT "gym_post_blocks_not_self_check" CHECK ("user_id" <> "blocked_user_id")
);--> statement-breakpoint
CREATE INDEX "gym_post_blocks_user_idx" ON "gym_post_blocks" ("user_id");--> statement-breakpoint
CREATE INDEX "gym_post_blocks_blocked_idx" ON "gym_post_blocks" ("blocked_user_id");
