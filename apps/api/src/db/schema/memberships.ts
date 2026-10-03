// WHAT A GYM SELLS (Part 3 §13.1; ROADMAP Stage 2 item 17a-i). Mirrors
// `0068_membership_types.sql` 1:1; the migration carries the reasoning.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt } from "./common.js";
import { gymClassTypes } from "./classes.js";
import { gyms } from "./tenancy.js";

/** One line of a gym's price list. `price_minor` is whole minor units of
 *  `currency`, stamped by the server from the gym's country. */
export const gymMembershipTypes = pgTable(
  "gym_membership_types",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    priceMinor: integer("price_minor").notNull(),
    currency: text("currency").notNull(),
    termCount: integer("term_count"),
    termUnit: text("term_unit"),
    packClasses: integer("pack_classes"),
    packDays: integer("pack_days"),
    access: text("access").notNull(),
    weeklyBookings: integer("weekly_bookings"),
    coversAllClasses: boolean("covers_all_classes").notNull().default(true),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("gym_membership_types_name_len_check", sql`char_length(${t.name}) BETWEEN 1 AND 80`),
    check("gym_membership_types_kind_check", sql`${t.kind} IN ('recurring','one_time','pack','trial')`),
    check("gym_membership_types_price_check", sql`${t.priceMinor} BETWEEN 0 AND 99999999`),
    check("gym_membership_types_currency_check", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("gym_membership_types_access_check", sql`${t.access} IN ('all_classes','weekly_bookings','gym_only')`),
    check(
      "gym_membership_types_weekly_check",
      sql`(${t.access} = 'weekly_bookings') = (${t.weeklyBookings} IS NOT NULL) AND (${t.weeklyBookings} IS NULL OR ${t.weeklyBookings} BETWEEN 1 AND 50)`,
    ),
    check(
      "gym_membership_types_shape_check",
      sql`CASE WHEN ${t.kind} = 'pack' THEN
        ${t.packClasses} IS NOT NULL AND ${t.packClasses} BETWEEN 1 AND 500
        AND ${t.packDays} IS NOT NULL AND ${t.packDays} BETWEEN 1 AND 730
        AND ${t.termCount} IS NULL AND ${t.termUnit} IS NULL AND ${t.access} = 'all_classes'
      ELSE
        ${t.termCount} IS NOT NULL AND ${t.termCount} BETWEEN 1 AND 365
        AND ${t.termUnit} IS NOT NULL AND ${t.termUnit} IN ('day','week','month','year')
        AND NOT (${t.kind} = 'recurring' AND ${t.termUnit} = 'day')
        AND ${t.packClasses} IS NULL AND ${t.packDays} IS NULL
      END`,
    ),
    index("gym_membership_types_gym_idx").on(t.gymId, t.archivedAt),
    uniqueIndex("gym_membership_types_live_name_uq")
      .on(t.gymId, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} IS NULL`),
  ],
);

/** The classes a type covers, where `covers_all_classes` is false. */
export const gymMembershipTypeClasses = pgTable(
  "gym_membership_type_classes",
  {
    membershipTypeId: uuid("membership_type_id")
      .notNull()
      .references(() => gymMembershipTypes.id, { onDelete: "cascade" }),
    classTypeId: uuid("class_type_id")
      .notNull()
      .references(() => gymClassTypes.id, { onDelete: "cascade" }),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ name: "gym_membership_type_classes_pk", columns: [t.membershipTypeId, t.classTypeId] }),
    index("gym_membership_type_classes_gym_idx").on(t.gymId),
    index("gym_membership_type_classes_class_idx").on(t.classTypeId),
  ],
);
