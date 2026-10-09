-- A gym's messages to a member, in the app (ROADMAP Stage 2 item 20a; spec Part 3 §16.1).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- One row is one message, and one message is ever sent for (gym, person, kind, occasion):
-- the unique index is what makes a job that runs twice send once. A message leaves the
-- inbox at `expires_at` and its row stays, so the occasion is never sent again. `gym_day`
-- is the gym's own date it was sent on, for "one automatic message a day".
CREATE TABLE "gym_member_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "gym_id" uuid NOT NULL REFERENCES "gyms" ("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "occasion" text NOT NULL,
  "body" text NOT NULL,
  "gym_day" date NOT NULL,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL,
  "read_at" timestamp with time zone,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "gym_member_messages_kind_check" CHECK ("kind" IN ('payment_overdue','membership_ending','trial_ending','trial_check_in','welcome','birthday','milestone','miss_you')),
  CONSTRAINT "gym_member_messages_occasion_check" CHECK (length("occasion") BETWEEN 1 AND 80),
  CONSTRAINT "gym_member_messages_body_check" CHECK (length("body") BETWEEN 1 AND 500),
  CONSTRAINT "gym_member_messages_expires_check" CHECK ("expires_at" > "sent_at")
);--> statement-breakpoint
CREATE UNIQUE INDEX "gym_member_messages_occasion_uq" ON "gym_member_messages" ("gym_id", "user_id", "kind", "occasion");--> statement-breakpoint
CREATE INDEX "gym_member_messages_inbox_idx" ON "gym_member_messages" ("user_id", "gym_id", "sent_at" DESC);
