-- Undo cancellation, for staff (ROADMAP Stage 2 item 18l-ii-b; Kd, rulings/2026-11-11-18l.md). Forward-only.
-- Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A membership the front desk cancelled to end on a later day is undone by staff until that day. This row is that
-- cancel: who pressed it, the ways it was cancelled (`ways`: staff may end it sooner after giving notice, or leave early
-- after ending it with the minimum term, and the undo puts back every one), the soonest last day it was given (the bills
-- it took off are those after it; null where it was frozen, so no bill was taken off), and the bookings it ended. Undone,
-- the row says when, the gym's day and by whom; the same press sent twice is one undo (`undo_request_key`). One open
-- cancel a membership, any number undone. The membership going takes its rows with it.
CREATE TABLE "gym_desk_cancels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"held_membership_id" uuid NOT NULL,
	"user_id" uuid,
	"ways" text[] NOT NULL,
	"ends_on" date,
	"cancelled_on" date NOT NULL,
	"ended_classes" integer DEFAULT 0 NOT NULL,
	"ended_sessions" integer DEFAULT 0 NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_on" date,
	"undone_by_user_id" uuid,
	"undo_request_key" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_desk_cancels_ways_check" CHECK (cardinality("ways") BETWEEN 1 AND 4 AND "ways" <@ ARRAY['period_end','notice','contract_end','leave_early']::text[]),
	CONSTRAINT "gym_desk_cancels_ended_check" CHECK ("ended_classes" >= 0 AND "ended_sessions" >= 0),
	CONSTRAINT "gym_desk_cancels_days_check" CHECK ("ends_on" IS NULL OR "ends_on" >= "cancelled_on"),
	CONSTRAINT "gym_desk_cancels_undone_check" CHECK (
		("undone_at" IS NULL) = ("undone_on" IS NULL)
		AND ("undone_at" IS NULL) = ("undo_request_key" IS NULL)
		AND ("undone_at" IS NOT NULL OR "undone_by_user_id" IS NULL)
		AND ("undone_on" IS NULL OR "undone_on" >= "cancelled_on")
	)
);--> statement-breakpoint
ALTER TABLE "gym_desk_cancels" ADD CONSTRAINT "gym_desk_cancels_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_desk_cancels" ADD CONSTRAINT "gym_desk_cancels_held_fk" FOREIGN KEY ("gym_id","held_membership_id") REFERENCES "public"."gym_held_memberships"("gym_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_desk_cancels" ADD CONSTRAINT "gym_desk_cancels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_desk_cancels" ADD CONSTRAINT "gym_desk_cancels_undone_by_user_id_users_id_fk" FOREIGN KEY ("undone_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- One open cancel a membership; undone, it can be cancelled again.
CREATE UNIQUE INDEX "gym_desk_cancels_held_uq" ON "gym_desk_cancels" USING btree ("gym_id","held_membership_id") WHERE "undone_at" IS NULL;--> statement-breakpoint
-- The same Undo press sent twice is one undo.
CREATE UNIQUE INDEX "gym_desk_cancels_undo_request_uq" ON "gym_desk_cancels" USING btree ("gym_id","undo_request_key") WHERE "undo_request_key" IS NOT NULL;
