// WHAT A GYM SELLS (Part 3 §13.1; ROADMAP Stage 2 item 17a-i). Mirrors
// `0069_membership_types.sql`, `0070_held_memberships.sql` and
// `0073_membership_word_links.sql` 1:1, and `0074_class_bookings.sql`'s bookings; the
// migrations carry the reasoning.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt } from "./common.js";
import { gymClassTypes } from "./classes.js";
import { gymMemberListEntries } from "./memberList.js";
import { gyms } from "./tenancy.js";
import { users } from "./identity.js";

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
    description: text("description"),
    kind: text("kind").notNull(),
    priceMinor: integer("price_minor").notNull(),
    currency: text("currency").notNull(),
    termCount: integer("term_count"),
    termUnit: text("term_unit"),
    packClasses: integer("pack_classes"),
    packDays: integer("pack_days"),
    access: text("access").notNull(),
    bookingsLimit: integer("bookings_limit"),
    bookingsPeriod: text("bookings_period"),
    coversAllClasses: boolean("covers_all_classes").notNull().default(true),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("gym_membership_types_name_len_check", sql`char_length(${t.name}) BETWEEN 1 AND 80`),
    check(
      "gym_membership_types_description_len_check",
      sql`${t.description} IS NULL OR char_length(${t.description}) BETWEEN 1 AND 300`,
    ),
    check("gym_membership_types_kind_check", sql`${t.kind} IN ('recurring','one_time','pack','trial')`),
    check("gym_membership_types_price_check", sql`${t.priceMinor} BETWEEN 0 AND 99999999`),
    check("gym_membership_types_currency_check", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("gym_membership_types_access_check", sql`${t.access} IN ('all_classes','limited','gym_only')`),
    check(
      "gym_membership_types_limit_check",
      sql`(${t.access} = 'limited') = (${t.bookingsLimit} IS NOT NULL) AND (${t.access} = 'limited') = (${t.bookingsPeriod} IS NOT NULL) AND (${t.bookingsLimit} IS NULL OR ${t.bookingsLimit} BETWEEN 1 AND 200) AND (${t.bookingsPeriod} IS NULL OR ${t.bookingsPeriod} IN ('week','month'))`,
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
    // What a held membership's type key points at, with its gym (0070).
    unique("gym_membership_types_gym_id_uq").on(t.gymId, t.id),
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

/** One membership a gym's record of a person holds (§13.2). The kind, price and term are
 *  the type's as they were when it was given; what it is on a given day is worked out by
 *  `heldMembershipView` in `@app/shared`, never read off `status` alone. */
export const gymHeldMemberships = pgTable(
  "gym_held_memberships",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    entryId: uuid("entry_id").notNull(),
    membershipTypeId: uuid("membership_type_id").notNull(),
    requestKey: uuid("request_key").notNull(),
    kind: text("kind").notNull(),
    priceMinor: integer("price_minor").notNull(),
    currency: text("currency").notNull(),
    termCount: integer("term_count"),
    termUnit: text("term_unit"),
    packClasses: integer("pack_classes"),
    packDays: integer("pack_days"),
    startsOn: date("starts_on").notNull(),
    frozenDays: integer("frozen_days").notNull().default(0),
    status: text("status").notNull().default("active"),
    frozenOn: date("frozen_on"),
    cancelledOn: date("cancelled_on"),
    paidPeriods: integer("paid_periods").notNull().default(0),
    paidFloor: integer("paid_floor").notNull().default(0),
    renews: boolean("renews").notNull(),
    classesLeft: integer("classes_left"),
    fromList: boolean("from_list").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("gym_held_memberships_request_uq").on(t.gymId, t.requestKey),
    check("gym_held_memberships_kind_check", sql`${t.kind} IN ('recurring','one_time','pack','trial')`),
    check("gym_held_memberships_price_check", sql`${t.priceMinor} BETWEEN 0 AND 99999999`),
    check("gym_held_memberships_currency_check", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("gym_held_memberships_status_check", sql`${t.status} IN ('active','frozen','ended','cancelled')`),
    check(
      "gym_held_memberships_shape_check",
      sql`CASE WHEN ${t.kind} = 'pack' THEN
        ${t.packClasses} IS NOT NULL AND ${t.packClasses} BETWEEN 1 AND 500
        AND ${t.packDays} IS NOT NULL AND ${t.packDays} BETWEEN 1 AND 730
        AND ${t.termCount} IS NULL AND ${t.termUnit} IS NULL
        AND ${t.classesLeft} IS NOT NULL AND ${t.classesLeft} BETWEEN 0 AND ${t.packClasses}
      ELSE
        ${t.termCount} IS NOT NULL AND ${t.termCount} BETWEEN 1 AND 365
        AND ${t.termUnit} IS NOT NULL AND ${t.termUnit} IN ('day','week','month','year')
        AND NOT (${t.kind} = 'recurring' AND ${t.termUnit} = 'day')
        AND ${t.packClasses} IS NULL AND ${t.packDays} IS NULL AND ${t.classesLeft} IS NULL
      END`,
    ),
    check("gym_held_memberships_frozen_days_check", sql`${t.frozenDays} BETWEEN 0 AND 36500`),
    check("gym_held_memberships_frozen_check", sql`(${t.status} = 'frozen') = (${t.frozenOn} IS NOT NULL)`),
    check("gym_held_memberships_cancelled_check", sql`(${t.status} = 'cancelled') = (${t.cancelledOn} IS NOT NULL)`),
    check(
      "gym_held_memberships_paid_check",
      sql`${t.paidFloor} >= 0 AND ${t.paidPeriods} >= ${t.paidFloor} AND (${t.kind} = 'recurring' OR (${t.paidPeriods} <= 1 AND ${t.paidFloor} = 0)) AND (${t.priceMinor} > 0 OR ${t.paidPeriods} = 0)`,
    ),
    check("gym_held_memberships_renews_check", sql`${t.kind} = 'recurring' OR NOT ${t.renews}`),
    foreignKey({
      name: "gym_held_memberships_entry_fk",
      columns: [t.gymId, t.entryId],
      foreignColumns: [gymMemberListEntries.gymId, gymMemberListEntries.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "gym_held_memberships_type_fk",
      columns: [t.gymId, t.membershipTypeId],
      foreignColumns: [gymMembershipTypes.gymId, gymMembershipTypes.id],
    }),
    index("gym_held_memberships_entry_idx").on(t.gymId, t.entryId),
    index("gym_held_memberships_type_idx").on(t.gymId, t.membershipTypeId),
  ],
);

/** One person's booking of one class (§13.4; 17c-i). Mirrors `0074_class_bookings.sql`,
 *  which holds the two foreign keys Drizzle's builder cannot express: `(gym_id,
 *  session_id)` → the class, and `(gym_id, entry_id)` → the record, ON DELETE SET NULL
 *  (entry_id). `seq` is the waitlist's order. */
export const gymClassBookings = pgTable(
  "gym_class_bookings",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    seq: bigint("seq", { mode: "number" }).notNull().generatedAlwaysAsIdentity(),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    entryId: uuid("entry_id"),
    heldMembershipId: uuid("held_membership_id").references(() => gymHeldMemberships.id, { onDelete: "set null" }),
    status: text("status").notNull(),
    packCharged: boolean("pack_charged").notNull().default(false),
    requestKey: uuid("request_key").notNull(),
    /** The request that claimed the place from the waitlist, where a person did. */
    claimKey: uuid("claim_key"),
    createdAt: createdAt(),
    bookedAt: timestamp("booked_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (t) => [
    unique("gym_class_bookings_request_uq").on(t.gymId, t.requestKey),
    unique("gym_class_bookings_claim_uq").on(t.gymId, t.claimKey),
    check(
      "gym_class_bookings_status_check",
      sql`${t.status} IN ('booked','waitlisted','cancelled','late_cancelled','attended','no_show')`,
    ),
    check(
      "gym_class_bookings_booked_check",
      sql`${t.status} NOT IN ('booked','attended','no_show','late_cancelled') OR ${t.bookedAt} IS NOT NULL`,
    ),
    check(
      "gym_class_bookings_cancelled_check",
      sql`(${t.status} IN ('cancelled','late_cancelled')) = (${t.cancelledAt} IS NOT NULL)`,
    ),
    check("gym_class_bookings_pack_check", sql`NOT ${t.packCharged} OR ${t.bookedAt} IS NOT NULL`),
    uniqueIndex("gym_class_bookings_live_uq")
      .on(t.sessionId, t.userId)
      .where(sql`${t.status} IN ('booked','waitlisted','attended','no_show')`),
    index("gym_class_bookings_session_idx").on(t.gymId, t.sessionId, t.status, t.seq),
    index("gym_class_bookings_user_idx").on(t.userId, t.gymId),
    index("gym_class_bookings_entry_idx").on(t.gymId, t.entryId).where(sql`${t.entryId} IS NOT NULL`),
    index("gym_class_bookings_held_idx").on(t.heldMembershipId).where(sql`${t.heldMembershipId} IS NOT NULL`),
  ],
);

/** Which type a gym linked one of its list's membership words to (§13.2; 17a-iii). */
export const gymMembershipWordLinks = pgTable(
  "gym_membership_word_links",
  {
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    wordKey: text("word_key").notNull(),
    word: text("word").notNull(),
    membershipTypeId: uuid("membership_type_id").notNull(),
    linkedBy: uuid("linked_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: "gym_membership_word_links_pk", columns: [t.gymId, t.wordKey] }),
    check("gym_membership_word_links_word_check", sql`char_length(${t.word}) BETWEEN 1 AND 40`),
    check("gym_membership_word_links_key_check", sql`${t.wordKey} = lower(${t.word})`),
    foreignKey({
      name: "gym_membership_word_links_type_fk",
      columns: [t.gymId, t.membershipTypeId],
      foreignColumns: [gymMembershipTypes.gymId, gymMembershipTypes.id],
    }).onDelete("cascade"),
    index("gym_membership_word_links_type_idx").on(t.gymId, t.membershipTypeId),
    index("gym_membership_word_links_linked_by_idx").on(t.linkedBy),
  ],
);
