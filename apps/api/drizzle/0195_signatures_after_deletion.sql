-- Signed forms of deleted members (ROADMAP 18u-iii). A desk waiver keeps the name of the member whose
-- record was deleted for good, as an agreement's details already do, so one signed by a parent is
-- found by the child's name. A signature left on the record not kept when two records are joined
-- names the record kept: it is that person's, still on the list, never a deleted member's.
ALTER TABLE "gym_waiver_desk_signatures" ADD COLUMN "member_name" text;--> statement-breakpoint
ALTER TABLE "gym_waiver_desk_signatures" ADD CONSTRAINT "gym_waiver_desk_signatures_member_name_check" CHECK ("member_name" IS NULL OR char_length("member_name") BETWEEN 1 AND 200);--> statement-breakpoint
ALTER TABLE "gym_waiver_desk_signatures" ADD COLUMN "merged_into_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "gym_agreement_signatures" ADD COLUMN "merged_into_entry_id" uuid;--> statement-breakpoint
CREATE INDEX "gym_waiver_desk_signatures_merged_idx" ON "gym_waiver_desk_signatures" USING btree ("gym_id","merged_into_entry_id") WHERE "merged_into_entry_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "gym_agreement_signatures_merged_idx" ON "gym_agreement_signatures" USING btree ("gym_id","merged_into_entry_id") WHERE "merged_into_entry_id" IS NOT NULL;
