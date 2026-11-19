-- What each person used on a day, on the admin page (ROADMAP Stage 2 item 14a-iii; Kd, 2026-11-17). Forward-only.
-- Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- What a person saved is counted on the day it reached the server. By day reads everyone's saves of one day, by when;
-- a person's days read their own, by person and when (without these, a person's 30 days read the whole app's 30 days
-- of meals: 360,000 rows at 10,000 people, tools/measure-admin-days-cost.ts).
CREATE INDEX "meal_logs_created_idx" ON "meal_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "meal_logs_user_created_idx" ON "meal_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "member_label_foods_created_idx" ON "member_label_foods" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "member_label_foods_user_created_idx" ON "member_label_foods" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "runs_created_idx" ON "runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "runs_user_created_idx" ON "runs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "workouts_created_idx" ON "workouts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "workouts_user_created_idx" ON "workouts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "body_measurements_created_idx" ON "body_measurements" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "body_measurements_user_created_idx" ON "body_measurements" USING btree ("user_id","created_at");
