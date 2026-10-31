// Refund to card at Sell (ROADMAP 18d-iv-b-ii): a press on one product of a sale paid on the Terminal, or on all that is left of
// it. A basket's products share one Square payment, so what can go back is the least of what is left of the product and of the
// whole payment, at most one press waits on the payment at a time, and all of a sale is ONE refund at Square. The rest of a press's
// life is `cardRefundsRepo.ts`'s; what differs here is what the money is written against: a row of `gym_sale_refunds` for each
// product, under the gym's lock, in the statement group that moves the press on.
import { saleRefundReasonSchema, type CardRefundCheck, type SaleCardRefundRequest, type SaleRefundReason, type SaleWholeCardRefundRequest } from "@app/shared";
import type { Sql } from "postgres";
import { lockGym } from "../memberList/repo.js";
import { saleLineRule, saleLinesToRefund, saleRefundAsking, undoSaleRefund, wholeSaleParts, writeSaleRefund, type SaleToRefund } from "../register/repo.js";
import { insertAudit } from "../repo.js";
import { toPress, type RawPress, type RefundPress, type SalePart } from "./cardRefundsRepo.js";
import type { SquareEnvironment } from "./square.js";

/** The same press sent again: the same product, amount, reason and shelf count. */
export function samePress(press: RefundPress, saleId: string, body: Pick<SaleCardRefundRequest, "amountMinor" | "reason" | "restock">): boolean {
  return press.parts === null && press.saleId === saleId && press.amountMinor === body.amountMinor && press.reason === body.reason && press.restock === body.restock;
}

/** The same press on all of a sale sent again: the same sale, amount and reason. Its shelf counts were fixed by the first. */
export function sameWholePress(press: RefundPress, lines: readonly SaleToRefund[], body: Pick<SaleWholeCardRefundRequest, "amountMinor" | "reason">): boolean {
  return press.parts !== null && lines.some((l) => l.saleId === press.saleId) && press.amountMinor === body.amountMinor && press.reason === body.reason;
}

interface PressBase {
  id: string;
  gymId: string;
  saleId: string;
  requestKey: string;
  amountMinor: number;
  reason: SaleRefundReason;
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

export interface NewSalePress extends PressBase {
  restock: number;
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
    const [noted] = await tx<{ id: string }[]>`SELECT id FROM gym_sale_refunds WHERE gym_id = ${s.gymId} AND request_key = ${s.requestKey} LIMIT 1`;
    if (noted !== undefined) return { kind: "key_reused" };

    const sale = (await saleLinesToRefund(tx, s.gymId, s.saleId)).find((l) => l.saleId === s.saleId);
    if (sale === undefined) return { kind: "sale_not_found" };
    if (sale.squarePaymentId === null) return { kind: "not_card" };
    if (await saleRefundAsking(tx, s.gymId, s.saleId)) return { kind: "waiting" };

    const rule = saleLineRule(sale, s);
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

export interface NewWholeSalePress extends PressBase {
  shelf: readonly { saleId: string; count: number }[];
}

export type StartWholeSaleOutcome =
  | { kind: "new" | "same_press"; press: RefundPress }
  | { kind: "key_reused" | "sale_not_found" | "not_card" | "voided" | "waiting" | "changed" | "not_counted" }
  | { kind: "too_many_back"; leftCount: number };

/** The press on all of a sale: what each product takes is fixed here, under the gym's lock, and the amount is what staff saw left,
 *  so a sale that changed meanwhile is refused and never sent for another amount. */
export async function startWholeSaleRefund(sql: Sql, s: NewWholeSalePress): Promise<StartWholeSaleOutcome> {
  return await sql.begin(async (tx): Promise<StartWholeSaleOutcome> => {
    await lockGym(tx, s.gymId);
    const lines = await saleLinesToRefund(tx, s.gymId, s.saleId);
    const [again] = await tx<RawPress[]>`SELECT * FROM gym_square_refunds WHERE gym_id = ${s.gymId} AND request_key = ${s.requestKey}`;
    if (again !== undefined) {
      const press = toPress(again);
      return sameWholePress(press, lines, s) ? { kind: "same_press", press } : { kind: "key_reused" };
    }
    const [noted] = await tx<{ id: string }[]>`SELECT id FROM gym_sale_refunds WHERE gym_id = ${s.gymId} AND request_key = ${s.requestKey} LIMIT 1`;
    if (noted !== undefined) return { kind: "key_reused" };

    const first = lines[0];
    if (first === undefined) return { kind: "sale_not_found" };
    if (first.squarePaymentId === null) return { kind: "not_card" };
    if (first.undone) return { kind: "voided" };
    if (await saleRefundAsking(tx, s.gymId, s.saleId)) return { kind: "waiting" };
    const leftMinor = lines.reduce((n, l) => n + l.refundableMinor, 0);
    if (leftMinor !== s.amountMinor || leftMinor > s.squareLeftMinor) return { kind: "changed" };
    const split = wholeSaleParts(lines, s.shelf);
    if (split.kind !== "ok") return split;
    const [firstPart] = split.parts;
    if (firstPart === undefined) return { kind: "changed" };

    const [row] = await tx<RawPress[]>`
      INSERT INTO gym_square_refunds
        (id, gym_id, sale_id, parts, environment, account_id, square_payment_id, amount_minor, currency, reason, brand, last4,
         request_key, state, started_by, started_at, checked_at, checking_until)
      VALUES (${s.id}, ${s.gymId}, ${firstPart.saleId}, ${tx.json(split.parts)}, ${s.environment}, ${s.accountId}, ${first.squarePaymentId}, ${s.amountMinor},
              ${first.currency}, ${s.reason}, ${s.card?.brand ?? null}, ${s.card?.last4 ?? null}, ${s.requestKey}, 'asking',
              ${s.startedBy}, ${s.now}, ${s.now}, ${s.checkingUntil})
      RETURNING *`;
    if (row === undefined) throw new Error("a sale's refund press was not written under the gym's lock");
    return { kind: "new", press: toPress(row) };
  });
}

/** What a press writes: its parts, or its one product. */
function partsOf(press: RefundPress): SalePart[] {
  if (press.parts !== null) return press.parts;
  if (press.saleId === null) throw new Error("a member's refund press read as a sale's");
  return [{ saleId: press.saleId, amountMinor: press.amountMinor, restock: press.restock }];
}

/** Square took the refund up: the money stands as given back on each product, and what went back on the shelf with it, once. False
 *  where this press was already moved on. */
export async function recordSaleTaken(sql: Sql, press: RefundPress, taken: { squareRefundId: string; today: string; now: Date; lookAt: Date }): Promise<boolean> {
  return await sql.begin(async (tx) => {
    await lockGym(tx, press.gymId);
    const [row] = await tx<{ state: string }[]>`SELECT state FROM gym_square_refunds WHERE gym_id = ${press.gymId} AND id = ${press.id} FOR UPDATE`;
    if (row?.state !== "asking") return false;
    const parts = partsOf(press);
    const lines = await saleLinesToRefund(tx, press.gymId, parts[0]?.saleId ?? "");
    for (const part of parts) {
      const sale = lines.find((l) => l.saleId === part.saleId);
      if (sale === undefined) throw new Error("the sale of a refund press is gone");
      // Square has the money on its way: what is written is what Square did.
      await writeSaleRefund(tx, {
        gymId: press.gymId,
        saleId: sale.saleId,
        productId: sale.productId,
        itemName: sale.itemName,
        stockCounted: sale.stockCounted,
        currency: press.currency,
        requestKey: press.requestKey,
        amountMinor: part.amountMinor,
        method: "terminal",
        reason: saleRefundReasonSchema.parse(press.reason),
        restock: sale.stockCounted ? part.restock : 0,
        refundedInFull: sale.lineRefundedMinor + part.amountMinor >= sale.lineMinor,
        today: taken.today,
        actorUserId: press.startedBy,
        now: taken.now,
        action: "org.sale_refund_sent",
        card: press.brand === null || press.last4 === null ? null : { brand: press.brand, last4: press.last4 },
        pressId: press.id,
      });
    }
    await tx`
      UPDATE gym_square_refunds
      SET state = 'pending', square_refund_id = ${taken.squareRefundId}, look_at = ${taken.lookAt}, checking_until = NULL
      WHERE gym_id = ${press.gymId} AND id = ${press.id}`;
    return true;
  });
}

/** Square took the refund up, then said it failed: the money was never sent, so each refund of the press is voided by the app, what
 *  it put on the shelf comes off, and a friend's sale gives the member's gift again where none stands. */
export async function recordSaleFailed(sql: Sql, press: RefundPress, failed: { code: string; today: string; now: Date }): Promise<boolean> {
  return await sql.begin(async (tx) => {
    await lockGym(tx, press.gymId);
    const [row] = await tx<{ state: string }[]>`SELECT state FROM gym_square_refunds WHERE gym_id = ${press.gymId} AND id = ${press.id} FOR UPDATE`;
    if (row?.state !== "pending") return false;
    const voided = await tx<{ id: string; sale_id: string; restocked: number; amount_minor: number }[]>`
      UPDATE gym_sale_refunds SET undone_at = ${failed.now}, void_reason = 'square_failed'
      WHERE gym_id = ${press.gymId} AND press_id = ${press.id} AND undone_at IS NULL
      RETURNING id, sale_id, restocked, amount_minor`;
    const lines: SaleToRefund[] = voided[0] === undefined ? [] : await saleLinesToRefund(tx, press.gymId, voided[0].sale_id);
    for (const refund of voided) {
      const sale = lines.find((l) => l.saleId === refund.sale_id);
      if (sale === undefined) throw new Error("the sale of a refund press is gone");
      await undoSaleRefund(tx, {
        gymId: press.gymId,
        saleId: sale.saleId,
        productId: sale.productId,
        restocked: refund.restocked,
        stockCounted: sale.stockCounted,
        entryId: sale.entryId,
        saleUndone: sale.undone,
        today: failed.today,
        now: failed.now,
      });
      await insertAudit(tx, {
        actorUserId: null,
        gymId: press.gymId,
        action: "org.sale_refund_failed",
        targetType: "gym_sale_refund",
        targetId: refund.id,
        meta: { saleId: sale.saleId, product: sale.itemName, amountMinor: String(refund.amount_minor), currency: press.currency, restocked: String(refund.restocked) },
      });
    }
    await tx`
      UPDATE gym_square_refunds SET state = 'done', outcome = 'failed', code = ${failed.code}, look_at = NULL, finished_at = ${failed.now}, checking_until = NULL
      WHERE gym_id = ${press.gymId} AND id = ${press.id}`;
    return true;
  });
}
