// Part 4 §3.10 — Metering & cost telemetry. Mirrors the DDL 1:1.
// BRIN index on api_cost_events(at) added as raw SQL in the migration.
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity.js";

export const usageDaily = pgTable(
  "usage_daily", // nightly Redis rollup (v1 §7.2); feeds reports & Part 3 analytics
  {
    userId: uuid("user_id").notNull(),
    feature: text("feature").notNull(),
    day: date("day").notNull(),
    count: integer("count").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.feature, t.day] })],
);

export const apiCostEvents = pgTable(
  "api_cost_events", // the v1 §9.3 breaker's ledger
  {
    id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    userId: uuid("user_id"),
    gymId: uuid("gym_id"), // gym resolved via live membership at spend time; null for direct consumers
    feature: text("feature").notNull(),
    provider: text("provider").notNull(),
    units: numeric("units", { precision: 12, scale: 4 }).notNull(),
    unitType: text("unit_type").notNull(),
    costMicro: bigint("cost_micro", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull().default("USD"),
  },
  (t) => [index("api_cost_events_gym_at_idx").on(t.gymId, t.at)],
);

/** Kd's own number of meal scans or route plans a day for one person, set on the admin page
 *  (ROADMAP Stage 2 item 14a-i, migration 0225). It replaces the plan's number, higher or lower,
 *  until he takes it back; a row with neither number is deleted. */
export const usageLimits = pgTable(
  "usage_limits",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    mealScansADay: smallint("meal_scans_a_day"),
    routePlansADay: smallint("route_plans_a_day"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("usage_limits_meal_scans_check", sql`${t.mealScansADay} IS NULL OR ${t.mealScansADay} BETWEEN 0 AND 100`),
    check("usage_limits_route_plans_check", sql`${t.routePlansADay} IS NULL OR ${t.routePlansADay} BETWEEN 0 AND 100`),
    check("usage_limits_some_check", sql`${t.mealScansADay} IS NOT NULL OR ${t.routePlansADay} IS NOT NULL`),
  ],
);
