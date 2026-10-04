-- A list's membership word linked to a type (ROADMAP Stage 2 item 17a-iii; spec Part 3 §13.2).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- gym_membership_word_links  which type a gym linked one of its list's words to.

-- `word_key` is the word as the list's chips fold it (`lower`), so "Gold" and "GOLD" are one
-- word and "Gold Plus" is another; `word` is the spelling the list wrote first. One link a
-- word: the people who carry it are given the type when staff press Link, never by an import.
CREATE TABLE "gym_membership_word_links" (
	"gym_id" uuid NOT NULL REFERENCES "gyms"("id") ON DELETE CASCADE,
	"word_key" text NOT NULL,
	"word" text NOT NULL,
	"membership_type_id" uuid NOT NULL,
	"linked_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_membership_word_links_pk" PRIMARY KEY ("gym_id", "word_key"),
	CONSTRAINT "gym_membership_word_links_word_check" CHECK (char_length("word") BETWEEN 1 AND 40),
	CONSTRAINT "gym_membership_word_links_key_check" CHECK ("word_key" = lower("word"))
);--> statement-breakpoint
-- With its gym, so a link cannot name another gym's type.
ALTER TABLE "gym_membership_word_links" ADD CONSTRAINT "gym_membership_word_links_type_fk" FOREIGN KEY ("gym_id", "membership_type_id") REFERENCES "public"."gym_membership_types"("gym_id", "id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gym_membership_word_links_type_idx" ON "gym_membership_word_links" ("gym_id", "membership_type_id");--> statement-breakpoint
CREATE INDEX "gym_membership_word_links_linked_by_idx" ON "gym_membership_word_links" ("linked_by");--> statement-breakpoint

-- A membership whose start day was worked back from the list's own end-or-renewal day, so
-- no screen prints it as the day the person started. One linked with no day on the list
-- starts on the day it was linked, and is false here.
ALTER TABLE "gym_held_memberships" ADD COLUMN "from_list" boolean DEFAULT false NOT NULL;
