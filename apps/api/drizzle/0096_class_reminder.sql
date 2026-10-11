-- The class reminder (ROADMAP Stage 2 item 20b-iii; spec Part 3 §16.2).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A ninth kind of automatic message, `class_reminder`: a row in a member's inbox, a kind a
-- member can switch off, and a kind a gym sets. Each list of kinds is a CHECK, so each is
-- written again with the new kind in it; no row is changed.
ALTER TABLE "gym_member_messages" DROP CONSTRAINT "gym_member_messages_kind_check";--> statement-breakpoint
ALTER TABLE "gym_member_messages" ADD CONSTRAINT "gym_member_messages_kind_check" CHECK ("kind" IN ('payment_overdue','membership_ending','trial_ending','trial_check_in','welcome','birthday','milestone','miss_you','class_reminder','group'));--> statement-breakpoint
ALTER TABLE "gym_member_messages_off" DROP CONSTRAINT "gym_member_messages_off_kind_check";--> statement-breakpoint
ALTER TABLE "gym_member_messages_off" ADD CONSTRAINT "gym_member_messages_off_kind_check" CHECK ("kind" IN ('membership_ending','trial_ending','trial_check_in','welcome','birthday','milestone','miss_you','class_reminder','group'));--> statement-breakpoint
ALTER TABLE "gym_message_settings" DROP CONSTRAINT "gym_message_settings_kind_check";--> statement-breakpoint
ALTER TABLE "gym_message_settings" ADD CONSTRAINT "gym_message_settings_kind_check" CHECK ("kind" IN ('payment_overdue','membership_ending','trial_ending','trial_check_in','welcome','birthday','milestone','miss_you','class_reminder'));--> statement-breakpoint

-- The reminder's number is a count of hours before the start, kept beside `days`.
ALTER TABLE "gym_message_settings" ADD COLUMN "hours" integer;--> statement-breakpoint
ALTER TABLE "gym_message_settings" ADD CONSTRAINT "gym_message_settings_hours_check" CHECK ("hours" IS NULL OR "hours" BETWEEN 1 AND 48);--> statement-breakpoint

-- The sender asks, four times an hour, for a gym's sessions that start soon. The
-- classes have their index by start already (`gym_class_sessions_gym_starts_idx`).
CREATE INDEX "gym_pt_appointments_gym_starts_idx" ON "gym_pt_appointments" ("gym_id", "starts_at");
