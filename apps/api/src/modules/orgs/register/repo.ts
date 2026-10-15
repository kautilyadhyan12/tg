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
import {
  PRODUCTS_MAX,
  PRODUCT_ARCHIVED_PAGE,
  discountFits,
  discountOff,
  memberCurrencyForCountry,
  memberPaymentByHandSchema,
  saleAmounts,
  type DiscountRefusal,
  type SalesTax,
  type MemberPaymentByHand,
} from "@app/shared";
import { insertAudit, lockOrgRow } from "../repo.js";
import { nextReceipt } from "../receipts/repo.js";
import { lockedDiscount, returnUse, takeUse } from "./discountsRepo.js";
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
  currency: string;
  method: MemberPaymentByHand;
  soldOn: string;
  soldAt: Date;
  by: string | null;
  person: { entryId: string; name: string } | null;
  undone: boolean;
  receiptNumber: number;
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
  currency: string;
  method: string;
  sold_on: string;
  created_at: Date;
  by: string | null;
  entry_id: string | null;
  person_name: string | null;
  undone: boolean;
  receipt_number: number;
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
  currency: r.currency,
  // Text under a CHECK: parsed, so a method this build does not know fails here.
  method: memberPaymentByHandSchema.parse(r.method),
  soldOn: r.sold_on,
  soldAt: r.created_at,
  by: r.by,
  person: r.entry_id === null ? null : { entryId: r.entry_id, name: r.person_name === null || r.person_name.trim() === "" ? NO_NAME : r.person_name },
  undone: r.undone,
  receiptNumber: r.receipt_number,
});

/** The columns every read of a sale takes, from `gym_sales s` with its two joins. */
const saleColumns = (sql: Sql | TransactionSql) => sql`
  s.id, s.item_name, s.quantity, s.unit_price_minor, s.net_minor, s.tax_minor, s.total_minor, s.tax_bp, s.tax_name, s.tax_included,
  s.discount_name, s.discount_minor, s.currency, s.method, s.sold_on::text AS sold_on, s.created_at, u.display_name AS by, s.entry_id,
  e.full_name AS person_name, s.undone_at IS NOT NULL AS undone, s.receipt_number`;

export interface RegisterRow {
  country: string | null;
  tax: SalesTax;
  products: ProductRow[];
  archived: ProductRow[];
  archivedTotal: number;
  sales: SaleRow[];
  salesTotal: number;
  /** The day's sales that stand, added up in each money they were taken in. */
  totals: { currency: string; count: number; totalMinor: number; taxMinor: number; discountMinor: number; cash: number; card_at_desk: number; bank_transfer: number }[];
}

/** The Sell page in one go, or null where the gym does not exist: what is on sale (bounded
 *  by the cap the writes hold), a page of what was archived, and the day's sales. A sale
 *  names who bought it, so the day's sales are read only `withSales`. */
export async function readRegister(sql: Sql, gymId: string, today: string, salesShown: number, withSales: boolean): Promise<RegisterRow | null> {
  const readProducts = (archived: boolean, limit: number) => sql<RawProduct[]>`
    SELECT id, name, price_minor, currency, tax_rate_id, stock, archived_at, updated_at
    FROM gym_products
    WHERE gym_id = ${gymId} AND (archived_at IS NOT NULL) = ${archived}
    ORDER BY ${archived ? sql`archived_at DESC, id` : sql`lower(name), id`}
    LIMIT ${limit}`;
  const [gymRows, included, rates, live, archived, archivedTotal, sales, totals] = await Promise.all([
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
      WHERE s.gym_id = ${gymId} AND s.sold_on = ${today}::date
      ORDER BY s.seq DESC
      LIMIT ${salesShown}`,
    !withSales
      ? []
      : sql<{ currency: string; n: number; standing: number; total: string; tax: string; discount: string; cash: string; card: string; bank: string }[]>`
      SELECT currency, count(*)::int AS n,
             (count(*) FILTER (WHERE undone_at IS NULL))::int AS standing,
             COALESCE(sum(total_minor) FILTER (WHERE undone_at IS NULL), 0)::text AS total,
             COALESCE(sum(tax_minor) FILTER (WHERE undone_at IS NULL), 0)::text AS tax,
             COALESCE(sum(discount_minor) FILTER (WHERE undone_at IS NULL), 0)::text AS discount,
             COALESCE(sum(total_minor) FILTER (WHERE undone_at IS NULL AND method = 'cash'), 0)::text AS cash,
             COALESCE(sum(total_minor) FILTER (WHERE undone_at IS NULL AND method = 'card_at_desk'), 0)::text AS card,
             COALESCE(sum(total_minor) FILTER (WHERE undone_at IS NULL AND method = 'bank_transfer'), 0)::text AS bank
      FROM gym_sales WHERE gym_id = ${gymId} AND sold_on = ${today}::date
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
    sales: sales.map(sale),
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
    })),
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
  | { kind: "ok"; saleId: string }
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
  | { kind: "discount_nothing_off"; name: string };

export interface SellInput {
  gymId: string;
  requestKey: string;
  productId: string;
  quantity: number;
  entryId: string | null;
  method: MemberPaymentByHand;
  /** The total the screen showed. */
  totalMinor: number;
  /** The gym's discount the sale is made with; null for none. */
  discountId: string | null;
  /** The gym's own day. */
  today: string;
  actorUserId: string;
  now: Date;
}

/** ONE SALE: one row, the stock count down by what was sold, one use of its discount
 *  counted, and its note in the gym's record, together or not at all. Under the gym's lock, so the same request arriving
 *  twice at one instant is one sale and the last one in stock is sold once. */
export async function sell(sql: Sql, input: SellInput): Promise<SellOutcome> {
  return await sql.begin(async (tx): Promise<SellOutcome> => {
    await lockOrgRow(tx, input.gymId);

    // The same request again: the sale it made stands, and nothing is added.
    const [again] = await tx<{ id: string; product_id: string; quantity: number; method: string; total_minor: number; discount_id: string | null }[]>`
      SELECT id, product_id, quantity, method, total_minor, discount_id FROM gym_sales
      WHERE gym_id = ${input.gymId} AND request_key = ${input.requestKey}`;
    if (again !== undefined) {
      // Not who bought it: their record may have been joined to another or deleted since,
      // and the press is still the same press.
      const same =
        again.product_id === input.productId &&
        again.quantity === input.quantity &&
        again.method === input.method &&
        again.total_minor === input.totalMinor &&
        again.discount_id === input.discountId;
      return same ? { kind: "ok", saleId: again.id } : { kind: "request_reused" };
    }

    const [gym] = await tx<{ country: string | null }[]>`SELECT country FROM gyms WHERE id = ${input.gymId}`;
    const included = await taxIncludedOf(tx, input.gymId);
    if (gym === undefined || included === null) return { kind: "product_not_found" };
    const [item] = await tx<RawProduct[]>`
      SELECT id, name, price_minor, currency, tax_rate_id, stock, archived_at, updated_at FROM gym_products
      WHERE gym_id = ${input.gymId} AND id = ${input.productId} AND archived_at IS NULL`;
    if (item === undefined) return { kind: "product_not_found" };

    // A past member can buy a bottle of water: any record of this gym's, and no other's.
    if (input.entryId !== null) {
      const [person] = await tx<{ id: string }[]>`
        SELECT id FROM gym_member_list_entries WHERE gym_id = ${input.gymId} AND id = ${input.entryId} FOR UPDATE`;
      if (person === undefined) return { kind: "person_not_found" };
    }

    // One day's total is one money: a product still priced in the gym's old one is not sold.
    const selling = memberCurrencyForCountry(gym.country);
    if (item.currency !== selling) return { kind: "currency_changed", name: item.name, was: item.currency, now: selling };

    // The discount is this gym's own, read under its lock, and judged on the gym's own day.
    let used: { id: string; name: string; offMinor: number } | null = null;
    if (input.discountId !== null) {
      const found = await lockedDiscount(tx, input.gymId, input.discountId);
      if (found === null) return { kind: "discount_not_found" };
      const fits = discountFits({ ...found, archived: found.archivedAt !== null }, { today: input.today, productId: item.id, currency: item.currency });
      if (!fits.ok) return { kind: "discount_refused", name: found.name, reason: fits.reason };
      used = { id: found.id, name: found.name, offMinor: discountOff(found, item.price_minor * input.quantity) };
      // No use is spent on a discount that takes nothing off.
      if (used.offMinor === 0) return { kind: "discount_nothing_off", name: found.name };
    }

    // The product's rate as it is now, read under the gym's lock that its changes take.
    const rate = item.tax_rate_id === null ? null : await rateOf(tx, input.gymId, item.tax_rate_id);
    const amounts = saleAmounts({
      unitPriceMinor: item.price_minor,
      quantity: input.quantity,
      taxed: rate !== null,
      taxBp: rate?.bp ?? 0,
      taxIncluded: included,
      discountMinor: used?.offMinor ?? 0,
    });
    if (!amounts.ok && amounts.reason === "nothing_to_pay") return { kind: "nothing_to_pay" };
    if (!amounts.ok || amounts.totalMinor !== input.totalMinor) return { kind: "price_changed" };
    if (item.stock !== null && item.stock < input.quantity) return { kind: "out_of_stock", name: item.name, left: item.stock };
    // The last check before anything is written: the count moves only if the limit allows.
    if (used !== null && !(await takeUse(tx, input.gymId, used.id))) return { kind: "discount_refused", name: used.name, reason: "used_up" };

    // The sale takes the gym's next receipt number in the statement that writes it (18g-i).
    const [created] = await tx<{ id: string }[]>`
      WITH n AS (${nextReceipt(tx, input.gymId)})
      INSERT INTO gym_sales
        (gym_id, request_key, product_id, entry_id, item_name, quantity, unit_price_minor, net_minor, tax_minor, total_minor,
         tax_bp, tax_name, tax_included, currency, method, sold_on, recorded_by, stock_counted, created_at,
         discount_id, discount_name, discount_minor, receipt_number)
      SELECT ${input.gymId}, ${input.requestKey}, ${item.id}, ${input.entryId}, ${item.name}, ${input.quantity}, ${item.price_minor},
             ${amounts.netMinor}, ${amounts.taxMinor}, ${amounts.totalMinor}, ${rate?.bp ?? 0}, ${rate?.name ?? null}, ${included}, ${item.currency},
             ${input.method}, ${input.today}::date, ${input.actorUserId}, ${item.stock !== null}, ${input.now},
             ${used?.id ?? null}, ${used?.name ?? null}, ${used?.offMinor ?? 0}, n.number
      FROM n
      RETURNING id`;
    if (created === undefined) throw new Error("sale insert returned no row");
    if (item.stock !== null) {
      await tx`
        UPDATE gym_products SET stock = stock - ${input.quantity}, updated_at = ${input.now}
        WHERE gym_id = ${input.gymId} AND id = ${item.id}`;
    }
    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.sale_recorded",
      targetType: "gym_sale",
      targetId: created.id,
      meta: {
        productId: item.id,
        product: item.name,
        quantity: String(input.quantity),
        totalMinor: String(amounts.totalMinor),
        taxMinor: String(amounts.taxMinor),
        currency: item.currency,
        method: input.method,
        ...(input.entryId === null ? {} : { entryId: input.entryId }),
        ...(used === null ? {} : { discountId: used.id, discount: used.name, discountMinor: String(used.offMinor) }),
      },
    });
    return { kind: "ok", saleId: created.id };
  });
}

export type UndoSaleOutcome = { kind: "ok" } | { kind: "sale_not_found" } | { kind: "not_today" };

/** Takes one sale back: its row is kept, marked, what it took from the stock count is
 *  returned where the product is still counted, and the use of its discount is given
 *  back. Pressed twice it is taken back once. */
export async function undoSale(sql: Sql, input: { gymId: string; saleId: string; today: string; actorUserId: string; now: Date }): Promise<UndoSaleOutcome> {
  return await sql.begin(async (tx): Promise<UndoSaleOutcome> => {
    await lockOrgRow(tx, input.gymId);
    const [row] = await tx<{ product_id: string; quantity: number; sold_on: string; stock_counted: boolean; undone: boolean; total_minor: number; currency: string; item_name: string; discount_id: string | null }[]>`
      SELECT product_id, quantity, sold_on::text AS sold_on, stock_counted, undone_at IS NOT NULL AS undone, total_minor, currency, item_name, discount_id
      FROM gym_sales WHERE gym_id = ${input.gymId} AND id = ${input.saleId}`;
    if (row === undefined) return { kind: "sale_not_found" };
    if (row.undone) return { kind: "ok" };
    if (row.sold_on !== input.today) return { kind: "not_today" };
    await tx`
      UPDATE gym_sales SET undone_at = ${input.now}, undone_by = ${input.actorUserId}
      WHERE gym_id = ${input.gymId} AND id = ${input.saleId} AND undone_at IS NULL`;
    if (row.stock_counted) {
      await tx`
        UPDATE gym_products SET stock = LEAST(stock + ${row.quantity}, 100000), updated_at = ${input.now}
        WHERE gym_id = ${input.gymId} AND id = ${row.product_id} AND stock IS NOT NULL`;
    }
    if (row.discount_id !== null) await returnUse(tx, input.gymId, row.discount_id);
    await insertAudit(tx, {
      actorUserId: input.actorUserId,
      gymId: input.gymId,
      action: "org.sale_undone",
      targetType: "gym_sale",
      targetId: input.saleId,
      meta: { product: row.item_name, quantity: String(row.quantity), totalMinor: String(row.total_minor), currency: row.currency },
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

/** What one record has bought, newest first, and how many there are in all; null where
 *  the record is not this gym's. */
export async function purchasesOf(sql: Sql, gymId: string, entryId: string, limit: number): Promise<{ sales: SaleRow[]; total: number } | null> {
  const [entry] = await sql<{ id: string }[]>`SELECT id FROM gym_member_list_entries WHERE gym_id = ${gymId} AND id = ${entryId}`;
  if (entry === undefined) return null;
  const [rows, count] = await Promise.all([
    sql<RawSale[]>`
      SELECT ${saleColumns(sql)}
      FROM gym_sales s
      LEFT JOIN users u ON u.id = s.recorded_by
      LEFT JOIN gym_member_list_entries e ON e.gym_id = s.gym_id AND e.id = s.entry_id
      WHERE s.gym_id = ${gymId} AND s.entry_id = ${entryId}
      ORDER BY s.seq DESC
      LIMIT ${limit}`,
    sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_sales WHERE gym_id = ${gymId} AND entry_id = ${entryId}`,
  ]);
  return { sales: rows.map(sale), total: count[0]?.n ?? 0 };
}
