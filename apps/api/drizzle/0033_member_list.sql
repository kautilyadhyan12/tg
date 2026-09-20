-- THE GYM'S OWN LIST OF PEOPLE (Part 3 §9.6; ROADMAP Stage 2 item 3a-iii).
-- Forward-only, three new tables and two new columns on a membership.
--
-- Hand-written, for the recorded reason `0016`-`0032` were: `drizzle/meta/`
-- stops at `0012_snapshot.json`, so `drizzle-kit generate` re-emits everything
-- since. Its journal entry is part of this commit.
--
-- WHAT CHANGES. A gym uploads the list its own software exports; the app reads
-- it, shows staff what it WOULD do, and — once they confirm — keeps it. These
-- tables are that store. Nothing here emails anybody: the gym's invite is its
-- own decision (§9.2 rule 11) and it is 3b's.
--
-- THE LIST IS THE GYM'S RECORD, HELD FOR THE GYM, and that decides the privacy
-- footing. An entry points at NO USER — it is a name, an address and a phone
-- number a gym gave us about somebody who may never have opened the app — so it
-- is not in a person's own export and the Day-14 purge does not touch it. What
-- ends it is the GYM ending: `archiveSweep.ts` deletes all three tables' rows in
-- the same transaction that archives a gym, and `ON DELETE CASCADE` is defence
-- in depth behind that. The only user link in the three is an upload's uploader,
-- which is why `gym_member_list_uploads` alone joins `privacy/tables.ts`, on
-- `gym_closures`' footing.
--
-- WHY `version` EXISTS. A preview is worked out against the list as it was. The
-- version is bumped by every change, so a confirm can say "the list I measured
-- is still the list" and refuse rather than apply a stale answer — and staff who
-- typed somebody in while reading a preview are told, instead of quietly losing
-- them.
--
-- WHY THE UPLOAD'S DOCUMENT IS SPLIT IN TWO. `summary` is counts, and the gym's
-- own status words, which say nothing about any one person; `rows` is the names,
-- addresses, phone numbers and sample cells. `rows` is emptied the moment the
-- upload is confirmed, superseded or expired, and the CHECK below makes that
-- structural rather than a promise: "confirmed, and still holding a member's
-- address" is exactly the state nothing else in the system would ever notice.
--
-- `expires_at` HAS NO DEFAULT ON PURPOSE. The expiry job and its tests drive an
-- injectable clock; a DEFAULT of `now() + interval` would be a second clock in
-- the database that no test can move.
CREATE TABLE "gym_member_lists" (
	"gym_id" uuid PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"last_confirmed_upload_id" uuid,
	"last_confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "gym_member_lists"
	ADD CONSTRAINT "gym_member_lists_gym_id_gyms_id_fk"
	FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE TABLE "gym_member_list_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"full_name" text DEFAULT '' NOT NULL,
	"email" citext,
	"phone_e164" text,
	"member_number" text,
	"status" text,
	"identity_key" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_member_list_entries_full_name_check" CHECK (length("full_name") <= 120),
	CONSTRAINT "gym_member_list_entries_email_check" CHECK ("email" IS NULL OR length("email") <= 254),
	CONSTRAINT "gym_member_list_entries_phone_check" CHECK ("phone_e164" IS NULL OR "phone_e164" ~ '^\+[1-9][0-9]{6,14}$'),
	CONSTRAINT "gym_member_list_entries_member_number_check" CHECK ("member_number" IS NULL OR length("member_number") <= 64),
	CONSTRAINT "gym_member_list_entries_status_check" CHECK ("status" IS NULL OR length("status") <= 40),
	CONSTRAINT "gym_member_list_entries_identity_key_check" CHECK ("identity_key" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "gym_member_list_entries_source_check" CHECK ("source" IN ('upload','typed','member')),
	CONSTRAINT "gym_member_list_entries_contact_check" CHECK ("email" IS NOT NULL OR "phone_e164" IS NOT NULL)
);--> statement-breakpoint
ALTER TABLE "gym_member_list_entries"
	ADD CONSTRAINT "gym_member_list_entries_gym_id_gyms_id_fk"
	FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- One person per gym, told apart by the name, email, phone and member number and
-- NOT the status (§9.5) — which is what lets a confirm's three statements run
-- twice with the same result, and what makes "Active" becoming "Expired" a
-- change in place instead of one person gone and another arrived.
CREATE UNIQUE INDEX "gym_member_list_entries_identity_uq" ON "gym_member_list_entries" ("gym_id","identity_key");--> statement-breakpoint
CREATE INDEX "gym_member_list_entries_gym_email_idx" ON "gym_member_list_entries" ("gym_id","email");--> statement-breakpoint
CREATE INDEX "gym_member_list_entries_gym_phone_idx" ON "gym_member_list_entries" ("gym_id","phone_e164");--> statement-breakpoint
-- Case folded, because two exports of one gym write "Active" and "ACTIVE" and
-- they are one word to everything that counts or filters on it.
CREATE INDEX "gym_member_list_entries_gym_status_idx" ON "gym_member_list_entries" ("gym_id",lower("status"));--> statement-breakpoint

CREATE TABLE "gym_member_list_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"status" text DEFAULT 'staged' NOT NULL,
	"mode" text NOT NULL,
	"file_kind" text NOT NULL,
	"file_sha256" text NOT NULL,
	"file_bytes" integer NOT NULL,
	"header_fingerprint" text,
	"mapping" jsonb NOT NULL,
	"base_version" integer NOT NULL,
	"summary" jsonb NOT NULL,
	"rows" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "gym_member_list_uploads_status_check" CHECK ("status" IN ('staged','confirmed','superseded','expired')),
	CONSTRAINT "gym_member_list_uploads_mode_check" CHECK ("mode" IN ('whole_list','add')),
	CONSTRAINT "gym_member_list_uploads_file_kind_check" CHECK ("file_kind" IN ('csv','xlsx')),
	CONSTRAINT "gym_member_list_uploads_file_sha256_check" CHECK ("file_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "gym_member_list_uploads_file_bytes_check" CHECK ("file_bytes" > 0 AND "file_bytes" <= 5242880),
	CONSTRAINT "gym_member_list_uploads_header_fingerprint_check" CHECK ("header_fingerprint" IS NULL OR "header_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "gym_member_list_uploads_base_version_check" CHECK ("base_version" >= 0),
	CONSTRAINT "gym_member_list_uploads_rows_only_staged_check" CHECK ("status" = 'staged' OR "rows" IS NULL),
	CONSTRAINT "gym_member_list_uploads_confirmed_at_check" CHECK (("status" = 'confirmed') = ("confirmed_at" IS NOT NULL))
);--> statement-breakpoint
ALTER TABLE "gym_member_list_uploads"
	ADD CONSTRAINT "gym_member_list_uploads_gym_id_gyms_id_fk"
	FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_member_list_uploads"
	ADD CONSTRAINT "gym_member_list_uploads_uploaded_by_user_id_users_id_fk"
	FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Partial, because a gym accumulates confirmed rows for ever and only ever has
-- ONE staged upload: the row to supersede, to read a preview back from, and the
-- row the expiry job selects.
CREATE INDEX "gym_member_list_uploads_staged_idx" ON "gym_member_list_uploads" ("gym_id","created_at" DESC) WHERE "status" = 'staged';--> statement-breakpoint
CREATE INDEX "gym_member_list_uploads_expiry_idx" ON "gym_member_list_uploads" ("expires_at") WHERE "status" = 'staged';--> statement-breakpoint
CREATE INDEX "gym_member_list_uploads_gym_created_idx" ON "gym_member_list_uploads" ("gym_id","created_at" DESC);--> statement-breakpoint

-- THE TWO COLUMNS ON A MEMBERSHIP (§9.6). Both NULL for everybody, and neither
-- is back-filled: nothing honest can be.
--
-- `stated_phone_e164` is the phone number a person gave the GYM, and the second
-- way a member is matched to an uploaded list after their verified email (§9.7).
-- A gym's export often holds a phone number and no address, and the app asks
-- nobody for a phone number, so without it a whole export can match nobody. It
-- is written when somebody joins by a gym code and is asked (3c) — never
-- guessed, and never copied off the list itself, which would make "is this
-- member on the list" answer itself.
--
-- `last_listed_at` is what tells "dropped off the list" from "never was on it".
-- A member with it set and no entry matching them today is `no longer listed`,
-- which is the one thing staff act on; a member without it was never listed and
-- is nobody's mistake. A gym that has never confirmed a list has no marks at
-- all, which is why this is NULL rather than a false "never listed" flag.
ALTER TABLE "gym_members" ADD COLUMN "stated_phone_e164" text;--> statement-breakpoint
ALTER TABLE "gym_members" ADD COLUMN "last_listed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gym_members"
	ADD CONSTRAINT "gym_members_stated_phone_check"
	CHECK ("stated_phone_e164" IS NULL OR "stated_phone_e164" ~ '^\+[1-9][0-9]{6,14}$');--> statement-breakpoint
-- Partial on both conditions: only live memberships are ever matched, and today
-- every row's number is NULL, so the index stays empty until 3c starts asking.
CREATE INDEX "gym_members_gym_stated_phone_idx" ON "gym_members" ("gym_id","stated_phone_e164") WHERE "removed_at" IS NULL AND "stated_phone_e164" IS NOT NULL;
