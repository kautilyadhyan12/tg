-- The phone notifications a person lets the app send (ROADMAP Stage 5 item 19d). Forward-only.
-- Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- One switch for each kind the app sends: a gym's messages, a place in a class or an event, a comment
-- or reply on the person's post. Each is on until the person switches it off in Settings; off, the
-- sender finds no phone for that kind. A gym's messages still reach its Inbox.
ALTER TABLE "users" ADD COLUMN "push_gym_messages" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "push_places" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "push_comments" boolean DEFAULT true NOT NULL;
