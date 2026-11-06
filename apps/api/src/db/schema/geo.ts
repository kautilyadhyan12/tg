// Part 4 §3.9 — Geo & runs (mobile-first). Mirrors the DDL 1:1.
// GPS polylines: most sensitive data in the app — org-invisible (Part 3 §2.4),
// excluded from all exports except the user's own DPDP export, deleted in §5.2.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt } from "./common.js";
import { users } from "./identity.js";

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey(), // client-generated, same idempotency pattern as workouts
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    durationS: integer("duration_s").notNull(),
    distanceM: integer("distance_m").notNull(),
    polyline: text("polyline"),
    routeName: text("route_name"),
    splits: jsonb("splits"),
    kcalPoint: integer("kcal_point"),
    kcalCalcVersion: smallint("kcal_calc_version"),
    source: text("source").notNull().default("mobile"),
    legacyMongoId: text("legacy_mongo_id").unique(),
    createdAt: createdAt(),
    // 0211 (ROADMAP 37a): what the person gave it, and the numbers worked out beside duration_s
    // (the moving time) by the rules of runMaths.ts's run_calc_version.
    name: text("name"),
    effort: smallint("effort"),
    note: text("note"),
    elapsedS: integer("elapsed_s"),
    leftOutM: integer("left_out_m"),
    leftOutS: integer("left_out_s"),
    runCalcVersion: smallint("run_calc_version"),
    // 0218 (ROADMAP 37b-ii): the elevation gain from the server's height map, and where it stands.
    climbM: integer("climb_m"),
    climbState: text("climb_state"),
  },
  (t) => [
    index("runs_user_started_idx").on(t.userId, t.startedAt.desc()),
    check("runs_effort_check", sql`${t.effort} BETWEEN 1 AND 10`),
    check("runs_name_check", sql`char_length(${t.name}) BETWEEN 1 AND 60`),
    check("runs_note_check", sql`char_length(${t.note}) BETWEEN 1 AND 1000`),
    check(
      "runs_numbers_check",
      sql`${t.durationS} >= 0 AND ${t.distanceM} >= 0 AND ${t.elapsedS} >= ${t.durationS} AND ${t.leftOutM} >= 0 AND ${t.leftOutS} >= 0`,
    ),
    check(
      "runs_climb_check",
      sql`(${t.climbState} IS NULL AND ${t.climbM} IS NULL) OR (${t.climbState} = 'done' AND ${t.climbM} >= 0) OR (${t.climbState} IN ('none', 'waiting') AND ${t.climbM} IS NULL)`,
    ),
    index("runs_climb_waiting_idx").on(t.createdAt).where(sql`${t.climbState} = 'waiting'`),
  ],
);

export const savedRoutes = pgTable("saved_routes", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  polyline: text("polyline").notNull(),
  distanceM: integer("distance_m").notNull(),
  legacyMongoId: text("legacy_mongo_id").unique(),
  createdAt: createdAt(),
});

export const runSchedules = pgTable("run_schedules", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  rule: jsonb("rule").notNull(),
  active: boolean("active").notNull().default(true),
  legacyMongoId: text("legacy_mongo_id").unique(),
  createdAt: createdAt(),
});

export const geoCache = pgTable(
  "geo_cache", // persistent layer under the Redis geo cache (v1 §6.1)
  {
    lat3: numeric("lat3", { precision: 7, scale: 3 }).notNull(),
    lng3: numeric("lng3", { precision: 7, scale: 3 }).notNull(),
    name: text("name").notNull(),
    provider: text("provider").notNull(),
    cachedAt: timestamp("cached_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.lat3, t.lng3] })],
);
