// A GYM'S TAX RATES (Part 3 §14.3; ROADMAP Stage 2 item 18b-iii). Mirrors `0108_tax_rates.sql`
// 1:1; the migration carries the reasoning. A file of its own, so the register's tables and
// the memberships' can both point at it.
import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./common.js";
import { gyms } from "./tenancy.js";

/** One named rate: `rate_bp` is hundredths of a percent, 825 for 8.25%. */
export const gymTaxRates = pgTable(
  "gym_tax_rates",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    rateBp: integer("rate_bp").notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("gym_tax_rates_gym_id_uq").on(t.gymId, t.id),
    check("gym_tax_rates_name_check", sql`char_length(${t.name}) BETWEEN 1 AND 30`),
    check("gym_tax_rates_rate_check", sql`${t.rateBp} BETWEEN 1 AND 3000`),
    uniqueIndex("gym_tax_rates_name_uq").on(t.gymId, sql`lower(${t.name})`),
  ],
);
