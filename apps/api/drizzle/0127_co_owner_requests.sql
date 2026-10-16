-- Co-owners (ROADMAP Stage 2 item 4b-i; rulings/2026-10-16-4b-i.md). Forward-only.
-- Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- The owner asks one of the gym's staff to be a co-owner; the person asked accepts or
-- declines. One request waiting a person a gym. Accepting makes their staff row an owner's
-- row; the gym's own owner (`gyms.owner_user_id`) does not change.
--
-- `staff_since` is the asked person's staff row's `created_at` when they were asked: the
-- request is theirs only while that same row stands. Removed from the staff and put back,
-- they are a new appointment and the old request no longer counts.
CREATE TABLE IF NOT EXISTS "gym_co_owner_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"requested_by" uuid,
	"staff_since" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"answered_at" timestamp with time zone,
	CONSTRAINT "gym_co_owner_requests_state_check" CHECK ("state" IN ('pending','accepted','declined','cancelled','expired')),
	CONSTRAINT "gym_co_owner_requests_answered_check" CHECK (("state" = 'pending') = ("answered_at" IS NULL)),
	CONSTRAINT "gym_co_owner_requests_expires_check" CHECK ("expires_at" > "created_at")
);--> statement-breakpoint
ALTER TABLE "gym_co_owner_requests" ADD CONSTRAINT "gym_co_owner_requests_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_co_owner_requests" ADD CONSTRAINT "gym_co_owner_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_co_owner_requests" ADD CONSTRAINT "gym_co_owner_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "gym_co_owner_requests_pending_uq" ON "gym_co_owner_requests" USING btree ("gym_id","user_id") WHERE "state" = 'pending';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gym_co_owner_requests_user_idx" ON "gym_co_owner_requests" USING btree ("user_id") WHERE "state" = 'pending';--> statement-breakpoint
-- Invite staff may invite a co-owner (Kd at 4b-i's click-through): the invitation's role is
-- `owner`, with the owner's ticks and no role name of the gym's own. Only an owner's
-- invitation may carry "Manage staff".
ALTER TABLE "gym_staff_invites" DROP CONSTRAINT "gym_staff_invites_role_check";--> statement-breakpoint
ALTER TABLE "gym_staff_invites" ADD CONSTRAINT "gym_staff_invites_role_check" CHECK ("role" IN ('manager','trainer','owner') AND ("role" <> 'owner' OR "role_name" IS NULL));--> statement-breakpoint
ALTER TABLE "gym_staff_invites" DROP CONSTRAINT "gym_staff_invites_privileges_check";--> statement-breakpoint
ALTER TABLE "gym_staff_invites" ADD CONSTRAINT "gym_staff_invites_privileges_check" CHECK (("role" = 'owner' OR NOT ('staff.manage' = ANY ("privileges"))) AND cardinality("privileges") <= 20);
