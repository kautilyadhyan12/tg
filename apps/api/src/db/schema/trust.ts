// Part 4 §3.6 — Nutrition & body (Trust Layer, Part 2B §3.4). Mirrors the DDL 1:1.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt } from "./common.js";
import { users } from "./identity.js";

export const mealLogs = pgTable(
  "meal_logs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull(),
    // Kd DEVIATION ruling 2026-07-17 (Card-5b smoke; supersedes the D1
    // time-bucket interim): meal type is a USER-CHOSEN label, nullable —
    // takenAt stays the exact real time and never encodes the section.
    mealType: text("meal_type"),
    mealName: text("meal_name"),
    items: jsonb("items").notNull(), // [{name, canonical, grams_point, grams_range:[lo,hi], portion_source, nutrition_source, kcal, protein_g, carbs_g, fat_g}]
    kcalPoint: integer("kcal_point").notNull(),
    kcalLow: integer("kcal_low").notNull(),
    kcalHigh: integer("kcal_high").notNull(), // range survives confirmation, tightened (2B §3.2 S4)
    proteinG: numeric("protein_g", { precision: 6, scale: 1 }),
    carbsG: numeric("carbs_g", { precision: 6, scale: 1 }),
    fatG: numeric("fat_g", { precision: 6, scale: 1 }),
    confirmed: boolean("confirmed").notNull().default(false),
    origin: text("origin").notNull().default("manual"),
    portionSource: text("portion_source").notNull(), // worst rung used: user_dishware|anchor|regional_prior|default|legacy
    nutritionSources: text("nutrition_sources").array().notNull(), // e.g. {ifct,usda}
    calcVersion: smallint("calc_version").notNull(),
    legacyMongoId: text("legacy_mongo_id").unique(),
    // The phone's id for the meal's last change (ROADMAP 32b-ii-a): a change sent twice is made once.
    lastChangeId: uuid("last_change_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("meal_logs_user_taken_idx").on(t.userId, t.takenAt.desc()),
    check("meal_logs_origin_check", sql`${t.origin} IN ('photo','manual')`),
    check("meal_logs_meal_type_check", sql`${t.mealType} IN ('breakfast','lunch','dinner','snack')`),
  ],
);

export const userDishware = pgTable(
  "user_dishware",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    containerClass: text("container_class").notNull(),
    volumeMl: integer("volume_ml").notNull(),
    foodHint: text("food_hint"),
    // The cup, mug or bowl everybody has that this row is this person's own version of.
    standardId: uuid("standard_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("user_dishware_user_standard_uniq").on(t.userId, t.standardId)],
);

export const mealLogCorrections = pgTable(
  "meal_log_corrections", // P4 doctrine: corrections are ground truth, originals preserved
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    mealLogId: uuid("meal_log_id")
      .notNull()
      .references(() => mealLogs.id, { onDelete: "cascade" }),
    field: text("field").notNull(),
    original: jsonb("original").notNull(),
    corrected: jsonb("corrected").notNull(),
    portionSource: text("portion_source"),
    createdAt: createdAt(),
  },
);

/** A removed meal's id, kept for its owner (0169): a late save of it keeps nothing. */
export const mealRemovedIds = pgTable(
  "meal_removed_ids",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    removedAt: timestamp("removed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("meal_removed_ids_user_idx").on(t.userId)],
);

export const bodyMeasurements = pgTable(
  "body_measurements", // existing feature (audit find), kept; org-invisible by §2.4 boundary
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    measuredAt: timestamp("measured_at", { withTimezone: true }).notNull(),
    weightKg: numeric("weight_kg", { precision: 5, scale: 2 }),
    metrics: jsonb("metrics").notNull().default(sql`'{}'`), // waist_cm etc. — display-only, never computed upon except weight
    source: text("source").notNull().default("manual"),
    legacyMongoId: text("legacy_mongo_id").unique(),
    createdAt: createdAt(),
  },
  (t) => [
    index("body_measurements_user_measured_idx").on(t.userId, t.measuredAt.desc()),
    check("body_measurements_source_check", sql`${t.source} IN ('manual','self_reported')`),
  ],
);

/** A person's own food read from a pack's label (ROADMAP Stage 5 33b-iii-c), per 100 g or ml. */
export const memberLabelFoods = pgTable(
  "member_label_foods",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    code: text("code"),
    name: text("name").notNull(),
    unit: text("unit").notNull(),
    kcal: doublePrecision("kcal").notNull(),
    proteinG: doublePrecision("protein_g").notNull(),
    carbsG: doublePrecision("carbs_g").notNull(),
    fatG: doublePrecision("fat_g").notNull(),
    servingAmount: doublePrecision("serving_amount"),
    contains: text("contains").array().notNull().default(sql`'{}'`),
    mayContain: text("may_contain").array().notNull().default(sql`'{}'`),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("member_label_foods_user_code_idx").on(t.userId, t.code).where(sql`${t.code} IS NOT NULL`),
    check("member_label_foods_unit_check", sql`${t.unit} IN ('g','ml')`),
    check("member_label_foods_kcal_check", sql`${t.kcal} >= 0 AND ${t.kcal} <= 1000`),
    check("member_label_foods_macros_check", sql`${t.proteinG} BETWEEN 0 AND 100 AND ${t.carbsG} BETWEEN 0 AND 100 AND ${t.fatG} BETWEEN 0 AND 100`),
  ],
);
