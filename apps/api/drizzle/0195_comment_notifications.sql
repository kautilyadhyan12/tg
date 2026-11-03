-- A comment or reply on your post, told to the phone (ROADMAP Stage 5 item 18b-ii-b). Forward-only.
-- Hand-written, as `0016` onwards are; its journal entry is part of this commit.
-- One row for each person a new comment is owed to: the writer of the member's post it is on, and of
-- the member's comment or reply it answers; never its own writer. Written in the comment's own step.
-- `done_at`: the worker took it (sent, or nothing still true to send). `told_at`: a phone has it, so
-- the same person's next comments notification in that gym waits out the half hour. `seen_at`: the
-- person opened that gym's Updates since, so the next notification's count no longer holds it.
CREATE TABLE "gym_post_comment_notices" (
	"gym_id" uuid NOT NULL,
	"comment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone,
	"told_at" timestamp with time zone,
	"seen_at" timestamp with time zone,
	CONSTRAINT "gym_post_comment_notices_pk" PRIMARY KEY ("comment_id", "user_id")
);--> statement-breakpoint
ALTER TABLE "gym_post_comment_notices" ADD CONSTRAINT "gym_post_comment_notices_gym_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_post_comment_notices" ADD CONSTRAINT "gym_post_comment_notices_comment_fk" FOREIGN KEY ("gym_id", "comment_id") REFERENCES "public"."gym_post_comments"("gym_id", "id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_post_comment_notices" ADD CONSTRAINT "gym_post_comment_notices_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gym_post_comment_notices_due_idx" ON "gym_post_comment_notices" ("created_at", "user_id", "gym_id") WHERE "done_at" IS NULL;--> statement-breakpoint
CREATE INDEX "gym_post_comment_notices_told_idx" ON "gym_post_comment_notices" ("user_id", "gym_id", "told_at") WHERE "told_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "gym_post_comment_notices_unseen_idx" ON "gym_post_comment_notices" ("user_id", "gym_id") WHERE "seen_at" IS NULL;--> statement-breakpoint
CREATE INDEX "gym_post_comment_notices_done_idx" ON "gym_post_comment_notices" ("done_at") WHERE "done_at" IS NOT NULL;
