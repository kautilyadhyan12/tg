-- Ask for a review (ROADMAP Stage 2 item 20e-i; spec Part 3 §16.2).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A tenth kind of automatic message, `review`: a row in a member's inbox, a kind a member
-- can switch off, and a kind a gym sets. Each list of kinds is a CHECK, so each is written
-- again with the new kind in it; no row is changed.
ALTER TABLE "gym_member_messages" DROP CONSTRAINT "gym_member_messages_kind_check";--> statement-breakpoint
ALTER TABLE "gym_member_messages" ADD CONSTRAINT "gym_member_messages_kind_check" CHECK ("kind" IN ('payment_overdue','membership_ending','trial_ending','trial_check_in','welcome','birthday','milestone','miss_you','review','class_reminder','group'));--> statement-breakpoint
ALTER TABLE "gym_member_messages_off" DROP CONSTRAINT "gym_member_messages_off_kind_check";--> statement-breakpoint
ALTER TABLE "gym_member_messages_off" ADD CONSTRAINT "gym_member_messages_off_kind_check" CHECK ("kind" IN ('membership_ending','trial_ending','trial_check_in','welcome','birthday','milestone','miss_you','review','class_reminder','group'));--> statement-breakpoint
ALTER TABLE "gym_message_settings" DROP CONSTRAINT "gym_message_settings_kind_check";--> statement-breakpoint
ALTER TABLE "gym_message_settings" ADD CONSTRAINT "gym_message_settings_kind_check" CHECK ("kind" IN ('payment_overdue','membership_ending','trial_ending','trial_check_in','welcome','birthday','milestone','miss_you','review','class_reminder'));--> statement-breakpoint

-- The gym's number of visits before it asks, and its review link: on the review's own row only.
ALTER TABLE "gym_message_settings" ADD COLUMN "visits" integer;--> statement-breakpoint
ALTER TABLE "gym_message_settings" ADD COLUMN "link" text;--> statement-breakpoint
ALTER TABLE "gym_message_settings" ADD CONSTRAINT "gym_message_settings_visits_check" CHECK ("visits" IS NULL OR ("kind" = 'review' AND "visits" BETWEEN 1 AND 1000));--> statement-breakpoint
ALTER TABLE "gym_message_settings" ADD CONSTRAINT "gym_message_settings_link_check" CHECK ("link" IS NULL OR ("kind" = 'review' AND length("link") BETWEEN 9 AND 500 AND "link" LIKE 'https://%'));--> statement-breakpoint

-- The link a message's button opens, kept with the message as it was sent: the gym's own
-- review link, read from that gym's row by the sender.
ALTER TABLE "gym_member_messages" ADD COLUMN "link" text;--> statement-breakpoint
ALTER TABLE "gym_member_messages" ADD CONSTRAINT "gym_member_messages_link_check" CHECK ("link" IS NULL OR ("kind" = 'review' AND length("link") BETWEEN 9 AND 500 AND "link" LIKE 'https://%'));
