// Part 4 §3.4 — Exercise catalog & definitions. Mirrors the DDL 1:1.
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt } from "./common.js";
import { users } from "./identity.js";

export const exercises = pgTable(
  "exercises",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    slug: text("slug").unique().notNull(),
    nameKey: text("name_key").notNull(),
    family: text("family").notNull(), // F1..F12 (Part 2 §5)
    tier: text("tier").notNull(),
    tracking: text("tracking").notNull().default("pose"),
    status: text("status").notNull().default("live"),
    met: numeric("met", { precision: 3, scale: 1 }).notNull(), // Part 2B Appendix A, one value per row
    difficulty: smallint("difficulty"),
    equipment: text("equipment").array(),
    muscles: text("muscles").array(),
    legacyMongoId: text("legacy_mongo_id").unique(),
    createdAt: createdAt(),
  },
  (t) => [
    check("exercises_family_check", sql`${t.family} ~ '^F([1-9]|1[0-2])$'`),
    check("exercises_tier_check", sql`${t.tier} IN ('T1','T2','T3')`),
    check("exercises_tracking_check", sql`${t.tracking} IN ('pose','timer')`),
    check("exercises_status_check", sql`${t.status} IN ('live','hidden','retired')`),
  ],
);

export const exerciseDefinitions = pgTable(
  "exercise_definitions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    exerciseId: uuid("exercise_id")
      .notNull()
      .references(() => exercises.id),
    version: integer("version").notNull(),
    status: text("status").notNull(),
    definition: jsonb("definition").notNull(), // the Part 2 §4 document, immutable once beta+
    minEngineVersion: text("min_engine_version").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedBy: uuid("published_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "exercise_definitions_status_check",
      sql`${t.status} IN ('draft','beta','live','retired')`,
    ),
    unique("exercise_definitions_exercise_version_uq").on(t.exerciseId, t.version),
    index("exercise_definitions_exercise_status_idx").on(t.exerciseId, t.status),
  ],
);

export const definitionBundles = pgTable(
  "definition_bundles", // what clients actually download (Part 2 §9.3)
  {
    bundleVersion: integer("bundle_version").primaryKey().generatedAlwaysAsIdentity(),
    channel: text("channel").notNull(),
    sha256: text("sha256").notNull(), // the ETag
    manifest: jsonb("manifest").notNull(), // {exercise_slug: definition_version}
    createdAt: createdAt(),
  },
  (t) => [check("definition_bundles_channel_check", sql`${t.channel} IN ('live','beta')`)],
);
