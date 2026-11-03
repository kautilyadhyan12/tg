-- Recommended For You's choice, kept for each kind (ROADMAP Stage 5 item 31f; spec Part 6 §16.6).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
-- Numbered 0200 because two open pull requests (18v-i and phone 18) each hold a 0198.
--
-- One row per person and kind once they have picked: `suggested` (the app's own) or `mine` (their
-- own plan). The gym's plan (ROADMAP 31g) widens the CHECK in its own migration, with the choice the
-- server reads. No row means not picked yet, and the server works out where it starts. Food now;
-- workout and running join with items 36 and 37.
CREATE TABLE "recommended_choices" (
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "kind" text NOT NULL,
  "choice" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "recommended_choices_pkey" PRIMARY KEY ("user_id", "kind"),
  CONSTRAINT "recommended_choices_kind_check" CHECK ("kind" IN ('food','workout','running')),
  CONSTRAINT "recommended_choices_choice_check" CHECK ("choice" IN ('suggested','mine'))
);
