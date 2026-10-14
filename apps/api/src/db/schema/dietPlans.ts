// A person's own diet plan (migration 0106; ROADMAP 34e-i).
import { sql } from "drizzle-orm";
import { check, jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./common.js";
import { users } from "./identity.js";

export const dietPlans = pgTable(
  "diet_plans",
  {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  // Seven days, Monday first; each a list of meals with their priced foods.
  days: jsonb("days").notNull(),
  // The phone's ids of the last changes made, newest first: a change sent twice is made once.
  recentChanges: uuid("recent_changes").array().notNull().default(sql`'{}'::uuid[]`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
  },
  (t) => [check("diet_plans_days_check", sql`jsonb_typeof(${t.days}) = 'array' AND jsonb_array_length(${t.days}) = 7`)],
);
