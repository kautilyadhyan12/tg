-- A gym gone for good (ROADMAP Stage 4 item 14; Kd, RULINGS 2026-10-02). Forward-only.
-- Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A gym with no paid plan and no sign-in from its staff for 6 months is emailed a month
-- and a week before, then its member list, leads and staff invitations are deleted
-- (`modules/orgs/goneForGood/`). One row a gym, made the first time it comes due.
-- `counted_from` is the later of the plan's end and the last sign-in when the row was
-- written; a sign-in or a plan since moves it, and the two emails start again. The day
-- the list was deleted is kept through that, for the Members page.
CREATE TABLE "gym_gone_for_good" (
	"gym_id" uuid PRIMARY KEY NOT NULL,
	"counted_from" timestamp with time zone NOT NULL,
	"deletes_at" timestamp with time zone,
	"month_claimed_at" timestamp with time zone,
	"month_sent_at" timestamp with time zone,
	"month_recipients" integer,
	"week_claimed_at" timestamp with time zone,
	"week_sent_at" timestamp with time zone,
	"week_recipients" integer,
	"list_deleted_at" timestamp with time zone,
	CONSTRAINT "gym_gone_for_good_month_check" CHECK ("month_sent_at" IS NULL OR ("month_claimed_at" IS NOT NULL AND "deletes_at" IS NOT NULL AND "month_recipients" >= 0)),
	CONSTRAINT "gym_gone_for_good_week_check" CHECK ("week_claimed_at" IS NULL OR "month_sent_at" IS NOT NULL),
	CONSTRAINT "gym_gone_for_good_week_sent_check" CHECK ("week_sent_at" IS NULL OR ("week_claimed_at" IS NOT NULL AND "week_recipients" >= 0))
);
--> statement-breakpoint
ALTER TABLE "gym_gone_for_good" ADD CONSTRAINT "gym_gone_for_good_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- A gym's staff being used is read from `users.last_active_at` (written at every sign-in and
-- session renewal from now on, `auth/repo.ts`), never from `refresh_tokens`, whose rows the
-- spec's retention removes (Part 4 §5.1). The sign-ins already kept are carried in.
UPDATE "users" u SET "last_active_at" = r.last_used
FROM (SELECT "user_id", max("created_at") AS last_used FROM "refresh_tokens" GROUP BY "user_id") r
WHERE r."user_id" = u."id" AND (u."last_active_at" IS NULL OR u."last_active_at" < r.last_used);
