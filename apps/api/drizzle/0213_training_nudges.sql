-- The streak reminder, badges and the Sunday summary (ROADMAP Stage 5 item 19e-ii). Forward-only.
-- Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- Three switches on the account, each on until switched off (Kd, 2026-11-06). `recent_pushes`: when the
-- newest three notifications of any kind reached the person's phone, so these three give way to the
-- others. `nudge_day`: the person's own day one of the three last went (at most one a day).
-- `summary_week`: the Monday of the week whose summary went or was skipped. `told_at` on a badge: when
-- its notification went; badges earned before this job are marked told, so none of them is sent.
ALTER TABLE "users" ADD COLUMN "push_streak" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "push_badges" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "push_summary" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "recent_pushes" timestamp with time zone[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "nudge_day" date;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "summary_week" date;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_recent_pushes_check" CHECK (cardinality("recent_pushes") <= 3);--> statement-breakpoint
ALTER TABLE "user_achievements" ADD COLUMN "told_at" timestamp with time zone;--> statement-breakpoint
UPDATE "user_achievements" SET "told_at" = "earned_at";--> statement-breakpoint
CREATE INDEX "user_achievements_untold_idx" ON "user_achievements" USING btree ("user_id") WHERE "told_at" IS NULL;
