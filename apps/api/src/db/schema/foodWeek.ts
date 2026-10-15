// Each day's food targets, kept for "Your week in food" (migration 0110; ROADMAP 34f-i).
import { sql } from "drizzle-orm";
import { check, date, integer, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity.js";

export const foodDayTargets = pgTable(
  "food_day_targets",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // A day of the person's own time zone.
    day: date("day").notNull(),
    kcal: integer("kcal").notNull(),
    proteinG: integer("protein_g").notNull(),
    carbsG: integer("carbs_g").notNull(),
    fatG: integer("fat_g").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "food_day_targets_pkey", columns: [t.userId, t.day] }),
    // No upper bound: these are whatever the rings showed, and the plan's own numbers have none.
    check("food_day_targets_kcal_check", sql`${t.kcal} >= 0`),
    check("food_day_targets_macros_check", sql`${t.proteinG} >= 0 AND ${t.carbsG} >= 0 AND ${t.fatG} >= 0`),
  ],
);
