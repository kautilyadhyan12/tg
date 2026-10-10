-- Messages to a chosen group (ROADMAP Stage 2 item 20f-i; spec Part 3 §16.8).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A message staff typed for the people they chose. One row here is the message as sent;
-- each person's copy is a `gym_member_messages` row of kind `group` whose occasion is this
-- row's id, so one message can never be in one inbox twice.
CREATE TABLE "gym_group_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "gym_id" uuid NOT NULL REFERENCES "gyms" ("id") ON DELETE CASCADE,
  -- Which member of staff sent it; the gym's record, kept when their account goes.
  "sent_by" uuid REFERENCES "users" ("id") ON DELETE SET NULL,
  "body" text NOT NULL,
  -- The gym's own date it was sent on: the day's limit counts by it.
  "gym_day" date NOT NULL,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- How many people it was sent to.
  "people" integer NOT NULL,
  -- Made once for the box staff sent it from: the same press again sends nothing more.
  "send_key" uuid NOT NULL,
  CONSTRAINT "gym_group_messages_body_check" CHECK (length("body") BETWEEN 1 AND 500),
  CONSTRAINT "gym_group_messages_people_check" CHECK ("people" >= 1)
);--> statement-breakpoint
CREATE UNIQUE INDEX "gym_group_messages_key_uq" ON "gym_group_messages" ("gym_id", "send_key");--> statement-breakpoint
CREATE INDEX "gym_group_messages_day_idx" ON "gym_group_messages" ("gym_id", "gym_day");--> statement-breakpoint

ALTER TABLE "gym_member_messages" DROP CONSTRAINT "gym_member_messages_kind_check";--> statement-breakpoint
ALTER TABLE "gym_member_messages" ADD CONSTRAINT "gym_member_messages_kind_check" CHECK ("kind" IN ('payment_overdue','membership_ending','trial_ending','trial_check_in','welcome','birthday','milestone','miss_you','group'));--> statement-breakpoint

-- A kind of message a person has switched off at one gym. Only `group` is written yet;
-- the automatic kinds' own switches (20b) are rows here too.
CREATE TABLE "gym_member_messages_off" (
  "gym_id" uuid NOT NULL REFERENCES "gyms" ("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "gym_member_messages_off_pk" PRIMARY KEY ("gym_id", "user_id", "kind"),
  CONSTRAINT "gym_member_messages_off_kind_check" CHECK ("kind" IN ('membership_ending','trial_ending','trial_check_in','welcome','birthday','milestone','miss_you','group'))
);
