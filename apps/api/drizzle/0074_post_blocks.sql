-- Block on a gym's Updates (ROADMAP Stage 2 item 19b-ii-b; spec Part 3 §15.3). The
-- bad-words check of the same job keeps nothing: a post it refuses is never stored.
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
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
