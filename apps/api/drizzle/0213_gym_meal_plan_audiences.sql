-- Who gets a gym's meal plan (spec Part 6 §16.6; ROADMAP Stage 2 24a-ii). Forward-only.
-- Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- One row a group a plan is given to: everybody, a membership type, a tag or one person on the list.
-- A gym of 200 given one plan is one row, never 200. Each group holds one plan at a time (the partial
-- unique indexes): giving another plan to it moves the row. A member reached by several gets the
-- newest `given_at`. A plan, type, tag or record that goes takes its rows with it.
ALTER TABLE "gym_meal_plans" ADD CONSTRAINT "gym_meal_plans_gym_id_uq" UNIQUE ("gym_id", "id");--> statement-breakpoint
CREATE TABLE "gym_meal_plan_audiences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gym_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"membership_type_id" uuid,
	"tag_id" uuid,
	"entry_id" uuid,
	"given_by_user_id" uuid,
	"given_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_meal_plan_audiences_plan_fk" FOREIGN KEY ("gym_id", "plan_id") REFERENCES "gym_meal_plans" ("gym_id", "id") ON DELETE CASCADE,
	CONSTRAINT "gym_meal_plan_audiences_type_fk" FOREIGN KEY ("gym_id", "membership_type_id") REFERENCES "gym_membership_types" ("gym_id", "id") ON DELETE CASCADE,
	CONSTRAINT "gym_meal_plan_audiences_tag_fk" FOREIGN KEY ("gym_id", "tag_id") REFERENCES "gym_member_tags" ("gym_id", "id") ON DELETE CASCADE,
	CONSTRAINT "gym_meal_plan_audiences_entry_fk" FOREIGN KEY ("gym_id", "entry_id") REFERENCES "gym_member_list_entries" ("gym_id", "id") ON DELETE CASCADE,
	CONSTRAINT "gym_meal_plan_audiences_kind_check" CHECK (
		("kind" = 'everyone' AND "membership_type_id" IS NULL AND "tag_id" IS NULL AND "entry_id" IS NULL)
		OR ("kind" = 'membership_type' AND "membership_type_id" IS NOT NULL AND "tag_id" IS NULL AND "entry_id" IS NULL)
		OR ("kind" = 'tag' AND "tag_id" IS NOT NULL AND "membership_type_id" IS NULL AND "entry_id" IS NULL)
		OR ("kind" = 'member' AND "entry_id" IS NOT NULL AND "membership_type_id" IS NULL AND "tag_id" IS NULL)
	)
);--> statement-breakpoint
ALTER TABLE "gym_meal_plan_audiences" ADD CONSTRAINT "gym_meal_plan_audiences_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_meal_plan_audiences" ADD CONSTRAINT "gym_meal_plan_audiences_given_by_user_id_users_id_fk" FOREIGN KEY ("given_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gym_meal_plan_audiences_plan_idx" ON "gym_meal_plan_audiences" ("gym_id", "plan_id");--> statement-breakpoint
CREATE INDEX "gym_meal_plan_audiences_given_by_idx" ON "gym_meal_plan_audiences" ("given_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gym_meal_plan_audiences_everyone_uq" ON "gym_meal_plan_audiences" ("gym_id") WHERE "kind" = 'everyone';--> statement-breakpoint
CREATE UNIQUE INDEX "gym_meal_plan_audiences_type_uq" ON "gym_meal_plan_audiences" ("gym_id", "membership_type_id") WHERE "kind" = 'membership_type';--> statement-breakpoint
CREATE UNIQUE INDEX "gym_meal_plan_audiences_tag_uq" ON "gym_meal_plan_audiences" ("gym_id", "tag_id") WHERE "kind" = 'tag';--> statement-breakpoint
CREATE UNIQUE INDEX "gym_meal_plan_audiences_entry_uq" ON "gym_meal_plan_audiences" ("gym_id", "entry_id") WHERE "kind" = 'member';
