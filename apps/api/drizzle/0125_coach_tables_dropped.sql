-- The chat coach's old tables emptied (ROADMAP Stage 1 item 9b; Kd, 2026-10-15: the coach
-- is deleted, and its old chats with it). Forward-only. Hand-written, as `0016` onwards are;
-- its journal entry is part of this commit.
--
-- Nothing outside these three tables references them: coach_messages points at
-- coach_threads, and coach_threads at users. The plans keep every other limit; only the
-- unused `coach` key goes. The "first chat" badge goes with the chats it counted.
DROP TABLE "coach_messages";--> statement-breakpoint
DROP TABLE "coach_threads";--> statement-breakpoint
DROP TABLE "kb_chunks";--> statement-breakpoint
UPDATE "plans" SET "entitlements" = "entitlements" - 'coach' WHERE "entitlements" ? 'coach';--> statement-breakpoint
UPDATE "plans" SET "member_entitlements" = "member_entitlements" - 'coach' WHERE "member_entitlements" ? 'coach';--> statement-breakpoint
DELETE FROM "user_achievements" WHERE "code" = 'first_chat';--> statement-breakpoint
DELETE FROM "achievements" WHERE "code" = 'first_chat';
