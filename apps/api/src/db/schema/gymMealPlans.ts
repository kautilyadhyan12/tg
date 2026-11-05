// The meal plans a gym gives its members (migration 0210; ROADMAP Stage 2 24a-i). A plan is the
// gym's: who wrote it and who changed it last are `ON DELETE set null`, on gym_posts' footing, so
// the table is on `USER_LINKED_NOT_PURGED_TABLES`.
import { sql } from "drizzle-orm";
import { check, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./common.js";
import { users } from "./identity.js";
import { gyms } from "./tenancy.js";

export const gymMealPlans = pgTable(
  "gym_meal_plans",
  {
    // The browser's own id for the plan: a new plan sent twice is one plan.
    id: uuid("id").primaryKey(),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Seven days, Monday first; each a list of meals with their priced foods, as `diet_plans.days`.
    days: jsonb("days").notNull(),
    // The ids of the last changes made, newest first: a change sent twice is made once.
    recentChanges: uuid("recent_changes").array().notNull().default(sql`'{}'::uuid[]`),
    writtenByUserId: uuid("written_by_user_id").references(() => users.id, { onDelete: "set null" }),
    changedByUserId: uuid("changed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("gym_meal_plans_days_check", sql`jsonb_typeof(${t.days}) = 'array' AND jsonb_array_length(${t.days}) = 7`),
    check("gym_meal_plans_name_check", sql`char_length(${t.name}) BETWEEN 1 AND 60`),
    uniqueIndex("gym_meal_plans_gym_name_uq").on(t.gymId, sql`lower(${t.name})`),
  ],
);
