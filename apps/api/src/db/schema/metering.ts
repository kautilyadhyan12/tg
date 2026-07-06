// Part 4 §3.10 — Metering & cost telemetry. Mirrors the DDL 1:1.
// BRIN index on api_cost_events(at) added as raw SQL in the migration.
import {
  bigint,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

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
