// The register: the only file that reads or writes a gym's products and its sales (spec
// Part 3 §14.3; ROADMAP 18b-i). Its tax rates are `taxRepo.ts`'s (18b-iii). `memberList/repo.ts` moves a sale's person when
// two records are joined. A gym's discounts are `discountsRepo.ts`'s; a sale made with one
// counts its use here, in the sale's own transaction.
//
// Every statement carries `gym_id` in its WHERE, the ones holding a product's or a
// sale's id included. Every write takes the gym's row lock first, so the stock count, the
// name check and the same request arriving twice are decided against rows nobody else is
// changing.
import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";
import {
  PRODUCTS_MAX,
  SALE_LINES_MAX,
  PRODUCT_ARCHIVED_PAGE,
  discountFits,
  discountOff,
  memberGiftOff,
  MEMBER_GIFT_SALE_NAME,
  memberCurrencyForCountry,
  memberPaymentByHandSchema,
  refundSale as refundSaleCheck,
  refundVoidReasonSchema,
  saleAmounts,
  saleRefundReasonSchema,
  saleVoidReasonSchema,
  salePaymentMethodSchema,
  type DiscountRefusal,
  type RefundVoidReason,
  type SaleRefundReason,
  type SalesTax,
  type MemberPaymentByHand,
  type SalePaymentMethod,
  type SaleVoidReason,
} from "@app/shared";
import { insertAudit, lockOrgRow } from "../repo.js";
import { nextReceipt } from "../receipts/repo.js";
import { countUse, lockedDiscount, returnUse, takeUse, type DiscountRow } from "./discountsRepo.js";
import { friendGiftOpen } from "../referrals/friendGiftRepo.js";
import { friendPaymentGone, giftUseUndone, giveMemberGift, lockedWaitingGift, markUsed } from "../referrals/memberGiftRepo.js";
import { rateOf, readRates, taxIncludedOf } from "./taxRepo.js";

export interface ProductRow {
  id: string;
  name: string;
  priceMinor: number;
  currency: string;
  taxRateId: string | null;
  stock: number | null;
  archivedAt: Date | null;
  updatedAt: Date;
}

interface RawProduct {
  id: string;
  name: string;
  price_minor: number;
  currency: string;
  tax_rate_id: string | null;
  stock: number | null;
  archived_at: Date | null;
  updated_at: Date;
}

const product = (r: RawProduct): ProductRow => ({
  id: r.id,
  name: r.name,
  priceMinor: r.price_minor,
  currency: r.currency,
  taxRateId: r.tax_rate_id,
  stock: r.stock,
  archivedAt: r.archived_at,
  updatedAt: r.updated_at,
});

export interface SaleRow {
  id: string;
  itemName: string;
  quantity: number;
  unitPriceMinor: number;
  netMinor: number;
  taxMinor: number;
  totalMinor: number;
  taxBp: number;
  taxName: string | null;
  taxIncluded: boolean;
  discountName: string | null;
  discountMinor: number;
  /** The friend a member's Refer a friend gift on it was for inviting; null otherwise. */
  giftFor: string | null;
  currency: string;
  method: SalePaymentMethod;
  soldOn: string;
  soldAt: Date;
  by: string | null;
  person: { entryId: string; name: string } | null;
  /** Sold to somebody whose record was deleted for good since: no person, not a walk-in. */
  personDeleted: boolean;
  undone: boolean;
  /** Who voided it, on the gym's own day, and why (18o); null while it stands. */
  voided: { reason: SaleVoidReason | null; on: string; by: string | null } | null;
  receiptNumber: number;
  /** Its refunds, oldest first, voided ones too (18p). */
  refunds: SaleRefundRow[];
  /** What the refunds that stand gave back. */
  refundedMinor: number;
  stockCounted: boolean;
  /** Its place in its sale, from 1 (18q). */
  lineNo: number;
}

export interface SaleRefundRow {
  id: string;
  amountMinor: number;
  method: MemberPaymentByHand;
  reason: SaleRefundReason;
  restocked: number;
  refundedOn: string;
  by: string | null;
  receiptNumber: number;
  voided: { reason: RefundVoidReason; on: string; by: string | null } | null;
}

interface RawSale {
  id: string;
  item_name: string;
  quantity: number;
  unit_price_minor: number;
  net_minor: number;
  tax_minor: number;
  total_minor: number;
  tax_bp: number;
  tax_name: string | null;
  tax_included: boolean;
  discount_name: string | null;
  discount_minor: number;
  gift_for: string | null;
  currency: string;
  method: string;
  sold_on: string;
  created_at: Date;
  by: string | null;
  entry_id: string | null;
  person_name: string | null;
  for_member: boolean;
  undone: boolean;
  void_reason: string | null;
  voided_on: string | null;
  voided_by: string | null;
  receipt_number: number;
  refunded_minor: number;
  stock_counted: boolean;
  line_no: number;
}

/** A record with no name typed is still somebody: the row says so. */
export const NO_NAME = "No name on their record";

const sale = (r: RawSale): SaleRow => ({
  id: r.id,
  itemName: r.item_name,
  quantity: r.quantity,
  unitPriceMinor: r.unit_price_minor,
  netMinor: r.net_minor,
  taxMinor: r.tax_minor,
  totalMinor: r.total_minor,
  taxBp: r.tax_bp,
  taxName: r.tax_name,
  taxIncluded: r.tax_included,
  discountName: r.discount_name,
  discountMinor: r.discount_minor,
  giftFor: r.gift_for,
  currency: r.currency,
  // Text under a CHECK: parsed, so a method this build does not know fails here.
  method: salePaymentMethodSchema.parse(r.method),
  soldOn: r.sold_on,
  soldAt: r.created_at,
  by: r.by,
  person: r.entry_id === null ? null : { entryId: r.entry_id, name: r.person_name === null || r.person_name.trim() === "" ? NO_NAME : r.person_name },
  personDeleted: r.entry_id === null && r.for_member,
  undone: r.undone,
  voided:
    r.undone && r.voided_on !== null
      ? { reason: r.void_reason === null ? null : saleVoidReasonSchema.parse(r.void_reason), on: r.voided_on, by: r.voided_by }
      : null,
  receiptNumber: r.receipt_number,
  refunds: [],
  refundedMinor: r.refunded_minor,
  stockCounted: r.stock_counted,
  lineNo: r.line_no,
});

interface RawSaleRefund {
  id: string;
  sale_id: string;
  amount_minor: number;
  method: string;
  reason: string;
  restocked: number;
  refunded_on: string;
  by: string | null;
  receipt_number: number;
  void_reason: string | null;
  voided_on: string | null;
  voided_by: string | null;
}

/** The refunds of these sales, voided ones too, oldest first: one read for a list of sales. */
async function refundsOf(sql: Sql | TransactionSql, gymId: string, sales: SaleRow[]): Promise<SaleRow[]> {
  if (sales.length === 0) return sales;
  const rows = await sql<RawSaleRefund[]>`
    SELECT r.id, r.sale_id, r.amount_minor, r.method, r.reason, r.restocked, r.refunded_on::text AS refunded_on,
           u.display_name AS by, r.receipt_number, r.void_reason,
           CASE WHEN r.undone_at IS NOT NULL THEN (r.undone_at AT TIME ZONE g.timezone)::date::text END AS voided_on,
           v.display_name AS voided_by
    FROM gym_sale_refunds r
    JOIN gyms g ON g.id = r.gym_id
    LEFT JOIN users u ON u.id = r.recorded_by
    LEFT JOIN users v ON v.id = r.undone_by
    WHERE r.gym_id = ${gymId} AND r.sale_id = ANY(${sales.map((s) => s.id)}::uuid[])
    ORDER BY r.receipt_number`;
  const bySale = new Map<string, SaleRefundRow[]>();
  for (const r of rows) {
    const list = bySale.get(r.sale_id) ?? [];
    list.push({
      id: r.id,
      amountMinor: r.amount_minor,
      // Text under a CHECK: parsed, so a value this build does not know fails here.
      method: memberPaymentByHandSchema.parse(r.method),
      reason: saleRefundReasonSchema.parse(r.reason),
      restocked: r.restocked,
      refundedOn: r.refunded_on,
      by: r.by,
      receiptNumber: r.receipt_number,
      voided: r.voided_on === null ? null : { reason: refundVoidReasonSchema.parse(r.void_reason ?? ""), on: r.voided_on, by: r.voided_by },
    });
    bySale.set(r.sale_id, list);
  }
  return sales.map((s) => ({ ...s, refunds: bySale.get(s.id) ?? [] }));
}

/** The columns every read of a sale takes, from `gym_sales s` with its two joins. Who
 *  voided one and on what day are read on their own, for the few that were. */
const saleColumns = (sql: Sql | TransactionSql) => sql`
  s.id, s.item_name, s.quantity, s.unit_price_minor, s.net_minor, s.tax_minor, s.total_minor, s.tax_bp, s.tax_name, s.tax_included,
  s.discount_name, s.discount_minor,
  CASE WHEN s.member_gift THEN (
    SELECT NULLIF(btrim(f.full_name), '') FROM gym_referral_member_gifts g
    JOIN gym_member_list_entries f ON f.gym_id = g.gym_id AND f.id = g.friend_entry_id
    WHERE g.gym_id = s.gym_id AND g.used_sale_id = s.id
  ) END AS gift_for,
  s.currency, s.method, s.sold_on::text AS sold_on, s.created_at, u.display_name AS by, s.entry_id,
  e.full_name AS person_name, s.for_member, s.undone_at IS NOT NULL AS undone, s.void_reason,
  CASE WHEN s.undone_at IS NOT NULL THEN (s.undone_at AT TIME ZONE (SELECT g.timezone FROM gyms g WHERE g.id = s.gym_id))::date::text END AS voided_on,
  CASE WHEN s.undone_by IS NOT NULL THEN (SELECT v.display_name FROM users v WHERE v.id = s.undone_by) END AS voided_by,
  s.receipt_number, s.stock_counted, s.line_no,
  COALESCE((SELECT sum(f.amount_minor) FROM gym_sale_refunds f
            WHERE f.gym_id = s.gym_id AND f.sale_id = s.id AND f.undone_at IS NULL), 0)::int AS refunded_minor`;

export interface RegisterRow {
  country: string | null;
  tax: SalesTax;
  products: ProductRow[];
  archived: ProductRow[];
  archivedTotal: number;
  /** Every line of the newest sales of the day. */
  sales: SaleRow[];
  /** The day's sales, each counted once however many lines it has (18q). */
  salesTotal: number;
  /** The day's sales that stand, added up in each money they were taken in; `count` counts sales. */
  totals: { currency: string; count: number; totalMinor: number; taxMinor: number; discountMinor: number; cash: number; card_at_desk: number; bank_transfer: number; terminal: number }[];
  /** Refunds of sales noted on the day that stand, in each money (18p). */
  refunds: { currency: string; totalMinor: number }[];
}

/** The Sell page in one go, or null where the gym does not exist: what is on sale (bounded
 *  by the cap the writes hold), a page of what was archived, and the sales of `day` (today, or
 *  an earlier day staff picked, 18p). A sale names who bought it, so the day's sales are read
 *  only `withSales`. */
export async function readRegister(
  sql: Sql | TransactionSql,
  gymId: string,
  today: string,
  day: string,
  salesShown: number,
  withSales: boolean,
): Promise<RegisterRow | null> {
  const readProducts = (archived: boolean, limit: number) => sql<RawProduct[]>`
    SELECT id, name, price_minor, currency, tax_rate_id, stock, archived_at, updated_at
    FROM gym_products
    WHERE gym_id = ${gymId} AND (archived_at IS NOT NULL) = ${archived}
    ORDER BY ${archived ? sql`archived_at DESC, id` : sql`lower(name), id`}
    LIMIT ${limit}`;
  const [gymRows, included, rates, live, archived, archivedTotal, sales, totals, refunds] = await Promise.all([
    sql<{ country: string | null }[]>`SELECT country FROM gyms WHERE id = ${gymId}`,
    taxIncludedOf(sql, gymId),
    readRates(sql, gymId, today),
    readProducts(false, PRODUCTS_MAX),
    readProducts(true, PRODUCT_ARCHIVED_PAGE),
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_products WHERE gym_id = ${gymId} AND archived_at IS NOT NULL`,
    !withSales
      ? []
      : sql<RawSale[]>`
      SELECT ${saleColumns(sql)}
      FROM gym_sales s
      LEFT JOIN users u ON u.id = s.recorded_by
      LEFT JOIN gym_member_list_entries e ON e.gym_id = s.gym_id AND e.id = s.entry_id
      WHERE s.gym_id = ${gymId} AND s.sold_on = ${day}::date
        AND s.receipt_number IN (SELECT f.receipt_number FROM gym_sales f
                                 WHERE f.gym_id = ${gymId} AND f.sold_on = ${day}::date AND f.line_no = 1
                                 ORDER BY f.seq DESC LIMIT ${salesShown})
      ORDER BY s.receipt_number DESC, s.line_no`,
    !withSales
      ? []
      : sql<{ currency: string; n: number; standing: number; total: string; tax: string; discount: string; cash: string; card: string; bank: string; terminal: string }[]>`
      SELECT currency, (count(*) FILTER (WHERE line_no = 1))::int AS n,
             (count(*) FILTER (WHERE line_no = 1 AND undone_at IS NULL))::int AS standing,
             COALESCE(sum(total_minor) FILTER (WHERE undone_at IS NULL), 0)::text AS total,
             COALESCE(sum(tax_minor) FILTER (WHERE undone_at IS NULL), 0)::text AS tax,
             COALESCE(sum(discount_minor) FILTER (WHERE undone_at IS NULL), 0)::text AS discount,
             COALESCE(sum(total_minor) FILTER (WHERE undone_at IS NULL AND method = 'cash'), 0)::text AS cash,
             COALESCE(sum(total_minor) FILTER (WHERE undone_at IS NULL AND method = 'card_at_desk'), 0)::text AS card,
             COALESCE(sum(total_minor) FILTER (WHERE undone_at IS NULL AND method = 'bank_transfer'), 0)::text AS bank,
             COALESCE(sum(total_minor) FILTER (WHERE undone_at IS NULL AND method = 'terminal'), 0)::text AS terminal
      FROM gym_sales WHERE gym_id = ${gymId} AND sold_on = ${day}::date
      GROUP BY currency`,
    !withSales
      ? []
      : sql<{ currency: string; total: string }[]>`
      SELECT currency, sum(amount_minor)::text AS total
      FROM gym_sale_refunds WHERE gym_id = ${gymId} AND refunded_on = ${day}::date AND undone_at IS NULL
      GROUP BY currency`,
  ]);
  const gym = gymRows[0];
  if (gym === undefined || included === null) return null;
  return {
    country: gym.country,
    tax: { included, rates },
    products: live.map(product),
    archived: archived.map(product),
    archivedTotal: archivedTotal[0]?.n ?? 0,
    sales: await refundsOf(sql, gymId, sales.map(sale)),
    salesTotal: totals.reduce((n, row) => n + row.n, 0),
    totals: totals.map((row) => ({
      currency: row.currency,
      count: row.standing,
      totalMinor: Number(row.total),
      taxMinor: Number(row.tax),
      discountMinor: Number(row.discount),
      cash: Number(row.cash),
      card_at_desk: Number(row.card),
      bank_transfer: Number(row.bank),
      terminal: Number(row.terminal),
    })),
    refunds: refunds.map((row) => ({ currency: row.currency, totalMinor: Number(row.total) })),
  };
}

// ── Products ────────────────────────────────────────────────────────────────

export interface ProductInput {
  name: string;
  priceMinor: number;
  taxRateId: string | null;
  stock: number | null;
}

export type ProductWriteOutcome =
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "too_many"; cap: number }
  | { kind: "name_taken" }
  /** The product was changed, or one was sold, after the form that sent this read it. */
  | { kind: "changed" }
  /** The gym's country has no money to price in. */
  | { kind: "no_currency" }
  /** The tax rate named is not one of this gym's. */
  | { kind: "rate_not_found" };

async function liveCount(tx: TransactionSql, gymId: string): Promise<number> {
  const [row] = await tx<{ n: number }[]>`
    SELECT count(*)::int AS n FROM gym_products WHERE gym_id = ${gymId} AND archived_at IS NULL`;
  return row?.n ?? 0;
}

async function nameTaken(tx: TransactionSql, gymId: string, name: string, exceptId: string | null): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    SELECT id FROM gym_products
    WHERE gym_id = ${gymId} AND archived_at IS NULL AND lower(name) = lower(${name})
      AND (${exceptId}::uuid IS NULL OR id <> ${exceptId}::uuid)
    LIMIT 1`;
  return rows.length > 0;
}

export async function createProduct(sql: Sql, input: ProductInput & { gymId: string; actorUserId: string }): Promise<ProductWriteOutcome> {
  return await sql.begin(async (tx): Promise<ProductWriteOutcome> => {
    await lockOrgRow(tx, input.gymId);
    const [gym] = await tx<{ country: string | null }[]>`SELECT country FROM gyms WHERE id = ${input.gymId}`;
    if (gym === undefined) return { kind: "not_found" };
    const currency = memberCurrencyForCountry(gym.country);
    if (currency === null) return { kind: "no_currency" };
    if ((await liveCount(tx, input.gymId)) >= PRODUCTS_MAX) return { kind: "too_many", cap: PRODUCTS_MAX };
    if (await nameTaken(tx, input.gymId, input.name, null)) return { kind: "name_taken" };
    if (input.taxRateId !== null && (await rateOf(tx, input.gymId, input.taxRateId)) === null) return { kind: "rate_not_found" };
    const [created] = await tx<{ id: string }[]>`
      INSERT INTO gym_products (gym_id, name, price_minor, currency, tax_rate_id, stock)
      VALUES (${input.gymId}, ${input.name}, ${input.priceMinor}, ${currency}, ${input.taxRateId}, ${input.stock})
      RETURNING id`;
    if (created === undefined) throw new Error("product insert returned no row");
    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.product_created",
      targetType: "gym_product",
      targetId: created.id,
      meta: { name: input.name, priceMinor: String(input.priceMinor), currency },
    });
    return { kind: "ok" };
  });
}

/** Replace a product's fields. No sale already made is touched: each keeps the name, the
 *  price and the money it was sold in. */
export async function updateProduct(
  sql: Sql,
  input: ProductInput & { gymId: string; productId: string; readAt: Date; actorUserId: string; now: Date },
): Promise<ProductWriteOutcome> {
  return await sql.begin(async (tx): Promise<ProductWriteOutcome> => {
    await lockOrgRow(tx, input.gymId);
    const [before] = await tx<{ name: string; price_minor: number; stock: number | null; updated_at: Date }[]>`
      SELECT name, price_minor, stock, updated_at FROM gym_products
      WHERE id = ${input.productId} AND gym_id = ${input.gymId} AND archived_at IS NULL`;
    if (before === undefined) return { kind: "not_found" };
    // To the millisecond, which is what the list sends and a form can send back.
    if (before.updated_at.getTime() !== input.readAt.getTime()) return { kind: "changed" };
    if (await nameTaken(tx, input.gymId, input.name, input.productId)) return { kind: "name_taken" };
    if (input.taxRateId !== null && (await rateOf(tx, input.gymId, input.taxRateId)) === null) return { kind: "rate_not_found" };
    // The price typed is in the gym's money as it is now: a product made before the gym
    // changed its country takes the new one with its new price.
    const [gym] = await tx<{ country: string | null }[]>`SELECT country FROM gyms WHERE id = ${input.gymId}`;
    const currency = memberCurrencyForCountry(gym?.country ?? null);
    if (currency === null) return { kind: "no_currency" };
    await tx`
      UPDATE gym_products
      SET name = ${input.name}, price_minor = ${input.priceMinor}, currency = ${currency}, tax_rate_id = ${input.taxRateId}, stock = ${input.stock}, updated_at = ${input.now}
      WHERE id = ${input.productId} AND gym_id = ${input.gymId}`;
    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.product_updated",
      targetType: "gym_product",
      targetId: input.productId,
      meta: {
        before: before.name,
        after: input.name,
        priceBefore: String(before.price_minor),
        priceAfter: String(input.priceMinor),
        stockBefore: before.stock === null ? "not counted" : String(before.stock),
        stockAfter: input.stock === null ? "not counted" : String(input.stock),
      },
    });
    return { kind: "ok" };
  });
}

/** Archive: the product leaves the Sell page and is kept, with its sales. */
export async function archiveProduct(sql: Sql, input: { gymId: string; productId: string; actorUserId: string; now: Date }): Promise<ProductWriteOutcome> {
  return await sql.begin(async (tx): Promise<ProductWriteOutcome> => {
    await lockOrgRow(tx, input.gymId);
    const rows = await tx<{ name: string }[]>`
      UPDATE gym_products SET archived_at = ${input.now}, updated_at = ${input.now}
      WHERE id = ${input.productId} AND gym_id = ${input.gymId} AND archived_at IS NULL
      RETURNING name`;
    const [before] = rows;
    if (before === undefined) return { kind: "not_found" };
    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.product_archived",
      targetType: "gym_product",
      targetId: input.productId,
      meta: { name: before.name },
    });
    return { kind: "ok" };
  });
}

/** Put an archived product back on sale. It counts against the cap, and a product on
 *  sale may have taken its name while it was away. */
export async function restoreProduct(sql: Sql, input: { gymId: string; productId: string; actorUserId: string; now: Date }): Promise<ProductWriteOutcome> {
  return await sql.begin(async (tx): Promise<ProductWriteOutcome> => {
    await lockOrgRow(tx, input.gymId);
    const [before] = await tx<{ name: string }[]>`
      SELECT name FROM gym_products
      WHERE id = ${input.productId} AND gym_id = ${input.gymId} AND archived_at IS NOT NULL`;
    if (before === undefined) return { kind: "not_found" };
    if ((await liveCount(tx, input.gymId)) >= PRODUCTS_MAX) return { kind: "too_many", cap: PRODUCTS_MAX };
    if (await nameTaken(tx, input.gymId, before.name, input.productId)) return { kind: "name_taken" };
    await tx`
      UPDATE gym_products SET archived_at = NULL, updated_at = ${input.now}
      WHERE id = ${input.productId} AND gym_id = ${input.gymId}`;
    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.product_restored",
      targetType: "gym_product",
      targetId: input.productId,
      meta: { name: before.name },
    });
    return { kind: "ok" };
  });
}

// ── A sale ──────────────────────────────────────────────────────────────────

export type SellOutcome =
  | { kind: "ok"; saleId: string; receiptNumber: number }
  | { kind: "product_not_found" }
  | { kind: "person_not_found" }
  /** The key was already used for a different sale. */
  | { kind: "request_reused" }
  /** The sale no longer comes to the total the screen showed. */
  | { kind: "price_changed" }
  /** The product is priced in a money the gym no longer sells in. */
  | { kind: "currency_changed"; name: string; was: string; now: string | null }
  | { kind: "out_of_stock"; name: string; left: number }
  /** The discount named is not one of this gym's. */
  | { kind: "discount_not_found" }
  /** The gym's own discount, and it cannot be used on this sale today. */
  | { kind: "discount_refused"; name: string; reason: DiscountRefusal }
  /** The discount takes off the whole price. */
  | { kind: "nothing_to_pay" }
  /** The discount rounds to nothing on this price. */
  | { kind: "discount_nothing_off"; name: string }
  /** Refer a friend's gift, for somebody who is not an invited friend, or has had it. */
  | { kind: "friend_gift_not_theirs" }
  /** A member's Refer a friend gift that is not the buyer's, or no longer waits. */
  | { kind: "member_gift_not_theirs" }
  /** What it takes off is no longer what the screen showed, or it no longer fits. */
  | { kind: "member_gift_changed" }
  /** The gift and a discount on one line. */
  | { kind: "member_gift_with_discount" }
  /** A set amount off, or Refer a friend's gift, on more than one line of a sale (18q). */
  | { kind: "one_line_only"; name: string };

export interface SellLineInput {
  productId: string;
  quantity: number;
  /** The gym's discount on this line; null for none. */
  discountId: string | null;
  /** The buyer's own Refer a friend gift in place of a discount, and what the screen showed it
   *  takes off; null for none. */
  memberGift: { id: string; offMinor: number } | null;
  /** What the screen showed the line comes to. */
  totalMinor: number;
}

export interface SellInput {
  gymId: string;
  requestKey: string;
  entryId: string | null;
  method: MemberPaymentByHand;
  /** The total the screen showed. */
  totalMinor: number;
  /** Each product, in the order it was rung up (18q). */
  lines: readonly SellLineInput[];
  /** The gym's own day. */
  today: string;
  actorUserId: string;
  now: Date;
}

/** One product of a sale, priced: what it is recorded as. Kept as it is on a payment waiting on the
 *  Terminal (18d-vi-b-ii), so the sale Square takes the money for is the sale recorded. */
export const pricedSaleLineSchema = z
  .object({
    productId: z.string().uuid(),
    name: z.string().min(1).max(80),
    unitPriceMinor: z.number().int().min(1),
    currency: z.string().regex(/^[A-Z]{3}$/),
    quantity: z.number().int().min(1).max(99),
    used: z.object({ id: z.string().uuid(), name: z.string().min(1), offMinor: z.number().int().min(1) }).strict().nullable(),
    gift: z.object({ id: z.string().uuid(), offMinor: z.number().int().min(1) }).strict().nullable(),
    rate: z.object({ name: z.string().min(1), bp: z.number().int().min(0) }).strict().nullable(),
    netMinor: z.number().int().min(0),
    taxMinor: z.number().int().min(0),
    totalMinor: z.number().int().min(1),
  })
  .strict();
export type PricedSaleLine = z.infer<typeof pricedSaleLineSchema>;

/** A basket as it was priced, with whether its prices held the tax. */
export const pricedSaleSchema = z
  .object({
    included: z.boolean(),
    totalMinor: z.number().int().min(1),
    lines: z.array(pricedSaleLineSchema).min(1).max(SALE_LINES_MAX),
  })
  .strict();
export type PricedSale = z.infer<typeof pricedSaleSchema>;

/** Why a basket cannot be sold now. */
export type SaleRefusal = Exclude<SellOutcome, { kind: "ok" } | { kind: "request_reused" }>;

/** EVERY LINE OF A BASKET PRICED AGAIN (18q), under the gym's lock the caller holds: the products
 *  on sale now, the buyer this gym's, each discount and gift checked, the stock there, and the
 *  total what the screen showed. Nothing is written. A sale at the desk is written straight after;
 *  a Terminal's (18d-vi-b-ii) is kept until Square takes the money. */
export async function priceBasket(
  tx: TransactionSql,
  input: { gymId: string; entryId: string | null; totalMinor: number; lines: readonly SellLineInput[]; today: string },
): Promise<{ kind: "priced"; sale: PricedSale } | SaleRefusal> {
  const [gym] = await tx<{ country: string | null }[]>`SELECT country FROM gyms WHERE id = ${input.gymId}`;
  const included = await taxIncludedOf(tx, input.gymId);
  if (gym === undefined || included === null) return { kind: "product_not_found" };
  const items = await tx<RawProduct[]>`
    SELECT id, name, price_minor, currency, tax_rate_id, stock, archived_at, updated_at FROM gym_products
    WHERE gym_id = ${input.gymId} AND id = ANY(${input.lines.map((l) => l.productId)}::uuid[]) AND archived_at IS NULL`;
  const itemOf = new Map(items.map((i) => [i.id, i]));

  // A past member can buy a bottle of water: any record of this gym's, and no other's.
  if (input.entryId !== null) {
    const [person] = await tx<{ id: string }[]>`
      SELECT id FROM gym_member_list_entries WHERE gym_id = ${input.gymId} AND id = ${input.entryId} FOR UPDATE`;
    if (person === undefined) return { kind: "person_not_found" };
  }

  // One day's total is one money: a product still priced in the gym's old one is not sold.
  const selling = memberCurrencyForCountry(gym.country);
  // Each discount is this gym's own, read once under its lock, and judged on the gym's own day.
  const discountOf = new Map<string, DiscountRow | null>();
  const priced: PricedSaleLine[] = [];
  for (const line of input.lines) {
    const item = itemOf.get(line.productId);
    if (item === undefined) return { kind: "product_not_found" };
    if (item.currency !== selling) return { kind: "currency_changed", name: item.name, was: item.currency, now: selling };

    let used: PricedSaleLine["used"] = null;
    if (line.discountId !== null) {
      if (!discountOf.has(line.discountId)) discountOf.set(line.discountId, await lockedDiscount(tx, input.gymId, line.discountId));
      const found = discountOf.get(line.discountId) ?? null;
      if (found === null) return { kind: "discount_not_found" };
      const fits = discountFits({ ...found, archived: found.archivedAt !== null }, { today: input.today, productId: item.id, currency: item.currency });
      if (!fits.ok) return { kind: "discount_refused", name: found.name, reason: fits.reason };
      // Refer a friend's gift goes only to the friend it is for, once (20e-ii-b-i): never to a
      // walk-in.
      if (found.referralGift && (input.entryId === null || !(await friendGiftOpen(tx, input.gymId, input.entryId, found.id, input.today)))) {
        return { kind: "friend_gift_not_theirs" };
      }
      used = { id: found.id, name: found.name, offMinor: discountOff(found, item.price_minor * line.quantity) };
      // No use is spent on a discount that takes nothing off.
      if (used.offMinor === 0) return { kind: "discount_nothing_off", name: found.name };
    }
    // The buyer's own Refer a friend gift (20e-ii-b-ii-a), in a discount's place: theirs, still
    // waiting, read under its lock, and taking off what the screen showed.
    let gift: PricedSaleLine["gift"] = null;
    if (line.memberGift !== null) {
      if (line.discountId !== null) return { kind: "member_gift_with_discount" };
      if (input.entryId === null) return { kind: "member_gift_not_theirs" };
      const found = await lockedWaitingGift(tx, input.gymId, input.entryId, line.memberGift.id, "products");
      if (found === null) return { kind: "member_gift_not_theirs" };
      const off = memberGiftOff(found, item.price_minor * line.quantity, item.currency);
      if (off === 0 || off !== line.memberGift.offMinor) return { kind: "member_gift_changed" };
      gift = { id: found.id, offMinor: off };
    }

    // The product's rate as it is now, read under the gym's lock that its changes take.
    const rate = item.tax_rate_id === null ? null : await rateOf(tx, input.gymId, item.tax_rate_id);
    const amounts = saleAmounts({
      unitPriceMinor: item.price_minor,
      quantity: line.quantity,
      taxed: rate !== null,
      taxBp: rate?.bp ?? 0,
      taxIncluded: included,
      discountMinor: used?.offMinor ?? gift?.offMinor ?? 0,
    });
    if (!amounts.ok && amounts.reason === "nothing_to_pay") return { kind: "nothing_to_pay" };
    if (!amounts.ok || amounts.totalMinor !== line.totalMinor) return { kind: "price_changed" };
    if (item.stock !== null && item.stock < line.quantity) return { kind: "out_of_stock", name: item.name, left: item.stock };
    priced.push({
      productId: item.id,
      name: item.name,
      unitPriceMinor: item.price_minor,
      currency: item.currency,
      quantity: line.quantity,
      used,
      gift,
      rate: rate === null ? null : { name: rate.name, bp: rate.bp },
      netMinor: amounts.netMinor,
      taxMinor: amounts.taxMinor,
      totalMinor: amounts.totalMinor,
    });
  }
  if (priced.reduce((n, p) => n + p.totalMinor, 0) !== input.totalMinor) return { kind: "price_changed" };

  // A set amount off, and Refer a friend's gift, are taken off once a sale: on one line.
  for (const found of discountOf.values()) {
    if (found === null || (found.kind !== "amount" && !found.referralGift)) continue;
    if (priced.filter((p) => p.used?.id === found.id).length > 1) return { kind: "one_line_only", name: found.name };
  }
  return { kind: "priced", sale: { included, totalMinor: input.totalMinor, lines: priced } };
}

/** ONE SALE (18q): a row for each of its products under one receipt number, each stock count
 *  down by what was sold, one use of each discount on it counted, and its note in the gym's
 *  record, together or not at all. Every line is priced again here; one line refused refuses
 *  the sale. Under the gym's lock, so the same request arriving twice at one instant is one
 *  sale and the last one in stock is sold once. */
export async function sell(sql: Sql, input: SellInput): Promise<SellOutcome> {
  return await sql.begin(async (tx): Promise<SellOutcome> => {
    await lockOrgRow(tx, input.gymId);

    // The same request again: the sale it made stands, and nothing is added.
    const again = await tx<{ id: string; product_id: string; quantity: number; method: string; total_minor: number; discount_id: string | null; receipt_number: number }[]>`
      SELECT id, product_id, quantity, method, total_minor, discount_id, receipt_number FROM gym_sales
      WHERE gym_id = ${input.gymId} AND request_key = ${input.requestKey}
      ORDER BY line_no`;
    const made = again[0];
    if (made !== undefined) {
      // Not who bought it: their record may have been joined to another or deleted since,
      // and the press is still the same press.
      const same =
        again.length === input.lines.length &&
        again.every((row, i) => {
          const line = input.lines[i];
          return (
            line !== undefined &&
            row.product_id === line.productId &&
            row.quantity === line.quantity &&
            row.method === input.method &&
            row.total_minor === line.totalMinor &&
            row.discount_id === line.discountId
          );
        });
      return same ? { kind: "ok", saleId: made.id, receiptNumber: made.receipt_number } : { kind: "request_reused" };
    }

    const priced = await priceBasket(tx, input);
    if (priced.kind !== "priced") return priced;
    // The last check before anything is written: each count moves only if its limit allows,
    // once a sale however many of its lines the discount is on.
    for (const used of usedOnce(priced.sale)) {
      if (!(await takeUse(tx, input.gymId, used.id))) return { kind: "discount_refused", name: used.name, reason: "used_up" };
    }
    const written = await writeSale(tx, {
      gymId: input.gymId,
      requestKey: input.requestKey,
      entryId: input.entryId,
      forMember: input.entryId !== null,
      method: input.method,
      squarePaymentId: null,
      sale: priced.sale,
      today: input.today,
      actorUserId: input.actorUserId,
      now: input.now,
    });
    return { kind: "ok", ...written };
  });
}

/** Each discount on a sale, once. */
const usedOnce = (sale: PricedSale): { id: string; name: string }[] => [
  ...new Map(sale.lines.flatMap((l) => (l.used === null ? [] : [[l.used.id, { id: l.used.id, name: l.used.name }] as const]))).values(),
];

/** A SALE PAID ON THE TERMINAL (18d-vi-b-ii), written when Square took the money, as it was priced
 *  when the card was asked for: the person has paid that, so it is recorded even where a price,
 *  the stock or a discount changed while the Terminal waited. A count is never taken below none;
 *  a discount's use is counted past its limit; a gift used meanwhile is not used twice. Under the
 *  gym's lock the caller holds. `entryId`: the buyer's record now, or null once deleted for good. */
export async function recordTakenSale(
  tx: TransactionSql,
  input: { gymId: string; requestKey: string; entryId: string | null; forMember: boolean; squarePaymentId: string; sale: PricedSale; today: string; actorUserId: string | null; now: Date },
): Promise<{ saleId: string; receiptNumber: number }> {
  for (const used of usedOnce(input.sale)) await countUse(tx, input.gymId, used.id);
  return await writeSale(tx, { ...input, method: "terminal" });
}

/** The rows of a priced sale, its stock counts, its gifts and its note in the gym's record. The
 *  discounts' uses are the caller's. */
async function writeSale(
  tx: TransactionSql,
  input: {
    gymId: string;
    requestKey: string;
    entryId: string | null;
    forMember: boolean;
    method: SalePaymentMethod;
    squarePaymentId: string | null;
    sale: PricedSale;
    today: string;
    actorUserId: string | null;
    now: Date;
  },
): Promise<{ saleId: string; receiptNumber: number }> {
  const { sale } = input;
  // The sale takes the gym's next receipt number, and every line of it carries that number (18g-i).
  const [numbered] = await nextReceipt(tx, input.gymId);
  if (numbered === undefined) throw new Error("receipt number returned no row");
  const receiptNumber = Number(numbered.number);
  const ids: string[] = [];
  for (const [i, p] of sale.lines.entries()) {
    // A product whose stock is counted: down by what was sold, never below none.
    const counted = await tx<{ id: string }[]>`
      UPDATE gym_products SET stock = GREATEST(stock - ${p.quantity}, 0), updated_at = ${input.now}
      WHERE gym_id = ${input.gymId} AND id = ${p.productId} AND stock IS NOT NULL
      RETURNING id`;
    // A gift used meanwhile (only ever on a Terminal's sale) is not used again; the line still names
    // the gift and what it took off, as the person paid that, and the gift points at the other sale.
    const gift = p.gift === null ? null : (await giftStillWaiting(tx, input.gymId, input.entryId, p.gift.id)) ? p.gift : null;
    const [created] = await tx<{ id: string }[]>`
      INSERT INTO gym_sales
        (gym_id, request_key, product_id, entry_id, item_name, quantity, unit_price_minor, net_minor, tax_minor, total_minor,
         tax_bp, tax_name, tax_included, currency, method, square_payment_id, sold_on, recorded_by, stock_counted, created_at,
         discount_id, discount_name, discount_minor, receipt_number, for_member, member_gift, line_no)
      VALUES (${input.gymId}, ${input.requestKey}, ${p.productId}, ${input.entryId}, ${p.name}, ${p.quantity}, ${p.unitPriceMinor},
              ${p.netMinor}, ${p.taxMinor}, ${p.totalMinor}, ${p.rate?.bp ?? 0}, ${p.rate?.name ?? null}, ${sale.included}, ${p.currency},
              ${input.method}, ${input.squarePaymentId}, ${input.today}::date, ${input.actorUserId}, ${counted.length === 1}, ${input.now},
              ${p.used?.id ?? null}, ${p.used?.name ?? (p.gift === null ? null : MEMBER_GIFT_SALE_NAME)}, ${p.used?.offMinor ?? p.gift?.offMinor ?? 0},
              ${receiptNumber}, ${input.forMember}, ${p.gift !== null}, ${i + 1})
      RETURNING id`;
    if (created === undefined) throw new Error("sale insert returned no row");
    ids.push(created.id);
    if (gift !== null) await markUsed(tx, { gymId: input.gymId, giftId: gift.id, billId: null, saleId: created.id, offMinor: gift.offMinor, currency: p.currency, now: input.now });
  }
  const firstId = ids[0];
  const first = sale.lines[0];
  if (firstId === undefined || first === undefined) throw new Error("a sale with no line");
  // A friend a member invited has paid at the desk: the member's Refer a friend gift, once a sale.
  if (input.entryId !== null) await giveMemberGift(tx, { gymId: input.gymId, friendEntryId: input.entryId, by: { saleId: firstId }, today: input.today, now: input.now });
  const offMinor = sale.lines.reduce((n, p) => n + (p.used?.offMinor ?? p.gift?.offMinor ?? 0), 0);
  await insertAudit(tx, {
    actorUserId: input.actorUserId,
    gymId: input.gymId,
    action: "org.sale_recorded",
    targetType: "gym_sale",
    targetId: firstId,
    meta: {
      productId: first.productId,
      product: first.name,
      quantity: String(first.quantity),
      ...(sale.lines.length > 1 ? { others: String(sale.lines.length - 1) } : {}),
      totalMinor: String(sale.totalMinor),
      taxMinor: String(sale.lines.reduce((n, p) => n + p.taxMinor, 0)),
      currency: first.currency,
      method: input.method,
      receiptNumber: String(receiptNumber),
      ...(input.entryId === null ? {} : { entryId: input.entryId }),
      ...(offMinor === 0 ? {} : { discountMinor: String(offMinor) }),
      ...(first.used === null ? {} : { discountId: first.used.id, discount: first.used.name }),
      ...(first.gift === null ? {} : { memberGiftId: first.gift.id }),
    },
  });
  return { saleId: firstId, receiptNumber };
}

/** The buyer's gift, still theirs and waiting: a sale at the desk checked it a moment ago under the
 *  same lock; a Terminal's sale checked it when the card was asked for. */
async function giftStillWaiting(tx: TransactionSql, gymId: string, entryId: string | null, giftId: string): Promise<boolean> {
  if (entryId === null) return false;
  return (await lockedWaitingGift(tx, gymId, entryId, giftId, "products")) !== null;
}

export type VoidSaleOutcome = { kind: "ok" } | { kind: "sale_not_found" } | { kind: "not_today" } | { kind: "has_refund" } | { kind: "terminal" };

/** Voids one sale (18o), every line of it (18q), from any of its lines: each row is kept,
 *  marked with who, when and why, what each took from a stock count is returned where the
 *  product is still counted, and the use of each discount on it is given back. Pressed twice
 *  it is voided once. */
export async function voidSale(
  sql: Sql,
  input: { gymId: string; saleId: string; reason: SaleVoidReason; today: string; actorUserId: string; now: Date },
): Promise<VoidSaleOutcome> {
  return await sql.begin(async (tx): Promise<VoidSaleOutcome> => {
    await lockOrgRow(tx, input.gymId);
    const rows = await tx<
      { id: string; product_id: string; quantity: number; sold_on: string; stock_counted: boolean; undone: boolean; total_minor: number; currency: string; item_name: string; discount_id: string | null; receipt_number: number; method: string }[]
    >`
      SELECT s.id, s.product_id, s.quantity, s.sold_on::text AS sold_on, s.stock_counted, s.undone_at IS NOT NULL AS undone, s.total_minor, s.currency, s.item_name,
             s.discount_id, s.receipt_number, s.method
      FROM gym_sales s
      WHERE s.gym_id = ${input.gymId}
        AND s.receipt_number = (SELECT o.receipt_number FROM gym_sales o WHERE o.gym_id = ${input.gymId} AND o.id = ${input.saleId})
      ORDER BY s.line_no`;
    const first = rows[0];
    if (first === undefined) return { kind: "sale_not_found" };
    if (first.undone) return { kind: "ok" };
    if (first.sold_on !== input.today) return { kind: "not_today" };
    // Square holds a Terminal's money: it is refunded there (18d-vi-b-ii).
    if (first.method === "terminal") return { kind: "terminal" };
    // A refund standing on any line is voided first: a refund only ever stands on a sale that stands.
    const [refunded] = await tx<{ id: string }[]>`
      SELECT id FROM gym_sale_refunds WHERE gym_id = ${input.gymId} AND sale_id = ANY(${rows.map((r) => r.id)}::uuid[]) AND undone_at IS NULL LIMIT 1`;
    if (refunded !== undefined) return { kind: "has_refund" };
    await tx`
      UPDATE gym_sales SET undone_at = ${input.now}, undone_by = ${input.actorUserId}, void_reason = ${input.reason}
      WHERE gym_id = ${input.gymId} AND receipt_number = ${first.receipt_number} AND undone_at IS NULL`;
    for (const row of rows) {
      if (!row.stock_counted) continue;
      await tx`
        UPDATE gym_products SET stock = LEAST(stock + ${row.quantity}, 100000), updated_at = ${input.now}
        WHERE gym_id = ${input.gymId} AND id = ${row.product_id} AND stock IS NOT NULL`;
    }
    // One use a sale was taken of each discount on it, so one is given back.
    for (const discountId of new Set(rows.map((r) => r.discount_id))) {
      if (discountId !== null) await returnUse(tx, input.gymId, discountId);
    }
    // A member's Refer a friend gift taken off it waits again; a friend's sale that gave one
    // no longer stands for it (20e-ii-b-ii-a). Read once every line is voided.
    for (const row of rows) {
      await giftUseUndone(tx, input.gymId, { saleId: row.id }, input.today, input.now);
      await friendPaymentGone(tx, { gymId: input.gymId, by: { saleId: row.id }, why: "voided", today: input.today, now: input.now });
    }
    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.sale_undone",
      targetType: "gym_sale",
      targetId: first.id,
      meta: {
        product: first.item_name,
        quantity: String(first.quantity),
        ...(rows.length > 1 ? { others: String(rows.length - 1) } : {}),
        totalMinor: String(rows.reduce((n, r) => n + r.total_minor, 0)),
        currency: first.currency,
        reason: input.reason,
        receiptNumber: String(first.receipt_number),
      },
    });
    return { kind: "ok" };
  });
}

export type RefundSaleOutcome =
  | { kind: "ok"; receiptNumber: number }
  | { kind: "sale_not_found" }
  | { kind: "voided" }
  | { kind: "request_reused" }
  | { kind: "too_much"; leftMinor: number; currency: string }
  | { kind: "too_many_back"; leftCount: number }
  | { kind: "not_counted" };

export interface RefundSaleInput {
  gymId: string;
  saleId: string;
  requestKey: string;
  amountMinor: number;
  method: MemberPaymentByHand;
  reason: SaleRefundReason;
  restock: number;
  /** The gym's own day. */
  today: string;
  actorUserId: string;
  now: Date;
}

/** ONE REFUND OF A SALE (18p): its row, what went back on the shelf, and its note in the gym's
 *  record, together or not at all. Under the gym's lock, so two members of staff at one
 *  instant are taken one after the other and together never give back more than the sale took;
 *  the same request twice is one refund. The sale stays as it was. A friend's sale refunded in
 *  full no longer stands for a member's Refer a friend gift not yet used. */
export async function refundSale(sql: Sql, input: RefundSaleInput): Promise<RefundSaleOutcome> {
  return await sql.begin(async (tx): Promise<RefundSaleOutcome> => {
    await lockOrgRow(tx, input.gymId);

    // The same key with anything else in it, or after its refund was voided, is not the same
    // request: it is refused, never answered as noted.
    const [again] = await tx<{ sale_id: string; amount_minor: number; method: string; reason: string; restocked: number; undone: boolean; receipt_number: number }[]>`
      SELECT sale_id, amount_minor, method, reason, restocked, undone_at IS NOT NULL AS undone, receipt_number
      FROM gym_sale_refunds WHERE gym_id = ${input.gymId} AND request_key = ${input.requestKey}`;
    if (again !== undefined) {
      const same =
        again.sale_id === input.saleId &&
        again.amount_minor === input.amountMinor &&
        again.method === input.method &&
        again.reason === input.reason &&
        again.restocked === input.restock &&
        !again.undone;
      return same ? { kind: "ok", receiptNumber: again.receipt_number } : { kind: "request_reused" };
    }

    const [row] = await tx<
      { product_id: string; quantity: number; total_minor: number; currency: string; item_name: string; stock_counted: boolean; undone: boolean; refunded: number; restocked: number }[]
    >`
      SELECT s.product_id, s.quantity, s.total_minor, s.currency, s.item_name, s.stock_counted, s.undone_at IS NOT NULL AS undone,
             COALESCE((SELECT sum(f.amount_minor) FROM gym_sale_refunds f WHERE f.gym_id = s.gym_id AND f.sale_id = s.id AND f.undone_at IS NULL), 0)::int AS refunded,
             COALESCE((SELECT sum(f.restocked) FROM gym_sale_refunds f WHERE f.gym_id = s.gym_id AND f.sale_id = s.id AND f.undone_at IS NULL), 0)::int AS restocked
      FROM gym_sales s WHERE s.gym_id = ${input.gymId} AND s.id = ${input.saleId}`;
    if (row === undefined) return { kind: "sale_not_found" };
    const check = refundSaleCheck(
      { totalMinor: row.total_minor, quantity: row.quantity, voided: row.undone, refundedMinor: row.refunded, restocked: row.restocked, stockCounted: row.stock_counted },
      { amountMinor: input.amountMinor, restock: input.restock },
    );
    if (!check.ok) {
      if (check.reason === "too_much") return { kind: "too_much", leftMinor: check.leftMinor, currency: row.currency };
      if (check.reason === "too_many_back") return { kind: "too_many_back", leftCount: check.leftCount };
      if (check.reason === "not_counted") return { kind: "not_counted" };
      // The request's own schema lets no amount through that is not one: what is left is a voided sale.
      return { kind: "voided" };
    }

    // The refund takes the gym's next receipt number in the statement that writes it (18g-i).
    const [created] = await tx<{ id: string; receipt_number: number }[]>`
      WITH n AS (${nextReceipt(tx, input.gymId)})
      INSERT INTO gym_sale_refunds
        (gym_id, sale_id, amount_minor, currency, method, reason, restocked, request_key, refunded_on, recorded_by, receipt_number, created_at)
      SELECT ${input.gymId}, ${input.saleId}, ${input.amountMinor}, ${row.currency}, ${input.method}, ${input.reason}, ${input.restock},
             ${input.requestKey}, ${input.today}::date, ${input.actorUserId}, n.number, ${input.now}
      FROM n
      RETURNING id, receipt_number`;
    if (created === undefined) throw new Error("sale refund insert returned no row");
    // Back on the shelf, where the product still keeps a count; never past the count's ceiling.
    if (input.restock > 0 && row.stock_counted) {
      await tx`
        UPDATE gym_products SET stock = LEAST(stock + ${input.restock}, 100000), updated_at = ${input.now}
        WHERE gym_id = ${input.gymId} AND id = ${row.product_id} AND stock IS NOT NULL`;
    }
    if (check.refundedInFull) {
      await friendPaymentGone(tx, { gymId: input.gymId, by: { saleId: input.saleId }, why: "refunded", today: input.today, now: input.now });
    }
    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.sale_refund_noted",
      targetType: "gym_sale_refund",
      targetId: created.id,
      meta: {
        saleId: input.saleId,
        product: row.item_name,
        amountMinor: String(input.amountMinor),
        currency: row.currency,
        method: input.method,
        reason: input.reason,
        restocked: String(input.restock),
        refundedInFull: String(check.refundedInFull),
      },
    });
    return { kind: "ok", receiptNumber: created.receipt_number };
  });
}

export type VoidSaleRefundOutcome = { kind: "ok" } | { kind: "refund_not_found" };

/** Voids a refund of a sale noted by mistake (18p): its row is kept, marked with who, when and
 *  why; what it put back on the shelf comes off the count again, never below nothing; a friend's
 *  sale that stands again gives the member's gift where none stands. Pressed twice it is voided
 *  once. */
export async function voidSaleRefund(
  sql: Sql,
  input: { gymId: string; saleId: string; refundId: string; reason: RefundVoidReason; today: string; actorUserId: string; now: Date },
): Promise<VoidSaleRefundOutcome> {
  return await sql.begin(async (tx): Promise<VoidSaleRefundOutcome> => {
    await lockOrgRow(tx, input.gymId);
    const [row] = await tx<
      { undone: boolean; amount_minor: number; currency: string; restocked: number; product_id: string; item_name: string; stock_counted: boolean; entry_id: string | null; sale_undone: boolean }[]
    >`
      SELECT r.undone_at IS NOT NULL AS undone, r.amount_minor, r.currency, r.restocked,
             s.product_id, s.item_name, s.stock_counted, s.entry_id, s.undone_at IS NOT NULL AS sale_undone
      FROM gym_sale_refunds r
      JOIN gym_sales s ON s.gym_id = r.gym_id AND s.id = r.sale_id
      WHERE r.gym_id = ${input.gymId} AND r.id = ${input.refundId} AND r.sale_id = ${input.saleId}`;
    if (row === undefined) return { kind: "refund_not_found" };
    if (row.undone) return { kind: "ok" };
    await tx`
      UPDATE gym_sale_refunds SET undone_at = ${input.now}, undone_by = ${input.actorUserId}, void_reason = ${input.reason}
      WHERE gym_id = ${input.gymId} AND id = ${input.refundId} AND undone_at IS NULL`;
    if (row.restocked > 0 && row.stock_counted) {
      await tx`
        UPDATE gym_products SET stock = GREATEST(stock - ${row.restocked}, 0), updated_at = ${input.now}
        WHERE gym_id = ${input.gymId} AND id = ${row.product_id} AND stock IS NOT NULL`;
    }
    // The sale stands again: a friend's sale gives the member's gift where none stands.
    if (!row.sale_undone && row.entry_id !== null) {
      await giveMemberGift(tx, { gymId: input.gymId, friendEntryId: row.entry_id, by: { saleId: input.saleId }, today: input.today, now: input.now });
    }
    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.sale_refund_undone",
      targetType: "gym_sale_refund",
      targetId: input.refundId,
      meta: { saleId: input.saleId, product: row.item_name, amountMinor: String(row.amount_minor), currency: row.currency, restocked: String(row.restocked), reason: input.reason },
    });
    return { kind: "ok" };
  });
}

// ── People ──────────────────────────────────────────────────────────────────

export interface FoundPerson {
  entryId: string;
  name: string;
  email: string | null;
  memberNumber: string | null;
  past: boolean;
}

/** The gym's records a search finds, current members first. A record's email is the
 *  list's: matched on and sent only where `withEmail`. */
export async function peopleLike(sql: Sql, gymId: string, like: string, limit: number, withEmail: boolean): Promise<FoundPerson[]> {
  const rows = await sql<{ id: string; full_name: string; email: string | null; member_number: string | null; past: boolean }[]>`
    SELECT id, full_name, CASE WHEN ${withEmail} THEN email::text END AS email, member_number, former_at IS NOT NULL AS past
    FROM gym_member_list_entries
    WHERE gym_id = ${gymId}
      AND (full_name ILIKE ${like}
           OR (${withEmail} AND email::text ILIKE ${like})
           OR coalesce(member_number, '') ILIKE ${like})
    ORDER BY (former_at IS NOT NULL), lower(full_name), id
    LIMIT ${limit}`;
  return rows.map((r) => ({ entryId: r.id, name: r.full_name.trim() === "" ? NO_NAME : r.full_name, email: r.email, memberNumber: r.member_number, past: r.past }));
}

/** What one record has bought, newest first: every line of its newest `limit` sales, and how
 *  many sales there are in all; null where the record is not this gym's. `standing`: the
 *  sales staff voided are left out of both (the member's own view, 18j). */
export async function purchasesOf(sql: Sql, gymId: string, entryId: string, limit: number, standing = false): Promise<{ sales: SaleRow[]; total: number } | null> {
  const [entry] = await sql<{ id: string }[]>`SELECT id FROM gym_member_list_entries WHERE gym_id = ${gymId} AND id = ${entryId}`;
  if (entry === undefined) return null;
  const [rows, count] = await Promise.all([
    sql<RawSale[]>`
      SELECT ${saleColumns(sql)}
      FROM gym_sales s
      LEFT JOIN users u ON u.id = s.recorded_by
      LEFT JOIN gym_member_list_entries e ON e.gym_id = s.gym_id AND e.id = s.entry_id
      WHERE s.gym_id = ${gymId} AND s.entry_id = ${entryId}
        AND s.receipt_number IN (SELECT f.receipt_number FROM gym_sales f
                                 WHERE f.gym_id = ${gymId} AND f.entry_id = ${entryId} AND f.line_no = 1
                                   AND (${!standing} OR f.undone_at IS NULL)
                                 ORDER BY f.seq DESC LIMIT ${limit})
      ORDER BY s.receipt_number DESC, s.line_no`,
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_sales WHERE gym_id = ${gymId} AND entry_id = ${entryId} AND line_no = 1 AND (${!standing} OR undone_at IS NULL)`,
  ]);
  return { sales: await refundsOf(sql, gymId, rows.map(sale)), total: count[0]?.n ?? 0 };
}
