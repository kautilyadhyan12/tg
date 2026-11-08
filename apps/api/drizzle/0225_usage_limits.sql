-- Kd's own number of meal scans or route plans a day for one person (ROADMAP Stage 2 item 14a-i; Kd,
-- 2026-11-08). Forward-only. Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- Set on the admin page only. A number here is what the person gets each day, higher or lower than
-- their plan's, until Kd takes it back; a row with neither number is deleted, never kept empty.
CREATE TABLE "usage_limits" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"meal_scans_a_day" smallint,
	"route_plans_a_day" smallint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_limits_meal_scans_check" CHECK ("meal_scans_a_day" IS NULL OR "meal_scans_a_day" BETWEEN 0 AND 100),
	CONSTRAINT "usage_limits_route_plans_check" CHECK ("route_plans_a_day" IS NULL OR "route_plans_a_day" BETWEEN 0 AND 100),
	CONSTRAINT "usage_limits_some_check" CHECK ("meal_scans_a_day" IS NOT NULL OR "route_plans_a_day" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "usage_limits" ADD CONSTRAINT "usage_limits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
