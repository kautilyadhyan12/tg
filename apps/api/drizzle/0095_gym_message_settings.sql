-- A gym's own settings for its automatic messages (ROADMAP Stage 2 item 20b-i; spec Part 3 §16.2).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- One row a gym a kind: on or off, the gym's one line of its own, and the kind's number
-- (`days` for a kind that waits days, `milestones` for the visits it marks). A kind with
-- no row has its starting values, so no row is written for any gym here.
CREATE TABLE "gym_message_settings" (
  "gym_id" uuid NOT NULL REFERENCES "gyms" ("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "is_on" boolean DEFAULT true NOT NULL,
  "own_line" text,
  "days" integer,
  "milestones" integer[],
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "gym_message_settings_pk" PRIMARY KEY ("gym_id", "kind"),
  CONSTRAINT "gym_message_settings_kind_check" CHECK ("kind" IN ('payment_overdue','membership_ending','trial_ending','trial_check_in','welcome','birthday','milestone','miss_you')),
  CONSTRAINT "gym_message_settings_own_line_check" CHECK ("own_line" IS NULL OR length("own_line") BETWEEN 1 AND 140),
  CONSTRAINT "gym_message_settings_days_check" CHECK ("days" IS NULL OR "days" BETWEEN 1 AND 90),
  CONSTRAINT "gym_message_settings_milestones_check" CHECK ("milestones" IS NULL OR (cardinality("milestones") BETWEEN 1 AND 10 AND 1 <= ALL ("milestones")))
);--> statement-breakpoint

-- The last day, on the gym's own calendar, on which the sender read everybody in the gym.
-- That read is made once a day; the row is removed when the gym changes its settings.
CREATE TABLE "gym_message_days" (
  "gym_id" uuid PRIMARY KEY NOT NULL REFERENCES "gyms" ("id") ON DELETE CASCADE,
  "day" date NOT NULL
);
