-- Keep my membership (ROADMAP Stage 2 item 18l-ii-a; Kd, rulings/2026-11-11-18l.md). Forward-only.
-- Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A member who cancelled in the app, or whoever pays for them, undoes it there until its last day. The cancel's row is
-- kept and says when it was kept, by whom (their account, and their record on the gym's list), what the box said
-- (`keep_said`) and when its confirmation went. The same press sent twice is one keep (`keep_request_key`). Kept, the
-- membership can be cancelled in the app again: one open cancel a membership, any number kept. The bookings the cancel
-- ended are counted on it (`ended_classes`, `ended_sessions`), so the keep box says they stay cancelled.
ALTER TABLE "gym_app_cancels" ADD COLUMN "ended_classes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_app_cancels" ADD COLUMN "ended_sessions" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "gym_app_cancels" ADD COLUMN "kept_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gym_app_cancels" ADD COLUMN "kept_on" date;--> statement-breakpoint
ALTER TABLE "gym_app_cancels" ADD COLUMN "kept_by_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "gym_app_cancels" ADD COLUMN "kept_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "gym_app_cancels" ADD COLUMN "keep_request_key" uuid;--> statement-breakpoint
ALTER TABLE "gym_app_cancels" ADD COLUMN "keep_said" jsonb;--> statement-breakpoint
ALTER TABLE "gym_app_cancels" ADD COLUMN "keep_emailed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "gym_app_cancels" ADD CONSTRAINT "gym_app_cancels_ended_check" CHECK ("ended_classes" >= 0 AND "ended_sessions" >= 0);--> statement-breakpoint
ALTER TABLE "gym_app_cancels" ADD CONSTRAINT "gym_app_cancels_kept_check" CHECK (
	("kept_at" IS NULL) = ("kept_on" IS NULL)
	AND ("kept_at" IS NULL) = ("keep_request_key" IS NULL)
	AND ("kept_at" IS NULL) = ("keep_said" IS NULL)
	AND ("kept_at" IS NOT NULL OR ("kept_by_entry_id" IS NULL AND "kept_by_user_id" IS NULL AND "keep_emailed_at" IS NULL))
	AND ("kept_on" IS NULL OR "kept_on" >= "cancelled_on")
);--> statement-breakpoint
ALTER TABLE "gym_app_cancels" ADD CONSTRAINT "gym_app_cancels_kept_by_entry_fk" FOREIGN KEY ("gym_id","kept_by_entry_id") REFERENCES "public"."gym_member_list_entries"("gym_id","id") ON DELETE SET NULL ("kept_by_entry_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_app_cancels" ADD CONSTRAINT "gym_app_cancels_kept_by_user_id_users_id_fk" FOREIGN KEY ("kept_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- One open cancel a membership; once kept, it can be cancelled in the app again.
DROP INDEX "gym_app_cancels_held_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "gym_app_cancels_held_uq" ON "gym_app_cancels" USING btree ("gym_id","held_membership_id") WHERE "kept_at" IS NULL;--> statement-breakpoint
-- The same Keep press sent twice is one keep.
CREATE UNIQUE INDEX "gym_app_cancels_keep_request_uq" ON "gym_app_cancels" USING btree ("gym_id","keep_request_key") WHERE "keep_request_key" IS NOT NULL;
