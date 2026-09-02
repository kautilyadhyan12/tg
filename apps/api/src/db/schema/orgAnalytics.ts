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
    /** ATTENDANCE, ADDED BY MIGRATION `0020` — Kd's *"THE GYM'S NUMBERS ARE
     *  ATTENDANCE NUMBERS"* (:26469), which this table predates.
     *
     *  `visits` counts ROWS; `visitors` counts DISTINCT PEOPLE. They differ
     *  exactly when somebody came twice in a day, which ruling 12 (:27992 §1)
     *  made possible on purpose.
     *
     *  **`visitors` IS NOT SUMMABLE ACROSS DAYS and no reader may try.** A week
     *  of daily distinct counts double-counts everybody who came on two of its
     *  days; *"how many different people in N days"* is a DISTINCT count over
     *  `gym_attendance` and cannot be assembled from this table at all. The
     *  shape invites the mistake and no fixture with one visit per person can
     *  see it (:29961 §6.2). */
    visits: integer("visits").notNull().default(0),
    visitors: integer("visitors").notNull().default(0),
    /** THE WORKOUT-SIDE COLUMNS ARE SCOPED BY :29961 RULING 2, not by the
     *  workout alone: its owner held a live membership covering this day AND has
     *  an attendance row at this gym on this same day. Kd, :26469 §1.2 —
     *  *"A workout counts for a gym only if the person was a member that day and
     *  was present in the gym"*. */
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
