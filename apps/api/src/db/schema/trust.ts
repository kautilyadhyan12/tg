// Part 4 §3.6 — Nutrition & body (Trust Layer, Part 2B §3.4). Mirrors the DDL 1:1.
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
    createdAt: createdAt(),
  },
  (t) => [
    index("meal_logs_user_taken_idx").on(t.userId, t.takenAt.desc()),
    check("meal_logs_origin_check", sql`${t.origin} IN ('photo','manual')`),
    check("meal_logs_meal_type_check", sql`${t.mealType} IN ('breakfast','lunch','dinner','snack')`),
  ],
);

export const userDishware = pgTable("user_dishware", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  containerClass: text("container_class").notNull(),
  volumeMl: integer("volume_ml").notNull(),
  foodHint: text("food_hint"),
  createdAt: createdAt(),
});

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
