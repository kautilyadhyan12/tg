-- Staff notes and tags on a person's record (ROADMAP Stage 2 item 5d; spec Part 3 §18.13).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A note is what staff typed about one person, with who wrote it and when. It goes with
-- the record (ON DELETE CASCADE) and is moved by a join of two records. `request_key` is
-- the press that made it: the same press again adds nothing.
CREATE TABLE "gym_member_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"body" text NOT NULL,
	"author_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"request_key" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_member_notes_entry_fk" FOREIGN KEY ("gym_id", "entry_id") REFERENCES "gym_member_list_entries" ("gym_id", "id") ON DELETE CASCADE,
	CONSTRAINT "gym_member_notes_request_uq" UNIQUE ("gym_id", "request_key"),
	CONSTRAINT "gym_member_notes_body_check" CHECK (char_length("body") BETWEEN 1 AND 2000)
);--> statement-breakpoint
CREATE INDEX "gym_member_notes_entry_idx" ON "gym_member_notes" ("gym_id", "entry_id", "created_at");--> statement-breakpoint
-- A gym's own tags ("VIP", "Beginner"): one name once in a gym, whatever its capitals.
CREATE TABLE "gym_member_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL REFERENCES "gyms"("id") ON DELETE CASCADE,
	"name" text NOT NULL,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_member_tags_gym_id_uq" UNIQUE ("gym_id", "id"),
	CONSTRAINT "gym_member_tags_name_check" CHECK (char_length("name") BETWEEN 1 AND 30)
);--> statement-breakpoint
CREATE UNIQUE INDEX "gym_member_tags_name_uq" ON "gym_member_tags" ("gym_id", lower("name"));--> statement-breakpoint
-- Which record has which tag. Both ends carry the gym, so a tag is only ever on a record
-- of its own gym.
CREATE TABLE "gym_member_entry_tags" (
	"gym_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_member_entry_tags_pk" PRIMARY KEY ("entry_id", "tag_id"),
	CONSTRAINT "gym_member_entry_tags_entry_fk" FOREIGN KEY ("gym_id", "entry_id") REFERENCES "gym_member_list_entries" ("gym_id", "id") ON DELETE CASCADE,
	CONSTRAINT "gym_member_entry_tags_tag_fk" FOREIGN KEY ("gym_id", "tag_id") REFERENCES "gym_member_tags" ("gym_id", "id") ON DELETE CASCADE
);--> statement-breakpoint
CREATE INDEX "gym_member_entry_tags_tag_idx" ON "gym_member_entry_tags" ("gym_id", "tag_id");
