-- Each person's days on the admin page (ROADMAP Stage 2 item 14a-ii; Kd, 2026-11-08). Forward-only.
-- Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- The minutes the app was open on screen on one of the person's own days, as their phone counted them
-- (Stage 5 item 21f), with the phone's time zone. The phone sends a day's total so far, so a day sent
-- twice is the same row, and the higher total is kept.
CREATE TABLE "app_minutes" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"minutes" smallint NOT NULL,
	"zone" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_minutes_user_id_day_pk" PRIMARY KEY ("user_id", "day"),
	CONSTRAINT "app_minutes_minutes_check" CHECK ("minutes" BETWEEN 0 AND 1440)
);
--> statement-breakpoint
ALTER TABLE "app_minutes" ADD CONSTRAINT "app_minutes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "app_minutes_day_idx" ON "app_minutes" USING btree ("day");
--> statement-breakpoint
-- Each meal scan and route plan a person used, with when: the quota's own count, kept past the day
-- its counter in Redis forgets. A use the scan gave back is taken out again.
CREATE TABLE "metered_uses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metered_uses_feature_check" CHECK ("feature" IN ('meal_scan','route_gen'))
);
--> statement-breakpoint
ALTER TABLE "metered_uses" ADD CONSTRAINT "metered_uses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "metered_uses_user_at_idx" ON "metered_uses" USING btree ("user_id", "at");
--> statement-breakpoint
CREATE INDEX "metered_uses_at_idx" ON "metered_uses" USING btree ("at");
--> statement-breakpoint
-- A person's cost day by day reads their own rows of the ledger.
CREATE INDEX "api_cost_events_user_at_idx" ON "api_cost_events" USING btree ("user_id", "at");
