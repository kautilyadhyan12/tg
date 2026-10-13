// THE REGISTER (Part 3 §14.3; ROADMAP Stage 2 items 18b-i and 18b-ii-a). Mirrors
// `0102_register.sql` and `0103_discounts.sql` 1:1; the migrations carry the reasoning.
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
import { gymMemberListEntries } from "./memberList.js";
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
    taxed: boolean("taxed").notNull().default(true),
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
  ],
);

/** One discount a gym offers (`0103`): a percentage or a fixed amount, with or without a
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
        ${t.percentBp} IS NOT NULL AND ${t.percentBp} BETWEEN 1 AND 10000
        AND ${t.amountMinor} IS NULL AND ${t.currency} IS NULL
      ELSE
        ${t.amountMinor} IS NOT NULL AND ${t.amountMinor} BETWEEN 1 AND 99999999
        AND ${t.percentBp} IS NULL AND ${t.currency} IS NOT NULL AND ${t.currency} ~ '^[A-Z]{3}$'
      END`,
    ),
    check("gym_discounts_days_check", sql`${t.startsOn} IS NULL OR ${t.endsOn} IS NULL OR ${t.endsOn} >= ${t.startsOn}`),
    check("gym_discounts_uses_check", sql`${t.uses} >= 0 AND (${t.maxUses} IS NULL OR ${t.maxUses} BETWEEN 1 AND 100000)`),
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

/** One sale of a product: what staff say they were handed. The name, price and tax are the
 *  sale's own, as they were when it was sold. One taken back keeps its row, with
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
    currency: text("currency").notNull(),
    method: text("method").notNull(),
    soldOn: date("sold_on").notNull(),
    recordedBy: uuid("recorded_by").references(() => users.id, { onDelete: "set null" }),
    stockCounted: boolean("stock_counted").notNull().default(false),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
    undoneBy: uuid("undone_by").references(() => users.id, { onDelete: "set null" }),
    discountId: uuid("discount_id"),
    discountName: text("discount_name"),
    discountMinor: integer("discount_minor").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique("gym_sales_request_uq").on(t.gymId, t.requestKey),
    unique("gym_sales_gym_id_uq").on(t.gymId, t.id),
    check("gym_sales_name_check", sql`char_length(${t.itemName}) BETWEEN 1 AND 80`),
    check("gym_sales_quantity_check", sql`${t.quantity} BETWEEN 1 AND 99`),
    check(
      "gym_sales_amounts_check",
      sql`${t.unitPriceMinor} BETWEEN 1 AND 99999999 AND ${t.netMinor} >= 0 AND ${t.taxMinor} >= 0 AND ${t.totalMinor} BETWEEN 1 AND 99999999 AND ${t.netMinor} + ${t.taxMinor} = ${t.totalMinor}`,
    ),
    check("gym_sales_tax_check", sql`${t.taxBp} BETWEEN 0 AND 3000 AND (${t.taxBp} > 0 OR ${t.taxMinor} = 0)`),
    check("gym_sales_currency_check", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("gym_sales_method_check", sql`${t.method} IN ('cash','card_at_desk','bank_transfer')`),
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
      sql`(${t.discountId} IS NULL) = (${t.discountName} IS NULL) AND CASE WHEN ${t.discountId} IS NULL THEN ${t.discountMinor} = 0 ELSE ${t.discountMinor} BETWEEN 0 AND ${t.unitPriceMinor} * ${t.quantity} - 1 END`,
    ),
    foreignKey({
      name: "gym_sales_discount_fk",
      columns: [t.gymId, t.discountId],
      foreignColumns: [gymDiscounts.gymId, gymDiscounts.id],
    }).onDelete("cascade"),
    index("gym_sales_discount_idx")
      .on(t.gymId, t.discountId)
      .where(sql`${t.discountId} IS NOT NULL`),
    index("gym_sales_day_idx").on(t.gymId, t.soldOn, t.seq),
    index("gym_sales_entry_idx")
      .on(t.gymId, t.entryId, t.seq)
      .where(sql`${t.entryId} IS NOT NULL`),
  ],
);
