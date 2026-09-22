-- THE WIDER MEMBER RECORD, KEPT (Part 3 §11.1, §11.4, §11.5; ROADMAP Stage 2
-- item 3a-v-b). Forward-only: nine new columns on an entry, one new table.
--
-- Hand-written, for the recorded reason `0016`-`0034` were: `drizzle/meta/`
-- stops at `0012_snapshot.json`, so `drizzle-kit generate` re-emits everything
-- since. Its journal entry is part of this commit.
--
-- WHAT CHANGES, IN ONE SENTENCE. 3a-v-a taught the file reader to read a gym's
-- whole row; this is where that row is KEPT, and where a person who leaves the
-- list stops being deleted.
--
-- THE FIVE NEW STANDARD FIELDS ARE THE GYM'S OWN, and the app attaches no
-- meaning to any of them (§11.1). `membership_type` and `payment_status` are
-- words the gym wrote ("Gold", "Overdue"), compared with case and spaces folded
-- and shown in the file's own first spelling, each capped like `status`. A
-- payment word is never read as a state of membership, and no status is ever
-- worked out from a date (§11.11's rule, §9.11's limit).
--
-- WHY `date` AND NOT `timestamptz`. A join date and a birthday are the same day
-- in every country, so they carry no time and no zone: a timestamp would need
-- one to be read back, and day maths through a zone that was never the gym's is
-- the shape this repo's date rules exist to forbid (CLAUDE.md §4).
--
-- WHY `ends_on_kind` IS ON THE ENTRY and not on the upload, though it is one
-- answer for a COLUMN: the gym's next export can say the other thing, 3a-iv's
-- typed-in person has no column at all, and a screen showing one person has to
-- know whether to print "Renews 3 Oct" or "Ends 3 Oct" without fetching the file
-- the person came from. Its CHECK pairs it with the day, because "Renews" beside
-- no date is half a sentence.
--
-- WHY THE GYM'S OWN COLUMNS ARE ONE DOCUMENT AND A CATALOGUE. Every screen that
-- shows one of these people shows ALL of their fields at once (§11.6), so a row
-- per field would be forty rows to join for one person and four hundred thousand
-- for a list of ten thousand, and nothing in this build filters on one of them
-- (§11.1: "not filter chips in the first build"). The catalogue holds the
-- HEADING the gym wrote and the key the document is written under — built from
-- the heading, never from where the column sat, so next month's export with its
-- columns reordered lands in the same fields.
--
-- THE CATALOGUE HAS ITS OWN CEILING AND IT IS NOT THE FILE'S. One upload is
-- capped at forty of the gym's columns by the reader; the catalogue is not
-- replaced by a whole-list upload — a gym that exports a narrower report has not
-- stopped keeping the columns it leaves out — so without a cap of its own a gym
-- uploading differently-shaped exports would accumulate fields without limit,
-- which is an unbounded document on every one of its people. The cap is applied
-- in code (`repo.reconcileFields`), where a gym's rows can be counted; a CHECK
-- cannot, because counting a jsonb object's keys needs a set-returning function
-- and a CHECK may hold no subquery. A document's keys are only ever written from
-- the catalogue, so the ceiling holds by construction.
--
-- WHY NOBODY IS DELETED ANY MORE. §9.2 rule 2 had a confirm delete the people a
-- whole-list upload no longer holds, on the reasoning that the gym's own
-- software is the record of yesterday. That is true of a LIST and false of a
-- management app: the visits, the reports and a returning member's history hang
-- off this row (§11.1, agreed with Kd on 2026-09-21 beside Part 3). So they are
-- marked `former_at` instead. **The UNIQUE on `(gym_id, identity_key)` already
-- covers a former row, and that is exactly what makes a returning person the
-- SAME record** — the upload that holds them again clears the column rather than
-- inserting somebody new.
--
-- WHY `hand_edited` HOLDS NAMES AND NOT VALUES. It answers one question — would
-- this file write over something a member of staff typed here — and the values
-- needed to answer it are both already present, the file's and the column's. A
-- third copy of a person's phone number kept only to guard the second is one
-- more place it can leak from (§11.4, §11.6).
--
-- NO NEW INDEX, AND THAT IS MEASURED RATHER THAN ASSUMED. The two reads that
-- learn these filters (`GET /` and `GET /entries`, §11.5) walk this gym's own
-- entries once whatever they are asked, because the total is counted over the
-- same filtered set the page is cut from and neither the email nor the id is in
-- the `(gym_id, lower(status))` index either (§9.9's own note on it). An index on
-- `lower(membership_type)` would be a second index nothing reads. What bounds
-- these reads is the pool of ONE connection (ROADMAP Stage 4 item 11).
--
-- Existing rows take the defaults, which say what is true of them: no wider
-- fields were ever read for them, they are on the list, and nobody has edited
-- them by hand. Production launches empty (RULINGS 2026-07-13).
ALTER TABLE "gym_member_list_entries" ADD COLUMN "membership_type" text;--> statement-breakpoint
ALTER TABLE "gym_member_list_entries" ADD COLUMN "joined_on" date;--> statement-breakpoint
ALTER TABLE "gym_member_list_entries" ADD COLUMN "ends_on" date;--> statement-breakpoint
ALTER TABLE "gym_member_list_entries" ADD COLUMN "ends_on_kind" text;--> statement-breakpoint
ALTER TABLE "gym_member_list_entries" ADD COLUMN "payment_status" text;--> statement-breakpoint
ALTER TABLE "gym_member_list_entries" ADD COLUMN "date_of_birth" date;--> statement-breakpoint
ALTER TABLE "gym_member_list_entries" ADD COLUMN "extra" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_member_list_entries" ADD COLUMN "former_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gym_member_list_entries" ADD COLUMN "hand_edited" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint

ALTER TABLE "gym_member_list_entries"
	ADD CONSTRAINT "gym_member_list_entries_membership_type_check"
	CHECK ("membership_type" IS NULL OR length("membership_type") <= 40);--> statement-breakpoint
ALTER TABLE "gym_member_list_entries"
	ADD CONSTRAINT "gym_member_list_entries_payment_status_check"
	CHECK ("payment_status" IS NULL OR length("payment_status") <= 40);--> statement-breakpoint
ALTER TABLE "gym_member_list_entries"
	ADD CONSTRAINT "gym_member_list_entries_ends_on_kind_check"
	CHECK ("ends_on_kind" IS NULL OR "ends_on_kind" IN ('ends','renews'));--> statement-breakpoint
ALTER TABLE "gym_member_list_entries"
	ADD CONSTRAINT "gym_member_list_entries_ends_on_kind_needs_day_check"
	CHECK ("ends_on_kind" IS NULL OR "ends_on" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "gym_member_list_entries"
	ADD CONSTRAINT "gym_member_list_entries_extra_object_check"
	CHECK (jsonb_typeof("extra") = 'object');--> statement-breakpoint
ALTER TABLE "gym_member_list_entries"
	ADD CONSTRAINT "gym_member_list_entries_hand_edited_check"
	CHECK (array_length("hand_edited", 1) IS NULL OR array_length("hand_edited", 1) <= 52);--> statement-breakpoint

CREATE TABLE "gym_member_list_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"ord" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_member_list_fields_key_check" CHECK ("key" ~ '^[a-z0-9_]{1,64}$'),
	CONSTRAINT "gym_member_list_fields_label_check" CHECK (length("label") <= 80),
	CONSTRAINT "gym_member_list_fields_ord_check" CHECK ("ord" >= 0)
);--> statement-breakpoint
ALTER TABLE "gym_member_list_fields"
	ADD CONSTRAINT "gym_member_list_fields_gym_id_gyms_id_fk"
	FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gym_member_list_fields_key_uq" ON "gym_member_list_fields" ("gym_id","key");--> statement-breakpoint
CREATE INDEX "gym_member_list_fields_gym_ord_idx" ON "gym_member_list_fields" ("gym_id","ord");
