-- Members post on their gym's Updates, Report, and the staff queue (ROADMAP Stage 2 item
-- 19b-ii-a; spec Part 3 §15.2, §15.3).
-- Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- The gym's switch: whether its members may post. Off to start.
ALTER TABLE "gyms" ADD COLUMN "members_can_post" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- A member's own post, as against one by the gym's staff. It is the person's: shown only
-- while they are a live member of the gym, and deleted with their account.
ALTER TABLE "gym_posts" ADD COLUMN "by_member" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "gym_posts_member_author_idx" ON "gym_posts" ("author_user_id", "gym_id", "created_at" DESC) WHERE "by_member";--> statement-breakpoint

-- One report a person a post. Open until staff remove the post or keep it; a closed one is
-- kept, so the same person reporting the same post again changes nothing. `note`: what
-- the person typed beside their reason, if anything.
CREATE TABLE "gym_post_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL REFERENCES "gyms"("id") ON DELETE CASCADE,
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"reason" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"outcome" text,
	CONSTRAINT "gym_post_reports_post_fk" FOREIGN KEY ("gym_id", "post_id") REFERENCES "gym_posts" ("gym_id", "id") ON DELETE CASCADE,
	CONSTRAINT "gym_post_reports_one_each_uq" UNIQUE ("post_id", "user_id"),
	CONSTRAINT "gym_post_reports_reason_check" CHECK ("reason" IN ('unkind','photo_of_someone','nudity','spam','other')),
	CONSTRAINT "gym_post_reports_note_check" CHECK (char_length("note") BETWEEN 1 AND 300),
	CONSTRAINT "gym_post_reports_outcome_check" CHECK ("outcome" IN ('removed','kept')),
	CONSTRAINT "gym_post_reports_closed_check" CHECK (("closed_at" IS NULL) = ("outcome" IS NULL))
);--> statement-breakpoint
CREATE INDEX "gym_post_reports_open_idx" ON "gym_post_reports" ("gym_id", "post_id") WHERE "closed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "gym_post_reports_user_idx" ON "gym_post_reports" ("user_id");--> statement-breakpoint

-- A person the gym has stopped posting. Who stopped them is in `audit_log`.
CREATE TABLE "gym_post_stops" (
	"gym_id" uuid NOT NULL REFERENCES "gyms"("id") ON DELETE CASCADE,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_post_stops_pk" PRIMARY KEY ("gym_id", "user_id")
);--> statement-breakpoint
CREATE INDEX "gym_post_stops_user_idx" ON "gym_post_stops" ("user_id");
