// Part 4 §3.5 — Workouts & sets (partition-ready per §0.1). Mirrors the DDL 1:1.
// BRIN indexes are added as raw SQL in the migration (drizzle-kit cannot emit USING brin).
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt } from "./common.js";
import { exercises } from "./catalog.js";
import { users } from "./identity.js";

export const workouts = pgTable(
  "workouts",
  {
    id: uuid("id").primaryKey(), // CLIENT-generated (v1 §5.3): the PK is the idempotency key
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    platform: text("platform").notNull(),
    engineVersion: text("engine_version").notNull(),
    bundleVersion: integer("bundle_version"),
    setsCount: smallint("sets_count").notNull().default(0),
    totalReps: integer("total_reps").notNull().default(0),
    avgFormScore: smallint("avg_form_score"), // null until a scored set exists
    durationMs: integer("duration_ms"),
    kcalPoint: integer("kcal_point"),
    kcalCalcVersion: smallint("kcal_calc_version"), // computed server-side at sync (2B §2.2)
    qualityFlags: text("quality_flags").array().notNull().default(sql`'{}'`),
    createdAt: createdAt(),
  },
  (t) => [
    check("workouts_platform_check", sql`${t.platform} IN ('web','android','ios')`),
    index("workouts_user_started_idx").on(t.userId, t.startedAt.desc()), // history screens, member drawer
  ],
);

export const workoutSets = pgTable(
  "workout_sets",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    workoutId: uuid("workout_id")
      .notNull()
      .references(() => workouts.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(), // denormalized on purpose: per-user set queries skip the join
    exerciseId: uuid("exercise_id")
      .notNull()
      .references(() => exercises.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(), // copied from parent: partition-ready + BRIN-scannable alone
    setIndex: smallint("set_index").notNull(),
    view: text("view"),
    mode: text("mode"),
    reps: smallint("reps").notNull().default(0),
    holdMs: integer("hold_ms"),
    durationMs: integer("duration_ms").notNull(),
    avgFormScore: smallint("avg_form_score"),
    repScores: smallint("rep_scores").array(), // Part 2 §2.4 verbatim; no rep_events table (v1 §7.1)
    faultCounts: jsonb("fault_counts").notNull().default(sql`'{}'`),
    tempoMsAvg: integer("tempo_ms_avg"),
    romStats: jsonb("rom_stats"),
    calibration: jsonb("calibration"),
    engineVersion: text("engine_version").notNull(),
    definitionVersion: integer("definition_version").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("workout_sets_workout_idx").on(t.workoutId),
    index("workout_sets_user_started_idx").on(t.userId, t.startedAt.desc()), // exercise-mix, form trend per member
    index("workout_sets_exercise_started_idx").on(t.exerciseId, t.startedAt.desc()), // Part 2 §9.4 per-definition telemetry
  ],
);

export const workoutTemplates = pgTable(
  "workout_templates", // existing WorkoutBuilder feature, kept (audit find)
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    items: jsonb("items").notNull(), // [{exercise_slug, target_sets, target_reps|hold_s}]
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    legacyMongoId: text("legacy_mongo_id").unique(),
    createdAt: createdAt(),
  },
);
