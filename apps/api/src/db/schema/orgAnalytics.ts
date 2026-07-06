// Part 4 §3.11 — Org analytics & reports (Part 3 §3.2 made physical).
// The org_member_stats VIEW is created as raw SQL in the migration (§3.11 verbatim).
import { sql } from "drizzle-orm";
import {
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt } from "./common.js";
import { gyms } from "./tenancy.js";

export const orgDailyStats = pgTable(
  "org_daily_stats",
  {
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    day: date("day").notNull(), // in the ORG's timezone (worker computes the UTC window)
    activeMembers: integer("active_members").notNull(),
    workouts: integer("workouts").notNull(),
    sets: integer("sets").notNull(),
    totalReps: integer("total_reps").notNull(),
    minutes: integer("minutes").notNull(),
    avgFormScore: numeric("avg_form_score", { precision: 4, scale: 1 }),
    scoredSets: integer("scored_sets").notNull(),
    newMembers: integer("new_members").notNull(),
    removedMembers: integer("removed_members").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.gymId, t.day] })],
);

export const gymUsageReports = pgTable(
  "gym_usage_reports",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    period: text("period").notNull(),
    stats: jsonb("stats").notNull(),
    pdfKey: text("pdf_key"),
    emailedAt: timestamp("emailed_at", { withTimezone: true }),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [unique("gym_usage_reports_gym_period_uq").on(t.gymId, t.period)],
);
