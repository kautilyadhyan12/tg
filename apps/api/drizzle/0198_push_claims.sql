-- A notification taken by a worker run is settled only once a phone has it (ROADMAP Stage 5 item 18's
-- data-integrity pass). Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of
-- this commit. Numbered 0198: 18u-iv merged its 0197 first.
-- Until now taking a row marked it handled, so a worker stopped between taking it and sending lost it.
-- These columns hold the taking alone: a run that stops leaves the row owed, and past
-- `PUSH_CLAIM_MINUTES` the next run takes it again.
ALTER TABLE "gym_member_messages" ADD COLUMN "push_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gym_class_bookings" ADD COLUMN "push_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gym_event_places" ADD COLUMN "push_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gym_post_comment_notices" ADD COLUMN "claimed_at" timestamp with time zone;
