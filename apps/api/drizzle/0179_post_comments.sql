-- Comments and replies on a gym's Updates, and their reactions and reports (ROADMAP Stage 5
-- 17e; spec Part 3 §15.2). `parent_id` null is a comment; otherwise a reply, one level under a
-- comment. `reply_to_id` is the reply it answers, whose writer's name is read each time.
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
ALTER TABLE "gyms" ADD COLUMN "members_can_comment" boolean NOT NULL DEFAULT true;--> statement-breakpoint
CREATE TABLE "gym_post_comments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "gym_id" uuid NOT NULL REFERENCES "gyms" ("id") ON DELETE CASCADE,
  "post_id" uuid NOT NULL,
  "parent_id" uuid,
  "reply_to_id" uuid,
  "author_user_id" uuid REFERENCES "users" ("id") ON DELETE SET NULL,
  "by_member" boolean NOT NULL,
  "comment_key" uuid NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "removed_at" timestamp with time zone,
  "removed_by_user_id" uuid REFERENCES "users" ("id") ON DELETE SET NULL,
  "hidden_at" timestamp with time zone,
  CONSTRAINT "gym_post_comments_key_uq" UNIQUE ("gym_id", "comment_key"),
  CONSTRAINT "gym_post_comments_gym_id_uq" UNIQUE ("gym_id", "id"),
  CONSTRAINT "gym_post_comments_post_id_uq" UNIQUE ("gym_id", "post_id", "id"),
  CONSTRAINT "gym_post_comments_post_fk" FOREIGN KEY ("gym_id", "post_id") REFERENCES "gym_posts" ("gym_id", "id") ON DELETE CASCADE,
  CONSTRAINT "gym_post_comments_parent_fk" FOREIGN KEY ("gym_id", "post_id", "parent_id") REFERENCES "gym_post_comments" ("gym_id", "post_id", "id") ON DELETE CASCADE,
  CONSTRAINT "gym_post_comments_reply_to_fk" FOREIGN KEY ("gym_id", "reply_to_id") REFERENCES "gym_post_comments" ("gym_id", "id") ON DELETE SET NULL ("reply_to_id"),
  CONSTRAINT "gym_post_comments_body_check" CHECK (char_length("body") BETWEEN 1 AND 1000),
  CONSTRAINT "gym_post_comments_reply_to_check" CHECK ("reply_to_id" IS NULL OR "parent_id" IS NOT NULL)
);--> statement-breakpoint
CREATE INDEX "gym_post_comments_list_idx" ON "gym_post_comments" ("gym_id", "post_id", "created_at", "id") WHERE "parent_id" IS NULL AND "removed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "gym_post_comments_replies_idx" ON "gym_post_comments" ("gym_id", "parent_id", "created_at", "id") WHERE "parent_id" IS NOT NULL AND "removed_at" IS NULL;--> statement-breakpoint
-- The parent key's own: a post really deleted (a purge) finds what hangs off each comment through it.
CREATE INDEX "gym_post_comments_parent_key_idx" ON "gym_post_comments" ("gym_id", "post_id", "parent_id") WHERE "parent_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "gym_post_comments_count_idx" ON "gym_post_comments" ("gym_id", "post_id") WHERE "removed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "gym_post_comments_member_author_idx" ON "gym_post_comments" ("author_user_id", "gym_id", "created_at") WHERE "by_member";--> statement-breakpoint
CREATE INDEX "gym_post_comments_removed_by_idx" ON "gym_post_comments" ("removed_by_user_id") WHERE "removed_by_user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "gym_post_comments_reply_to_idx" ON "gym_post_comments" ("gym_id", "reply_to_id") WHERE "reply_to_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE "gym_post_comment_reactions" (
  "gym_id" uuid NOT NULL REFERENCES "gyms" ("id") ON DELETE CASCADE,
  "comment_id" uuid NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "reaction" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "gym_post_comment_reactions_pk" PRIMARY KEY ("comment_id", "user_id"),
  CONSTRAINT "gym_post_comment_reactions_comment_fk" FOREIGN KEY ("gym_id", "comment_id") REFERENCES "gym_post_comments" ("gym_id", "id") ON DELETE CASCADE,
  CONSTRAINT "gym_post_comment_reactions_reaction_check" CHECK ("reaction" IN ('like','love','strong','fire'))
);--> statement-breakpoint
CREATE INDEX "gym_post_comment_reactions_user_idx" ON "gym_post_comment_reactions" ("user_id");--> statement-breakpoint
CREATE TABLE "gym_post_comment_reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "gym_id" uuid NOT NULL REFERENCES "gyms" ("id") ON DELETE CASCADE,
  "comment_id" uuid NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "reason" text NOT NULL,
  "note" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "closed_at" timestamp with time zone,
  "outcome" text,
  CONSTRAINT "gym_post_comment_reports_comment_fk" FOREIGN KEY ("gym_id", "comment_id") REFERENCES "gym_post_comments" ("gym_id", "id") ON DELETE CASCADE,
  CONSTRAINT "gym_post_comment_reports_one_each_uq" UNIQUE ("comment_id", "user_id"),
  CONSTRAINT "gym_post_comment_reports_reason_check" CHECK ("reason" IN ('unkind','nudity','spam','other')),
  CONSTRAINT "gym_post_comment_reports_note_check" CHECK (char_length("note") BETWEEN 1 AND 300),
  CONSTRAINT "gym_post_comment_reports_outcome_check" CHECK ("outcome" IN ('removed','kept')),
  CONSTRAINT "gym_post_comment_reports_closed_check" CHECK (("closed_at" IS NULL) = ("outcome" IS NULL))
);--> statement-breakpoint
CREATE INDEX "gym_post_comment_reports_open_idx" ON "gym_post_comment_reports" ("gym_id", "comment_id") WHERE "closed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "gym_post_comment_reports_user_idx" ON "gym_post_comment_reports" ("user_id");
