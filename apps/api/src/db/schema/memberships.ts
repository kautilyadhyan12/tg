// WHAT A GYM SELLS (Part 3 §13.1; ROADMAP Stage 2 item 17a-i). Mirrors
// `0069_membership_types.sql`, `0070_held_memberships.sql` and
// `0073_membership_word_links.sql` 1:1, and `0075_class_bookings.sql`'s bookings; the
// migrations carry the reasoning. `0112_tax_rates.sql` adds the tax rate columns.
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
import { gymTaxRates } from "./tax.js";
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
    includesPt: boolean("includes_pt").notNull().default(false),
    ptLimit: integer("pt_limit"),
    ptPeriod: text("pt_period"),
    /** The gym's tax rate its bills charge (0112); null for none. */
    taxRateId: uuid("tax_rate_id"),
    /** Charged on the first bill of a membership given from it (0150; 18t); 0 for none. */
    joiningFeeMinor: integer("joining_fee_minor").notNull().default(0),
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
    check(
      "gym_membership_types_joining_fee_check",
      sql`${t.joiningFeeMinor} BETWEEN 0 AND 99999999 AND (${t.joiningFeeMinor} = 0 OR (${t.kind} IN ('recurring','one_time') AND ${t.priceMinor} > 0))`,
    ),
    check("gym_membership_types_currency_check", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("gym_membership_types_access_check", sql`${t.access} IN ('all_classes','limited','gym_only')`),
    check(
      "gym_membership_types_limit_check",
      sql`(${t.access} = 'limited') = (${t.bookingsLimit} IS NOT NULL) AND (${t.access} = 'limited') = (${t.bookingsPeriod} IS NOT NULL) AND (${t.bookingsLimit} IS NULL OR ${t.bookingsLimit} BETWEEN 1 AND 200) AND (${t.bookingsPeriod} IS NULL OR ${t.bookingsPeriod} IN ('week','month'))`,
    ),
    check(
      "gym_membership_types_pt_limit_check",
      sql`(${t.ptLimit} IS NULL) = (${t.ptPeriod} IS NULL) AND (${t.ptLimit} IS NULL OR (${t.includesPt} AND ${t.kind} <> 'pack' AND ${t.ptLimit} BETWEEN 1 AND 200 AND ${t.ptPeriod} IN ('week','month')))`,
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
    // `0112` clears only `tax_rate_id` when the rate goes; Drizzle cannot say which column.
    foreignKey({
      name: "gym_membership_types_tax_rate_fk",
      columns: [t.gymId, t.taxRateId],
      foreignColumns: [gymTaxRates.gymId, gymTaxRates.id],
    }),
    index("gym_membership_types_tax_rate_idx")
      .on(t.gymId, t.taxRateId)
      .where(sql`${t.taxRateId} IS NOT NULL`),
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
    /** Null once its record was deleted for good with a payment on it (0116): kept for the
     *  gym's takings, with no name. */
    entryId: uuid("entry_id"),
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
    /** Refer a friend's free days (20e-ii-b-ii-b), added to period `giftFrom` and after. */
    giftDays: integer("gift_days").notNull().default(0),
    giftFrom: integer("gift_from").notNull().default(0),
    status: text("status").notNull().default("active"),
    frozenOn: date("frozen_on"),
    cancelledOn: date("cancelled_on"),
    paidPeriods: integer("paid_periods").notNull().default(0),
    paidFloor: integer("paid_floor").notNull().default(0),
    renews: boolean("renews").notNull(),
    classesLeft: integer("classes_left"),
    fromList: boolean("from_list").notNull().default(false),
    /** The discount it was given with (`0107`). Its key to `gym_discounts` is the
     *  migration's: declaring it here would import `register.ts`, which imports this file. */
    discountId: uuid("discount_id"),
    discountName: text("discount_name"),
    discountMinor: integer("discount_minor").notNull().default(0),
    discountPayments: text("discount_payments"),
    /** The tax rate it was sold with (0112): every bill opened from it charges that rate's
     *  percentage as it is that day. Null for none. */
    taxRateId: uuid("tax_rate_id"),
    /** Whether its price held that tax when it was sold (0112): kept, so a gym changing how
     *  it charges tax later moves nobody's total. Null with no rate. */
    taxIncluded: boolean("tax_included"),
    /** When its record was deleted for good (0116); set exactly when `entry_id` is null. */
    recordDeletedAt: timestamp("record_deleted_at", { withTimezone: true }),
    /** The membership this one replaced when staff changed one for the other (0152; 18x). */
    replacesId: uuid("replaces_id"),
    /** The change set the one it replaced to stop at the end of what is paid (0152): cancelling
     *  this one before it starts sets that one renewing again. */
    replacedStopped: boolean("replaced_stopped").notNull().default(false),
    /** Given while the gym billed everyone on one day (0154; 18y): the first of those days after
     *  the start, from which its full periods count; its first period is the part month before. */
    fullFrom: date("full_from"),
    /** What its freeze charges a month (0155; 18z): the gym's freeze fee when it was frozen, or 0
     *  where staff froze it with no fee. Read only while it is frozen. */
    freezeFeeMinor: integer("freeze_fee_minor").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "gym_held_memberships_record_deleted_check",
      sql`(${t.entryId} IS NULL) = (${t.recordDeletedAt} IS NOT NULL) AND (${t.entryId} IS NOT NULL OR ${t.status} IN ('ended','cancelled'))`,
    ),
    check("gym_held_memberships_tax_included_check", sql`${t.taxRateId} IS NULL OR ${t.taxIncluded} IS NOT NULL`),
    check("gym_held_memberships_freeze_fee_check", sql`${t.freezeFeeMinor} BETWEEN 0 AND 99999999`),
    check("gym_held_memberships_replaces_check", sql`${t.replacesId} IS NULL OR ${t.replacesId} <> ${t.id}`),
    check(
      "gym_held_memberships_full_from_check",
      sql`${t.fullFrom} IS NULL OR (${t.kind} = 'recurring' AND ${t.termUnit} IN ('month','year') AND ${t.fullFrom} > ${t.startsOn} AND ${t.fullFrom} <= ${t.startsOn} + 31)`,
    ),
    // `0152` clears only `replaces_id` when that row goes; Drizzle cannot say which column.
    foreignKey({
      name: "gym_held_memberships_replaces_fk",
      columns: [t.gymId, t.replacesId],
      foreignColumns: [t.gymId, t.id],
    }),
    index("gym_held_memberships_replaces_idx")
      .on(t.gymId, t.replacesId)
      .where(sql`${t.replacesId} IS NOT NULL`),
    unique("gym_held_memberships_request_uq").on(t.gymId, t.requestKey),
    // What a bill's key points at, with its gym (0093).
    unique("gym_held_memberships_gym_id_uq").on(t.gymId, t.id),
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
    check("gym_held_memberships_gift_days_check", sql`${t.giftDays} BETWEEN 0 AND 36500 AND ${t.giftFrom} >= 0`),
    check("gym_held_memberships_frozen_check", sql`(${t.status} = 'frozen') = (${t.frozenOn} IS NOT NULL)`),
    check("gym_held_memberships_cancelled_check", sql`(${t.status} = 'cancelled') = (${t.cancelledOn} IS NOT NULL)`),
    check(
      "gym_held_memberships_paid_check",
      sql`${t.paidFloor} >= 0 AND ${t.paidPeriods} >= ${t.paidFloor} AND (${t.kind} = 'recurring' OR (${t.paidPeriods} <= 1 AND ${t.paidFloor} = 0)) AND (${t.priceMinor} > 0 OR ${t.paidPeriods} = 0)`,
    ),
    check("gym_held_memberships_renews_check", sql`${t.kind} = 'recurring' OR NOT ${t.renews}`),
    check(
      "gym_held_memberships_discount_check",
      sql`(${t.discountId} IS NULL) = (${t.discountName} IS NULL) AND (${t.discountId} IS NULL) = (${t.discountPayments} IS NULL) AND CASE WHEN ${t.discountId} IS NULL THEN ${t.discountMinor} = 0 ELSE ${t.discountMinor} BETWEEN 1 AND 99999999 AND ${t.discountPayments} IN ('first','every') AND (${t.discountPayments} = 'every' OR ${t.kind} = 'recurring') END`,
    ),
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
    index("gym_held_memberships_discount_idx")
      .on(t.gymId, t.discountId)
      .where(sql`${t.discountId} IS NOT NULL`),
    // `0112` clears only `tax_rate_id` when the rate goes; Drizzle cannot say which column.
    foreignKey({
      name: "gym_held_memberships_tax_rate_fk",
      columns: [t.gymId, t.taxRateId],
      foreignColumns: [gymTaxRates.gymId, gymTaxRates.id],
    }),
    index("gym_held_memberships_tax_rate_idx")
      .on(t.gymId, t.taxRateId)
      .where(sql`${t.taxRateId} IS NOT NULL`),
  ],
);

/** One bill of a gym's notebook (§14.2; 18a-i): one period of one held membership.
 *  Mirrors `0093_member_bills.sql` and `0094`'s three columns for a bill staff
 *  cancelled. Whether it reads Due or Overdue is worked out by `memberBillState` in
 *  `@app/shared`, never stored. */
export const gymMemberBills = pgTable(
  "gym_member_bills",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    heldMembershipId: uuid("held_membership_id").notNull(),
    /** Null on a fee alone (0136; 18h-i). */
    periodIndex: integer("period_index"),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    dueOn: date("due_on").notNull(),
    /** The days it is for, as they were when it was opened; null for one period. */
    coversFrom: date("covers_from"),
    coversTo: date("covers_to"),
    status: text("status").notNull().default("open"),
    /** Set together where staff cancelled it; null on one cancelled with its membership. */
    voidReason: text("void_reason"),
    voidedOn: date("voided_on"),
    voidedBy: uuid("voided_by").references(() => users.id, { onDelete: "set null" }),
    /** The tax inside `amount_minor`, as the bill was opened (0112): how much, the rate's
     *  percentage and name then, and whether the price held it. 0 and nulls for none. */
    taxMinor: integer("tax_minor").notNull().default(0),
    taxBp: integer("tax_bp").notNull().default(0),
    taxName: text("tax_name"),
    taxIncluded: boolean("tax_included"),
    /** A fee for a late cancel or a no-show (0136; 18h-i): which, the class's name, and the
     *  booking while it stands. The class's day is `covers_from` and `covers_to`. */
    fee: text("fee"),
    feeFor: text("fee_for"),
    classBookingId: uuid("class_booking_id"),
    /** A personal training session's fee (0138; 18h-ii): the session while it stands. */
    ptAppointmentId: uuid("pt_appointment_id"),
    /** The type's joining fee inside `amount_minor`, before any tax added on top (0150; 18t):
     *  on the bill opened when the membership was given; 0 on every other. */
    joiningFeeMinor: integer("joining_fee_minor").notNull().default(0),
    /** What the membership it replaced had paid for the days not yet used, before tax, taken off
     *  this first bill (0152; 18x): not inside `amount_minor`; 0 on every other. */
    changeCreditMinor: integer("change_credit_minor").notNull().default(0),
    /** On a bill of a membership changed for another (0152; 18x): the money whose days moved to
     *  the new one, never refunded from this bill. 0 on every other. */
    movedMinor: integer("moved_minor").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "gym_member_bills_joining_fee_check",
      sql`${t.joiningFeeMinor} >= 0 AND ${t.joiningFeeMinor} <= ${t.amountMinor} AND (${t.joiningFeeMinor} = 0 OR ${t.periodIndex} IS NOT NULL)`,
    ),
    check("gym_member_bills_moved_check", sql`${t.movedMinor} BETWEEN 0 AND ${t.amountMinor}`),
    check(
      "gym_member_bills_change_credit_check",
      sql`${t.changeCreditMinor} BETWEEN 0 AND 99999999 AND (${t.changeCreditMinor} = 0 OR ${t.periodIndex} IS NOT NULL)`,
    ),
    check(
      "gym_member_bills_fee_check",
      sql`(${t.periodIndex} IS NULL) = (${t.fee} IS NOT NULL) AND (${t.fee} IS NULL OR (${t.fee} IN ('late_cancel','no_show','freeze') AND char_length(${t.feeFor}) BETWEEN 1 AND 80 AND ${t.coversFrom} IS NOT NULL)) AND (${t.fee} IS NOT NULL OR ${t.feeFor} IS NULL) AND (${t.classBookingId} IS NULL OR ${t.fee} IS NOT NULL) AND (${t.fee} <> 'freeze' OR (${t.classBookingId} IS NULL AND ${t.ptAppointmentId} IS NULL))`,
    ),
    // `0136` holds its foreign key, which sets the booking to null when it goes.
    // One freeze fee a month of a membership (0155; 18z); a waived one counts.
    uniqueIndex("gym_member_bills_freeze_fee_uq")
      .on(t.heldMembershipId, t.coversFrom)
      .where(sql`${t.fee} = 'freeze' AND (${t.status} <> 'void' OR ${t.voidReason} = 'waived')`),
    uniqueIndex("gym_member_bills_class_fee_uq").on(t.classBookingId).where(sql`${t.classBookingId} IS NOT NULL AND ${t.status} <> 'void'`),
    // `0138` holds the session's foreign key, which sets it to null when the session goes.
    check("gym_member_bills_pt_fee_check", sql`(${t.ptAppointmentId} IS NULL OR ${t.fee} IS NOT NULL) AND (${t.ptAppointmentId} IS NULL OR ${t.classBookingId} IS NULL)`),
    uniqueIndex("gym_member_bills_pt_fee_uq").on(t.ptAppointmentId).where(sql`${t.ptAppointmentId} IS NOT NULL AND ${t.status} <> 'void'`),
    index("gym_member_bills_pt_appointment_idx").on(t.ptAppointmentId).where(sql`${t.ptAppointmentId} IS NOT NULL`),
    check(
      "gym_member_bills_tax_check",
      sql`${t.taxBp} BETWEEN 0 AND 3000 AND (${t.taxName} IS NULL) = (${t.taxBp} = 0) AND (${t.taxName} IS NULL) = (${t.taxIncluded} IS NULL) AND ${t.taxMinor} >= 0 AND ${t.taxMinor} < ${t.amountMinor} AND (${t.taxBp} > 0 OR ${t.taxMinor} = 0) AND (${t.taxName} IS NULL OR char_length(${t.taxName}) BETWEEN 1 AND 30)`,
    ),
    unique("gym_member_bills_period_uq").on(t.heldMembershipId, t.periodIndex),
    check(
      "gym_member_bills_void_check",
      sql`(${t.voidReason} IS NULL) = (${t.voidedOn} IS NULL) AND (${t.voidReason} IS NOT NULL OR ${t.voidedBy} IS NULL) AND (${t.voidReason} IS NULL OR (${t.status} = 'void' AND ${t.voidReason} IN ('mistake','not_charging','other','waived'))) AND (${t.voidReason} <> 'waived' OR ${t.fee} IS NOT NULL)`,
    ),
    unique("gym_member_bills_gym_id_uq").on(t.gymId, t.id),
    check("gym_member_bills_period_check", sql`${t.periodIndex} BETWEEN 0 AND 100000`),
    check("gym_member_bills_amount_check", sql`${t.amountMinor} BETWEEN 1 AND 99999999`),
    check("gym_member_bills_currency_check", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("gym_member_bills_status_check", sql`${t.status} IN ('open','paid','void','refunded')`),
    check(
      "gym_member_bills_covers_check",
      sql`(${t.coversFrom} IS NULL) = (${t.coversTo} IS NULL) AND (${t.coversFrom} IS NULL OR ${t.coversTo} >= ${t.coversFrom})`,
    ),
    foreignKey({
      name: "gym_member_bills_membership_fk",
      columns: [t.gymId, t.heldMembershipId],
      foreignColumns: [gymHeldMemberships.gymId, gymHeldMemberships.id],
    }).onDelete("cascade"),
    index("gym_member_bills_open_idx").on(t.gymId, t.dueOn).where(sql`${t.status} = 'open'`),
    index("gym_member_bills_staff_void_idx").on(t.gymId).where(sql`${t.status} = 'void' AND ${t.voidReason} IS NOT NULL`),
    index("gym_member_bills_refunded_idx").on(t.gymId).where(sql`${t.status} = 'refunded'`),
  ],
);

/** One payment recorded against a bill. `seq` is the order they were recorded in (an
 *  identity column in `0093`); a payment taken back keeps its row, with `undone_at`. */
export const gymMemberPayments = pgTable(
  "gym_member_payments",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    billId: uuid("bill_id").notNull(),
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity().notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    method: text("method").notNull(),
    provider: text("provider"),
    providerPaymentId: text("provider_payment_id"),
    requestKey: uuid("request_key").notNull(),
    paidOn: date("paid_on").notNull(),
    recordedBy: uuid("recorded_by").references(() => users.id, { onDelete: "set null" }),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
    undoneBy: uuid("undone_by").references(() => users.id, { onDelete: "set null" }),
    /** Why staff voided it, picked from a list (0126; 18o); null for one voided before. */
    voidReason: text("void_reason"),
    /** Its receipt's number, the gym's own (0114; 18g-i). */
    receiptNumber: integer("receipt_number").notNull(),
    /** Who paid, as their record was named when it was recorded, where somebody else on the
     *  gym's list pays for this person (0140; 18i); null where they paid for themselves. */
    paidByName: text("paid_by_name"),
    /** That record while it is on the list (0140): a join moves it, and a record deleted for good
     *  blanks the name first and marks `paidByDeleted`, as a payment's own person deleted reads. */
    paidByEntryId: uuid("paid_by_entry_id"),
    paidByDeleted: boolean("paid_by_deleted").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    check("gym_member_payments_paid_by_name_check", sql`${t.paidByName} IS NULL OR char_length(${t.paidByName}) <= 120`),
    check("gym_member_payments_paid_by_check", sql`NOT ${t.paidByDeleted} OR (${t.paidByName} IS NULL AND ${t.paidByEntryId} IS NULL)`),
    // Its `(gym_id, paid_by_entry_id)` key to the gym's list, ON DELETE SET NULL (paid_by_entry_id),
    // is in `0140_member_payers.sql` alone: Drizzle's builder cannot say a column list.
    index("gym_member_payments_paid_by_idx").on(t.gymId, t.paidByEntryId).where(sql`${t.paidByEntryId} IS NOT NULL`),
    check(
      "gym_member_payments_void_reason_check",
      sql`${t.voidReason} IS NULL OR (${t.undoneAt} IS NOT NULL AND ${t.voidReason} IN ('mistake','wrong_amount','wrong_person','other'))`,
    ),
    unique("gym_member_payments_receipt_uq").on(t.gymId, t.receiptNumber),
    check("gym_member_payments_receipt_check", sql`${t.receiptNumber} >= 1`),
    unique("gym_member_payments_request_uq").on(t.gymId, t.requestKey),
    unique("gym_member_payments_gym_id_uq").on(t.gymId, t.id),
    check("gym_member_payments_amount_check", sql`${t.amountMinor} BETWEEN 1 AND 99999999`),
    check("gym_member_payments_currency_check", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("gym_member_payments_method_check", sql`${t.method} IN ('cash','card_at_desk','bank_transfer','link','company','terminal')`),
    check(
      "gym_member_payments_provider_check",
      sql`(${t.method} IN ('company','terminal')) = (${t.provider} IS NOT NULL) AND (${t.provider} IS NULL) = (${t.providerPaymentId} IS NULL) AND (${t.provider} IS NULL OR (char_length(${t.provider}) BETWEEN 1 AND 40 AND char_length(${t.providerPaymentId}) BETWEEN 1 AND 200))`,
    ),
    foreignKey({
      name: "gym_member_payments_bill_fk",
      columns: [t.gymId, t.billId],
      foreignColumns: [gymMemberBills.gymId, gymMemberBills.id],
    }).onDelete("cascade"),
    uniqueIndex("gym_member_payments_provider_uq").on(t.gymId, t.provider, t.providerPaymentId).where(sql`${t.provider} IS NOT NULL`),
    index("gym_member_payments_bill_idx").on(t.gymId, t.billId),
  ],
);

/** One refund noted against a payment (§14.2; 18a-ii): the gym's note that it gave
 *  money back. Mirrors `0094_member_refunds.sql`; one taken back keeps its row. */
export const gymMemberRefunds = pgTable(
  "gym_member_refunds",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    paymentId: uuid("payment_id").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    method: text("method").notNull(),
    reason: text("reason").notNull(),
    requestKey: uuid("request_key").notNull(),
    refundedOn: date("refunded_on").notNull(),
    recordedBy: uuid("recorded_by").references(() => users.id, { onDelete: "set null" }),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
    undoneBy: uuid("undone_by").references(() => users.id, { onDelete: "set null" }),
    /** Why staff voided it, picked from a list (0126; 18o); null for one voided before. */
    voidReason: text("void_reason"),
    /** Its receipt's number, the gym's own (0114; 18g-i). */
    receiptNumber: integer("receipt_number").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "gym_member_refunds_void_reason_check",
      sql`${t.voidReason} IS NULL OR (${t.undoneAt} IS NOT NULL AND ${t.voidReason} IN ('mistake','wrong_amount','other'))`,
    ),
    unique("gym_member_refunds_receipt_uq").on(t.gymId, t.receiptNumber),
    check("gym_member_refunds_receipt_check", sql`${t.receiptNumber} >= 1`),
    unique("gym_member_refunds_request_uq").on(t.gymId, t.requestKey),
    check("gym_member_refunds_amount_check", sql`${t.amountMinor} BETWEEN 1 AND 99999999`),
    check("gym_member_refunds_currency_check", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("gym_member_refunds_method_check", sql`${t.method} IN ('cash','card_at_desk','bank_transfer')`),
    check("gym_member_refunds_reason_check", sql`${t.reason} IN ('paid_twice','charged_too_much','leaving','other')`),
    foreignKey({
      name: "gym_member_refunds_payment_fk",
      columns: [t.gymId, t.paymentId],
      foreignColumns: [gymMemberPayments.gymId, gymMemberPayments.id],
    }).onDelete("cascade"),
    index("gym_member_refunds_payment_idx").on(t.gymId, t.paymentId),
  ],
);

/** One person's booking of one class (§13.4; 17c-i). Mirrors `0075_class_bookings.sql`,
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
