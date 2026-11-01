// Refund to card at Sell (ROADMAP 18d-iv-b-ii): a press on one product of a sale paid on the Terminal, or on all that is left of
// it. A basket's products share one Square payment, so what can go back is the least of what is left of the product and of the
// whole payment, at most one press waits on the payment at a time, and all of a sale is ONE refund at Square. The rest of a press's
// life is `cardRefundsRepo.ts`'s; what differs here is what the money is written against: a row of `gym_sale_refunds` for each
// product, under the gym's lock, in the statement group that moves the press on.
import { saleRefundReasonSchema, type CardRefundCheck, type SaleCardRefundRequest, type SaleRefundReason, type SaleWholeCardRefundRequest } from "@app/shared";
import { randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import { lockGym } from "../memberList/repo.js";
import { checkPlaceAnswer, notesCrossedOut, placeSquareRefund, type PlaceNote, type PlacedPart } from "./saleSquarePlace.js";
import { saleLineRule, saleLinesToRefund, saleRefundAsking, undoSaleRefund, wholeSaleParts, writeSaleRefund, type SaleToRefund } from "../register/repo.js";
import { insertAudit } from "../repo.js";
import { CLOCKS_APART_MS, terminalFree, toPress, type MadeInSquareOutcome, type RawPress, type RefundPress, type SalePart } from "./cardRefundsRepo.js";
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
  /** The Terminal, where Square needs the card present. */
  deviceId: string | null;
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
  | { kind: "key_reused" | "sale_not_found" | "not_card" | "voided" | "waiting" | "not_counted" | "terminal_busy" }
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
    if (!(await terminalFree(tx, s))) return { kind: "terminal_busy" };

    const [row] = await tx<RawPress[]>`
      INSERT INTO gym_square_refunds
        (id, gym_id, sale_id, restock, environment, account_id, square_payment_id, amount_minor, currency, reason, brand, last4,
         request_key, state, device_id, started_by, started_at, checked_at, checking_until)
      VALUES (${s.id}, ${s.gymId}, ${s.saleId}, ${s.restock}, ${s.environment}, ${s.accountId}, ${sale.squarePaymentId}, ${s.amountMinor},
              ${sale.currency}, ${s.reason}, ${s.card?.brand ?? null}, ${s.card?.last4 ?? null}, ${s.requestKey}, 'asking',
              ${s.deviceId}, ${s.startedBy}, ${s.now}, ${s.now}, ${s.checkingUntil})
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
  | { kind: "key_reused" | "sale_not_found" | "not_card" | "voided" | "waiting" | "changed" | "not_counted" | "terminal_busy" }
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
    if (!(await terminalFree(tx, s))) return { kind: "terminal_busy" };

    const [row] = await tx<RawPress[]>`
      INSERT INTO gym_square_refunds
        (id, gym_id, sale_id, parts, environment, account_id, square_payment_id, amount_minor, currency, reason, brand, last4,
         request_key, state, device_id, started_by, started_at, checked_at, checking_until)
      VALUES (${s.id}, ${s.gymId}, ${firstPart.saleId}, ${tx.json(split.parts)}, ${s.environment}, ${s.accountId}, ${first.squarePaymentId}, ${s.amountMinor},
              ${first.currency}, ${s.reason}, ${s.card?.brand ?? null}, ${s.card?.last4 ?? null}, ${s.requestKey}, 'asking',
              ${s.deviceId}, ${s.startedBy}, ${s.now}, ${s.now}, ${s.checkingUntil})
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
      UPDATE gym_square_refunds SET state = 'done', outcome = 'failed', code = ${failed.code}, look_at = NULL, finished_at = ${failed.now}, checking_until = NULL, to_place = false
      WHERE gym_id = ${press.gymId} AND id = ${press.id}`;
    return true;
  });
}

/** The refunds noted by card on a sale, oldest first. A note made after one was crossed out is staff saying it is another refund, so it stands. */
async function cardNotes(tx: TransactionSql, gymId: string, lines: readonly SaleToRefund[]): Promise<PlaceNote[]> {
  const ids = lines.map((l) => l.saleId);
  const rows = await tx<{ id: string; sale_id: string; amount_minor: number; restocked: number }[]>`
    SELECT n.id, n.sale_id, n.amount_minor, n.restocked FROM gym_sale_refunds n
    WHERE n.gym_id = ${gymId} AND n.sale_id = ANY(${ids}::uuid[]) AND n.undone_at IS NULL AND n.method = 'card_at_desk'
      AND NOT EXISTS (SELECT 1 FROM gym_sale_refunds v WHERE v.gym_id = n.gym_id AND v.sale_id = ANY(${ids}::uuid[]) AND v.void_reason = 'in_square' AND v.undone_at <= n.created_at)
    ORDER BY n.created_at, n.id FOR UPDATE OF n`;
  return rows.map((r) => ({ id: r.id, saleId: r.sale_id, amountMinor: r.amount_minor, restocked: r.restocked }));
}

/** Notes Square's record replaces: crossed out, what they did undone, with the reason said. */
async function crossOutNotes(tx: TransactionSql, gymId: string, lines: readonly SaleToRefund[], notes: readonly PlaceNote[], currency: string, today: string, now: Date): Promise<void> {
  for (const note of notes) {
    const sale = lines.find((l) => l.saleId === note.saleId);
    if (sale === undefined) throw new Error("a noted refund is not on its sale");
    await tx`UPDATE gym_sale_refunds SET undone_at = ${now}, void_reason = 'in_square' WHERE gym_id = ${gymId} AND id = ${note.id}`;
    await undoSaleRefund(tx, { gymId, saleId: sale.saleId, productId: sale.productId, restocked: note.restocked, stockCounted: sale.stockCounted, entryId: sale.entryId, saleUndone: sale.undone, today, now });
    await insertAudit(tx, {
      actorUserId: null,
      gymId,
      action: "org.sale_refund_replaced",
      targetType: "gym_sale_refund",
      targetId: note.id,
      meta: { saleId: sale.saleId, product: sale.itemName, amountMinor: String(note.amountMinor), currency, reason: "in_square" },
    });
  }
}

/** The money of a refund through Square, written on its products, after any notes it replaces are gone. */
async function writeParts(
  tx: TransactionSql,
  w: { gymId: string; lines: readonly SaleToRefund[]; crossed: readonly PlaceNote[]; parts: readonly PlacedPart[]; currency: string; requestKey: string; reason: SaleRefundReason; today: string; actorUserId: string | null; now: Date; action: "org.sale_refund_sent" | "org.sale_refund_in_square"; card: { brand: string; last4: string } | null; pressId: string },
): Promise<number[]> {
  const receipts: number[] = [];
  for (const part of w.parts) {
    const sale = w.lines.find((l) => l.saleId === part.saleId);
    if (sale === undefined) throw new Error("a part of a refund is not on its sale");
    const before = sale.lineRefundedMinor - w.crossed.filter((n) => n.saleId === part.saleId).reduce((total, n) => total + n.amountMinor, 0);
    const written = await writeSaleRefund(tx, {
      gymId: w.gymId,
      saleId: sale.saleId,
      productId: sale.productId,
      itemName: sale.itemName,
      stockCounted: sale.stockCounted,
      currency: w.currency,
      requestKey: w.requestKey,
      amountMinor: part.amountMinor,
      method: "terminal",
      reason: w.reason,
      restock: sale.stockCounted ? part.restock : 0,
      refundedInFull: before + part.amountMinor >= sale.lineMinor,
      today: w.today,
      actorUserId: w.actorUserId,
      now: w.now,
      action: w.action,
      card: w.card,
      pressId: w.pressId,
    });
    receipts.push(written.receiptNumber);
  }
  return receipts;
}

/** A refund Square made on a sale and no row here holds: written once and in full, under the gym's lock. A press left "We don't know" for
 *  this amount is this refund and takes its own products. Otherwise `placeSquareRefund` says which products, or that staff must. */
export async function recordSaleMadeInSquare(
  sql: Sql,
  r: { gymId: string; environment: SquareEnvironment; accountId: string; squareRefundId: string; squarePaymentId: string; amountMinor: number; currency: string; card: { brand: string; last4: string } | null; madeAt: Date; today: string; now: Date; lookAt: Date },
): Promise<MadeInSquareOutcome> {
  return await sql.begin(async (tx): Promise<MadeInSquareOutcome> => {
    await lockGym(tx, r.gymId);
    const [known] = await tx<{ id: string }[]>`SELECT id FROM gym_square_refunds WHERE environment = ${r.environment} AND square_refund_id = ${r.squareRefundId}`;
    if (known !== undefined) return { kind: "already" };
    const [asking] = await tx<{ id: string }[]>`SELECT id FROM gym_square_refunds WHERE gym_id = ${r.gymId} AND square_payment_id = ${r.squarePaymentId} AND state = 'asking' LIMIT 1`;
    if (asking !== undefined) return { kind: "waiting" };
    const [line] = await tx<{ id: string }[]>`SELECT id FROM gym_sales WHERE gym_id = ${r.gymId} AND square_payment_id = ${r.squarePaymentId} LIMIT 1`;
    const lines = line === undefined ? [] : await saleLinesToRefund(tx, r.gymId, line.id);
    const first = lines[0];
    if (first === undefined || first.undone || first.currency !== r.currency) return { kind: "no_payment" };
    const notes = await cardNotes(tx, r.gymId, lines);

    const [lost] = await tx<RawPress[]>`
      SELECT * FROM gym_square_refunds
      WHERE gym_id = ${r.gymId} AND square_payment_id = ${r.squarePaymentId} AND sale_id IS NOT NULL AND outcome = 'lost' AND no_refund_at IS NULL AND amount_minor = ${r.amountMinor}
        AND started_at <= ${new Date(r.madeAt.getTime() + CLOCKS_APART_MS)} AND finished_at >= ${new Date(r.madeAt.getTime() - CLOCKS_APART_MS)}
      ORDER BY started_at DESC LIMIT 1 FOR UPDATE`;
    if (lost !== undefined) {
      const press = toPress(lost);
      const parts = partsOf(press);
      // Staff noted it as told, "if it went through": the press holds the same money and its own shelf count.
      const crossed = notesCrossedOut(notes, r.amountMinor);
      await crossOutNotes(tx, r.gymId, lines, crossed, r.currency, r.today, r.now);
      await writeParts(tx, { gymId: r.gymId, lines, crossed, parts, currency: r.currency, requestKey: press.requestKey, reason: saleRefundReasonSchema.parse(press.reason), today: r.today, actorUserId: press.startedBy, now: r.now, action: "org.sale_refund_sent", card: press.brand === null || press.last4 === null ? r.card : { brand: press.brand, last4: press.last4 }, pressId: press.id });
      const [row] = await tx<RawPress[]>`
        UPDATE gym_square_refunds SET state = 'pending', outcome = NULL, code = NULL, finished_at = NULL, square_refund_id = ${r.squareRefundId}, look_at = ${r.lookAt}, checking_until = NULL
        WHERE gym_id = ${r.gymId} AND id = ${press.id} RETURNING *`;
      if (row === undefined) throw new Error("a sale's press was not moved on under the gym's lock");
      return { kind: "written", press: toPress(row) };
    }

    const placed = placeSquareRefund(lines.map((l) => ({ saleId: l.saleId, lineMinor: l.lineMinor, refundedMinor: l.lineRefundedMinor })), notes, r.amountMinor);
    const id = randomUUID();
    const requestKey = randomUUID();
    const onSale = placed.kind === "place" ? (placed.parts[0]?.saleId ?? first.saleId) : first.saleId;
    const [row] = await tx<RawPress[]>`
      INSERT INTO gym_square_refunds
        (id, gym_id, sale_id, parts, to_place, environment, account_id, square_payment_id, square_refund_id, amount_minor, currency, reason, brand, last4,
         request_key, state, look_at, from_square, started_at, checked_at)
      VALUES (${id}, ${r.gymId}, ${onSale}, ${placed.kind === "place" ? tx.json(placed.parts.map((p) => ({ ...p }))) : null}, ${placed.kind === "ask"}, ${r.environment}, ${r.accountId}, ${r.squarePaymentId}, ${r.squareRefundId}, ${r.amountMinor}, ${r.currency}, 'other',
              ${r.card?.brand ?? null}, ${r.card?.last4 ?? null}, ${requestKey}, 'pending', ${r.lookAt}, true, ${r.madeAt}, ${r.now})
      RETURNING *`;
    if (row === undefined) throw new Error("a refund made in Square was not written under the gym's lock");
    if (placed.kind === "place") {
      await crossOutNotes(tx, r.gymId, lines, placed.crossed, r.currency, r.today, r.now);
      await writeParts(tx, { gymId: r.gymId, lines, crossed: placed.crossed, parts: placed.parts, currency: r.currency, requestKey, reason: "other", today: r.today, actorUserId: null, now: r.now, action: "org.sale_refund_in_square", card: r.card, pressId: id });
    } else {
      await insertAudit(tx, {
        actorUserId: null,
        gymId: r.gymId,
        action: "org.sale_refund_to_place",
        targetType: "gym_square_refund",
        targetId: id,
        meta: { saleId: first.saleId, product: first.itemName, amountMinor: String(r.amountMinor), currency: r.currency, ...(r.card === null ? {} : { brand: r.card.brand, last4: r.card.last4 }) },
      });
    }
    return { kind: "written", press: toPress(row) };
  });
}

export type PlaceOutcome = { kind: "ok"; receiptNumbers: number[]; parts: PlacedPart[] } | { kind: "not_found" | "changed" | "waiting" | "not_on_sale" | "wrong_total" | "too_much" | "too_many_back" };

/** Staff say which product a refund made in Square was for: its money is written then, on the day Square made it. The same answer twice is one. */
export async function placeSaleRefund(sql: Sql, a: { gymId: string; saleId: string; pressId: string; parts: readonly PlacedPart[]; actorUserId: string; now: Date }): Promise<PlaceOutcome> {
  return await sql.begin(async (tx): Promise<PlaceOutcome> => {
    await lockGym(tx, a.gymId);
    const [row] = await tx<(RawPress & { made_on: string; today: string })[]>`
      SELECT q.*, (q.started_at AT TIME ZONE g.timezone)::date::text AS made_on, (${a.now}::timestamptz AT TIME ZONE g.timezone)::date::text AS today
      FROM gym_square_refunds q JOIN gyms g ON g.id = q.gym_id
      WHERE q.gym_id = ${a.gymId} AND q.id = ${a.pressId} AND q.from_square FOR UPDATE OF q`;
    if (row === undefined || row.sale_id === null) return { kind: "not_found" };
    const press = toPress(row);
    const lines = await saleLinesToRefund(tx, a.gymId, row.sale_id);
    if (!lines.some((l) => l.saleId === a.saleId)) return { kind: "not_found" };
    if (!press.toPlace) {
      const same = press.parts !== null && press.outcome !== "failed" && press.parts.length === a.parts.length && a.parts.every((p) => press.parts?.some((q) => q.saleId === p.saleId && q.amountMinor === p.amountMinor));
      if (!same) return { kind: "changed" };
      const receipts = await tx<{ receipt_number: number }[]>`SELECT receipt_number FROM gym_sale_refunds WHERE gym_id = ${a.gymId} AND press_id = ${press.id} ORDER BY receipt_number`;
      return { kind: "ok", receiptNumbers: receipts.map((r) => r.receipt_number), parts: press.parts ?? [] };
    }
    if (lines[0]?.undone === true) return { kind: "changed" };
    if (await saleRefundAsking(tx, a.gymId, row.sale_id)) return { kind: "waiting" };
    const notes = await cardNotes(tx, a.gymId, lines);
    const check = checkPlaceAnswer(lines.map((l) => ({ saleId: l.saleId, lineMinor: l.lineMinor, refundedMinor: l.lineRefundedMinor, quantity: l.quantity, restocked: l.lineRestocked, stockCounted: l.stockCounted })), notes, press.amountMinor, a.parts);
    if (!check.ok) return { kind: check.reason };
    await crossOutNotes(tx, a.gymId, lines, check.crossed, press.currency, row.today, a.now);
    const receiptNumbers = await writeParts(tx, { gymId: a.gymId, lines, crossed: check.crossed, parts: check.parts, currency: press.currency, requestKey: press.requestKey, reason: "other", today: row.made_on, actorUserId: a.actorUserId, now: a.now, action: "org.sale_refund_in_square", card: press.brand === null || press.last4 === null ? null : { brand: press.brand, last4: press.last4 }, pressId: press.id });
    await tx`UPDATE gym_square_refunds SET to_place = false, parts = ${tx.json(check.parts.map((p) => ({ ...p })))} WHERE gym_id = ${a.gymId} AND id = ${press.id}`;
    return { kind: "ok", receiptNumbers, parts: check.parts };
  });
}
