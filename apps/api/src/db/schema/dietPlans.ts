// A person's own diet plan (migration 0109; ROADMAP 34e-i), and which plan Recommended For You shows (0200; 31f).
import { sql } from "drizzle-orm";
import { check, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
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

// Recommended For You's choice for each kind (migration 0200; ROADMAP 31f). No row: not picked yet.
// The gym's choice (31g) widens the CHECK and `foodChoiceSchema` together.
export const recommendedChoices = pgTable(
  "recommended_choices",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    choice: text("choice").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "recommended_choices_pkey", columns: [t.userId, t.kind] }),
    check("recommended_choices_kind_check", sql`${t.kind} IN ('food','workout','running')`),
    check("recommended_choices_choice_check", sql`${t.choice} IN ('suggested','mine')`),
  ],
);
