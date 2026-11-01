// THE REGISTER (Part 3 §14.3; ROADMAP Stage 2 items 18b-i, 18b-ii-a and 18b-ii-b). Mirrors
// `0102_register.sql`, `0104_discounts.sql`, `0107_membership_discounts.sql` and `0112_tax_rates.sql` and `0128_sale_refunds.sql` and `0135_sale_baskets.sql` 1:1; the migrations carry the reasoning.
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
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt } from "./common.js";
import { gymMemberListEntries } from "./memberList.js";
import { gymMembershipTypes } from "./memberships.js";
import { gymTaxRates } from "./tax.js";
import { gyms } from "./tenancy.js";
import { users } from "./identity.js";

/** One thing a gym sells at the desk. `price_minor` is whole minor units of `currency`,
 *  stamped by the server from the gym's country. */
export const gymProducts = pgTable(
  "gym_products",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    priceMinor: integer("price_minor").notNull(),
    currency: text("currency").notNull(),
    /** The gym's tax rate it charges; null for none. */
    taxRateId: uuid("tax_rate_id"),
    /** How many are left; null where the gym does not count it. */
    stock: integer("stock"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("gym_products_gym_id_uq").on(t.gymId, t.id),
    check("gym_products_name_check", sql`char_length(${t.name}) BETWEEN 1 AND 80`),
    check("gym_products_price_check", sql`${t.priceMinor} BETWEEN 1 AND 99999999`),
    check("gym_products_currency_check", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("gym_products_stock_check", sql`${t.stock} IS NULL OR ${t.stock} BETWEEN 0 AND 100000`),
    uniqueIndex("gym_products_name_uq")
      .on(t.gymId, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} IS NULL`),
    // `0112` clears only `tax_rate_id` when the rate goes; Drizzle cannot say which column.
    foreignKey({
      name: "gym_products_tax_rate_fk",
      columns: [t.gymId, t.taxRateId],
      foreignColumns: [gymTaxRates.gymId, gymTaxRates.id],
    }),
    index("gym_products_tax_rate_idx")
      .on(t.gymId, t.taxRateId)
      .where(sql`${t.taxRateId} IS NOT NULL`),
  ],
);

/** One discount a gym offers (`0104`): a percentage or a fixed amount, with or without a
 *  promo code. `uses` counts the sales made with it that still stand. */
export const gymDiscounts = pgTable(
  "gym_discounts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code"),
    kind: text("kind").notNull(),
    percentBp: integer("percent_bp"),
    amountMinor: integer("amount_minor"),
    currency: text("currency"),
    startsOn: date("starts_on"),
    endsOn: date("ends_on"),
    maxUses: integer("max_uses"),
    uses: integer("uses").notNull().default(0),
    allProducts: boolean("all_products").notNull().default(true),
    forProducts: boolean("for_products").notNull().default(true),
    forMemberships: boolean("for_memberships").notNull().default(false),
    allMembershipTypes: boolean("all_membership_types").notNull().default(true),
    membershipPayments: text("membership_payments"),
    /** Refer a friend's own friend's gift (0119): given only to a friend a member invited. */
    referralGift: boolean("referral_gift").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("gym_discounts_gym_id_uq").on(t.gymId, t.id),
    check("gym_discounts_name_check", sql`char_length(${t.name}) BETWEEN 1 AND 60`),
    check("gym_discounts_code_check", sql`${t.code} IS NULL OR ${t.code} ~ '^[A-Z0-9]{3,20}$'`),
    check("gym_discounts_kind_check", sql`${t.kind} IN ('percent','amount')`),
    check(
      "gym_discounts_shape_check",
      sql`CASE WHEN ${t.kind} = 'percent' THEN
        ${t.percentBp} IS NOT NULL AND ${t.percentBp} BETWEEN 1 AND 9999
        AND ${t.amountMinor} IS NULL AND ${t.currency} IS NULL
      ELSE
        ${t.amountMinor} IS NOT NULL AND ${t.amountMinor} BETWEEN 1 AND 99999999
        AND ${t.percentBp} IS NULL AND ${t.currency} IS NOT NULL AND ${t.currency} ~ '^[A-Z]{3}$'
      END`,
    ),
    check("gym_discounts_days_check", sql`${t.startsOn} IS NULL OR ${t.endsOn} IS NULL OR ${t.endsOn} >= ${t.startsOn}`),
    check("gym_discounts_uses_check", sql`${t.uses} >= 0 AND (${t.maxUses} IS NULL OR ${t.maxUses} BETWEEN 1 AND 100000)`),
    check(
      "gym_discounts_applies_check",
      sql`(${t.forProducts} OR ${t.forMemberships}) AND (${t.forProducts} OR ${t.allProducts}) AND (${t.forMemberships} OR ${t.allMembershipTypes}) AND (${t.forMemberships} = (${t.membershipPayments} IS NOT NULL)) AND (${t.membershipPayments} IS NULL OR ${t.membershipPayments} IN ('first','every'))`,
    ),
    uniqueIndex("gym_discounts_name_uq")
      .on(t.gymId, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} IS NULL`),
    uniqueIndex("gym_discounts_code_uq")
      .on(t.gymId, t.code)
      .where(sql`${t.archivedAt} IS NULL AND ${t.code} IS NOT NULL`),
  ],
);

/** The products a discount is limited to. */
export const gymDiscountProducts = pgTable(
  "gym_discount_products",
  {
    gymId: uuid("gym_id").notNull(),
    discountId: uuid("discount_id").notNull(),
    productId: uuid("product_id").notNull(),
  },
  (t) => [
    primaryKey({ name: "gym_discount_products_pk", columns: [t.discountId, t.productId] }),
    foreignKey({
      name: "gym_discount_products_discount_fk",
      columns: [t.gymId, t.discountId],
      foreignColumns: [gymDiscounts.gymId, gymDiscounts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "gym_discount_products_product_fk",
      columns: [t.gymId, t.productId],
      foreignColumns: [gymProducts.gymId, gymProducts.id],
    }).onDelete("cascade"),
    index("gym_discount_products_gym_idx").on(t.gymId),
    index("gym_discount_products_product_idx").on(t.productId),
  ],
);

/** The membership types a discount is limited to (`0107`). */
export const gymDiscountMembershipTypes = pgTable(
  "gym_discount_membership_types",
  {
    gymId: uuid("gym_id").notNull(),
    discountId: uuid("discount_id").notNull(),
    membershipTypeId: uuid("membership_type_id").notNull(),
  },
  (t) => [
    primaryKey({ name: "gym_discount_membership_types_pk", columns: [t.discountId, t.membershipTypeId] }),
    foreignKey({
      name: "gym_discount_membership_types_discount_fk",
      columns: [t.gymId, t.discountId],
      foreignColumns: [gymDiscounts.gymId, gymDiscounts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "gym_discount_membership_types_type_fk",
      columns: [t.gymId, t.membershipTypeId],
      foreignColumns: [gymMembershipTypes.gymId, gymMembershipTypes.id],
    }).onDelete("cascade"),
    index("gym_discount_membership_types_gym_idx").on(t.gymId),
    index("gym_discount_membership_types_type_idx").on(t.membershipTypeId),
  ],
);

/** One product of a sale: what staff say they were handed. The name, price and tax are the
 *  line's own, as they were when it was sold. The lines of one sale (18q) share its receipt
 *  number, request key, buyer, payment and day. One taken back keeps its row, with
 *  `undone_at`. */
export const gymSales = pgTable(
  "gym_sales",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    seq: bigint("seq", { mode: "bigint" }).generatedAlwaysAsIdentity().notNull(),
    requestKey: uuid("request_key").notNull(),
    productId: uuid("product_id").notNull(),
    /** Who bought it; null for a walk-in. */
    entryId: uuid("entry_id"),
    itemName: text("item_name").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceMinor: integer("unit_price_minor").notNull(),
    netMinor: integer("net_minor").notNull(),
    taxMinor: integer("tax_minor").notNull(),
    totalMinor: integer("total_minor").notNull(),
    taxBp: integer("tax_bp").notNull(),
    taxIncluded: boolean("tax_included").notNull(),
    taxName: text("tax_name"),
    currency: text("currency").notNull(),
    method: text("method").notNull(),
    /** Square's payment, for a sale paid on the Terminal (0153; 18d-vi-b-ii). */
    squarePaymentId: text("square_payment_id"),
    soldOn: date("sold_on").notNull(),
    recordedBy: uuid("recorded_by").references(() => users.id, { onDelete: "set null" }),
    stockCounted: boolean("stock_counted").notNull().default(false),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
    undoneBy: uuid("undone_by").references(() => users.id, { onDelete: "set null" }),
    /** Why staff voided it, picked from a list (0126; 18o); null for one voided before. */
    voidReason: text("void_reason"),
    discountId: uuid("discount_id"),
    discountName: text("discount_name"),
    discountMinor: integer("discount_minor").notNull().default(0),
    /** Its receipt's number, the gym's own (0114; 18g-i). */
    receiptNumber: integer("receipt_number").notNull(),
    /** Sold to somebody on the gym's list, kept after their record is deleted for good (0114). */
    forMember: boolean("for_member").notNull().default(false),
    /** Its discount line is a member's Refer a friend gift (0121), not one of the gym's discounts. */
    memberGift: boolean("member_gift").notNull().default(false),
    /** Its place in its sale, from 1 (0135; 18q). */
    lineNo: smallint("line_no").notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [
    check("gym_sales_line_no_check", sql`${t.lineNo} BETWEEN 1 AND 20`),
    unique("gym_sales_basket_product_uq").on(t.gymId, t.receiptNumber, t.productId),
    check(
      "gym_sales_void_reason_check",
      sql`${t.voidReason} IS NULL OR (${t.undoneAt} IS NOT NULL AND ${t.voidReason} IN ('mistake','wrong_item','returned','other'))`,
    ),
    unique("gym_sales_receipt_uq").on(t.gymId, t.receiptNumber, t.lineNo),
    check("gym_sales_receipt_check", sql`${t.receiptNumber} >= 1`),
    check("gym_sales_for_member_check", sql`${t.entryId} IS NULL OR ${t.forMember}`),
    unique("gym_sales_request_uq").on(t.gymId, t.requestKey, t.lineNo),
    unique("gym_sales_gym_id_uq").on(t.gymId, t.id),
    check("gym_sales_name_check", sql`char_length(${t.itemName}) BETWEEN 1 AND 80`),
    check("gym_sales_quantity_check", sql`${t.quantity} BETWEEN 1 AND 99`),
    check(
      "gym_sales_amounts_check",
      sql`${t.unitPriceMinor} BETWEEN 1 AND 99999999 AND ${t.netMinor} >= 0 AND ${t.taxMinor} >= 0 AND ${t.totalMinor} BETWEEN 1 AND 99999999 AND ${t.netMinor} + ${t.taxMinor} = ${t.totalMinor}`,
    ),
    check("gym_sales_tax_check", sql`${t.taxBp} BETWEEN 0 AND 3000 AND (${t.taxBp} > 0 OR ${t.taxMinor} = 0)`),
    check("gym_sales_tax_name_check", sql`${t.taxName} IS NULL OR char_length(${t.taxName}) BETWEEN 1 AND 30`),
    check("gym_sales_currency_check", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("gym_sales_method_check", sql`${t.method} IN ('cash','upi','card_at_desk','bank_transfer','terminal')`),
    check(
      "gym_sales_square_payment_check",
      sql`(${t.method} = 'terminal') = (${t.squarePaymentId} IS NOT NULL) AND (${t.squarePaymentId} IS NULL OR ${t.squarePaymentId} ~ '^[A-Za-z0-9_-]{1,192}$')`,
    ),
    foreignKey({
      name: "gym_sales_product_fk",
      columns: [t.gymId, t.productId],
      foreignColumns: [gymProducts.gymId, gymProducts.id],
    }).onDelete("cascade"),
    // `0102` sets only `entry_id` to null when the record goes; Drizzle cannot say which column.
    foreignKey({
      name: "gym_sales_entry_fk",
      columns: [t.gymId, t.entryId],
      foreignColumns: [gymMemberListEntries.gymId, gymMemberListEntries.id],
    }),
    check(
      "gym_sales_discount_check",
      sql`CASE WHEN ${t.memberGift} THEN ${t.discountId} IS NULL AND ${t.discountName} IS NOT NULL AND ${t.discountMinor} BETWEEN 1 AND ${t.unitPriceMinor} * ${t.quantity} - 1
        ELSE (${t.discountId} IS NULL) = (${t.discountName} IS NULL) AND CASE WHEN ${t.discountId} IS NULL THEN ${t.discountMinor} = 0 ELSE ${t.discountMinor} BETWEEN 1 AND ${t.unitPriceMinor} * ${t.quantity} - 1 END END`,
    ),
    foreignKey({
      name: "gym_sales_discount_fk",
      columns: [t.gymId, t.discountId],
      foreignColumns: [gymDiscounts.gymId, gymDiscounts.id],
    }),
    index("gym_sales_discount_idx")
      .on(t.gymId, t.discountId)
      .where(sql`${t.discountId} IS NOT NULL`),
    index("gym_sales_day_idx").on(t.gymId, t.soldOn, t.seq),
    index("gym_sales_entry_idx")
      .on(t.gymId, t.entryId, t.seq)
      .where(sql`${t.entryId} IS NOT NULL`),
  ],
);

/** One refund of a product sale: noted by staff (18p), or sent to the card through Square
 *  (18d-iv-b-ii). Mirrors `0128_sale_refunds.sql`; one voided keeps its row. */
export const gymSaleRefunds = pgTable(
  "gym_sale_refunds",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    gymId: uuid("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    saleId: uuid("sale_id").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    currency: text("currency").notNull(),
    method: text("method").notNull(),
    reason: text("reason").notNull(),
    /** How many of what was sold went back on the shelf with it. */
    restocked: integer("restocked").notNull().default(0),
    requestKey: uuid("request_key").notNull(),
    refundedOn: date("refunded_on").notNull(),
    recordedBy: uuid("recorded_by").references(() => users.id, { onDelete: "set null" }),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
    undoneBy: uuid("undone_by").references(() => users.id, { onDelete: "set null" }),
    voidReason: text("void_reason"),
    receiptNumber: integer("receipt_number").notNull(),
    /** The refund to the card it came from (0180; 18d-iv-b-ii); null for one noted by hand. */
    pressId: uuid("press_id"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("gym_sale_refunds_receipt_uq").on(t.gymId, t.receiptNumber),
    unique("gym_sale_refunds_request_uq").on(t.gymId, t.requestKey, t.saleId),
    index("gym_sale_refunds_press_idx").on(t.pressId).where(sql`${t.pressId} IS NOT NULL`),
    check("gym_sale_refunds_receipt_check", sql`${t.receiptNumber} >= 1`),
    check("gym_sale_refunds_amount_check", sql`${t.amountMinor} BETWEEN 1 AND 99999999`),
    check("gym_sale_refunds_currency_check", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("gym_sale_refunds_method_check", sql`${t.method} IN ('cash','upi','card_at_desk','bank_transfer','terminal')`),
    check("gym_sale_refunds_reason_check", sql`${t.reason} IN ('returned','charged_too_much','faulty','other')`),
    check("gym_sale_refunds_restocked_check", sql`${t.restocked} BETWEEN 0 AND 99`),
    check(
      "gym_sale_refunds_void_reason_check",
      sql`${t.voidReason} IS NULL OR (${t.undoneAt} IS NOT NULL AND ${t.voidReason} IN ('mistake','wrong_amount','other','square_failed','in_square'))`,
    ),
    foreignKey({
      name: "gym_sale_refunds_sale_fk",
      columns: [t.gymId, t.saleId],
      foreignColumns: [gymSales.gymId, gymSales.id],
    }).onDelete("cascade"),
    index("gym_sale_refunds_sale_idx").on(t.gymId, t.saleId),
    index("gym_sale_refunds_day_idx").on(t.gymId, t.refundedOn),
  ],
);
