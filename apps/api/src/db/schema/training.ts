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
  uniqueIndex,
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
    // Part 4 §3.5 declares this column and never its vocabulary. Filled in here
    // for the log-only card (Kd-ruled 2026-08-01): 'engine' = the engine
    // analysed this set; 'log_only' = the user counted it themselves (Part 6
    // §3.6's degradation floor, whose own copy promises "your workout still
    // counts"). NULLABLE, and null means UNKNOWN — every row written before
    // this migration predates the distinction and must not be back-claimed as
    // either. v1 §14's "verified entries only" reads this column.
    mode: text("mode"),
    reps: smallint("reps").notNull().default(0),
    holdMs: integer("hold_ms"),
    durationMs: integer("duration_ms").notNull(),
    // How much of the set the camera could actually watch (Kd-ruled payload
    // addition, 2026-08-14; migration 0010). NULLABLE, and null means NOBODY
    // TOLD US — every row written before this migration, and every set from a
    // client that predates it, plus every hand-counted set, where the question
    // has no answer. Distinct from 0, which is a client saying it watched
    // nothing. Server-clamped to `duration_ms` on write, never CHECKed: a
    // constraint violation is a 500 and the client retries a 500 forever.
    watchedMs: integer("watched_ms"),
    avgFormScore: smallint("avg_form_score"),
    repScores: smallint("rep_scores").array(), // Part 2 §2.4 verbatim; no rep_events table (v1 §7.1)
    faultCounts: jsonb("fault_counts").notNull().default(sql`'{}'`),
    tempoMsAvg: integer("tempo_ms_avg"),
    romStats: jsonb("rom_stats"),
    calibration: jsonb("calibration"),
    // NULLABLE as of the log-only card: a set the engine never ran on has no
    // engine version and no definition version. Writing a sentinel (0, 'none')
    // would put a value that reads real into a column meaning "which engine
    // scored this" — the fabrication class this project keeps deleting. The
    // CHECK below is what keeps them mandatory for engine sets.
    engineVersion: text("engine_version"),
    definitionVersion: integer("definition_version"),
    createdAt: createdAt(),
  },
  (t) => [
    // Part 4 §3.5 sync contract: sets are "keyed (workout_id, set_index)" and
    // upserted — ON CONFLICT requires this uniqueness (migration 0002).
    uniqueIndex("workout_sets_workout_set_uq").on(t.workoutId, t.setIndex),
    check("workout_sets_mode_check", sql`${t.mode} IN ('engine','log_only')`),
    // T3 ROUND 1 F1 — THE FIRST VERSION OF THIS CONSTRAINT DID NOT HOLD THE LINE
    // IT WAS WRITTEN FOR. It read `mode IS DISTINCT FROM 'engine' OR (…)`, and
    // `mode` is nullable: Postgres confirms `NULL IS DISTINCT FROM 'engine'` is
    // TRUE, so ANY row omitting `mode` satisfied it with both provenance columns
    // NULL. Before 0009 the NOT NULL made a provenance-less scored set
    // impossible for every writer; that version made it impossible only for
    // writers that declare `mode='engine'` — a REGRESSION dressed as a guard,
    // and the commit claimed the opposite.
    //
    // Now the rule is about the DATA, not the discriminator: anything carrying
    // score evidence must say which engine produced it. Holds for every row
    // shape that exists or is intended — pre-0009 rows (provenance NOT NULL by
    // the old DDL), migrate-mongo rows ('legacy-py'/0, Part 4 §7), log-only rows
    // (no score evidence), and engine rows with no scored reps (repScores `[]`,
    // which is not NULL, so provenance is still required).
    // T3 ROUND 2 F3: `fault_counts` was missing from the first arm, so a row
    // with a FAULT LIST and no provenance was accepted — verified. A stored
    // fault list is an analyser output with nobody's name on it, and the
    // sibling constraint below already says so in words ("a log-only set cannot
    // carry faults — nothing analysed it"). Unreachable through the sync route
    // (the Zod union blocks it on both branches), but this CHECK exists exactly
    // because Zod is not the only writer: migrate-mongo inserts directly, and
    // P4.y's audit worker will.
    check(
      "workout_sets_engine_provenance_check",
      sql`(${t.mode} IS DISTINCT FROM 'engine' AND ${t.avgFormScore} IS NULL
           AND ${t.repScores} IS NULL AND ${t.faultCounts} = '{}'::jsonb)
          OR (${t.engineVersion} IS NOT NULL AND ${t.definitionVersion} IS NOT NULL)`,
    ),
    // A log-only set is user-typed: nothing analysed it, so it can carry no form
    // score, no per-rep scores, no faults — AND no provenance.
    //
    // T3 ROUND 1 F2 — the provenance half was MISSING here, so "enforced twice"
    // was false for it: the DB would have stored `mode='log_only'` alongside
    // `engine_version='1.0.0'`, i.e. "nothing analysed this, and here is the
    // engine that analysed it". Verified against Postgres before fixing.
    check(
      "workout_sets_log_only_unscored_check",
      sql`${t.mode} IS DISTINCT FROM 'log_only'
          OR (${t.avgFormScore} IS NULL AND ${t.repScores} IS NULL
              AND ${t.faultCounts} = '{}'::jsonb
              AND ${t.engineVersion} IS NULL AND ${t.definitionVersion} IS NULL)`,
    ),
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
