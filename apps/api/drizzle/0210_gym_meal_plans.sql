-- The meal plans a gym gives its members (spec Part 6 §16.6; ROADMAP Stage 2 24a-i). Forward-only.
-- Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- A plan is the gym's: a name, and a week, Monday first, of meals with their priced foods, in the
-- shape of a person's own `diet_plans.days`. Who wrote it and who changed it last are the only user
-- links, both `ON DELETE set null`, on gym_posts' footing. Who gets a plan is 24a-ii.
CREATE TABLE "gym_meal_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"gym_id" uuid NOT NULL,
	"name" text NOT NULL,
	"days" jsonb NOT NULL,
	"recent_changes" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"written_by_user_id" uuid,
	"changed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gym_meal_plans_days_check" CHECK (jsonb_typeof("days") = 'array' AND jsonb_array_length("days") = 7),
	CONSTRAINT "gym_meal_plans_name_check" CHECK (char_length("name") BETWEEN 1 AND 60)
);--> statement-breakpoint
ALTER TABLE "gym_meal_plans" ADD CONSTRAINT "gym_meal_plans_gym_id_gyms_id_fk" FOREIGN KEY ("gym_id") REFERENCES "public"."gyms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_meal_plans" ADD CONSTRAINT "gym_meal_plans_written_by_user_id_users_id_fk" FOREIGN KEY ("written_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gym_meal_plans" ADD CONSTRAINT "gym_meal_plans_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- One name for one plan in a gym, whatever its capitals.
CREATE UNIQUE INDEX "gym_meal_plans_gym_name_uq" ON "gym_meal_plans" ("gym_id", lower("name"));--> statement-breakpoint

-- A seventeenth privilege, `plans.manage`: write the gym's meal plans. The owner by default (a NULL
-- set reads its role's defaults, which gain it in the code); the owner ticks it for anyone else.
-- The list below is `ORG_PRIVILEGES` in `@app/shared`, and `db.migration.test.ts` reads the deployed
-- predicate against it.
ALTER TABLE "gym_staff" DROP CONSTRAINT "gym_staff_privileges_check";--> statement-breakpoint
ALTER TABLE "gym_staff" ADD CONSTRAINT "gym_staff_privileges_check" CHECK ("gym_staff"."privileges" IS NULL OR "gym_staff"."privileges" <@ ARRAY['members.read','codes.invite','codes.manage','members.confirm','members.remove','staff.manage','org.manage','billing.manage','attendance.read','schedule.manage','attendance.mark','leaderboard.manage','memberships.manage','posts.manage','reports.read','billing.members','plans.manage']::text[]);--> statement-breakpoint

-- An owner's stored set holds every tick an owner has: theirs gains this one too.
UPDATE "gym_staff"
SET "privileges" = array_append("privileges", 'plans.manage')
WHERE "role" = 'owner'
  AND "privileges" IS NOT NULL
  AND NOT ("privileges" @> ARRAY['plans.manage']::text[]);
