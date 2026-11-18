// Part 4 §3.4 — Exercise catalog & definitions. Mirrors the DDL 1:1.
import { sql } from "drizzle-orm";
import {
  boolean,
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
    // The four old facts below are empty only on a row the Exercise Library made for an exercise
    // that is not one of the old 58 (0243, job 60b). Such a row is never 'live' here, so the old
    // routes, which read only 'live' rows, never see it. The Library's own facts are in
    // `library_exercises`.
    nameKey: text("name_key"),
    family: text("family"), // F1..F12 (Part 2 §5)
    tier: text("tier"),
    tracking: text("tracking").default("pose"),
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
    check(
      "exercises_old_facts_check",
      sql`${t.status} <> 'live' OR (${t.nameKey} IS NOT NULL AND ${t.family} IS NOT NULL AND ${t.tier} IS NOT NULL AND ${t.tracking} IS NOT NULL)`,
    ),
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

// The Exercise Library on the server (spec Part 2 §13.4, job 60b; migration 0243). Written only by
// publishing (`modules/library/publish.ts`), from the exercise files in packages/shared/library.

/** One row for each exercise the Library has ever published, never deleted: the facts the server
 *  reckons with, and the exercise's whole entry as the phone's download carries it. 'hidden' is an
 *  exercise whose file is gone while a saved set names it (or one of the old 58, which the old save
 *  route can still name): in the download so that history names it, never shown in the Library.
 *  'removed' is one whose file is gone and that nothing names: out of the download, its entry kept,
 *  so a set that arrives later brings it back as 'hidden' at the next publish. */
export const libraryExercises = pgTable(
  "library_exercises",
  {
    exerciseId: uuid("exercise_id")
      .primaryKey()
      .references(() => exercises.id),
    status: text("status").notNull(),
    met: numeric("met", { precision: 3, scale: 1 }).notNull(),
    compendium: text("compendium").notNull(),
    measuredIn: text("measured_in").notNull(),
    weight: text("weight").notNull(),
    eachSide: boolean("each_side").notNull(),
    entry: jsonb("entry").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("library_exercises_status_check", sql`${t.status} IN ('live','retired','hidden','removed')`),
    check("library_exercises_met_check", sql`${t.met} BETWEEN 1 AND 23`),
    check("library_exercises_compendium_check", sql`${t.compendium} ~ '^[0-9]{5}$'`),
    check("library_exercises_measured_in_check", sql`${t.measuredIn} IN ('reps','time')`),
    check("library_exercises_weight_check", sql`${t.weight} IN ('never','may','usually')`),
  ],
);

/** The numbered copies of the whole list, one line of copies for each of beta and live. A copy is
 *  never changed: publishing adds one only when the content changed. `body` is the exact text the
 *  fingerprint is taken of and the download sends. */
export const libraryCopies = pgTable(
  "library_copies",
  {
    version: integer("version").primaryKey().generatedAlwaysAsIdentity(),
    channel: text("channel").notNull(),
    sha256: text("sha256").notNull(),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("library_copies_channel_check", sql`${t.channel} IN ('live','beta')`),
    check("library_copies_sha256_check", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    index("library_copies_channel_version_idx").on(t.channel, t.version.desc()),
  ],
);
