// Refund to card at Sell (ROADMAP 18d-iv-b-ii): a press on one product of a sale paid on the Terminal. A basket's products share
// one Square payment, so what can go back is the least of what is left of that product and of the whole payment, and at most one
// press waits on the payment at a time. The rest of a press's life is `cardRefundsRepo.ts`'s; what differs here is what the money
// is written against: a row of `gym_sale_refunds`, under the gym's lock, in the statement group that moves the press on.
import { refundSale as refundSaleCheck, type CardRefundCheck, type SaleCardRefundRequest, type SaleRefundReason } from "@app/shared";
import { saleRefundReasonSchema } from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import { lockGym } from "../memberList/repo.js";
import { saleRefundAsking, undoSaleRefund, writeSaleRefund } from "../register/repo.js";
import { insertAudit } from "../repo.js";
import { toPress, type RawPress, type RefundPress } from "./cardRefundsRepo.js";
import type { SquareEnvironment } from "./square.js";

type SqlOrTx = Sql | TransactionSql;

export interface SaleToRefund {
  saleId: string;
  productId: string;
  itemName: string;
  quantity: number;
  entryId: string | null;
  stockCounted: boolean;
  currency: string;
  undone: boolean;
  /** Square's payment, on a sale paid on the Terminal alone. */
  squarePaymentId: string | null;
  /** This product's own figures. */
  lineMinor: number;
  lineRefundedMinor: number;
  lineRestocked: number;
  /** What the app says can still go back on this product. */
  refundableMinor: number;
  /** What Square was paid for the whole sale, and what stands refunded on all of it, by any way. */
  amountMinor: number;
  refundedMinor: number;
}

/** One product of a sale, read through the gym, with what all of its one Square payment holds; null where it is not the gym's. */
export async function readSaleToRefund(sql: SqlOrTx, gymId: string, saleId: string): Promise<SaleToRefund | null> {
  const [row] = await sql<
    {
      product_id: string;
      item_name: string;
      quantity: number;
      entry_id: string | null;
      stock_counted: boolean;
      currency: string;
      undone: boolean;
      square_payment_id: string | null;
      total_minor: number;
      line_refunded: number;
      line_restocked: number;
      basket_minor: number;
      basket_refunded: number;
    }[]
  >`
    SELECT s.product_id, s.item_name, s.quantity, s.entry_id, s.stock_counted, s.currency, s.undone_at IS NOT NULL AS undone, s.square_payment_id, s.total_minor,
           COALESCE((SELECT sum(f.amount_minor) FROM gym_sale_refunds f WHERE f.gym_id = s.gym_id AND f.sale_id = s.id AND f.undone_at IS NULL), 0)::int AS line_refunded,
           COALESCE((SELECT sum(f.restocked) FROM gym_sale_refunds f WHERE f.gym_id = s.gym_id AND f.sale_id = s.id AND f.undone_at IS NULL), 0)::int AS line_restocked,
           (SELECT sum(b.total_minor) FROM gym_sales b WHERE b.gym_id = s.gym_id AND b.receipt_number = s.receipt_number)::int AS basket_minor,
           COALESCE((SELECT sum(f.amount_minor) FROM gym_sale_refunds f
                     JOIN gym_sales b ON b.gym_id = f.gym_id AND b.id = f.sale_id
                     WHERE f.gym_id = s.gym_id AND b.receipt_number = s.receipt_number AND f.undone_at IS NULL), 0)::int AS basket_refunded
    FROM gym_sales s
    WHERE s.gym_id = ${gymId} AND s.id = ${saleId}`;
  if (row === undefined) return null;
  return {
    saleId,
    productId: row.product_id,
    itemName: row.item_name,
    quantity: row.quantity,
    entryId: row.entry_id,
    stockCounted: row.stock_counted,
    currency: row.currency,
    undone: row.undone,
    squarePaymentId: row.square_payment_id,
    lineMinor: row.total_minor,
    lineRefundedMinor: row.line_refunded,
    lineRestocked: row.line_restocked,
    refundableMinor: Math.max(0, row.total_minor - row.line_refunded),
    amountMinor: row.basket_minor,
    refundedMinor: row.basket_refunded,
  };
}

const saleRule = (sale: SaleToRefund, ask: { amountMinor: number; restock: number }) =>
  refundSaleCheck(
    { totalMinor: sale.lineMinor, quantity: sale.quantity, voided: sale.undone, refundedMinor: sale.lineRefundedMinor, restocked: sale.lineRestocked, stockCounted: sale.stockCounted },
    ask,
  );

/** The same press sent again: the same product, amount, reason and shelf count. */
export function samePress(press: RefundPress, saleId: string, body: Pick<SaleCardRefundRequest, "amountMinor" | "reason" | "restock">): boolean {
  return press.saleId === saleId && press.amountMinor === body.amountMinor && press.reason === body.reason && press.restock === body.restock;
}

export interface NewSalePress {
  id: string;
  gymId: string;
  saleId: string;
  requestKey: string;
  amountMinor: number;
  reason: SaleRefundReason;
  restock: number;
  /** What Square says is left, read just before: never more than this is asked for. */
  squareLeftMinor: number;
  card: CardRefundCheck["card"];
  environment: SquareEnvironment;
  accountId: string;
  startedBy: string;
  now: Date;
  /** Held by the request that writes it, which asks Square straight after. */
  checkingUntil: Date;
}

export type StartSaleOutcome =
  | { kind: "new" | "same_press"; press: RefundPress }
  | { kind: "key_reused" | "sale_not_found" | "not_card" | "voided" | "waiting" | "not_counted" }
  | { kind: "too_much"; leftMinor: number; currency: string }
  | { kind: "too_many_back"; leftCount: number };

/** The press, written under the gym's lock with the rule a refund noted by hand uses. Two staff at one instant are taken one after
 *  the other, and the second finds the first waiting or its money gone; the same press twice is the one row. */
export async function startSaleRefund(sql: Sql, s: NewSalePress): Promise<StartSaleOutcome> {
  return await sql.begin(async (tx): Promise<StartSaleOutcome> => {
    await lockGym(tx, s.gymId);
    const [again] = await tx<RawPress[]>`SELECT * FROM gym_square_refunds WHERE gym_id = ${s.gymId} AND request_key = ${s.requestKey}`;
    if (again !== undefined) {
      const press = toPress(again);
      return samePress(press, s.saleId, s) ? { kind: "same_press", press } : { kind: "key_reused" };
    }
    const [noted] = await tx<{ id: string }[]>`SELECT id FROM gym_sale_refunds WHERE gym_id = ${s.gymId} AND request_key = ${s.requestKey}`;
    if (noted !== undefined) return { kind: "key_reused" };

    const sale = await readSaleToRefund(tx, s.gymId, s.saleId);
    if (sale === null) return { kind: "sale_not_found" };
    if (sale.squarePaymentId === null) return { kind: "not_card" };
    if (await saleRefundAsking(tx, s.gymId, s.saleId)) return { kind: "waiting" };

    const rule = saleRule(sale, s);
    if (!rule.ok) {
      if (rule.reason === "too_much") return { kind: "too_much", leftMinor: rule.leftMinor, currency: sale.currency };
      if (rule.reason === "too_many_back") return { kind: "too_many_back", leftCount: rule.leftCount };
      if (rule.reason === "not_counted") return { kind: "not_counted" };
      return { kind: "voided" };
    }
    if (s.amountMinor > s.squareLeftMinor) return { kind: "too_much", leftMinor: s.squareLeftMinor, currency: sale.currency };

    const [row] = await tx<RawPress[]>`
      INSERT INTO gym_square_refunds
        (id, gym_id, sale_id, restock, environment, account_id, square_payment_id, amount_minor, currency, reason, brand, last4,
         request_key, state, started_by, started_at, checked_at, checking_until)
      VALUES (${s.id}, ${s.gymId}, ${s.saleId}, ${s.restock}, ${s.environment}, ${s.accountId}, ${sale.squarePaymentId}, ${s.amountMinor},
              ${sale.currency}, ${s.reason}, ${s.card?.brand ?? null}, ${s.card?.last4 ?? null}, ${s.requestKey}, 'asking',
              ${s.startedBy}, ${s.now}, ${s.now}, ${s.checkingUntil})
      RETURNING *`;
    if (row === undefined) throw new Error("a sale's refund press was not written under the gym's lock");
    return { kind: "new", press: toPress(row) };
  });
}

const saleOf = async (tx: SqlOrTx, press: RefundPress): Promise<SaleToRefund> => {
  if (press.saleId === null) throw new Error("a member's refund press read as a sale's");
  const sale = await readSaleToRefund(tx, press.gymId, press.saleId);
  if (sale === null) throw new Error("the sale of a refund press is gone");
  return sale;
};

/** Square took the refund up: the money stands as given back, and what went back on the shelf with it, once. False where this
 *  press was already moved on. */
export async function recordSaleTaken(sql: Sql, press: RefundPress, taken: { squareRefundId: string; today: string; now: Date; lookAt: Date }): Promise<boolean> {
  return await sql.begin(async (tx) => {
    await lockGym(tx, press.gymId);
    const [row] = await tx<{ state: string }[]>`SELECT state FROM gym_square_refunds WHERE gym_id = ${press.gymId} AND id = ${press.id} FOR UPDATE`;
    if (row?.state !== "asking") return false;
    const sale = await saleOf(tx, press);
    // Square has the money on its way: what is written is what Square did.
    const written = await writeSaleRefund(tx, {
      gymId: press.gymId,
      saleId: sale.saleId,
      productId: sale.productId,
      itemName: sale.itemName,
      stockCounted: sale.stockCounted,
      currency: press.currency,
      requestKey: press.requestKey,
      amountMinor: press.amountMinor,
      method: "terminal",
      reason: saleRefundReasonSchema.parse(press.reason),
      restock: sale.stockCounted ? press.restock : 0,
      refundedInFull: sale.lineRefundedMinor + press.amountMinor >= sale.lineMinor,
      today: taken.today,
      actorUserId: press.startedBy,
      now: taken.now,
      action: "org.sale_refund_sent",
      card: press.brand === null || press.last4 === null ? null : { brand: press.brand, last4: press.last4 },
    });
    await tx`
      UPDATE gym_square_refunds
      SET state = 'pending', sale_refund_id = ${written.id}, square_refund_id = ${taken.squareRefundId}, look_at = ${taken.lookAt}, checking_until = NULL
      WHERE gym_id = ${press.gymId} AND id = ${press.id}`;
    return true;
  });
}

/** Square took the refund up, then said it failed: the money was never sent, so the refund is voided by the app, what it put on the
 *  shelf comes off, and a friend's sale gives the member's gift again where none stands. */
export async function recordSaleFailed(sql: Sql, press: RefundPress, failed: { code: string; today: string; now: Date }): Promise<boolean> {
  return await sql.begin(async (tx) => {
    await lockGym(tx, press.gymId);
    const [row] = await tx<{ state: string; sale_refund_id: string | null }[]>`
      SELECT state, sale_refund_id FROM gym_square_refunds WHERE gym_id = ${press.gymId} AND id = ${press.id} FOR UPDATE`;
    if (row?.state !== "pending" || row.sale_refund_id === null) return false;
    const [voided] = await tx<{ restocked: number }[]>`
      UPDATE gym_sale_refunds SET undone_at = ${failed.now}, void_reason = 'square_failed'
      WHERE gym_id = ${press.gymId} AND id = ${row.sale_refund_id} AND undone_at IS NULL
      RETURNING restocked`;
    const sale = await saleOf(tx, press);
    await undoSaleRefund(tx, {
      gymId: press.gymId,
      saleId: sale.saleId,
      productId: sale.productId,
      restocked: voided?.restocked ?? 0,
      stockCounted: sale.stockCounted,
      entryId: sale.entryId,
      saleUndone: sale.undone,
      today: failed.today,
      now: failed.now,
    });
    await tx`
      UPDATE gym_square_refunds SET state = 'done', outcome = 'failed', code = ${failed.code}, look_at = NULL, finished_at = ${failed.now}, checking_until = NULL
      WHERE gym_id = ${press.gymId} AND id = ${press.id}`;
    await insertAudit(tx, {
      actorUserId: null,
      gymId: press.gymId,
      action: "org.sale_refund_failed",
      targetType: "gym_sale_refund",
      targetId: row.sale_refund_id,
      meta: { saleId: sale.saleId, product: sale.itemName, amountMinor: String(press.amountMinor), currency: press.currency, restocked: String(voided?.restocked ?? 0) },
    });
    return true;
  });
}
