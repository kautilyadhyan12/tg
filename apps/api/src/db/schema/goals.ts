// A person's goals (migration 0099; ROADMAP Stage 5 item 30a).
import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./common.js";
import { exercises } from "./catalog.js";
import { users } from "./identity.js";

export const userGoals = pgTable(
  "user_goals",
  {
    id: uuid("id").primaryKey(), // the phone's own: the same request twice is one goal
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    period: text("period"),
    target: integer("target"), // null where the target is read from the person's plan
    exerciseId: uuid("exercise_id").references(() => exercises.id),
    setBy: text("set_by").notNull().default("user"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "user_goals_kind_check",
      sql`${t.kind} IN ('training_days','streak','gym_visits','calories_burned','active_minutes','reps_in_set','weight','calories_within','protein','food_logged_days')`,
    ),
    check("user_goals_period_check", sql`${t.period} IN ('day','week','month','year')`),
    check("user_goals_set_by_check", sql`${t.setBy} IN ('app','user')`),
    check("user_goals_target_check", sql`${t.target} > 0`),
    // `user_goals_one_of_each_uq` (one goal of each kind, period and exercise for a person)
    // is in `0099_user_goals.sql`: it is over expressions.
  ],
);
