-- Ask members to add their card (ROADMAP 18d-vii). Forward-only. Hand-written, as `0016` onwards
-- are. Its journal entry is part of this commit.
--
-- Each member asked is sent one message of the new kind `card_request` in their inbox; the row is
-- also the record that they were asked, and when, read by their page and by the box's "asked in
-- the last 7 days".
ALTER TABLE "gym_member_messages" DROP CONSTRAINT "gym_member_messages_kind_check";--> statement-breakpoint
ALTER TABLE "gym_member_messages" ADD CONSTRAINT "gym_member_messages_kind_check" CHECK ("kind" IN ('payment_overdue','membership_ending','trial_ending','trial_check_in','welcome','birthday','milestone','miss_you','review','class_reminder','group','referral_gift','card_request'));
