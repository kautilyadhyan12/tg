// A GYM'S TAX RATES (Part 3 §14.3; ROADMAP Stage 2 item 18b-iii). Mirrors `0112_tax_rates.sql`
// 1:1; the migration carries the reasoning. A file of its own, so the register's tables and
// the memberships' can both point at it.
import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./common.js";
import { gyms } from "./tenancy.js";

/** One named rate: `rate_pcm` is thousandths of a percent (0205), 8250 for 8.25%, 9975 for 9.975%. */
export const gymTaxRates = pgTable(
  "gym_tax_rates",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    ratePcm: integer("rate_pcm").notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("gym_tax_rates_gym_id_uq").on(t.gymId, t.id),
    check("gym_tax_rates_name_check", sql`char_length(${t.name}) BETWEEN 1 AND 30`),
    check("gym_tax_rates_rate_check", sql`${t.ratePcm} BETWEEN 1 AND 30000`),
    uniqueIndex("gym_tax_rates_name_uq").on(t.gymId, sql`lower(${t.name})`),
  ],
);
