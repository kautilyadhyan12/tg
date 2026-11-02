-- Phone notifications for a gym's messages (ROADMAP Stage 5 item 18b-i; spec Part 6 §6). Forward-only.
-- Hand-written, as `0016` onwards are; its journal entry is part of this commit.
-- A phone's notification address belongs to the sign-in it was given under: once that sign-in ends
-- (Sign out, or signed in on another phone), nothing more is sent to it. No route ever wrote this
-- table, so it is emptied before the column becomes required.
DELETE FROM "push_tokens";--> statement-breakpoint
ALTER TABLE "push_tokens" ADD COLUMN "family_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_platform_check" CHECK ("platform" IN ('android'));--> statement-breakpoint
CREATE INDEX "push_tokens_user_idx" ON "push_tokens" ("user_id");--> statement-breakpoint
-- When a message was handed to the phone notifications (or needed none). Every message already sent
-- counts as handled, so the first run notifies nobody about old messages.
ALTER TABLE "gym_member_messages" ADD COLUMN "push_done_at" timestamp with time zone;--> statement-breakpoint
UPDATE "gym_member_messages" SET "push_done_at" = "sent_at";--> statement-breakpoint
CREATE INDEX "gym_member_messages_push_idx" ON "gym_member_messages" ("sent_at") WHERE "push_done_at" IS NULL;
