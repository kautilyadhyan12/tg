-- What each person used on a day, on the admin page (ROADMAP Stage 2 item 14a-iii; Kd, 2026-11-17). Forward-only.
-- Hand-written, as `0016` onwards are; its journal entry is part of this commit.
--
-- By day lists everyone who saved a meal, a pack's label, a run, a workout or a body measurement that day, so each of
-- those is found by when it was saved. A person's own days read their rows by the person's own indexes.
CREATE INDEX "meal_logs_created_idx" ON "meal_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "member_label_foods_created_idx" ON "member_label_foods" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "runs_created_idx" ON "runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "workouts_created_idx" ON "workouts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "body_measurements_created_idx" ON "body_measurements" USING btree ("created_at");
