// Refer a friend (ROADMAP 20e-ii-a; spec Part 3 §16.3). Mirrors `0117_refer_a_friend.sql`
// and `0120_member_gift.sql`.
//
// A business's offer (its switch and its two gifts), and each member's own
// invite link at that business. The lead a link brings keeps who sent it on `gym_leads`.
import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, integer, pgTable, primaryKey, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./common.js";
import { users } from "./identity.js";
import { gymLeads } from "./leads.js";
import { gymMemberListEntries } from "./memberList.js";
import { gymMemberBills, gymMemberPayments } from "./memberships.js";
import { gymDiscounts, gymSales } from "./register.js";
import { gyms } from "./tenancy.js";

export const gymReferralSettings = pgTable(
  "gym_referral_settings",
  {
    gymId: uuid("gym_id")
      .primaryKey()
      .references(() => gyms.id, { onDelete: "cascade" }),
    switchedOn: boolean("switched_on").notNull().default(false),
    /** The member's gift, off their next payment (20e-ii-b gives it): percent or amount;
     *  null for none. */
    memberGiftKind: text("member_gift_kind"),
    memberPercentBp: integer("member_percent_bp"),
    memberAmountMinor: integer("member_amount_minor"),
    memberCurrency: text("member_currency"),
    /** The friend's gift: a discount with the promo code the app made; null for none. */
    friendDiscountId: uuid("friend_discount_id"),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "gym_referral_settings_member_gift_check",
      sql`CASE
        WHEN ${t.memberGiftKind} IS NULL THEN ${t.memberPercentBp} IS NULL AND ${t.memberAmountMinor} IS NULL AND ${t.memberCurrency} IS NULL
        WHEN ${t.memberGiftKind} = 'percent' THEN ${t.memberPercentBp} BETWEEN 1 AND 9999 AND ${t.memberAmountMinor} IS NULL AND ${t.memberCurrency} IS NULL
        WHEN ${t.memberGiftKind} = 'amount' THEN ${t.memberAmountMinor} BETWEEN 1 AND 99999999 AND ${t.memberPercentBp} IS NULL AND ${t.memberCurrency} ~ '^[A-Z]{3}$'
        ELSE false END`,
    ),
    check("gym_referral_settings_gift_check", sql`NOT ${t.switchedOn} OR ${t.memberGiftKind} IS NOT NULL OR ${t.friendDiscountId} IS NOT NULL`),
    foreignKey({
      name: "gym_referral_settings_friend_discount_fk",
      columns: [t.gymId, t.friendDiscountId],
      foreignColumns: [gymDiscounts.gymId, gymDiscounts.id],
    }),
  ],
);

export const gymReferralLinks = pgTable(
  "gym_referral_links",
  {
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** 16 of `a-z2-7`: 80 random bits. */
    code: text("code").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: "gym_referral_links_pk", columns: [t.gymId, t.userId] }),
    unique("gym_referral_links_code_uq").on(t.code),
    check("gym_referral_links_code_check", sql`${t.code} ~ '^[a-z2-7]{16}$'`),
  ],
);

/** The member's gift (20e-ii-b-ii-a): given to the member who invited a friend, once a friend,
 *  when that friend makes their first payment that stands; then taken off one bill or one sale
 *  of the member's, or taken back where the friend's payment was voided or refunded in full
 *  before it was used. The gift is kept as it was promised then. */
export const gymReferralMemberGifts = pgTable(
  "gym_referral_member_gifts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id").notNull(),
    /** The friend whose payment gave it, and the lead that brought them. */
    friendEntryId: uuid("friend_entry_id"),
    leadId: uuid("lead_id"),
    /** The member who invited them: the gift is for the record their account holds. */
    memberUserId: uuid("member_user_id"),
    kind: text("kind").notNull(),
    percentBp: integer("percent_bp"),
    amountMinor: integer("amount_minor"),
    currency: text("currency"),
    givenAt: timestamp("given_at", { withTimezone: true }).notNull(),
    givenOn: date("given_on").notNull(),
    /** The friend's payment, or desk sale, it was given for. */
    byPaymentId: uuid("by_payment_id"),
    bySaleId: uuid("by_sale_id"),
    usedAt: timestamp("used_at", { withTimezone: true }),
    usedBillId: uuid("used_bill_id"),
    usedSaleId: uuid("used_sale_id"),
    /** What it took off, before tax. */
    usedOffMinor: integer("used_off_minor"),
    usedCurrency: text("used_currency"),
    takenBackAt: timestamp("taken_back_at", { withTimezone: true }),
    takenBackOn: date("taken_back_on"),
    takenBackWhy: text("taken_back_why"),
  },
  (t) => [
    // Named by hand: the generated names pass Postgres's 63 characters.
    foreignKey({ name: "gym_referral_member_gifts_gym_fk", columns: [t.gymId], foreignColumns: [gyms.id] }).onDelete("cascade"),
    foreignKey({ name: "gym_referral_member_gifts_friend_fk", columns: [t.friendEntryId], foreignColumns: [gymMemberListEntries.id] }).onDelete("set null"),
    foreignKey({ name: "gym_referral_member_gifts_lead_fk", columns: [t.leadId], foreignColumns: [gymLeads.id] }).onDelete("set null"),
    foreignKey({ name: "gym_referral_member_gifts_member_fk", columns: [t.memberUserId], foreignColumns: [users.id] }).onDelete("set null"),
    foreignKey({ name: "gym_referral_member_gifts_by_payment_fk", columns: [t.byPaymentId], foreignColumns: [gymMemberPayments.id] }).onDelete("set null"),
    foreignKey({ name: "gym_referral_member_gifts_by_sale_fk", columns: [t.bySaleId], foreignColumns: [gymSales.id] }).onDelete("set null"),
    foreignKey({ name: "gym_referral_member_gifts_used_bill_fk", columns: [t.usedBillId], foreignColumns: [gymMemberBills.id] }).onDelete("set null"),
    foreignKey({ name: "gym_referral_member_gifts_used_sale_fk", columns: [t.usedSaleId], foreignColumns: [gymSales.id] }).onDelete("set null"),
    check("gym_referral_member_gifts_kind_check", sql`${t.kind} IN ('percent','amount')`),
    check(
      "gym_referral_member_gifts_shape_check",
      sql`CASE WHEN ${t.kind} = 'percent' THEN
        ${t.percentBp} BETWEEN 1 AND 9999 AND ${t.amountMinor} IS NULL AND ${t.currency} IS NULL
      ELSE
        ${t.amountMinor} BETWEEN 1 AND 99999999 AND ${t.percentBp} IS NULL AND ${t.currency} ~ '^[A-Z]{3}$'
      END`,
    ),
    check("gym_referral_member_gifts_by_check", sql`${t.byPaymentId} IS NULL OR ${t.bySaleId} IS NULL`),
    check(
      "gym_referral_member_gifts_used_check",
      sql`(${t.usedAt} IS NULL) = (${t.usedOffMinor} IS NULL) AND (${t.usedAt} IS NULL) = (${t.usedCurrency} IS NULL)
        AND (${t.usedOffMinor} IS NULL OR ${t.usedOffMinor} BETWEEN 1 AND 99999999)
        AND (${t.usedCurrency} IS NULL OR ${t.usedCurrency} ~ '^[A-Z]{3}$')
        AND (${t.usedBillId} IS NULL OR ${t.usedSaleId} IS NULL)`,
    ),
    check(
      "gym_referral_member_gifts_taken_back_check",
      sql`(${t.takenBackAt} IS NULL) = (${t.takenBackOn} IS NULL) AND (${t.takenBackAt} IS NULL) = (${t.takenBackWhy} IS NULL)
        AND (${t.takenBackWhy} IS NULL OR ${t.takenBackWhy} IN ('voided','refunded'))
        AND (${t.takenBackAt} IS NULL OR ${t.usedAt} IS NULL)`,
    ),
    // Once a friend: a gift taken back makes room for the one their next payment gives.
    uniqueIndex("gym_referral_member_gifts_friend_uq").on(t.gymId, t.friendEntryId).where(sql`${t.takenBackAt} IS NULL`),
    uniqueIndex("gym_referral_member_gifts_bill_uq").on(t.usedBillId).where(sql`${t.usedBillId} IS NOT NULL`),
    uniqueIndex("gym_referral_member_gifts_sale_uq").on(t.usedSaleId).where(sql`${t.usedSaleId} IS NOT NULL`),
    index("gym_referral_member_gifts_waiting_idx").on(t.gymId, t.memberUserId).where(sql`${t.usedAt} IS NULL AND ${t.takenBackAt} IS NULL`),
    index("gym_referral_member_gifts_payment_idx").on(t.byPaymentId).where(sql`${t.byPaymentId} IS NOT NULL`),
    index("gym_referral_member_gifts_by_sale_idx").on(t.bySaleId).where(sql`${t.bySaleId} IS NOT NULL`),
  ],
);
