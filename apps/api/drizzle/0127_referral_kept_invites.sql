-- Refer a friend: an invited friend stays invited when their lead is deleted (item 20's
-- two extra passes). Forward-only. Hand-written, as `0016` onwards are; its journal entry is
-- part of this commit.
--
-- A record is an invited friend through a joined lead that came by a member's link. Deleting
-- that lead (Delete, or Delete many) keeps who invited them, and when, here: one row a record,
-- the earliest invitation. It goes with the record, and a deleted account leaves the row with
-- no inviter, as the lead's `referred_by` does.
CREATE TABLE "gym_referral_kept_invites" (
	"gym_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"referred_by" uuid,
	"referred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_referral_kept_invites_pk" PRIMARY KEY ("gym_id","entry_id")
);--> statement-breakpoint
ALTER TABLE "gym_referral_kept_invites" ADD CONSTRAINT "gym_referral_kept_invites_entry_fk" FOREIGN KEY ("gym_id","entry_id") REFERENCES "public"."gym_member_list_entries"("gym_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_referral_kept_invites" ADD CONSTRAINT "gym_referral_kept_invites_referred_by_fk" FOREIGN KEY ("referred_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gym_referral_kept_invites_referred_by_idx" ON "gym_referral_kept_invites" USING btree ("referred_by") WHERE "referred_by" IS NOT NULL;
