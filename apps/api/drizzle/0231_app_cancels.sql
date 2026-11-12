-- Cancel in the app (ROADMAP Stage 2 item 18l; Kd, rulings/2026-11-11-18l.md; spec Part 3 §14.8). Forward-only.
-- Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A member, or whoever pays for them, cancels a membership in the app. The membership itself changes as the front
-- desk's Cancel changes it; this row is what the gym is told: when, the way it was cancelled, its last day, who pressed
-- it (their account, and their record on the gym's list), the reason they picked afterwards, and when the confirmation
-- email went, with what it says (`said`: the box's sentences), so one sent again says all of it. The same press sent
-- twice is one row (`request_key`); a membership is cancelled in the app once. A record deleted for good lets go of
-- `by_entry_id`; the membership going takes its row with it.
CREATE TABLE "gym_app_cancels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"held_membership_id" uuid NOT NULL,
	"by_entry_id" uuid,
	"user_id" uuid,
	"request_key" uuid NOT NULL,
	"when" text NOT NULL,
	"ends_on" date NOT NULL,
	"cancelled_on" date NOT NULL,
	"reason" text,
	"reason_at" timestamp with time zone,
	"emailed_at" timestamp with time zone,
	"said" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_app_cancels_when_check" CHECK ("when" IN ('cooling_off','period_end','today','notice','contract_end','leave_early')),
	CONSTRAINT "gym_app_cancels_reason_check" CHECK (("reason" IS NULL) = ("reason_at" IS NULL) AND ("reason" IS NULL OR "reason" IN ('moving','cost','not_using','other_gym','service','other'))),
	CONSTRAINT "gym_app_cancels_days_check" CHECK ("ends_on" >= "cancelled_on")
);--> statement-breakpoint
ALTER TABLE "gym_app_cancels" ADD CONSTRAINT "gym_app_cancels_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_app_cancels" ADD CONSTRAINT "gym_app_cancels_held_fk" FOREIGN KEY ("gym_id","held_membership_id") REFERENCES "public"."gym_held_memberships"("gym_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_app_cancels" ADD CONSTRAINT "gym_app_cancels_by_entry_fk" FOREIGN KEY ("gym_id","by_entry_id") REFERENCES "public"."gym_member_list_entries"("gym_id","id") ON DELETE SET NULL ("by_entry_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_app_cancels" ADD CONSTRAINT "gym_app_cancels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- The same press sent twice is one cancel; a membership is cancelled in the app once.
CREATE UNIQUE INDEX "gym_app_cancels_request_uq" ON "gym_app_cancels" USING btree ("gym_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "gym_app_cancels_held_uq" ON "gym_app_cancels" USING btree ("gym_id","held_membership_id");--> statement-breakpoint
-- Overview's Cancelled in the app reads a gym's newest.
CREATE INDEX "gym_app_cancels_recent_idx" ON "gym_app_cancels" USING btree ("gym_id","created_at");
