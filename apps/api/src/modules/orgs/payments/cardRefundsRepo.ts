// Refund to card (ROADMAP 18d-iv-a): one row a press, kept. A press is started under the record's lock with the rule a
// refund noted by hand uses, so what Square is asked for is what the payment can still give back; while it is `asking`
// nothing else is refunded on that bill (`refundAsking`). A row is asked about by one request at a time (`checking_until`),
// and each change names the state it was read in, so two requests never both act on one answer. Once Square takes the refund
// up, a row of `gym_member_refunds` holds the money as given back, written under the gym's lock in the statement group that
// moves this row on, so it is written once. Every read for a screen names the gym; the worker's reads across gyms name the
// environment and hand each row back with its gym.
import { randomUUID } from "node:crypto";
import {
  cardRefundReasonSchema,
  memberRefundMethodSchema,
  paymentRefundableMinor,
  refundMemberPayment,
  refundReasonSchema,
  type CardRefundCheck,
  type CardRefundOpen,
  type CardRefundReason,
  type MemberPaymentMethod,
  type RefundReason,
} from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import { z } from "zod";
import { giveMemberGift } from "../referrals/memberGiftRepo.js";
import { insertAudit } from "../repo.js";
import { writeRefund } from "../memberships/billsRepo.js";
import { refundAskingOnBill, refundTargetOf, type RefundTarget } from "../memberships/billsSql.js";
import { lockedEntry, lockedHeld } from "../memberships/heldRepo.js";
import { lockGym } from "../memberList/repo.js";
import type { SquareEnvironment } from "./square.js";
import { lockFreeTerminal } from "./terminalPaymentsRepo.js";

type SqlOrTx = Sql | TransactionSql;

/** What each product takes of a press on all of a sale (18d-iv-b-ii): our own column, parsed. */
export const salePartsSchema = z.array(z.object({ saleId: z.string().uuid(), amountMinor: z.number().int().min(1), restock: z.number().int().min(0).max(99) }).strict()).min(1);
export type SalePart = z.infer<typeof salePartsSchema>[number];

export interface RefundPress {
  id: string;
  gymId: string;
  /** A member's payment, or a sale (18d-iv-b-ii): one or the other. */
  paymentId: string | null;
  memberRefundId: string | null;
  saleId: string | null;
  /** How many go back on the shelf once Square takes it up: one product of a sale's alone. */
  restock: number;
  /** All of a sale: what each product takes. Null for one product. */
  parts: SalePart[] | null;
  environment: SquareEnvironment;
  accountId: string;
  squarePaymentId: string;
  squareRefundId: string | null;
  amountMinor: number;
  currency: string;
  reason: CardRefundReason;
  brand: string | null;
  last4: string | null;
  requestKey: string;
  state: "asking" | "pending" | "done";
  outcome: "completed" | "failed" | "refused" | "lost" | "cancelled" | null;
  code: string | null;
  looks: number;
  startedBy: string | null;
  startedAt: Date;
  /** When Square was last asked: past `startedAt`, Square was asked before, and may have taken it up then. */
  checkedAt: Date;
  /** The Terminal, where Square needs the card present (18d-iv-c); null for a refund sent to the card. */
  deviceId: string | null;
  terminalRefundId: string | null;
  pickedUp: boolean;
  cancelWantedAt: Date | null;
  cancelTooLate: boolean;
  /** Square's record of a refund made inside Square: no press made it. */
  fromSquare: boolean;
}

export interface RawPress {
  id: string;
  gym_id: string;
  payment_id: string | null;
  member_refund_id: string | null;
  sale_id: string | null;
  restock: number;
  parts: unknown;
  environment: SquareEnvironment;
  account_id: string;
  square_payment_id: string;
  square_refund_id: string | null;
  amount_minor: number;
  currency: string;
  reason: string;
  brand: string | null;
  last4: string | null;
  request_key: string;
  state: RefundPress["state"];
  outcome: RefundPress["outcome"];
  code: string | null;
  looks: number;
  started_by: string | null;
  started_at: Date;
  checked_at: Date;
  device_id: string | null;
  terminal_refund_id: string | null;
  picked_up: boolean;
  cancel_wanted_at: Date | null;
  cancel_too_late: boolean;
  from_square: boolean;
}

export const toPress = (r: RawPress): RefundPress => ({
  id: r.id,
  gymId: r.gym_id,
  paymentId: r.payment_id,
  memberRefundId: r.member_refund_id,
  saleId: r.sale_id,
  restock: r.restock,
  parts: r.parts === null ? null : salePartsSchema.parse(r.parts),
  environment: r.environment,
  accountId: r.account_id,
  squarePaymentId: r.square_payment_id,
  squareRefundId: r.square_refund_id,
  amountMinor: r.amount_minor,
  currency: r.currency,
  reason: cardRefundReasonSchema.parse(r.reason),
  brand: r.brand,
  last4: r.last4,
  requestKey: r.request_key,
  state: r.state,
  outcome: r.outcome,
  code: r.code,
  looks: r.looks,
  startedBy: r.started_by,
  startedAt: r.started_at,
  checkedAt: r.checked_at,
  deviceId: r.device_id,
  terminalRefundId: r.terminal_refund_id,
  pickedUp: r.picked_up,
  cancelWantedAt: r.cancel_wanted_at,
  cancelTooLate: r.cancel_too_late,
  fromSquare: r.from_square,
});

/** What a press left "We don't know" says once Square's own record shows no such refund. */
export const NOT_IN_SQUARE = "NOT_IN_SQUARE";
/** And once Square's own record shows it could not make it. */
export const FAILED_IN_SQUARE = "FAILED_IN_SQUARE";
/** How far apart Square's clock and ours may be, when a refund is matched to a press. */
const CLOCKS_APART_MS = 5 * 60_000;
/** A press left "We don't know" is first read against Square's record this long after. */
const LOST_LOOK_AFTER_MS = 15 * 60_000;

export interface PaymentToRefund {
  id: string;
  billId: string;
  method: MemberPaymentMethod;
  provider: string | null;
  squarePaymentId: string | null;
  amountMinor: number;
  currency: string;
  /** What the app says can still go back, and what stands refunded, by any way. */
  refundableMinor: number;
  refundedMinor: number;
  target: RefundTarget;
}

/** One payment of this record's membership, a period's or a fee's (18d-iv-b-i), or null. */
export async function readPaymentToRefund(sql: SqlOrTx, gymId: string, entryId: string, membershipId: string, paymentId: string): Promise<PaymentToRefund | null> {
  const [row] = await sql<{ id: string; bill_id: string; provider: string | null; provider_payment_id: string | null; currency: string }[]>`
    SELECT p.id, p.bill_id, p.provider, p.provider_payment_id, p.currency
    FROM gym_member_payments p
    JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
    JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
    WHERE p.gym_id = ${gymId} AND p.id = ${paymentId} AND b.held_membership_id = ${membershipId} AND h.entry_id = ${entryId}
      AND p.undone_at IS NULL`;
  if (row === undefined) return null;
  const target = await refundTargetOf(sql, gymId, membershipId, paymentId);
  if (target === null) return null;
  return {
    id: row.id,
    billId: row.bill_id,
    method: target.payment.method,
    provider: row.provider,
    squarePaymentId: row.provider_payment_id,
    amountMinor: target.payment.amountMinor,
    currency: row.currency,
    refundableMinor: paymentRefundableMinor(target.bill, target.payment),
    refundedMinor: target.payment.refundedMinor,
    target,
  };
}

export interface NewPress {
  id: string;
  gymId: string;
  entryId: string;
  membershipId: string;
  paymentId: string;
  requestKey: string;
  amountMinor: number;
  reason: RefundReason;
  /** What Square says is left of the payment, read just before: never more than this is asked for. */
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

/** The Terminal, locked, when this press may wait on it: a press with none needs nothing. */
export const terminalFree = async (tx: TransactionSql, s: { environment: SquareEnvironment; accountId: string; deviceId: string | null }): Promise<boolean> =>
  s.deviceId === null || (await lockFreeTerminal(tx, { environment: s.environment, accountId: s.accountId, deviceId: s.deviceId }));

export type StartOutcome =
  | { kind: "new" | "same_press"; press: RefundPress }
  | { kind: "key_reused" | "entry_not_found" | "membership_not_found" | "payment_not_found" | "not_card" | "waiting" | "not_settled" | "terminal_busy" }
  | { kind: "too_much"; leftMinor: number; currency: string };

/** The press, written under the gym's lock and the record's. Two staff at one instant are taken one after the other, and the
 *  second finds the first's money gone or waiting; the same press twice is the one row. */
export async function startRefund(sql: Sql, s: NewPress): Promise<StartOutcome> {
  return await sql.begin(async (tx): Promise<StartOutcome> => {
    const entry = await lockedEntry(tx, s.gymId, s.entryId);
    if (entry === null) return { kind: "entry_not_found" };
    const held = await lockedHeld(tx, s.gymId, s.entryId, s.membershipId);
    if (held === null) return { kind: "membership_not_found" };

    const [again] = await tx<RawPress[]>`SELECT * FROM gym_square_refunds WHERE gym_id = ${s.gymId} AND request_key = ${s.requestKey}`;
    if (again !== undefined) {
      const press = toPress(again);
      const same = press.paymentId === s.paymentId && press.amountMinor === s.amountMinor && press.reason === s.reason;
      return same ? { kind: "same_press", press } : { kind: "key_reused" };
    }
    const [noted] = await tx<{ id: string }[]>`SELECT id FROM gym_member_refunds WHERE gym_id = ${s.gymId} AND request_key = ${s.requestKey}`;
    if (noted !== undefined) return { kind: "key_reused" };

    const payment = await readPaymentToRefund(tx, s.gymId, s.entryId, s.membershipId, s.paymentId);
    if (payment === null) return { kind: "payment_not_found" };
    if (payment.provider !== "square" || payment.squarePaymentId === null) return { kind: "not_card" };
    if (await refundAskingOnBill(tx, s.gymId, payment.billId)) return { kind: "waiting" };

    const rule = refundMemberPayment(payment.target.bill, payment.target.payment, s.amountMinor);
    if (!rule.ok) {
      if (rule.reason === "too_much") return { kind: "too_much", leftMinor: rule.leftMinor, currency: payment.currency };
      return { kind: "not_settled" };
    }
    if (s.amountMinor > s.squareLeftMinor) return { kind: "too_much", leftMinor: s.squareLeftMinor, currency: payment.currency };
    if (!(await terminalFree(tx, s))) return { kind: "terminal_busy" };

    const [row] = await tx<RawPress[]>`
      INSERT INTO gym_square_refunds
        (id, gym_id, payment_id, environment, account_id, square_payment_id, amount_minor, currency, reason, brand, last4,
         request_key, state, device_id, started_by, started_at, checked_at, checking_until)
      VALUES (${s.id}, ${s.gymId}, ${s.paymentId}, ${s.environment}, ${s.accountId}, ${payment.squarePaymentId}, ${s.amountMinor},
              ${payment.currency}, ${s.reason}, ${s.card?.brand ?? null}, ${s.card?.last4 ?? null}, ${s.requestKey}, 'asking',
              ${s.deviceId}, ${s.startedBy}, ${s.now}, ${s.now}, ${s.checkingUntil})
      RETURNING *`;
    if (row === undefined) throw new Error("a refund press was not written under the gym's lock");
    return { kind: "new", press: toPress(row) };
  });
}

export async function readPress(sql: SqlOrTx, gymId: string, id: string): Promise<RefundPress | null> {
  const [row] = await sql<RawPress[]>`SELECT * FROM gym_square_refunds WHERE gym_id = ${gymId} AND id = ${id}`;
  return row === undefined ? null : toPress(row);
}

export async function pressOfKey(sql: SqlOrTx, gymId: string, requestKey: string): Promise<RefundPress | null> {
  const [row] = await sql<RawPress[]>`SELECT * FROM gym_square_refunds WHERE gym_id = ${gymId} AND request_key = ${requestKey}`;
  return row === undefined ? null : toPress(row);
}

export async function release(sql: SqlOrTx, press: RefundPress): Promise<void> {
  await sql`UPDATE gym_square_refunds SET checking_until = NULL WHERE gym_id = ${press.gymId} AND id = ${press.id}`;
}

/** Presses Square has not answered, idle for `idleMs`, claimed until `until`. */
export async function claimAsking(sql: Sql, environment: SquareEnvironment, now: Date, idleMs: number, until: Date, limit: number, gymIds: readonly string[] | null): Promise<RefundPress[]> {
  const idle = new Date(now.getTime() - idleMs);
  const rows = await sql<RawPress[]>`
    UPDATE gym_square_refunds SET checking_until = ${until}, checked_at = ${now}
    WHERE id IN (
      SELECT id FROM gym_square_refunds
      WHERE environment = ${environment} AND state = 'asking' AND checked_at <= ${idle}
        AND (checking_until IS NULL OR checking_until < ${now})
        ${gymIds === null ? sql`` : sql`AND gym_id = ANY(${[...gymIds]}::uuid[])`}
      ORDER BY checked_at LIMIT ${limit} FOR UPDATE SKIP LOCKED)
    RETURNING *`;
  return rows.map(toPress);
}

/** Refunds Square has taken up and not finished, due a look. */
export async function claimLooks(sql: Sql, environment: SquareEnvironment, now: Date, until: Date, limit: number, gymIds: readonly string[] | null): Promise<RefundPress[]> {
  const rows = await sql<RawPress[]>`
    UPDATE gym_square_refunds SET checking_until = ${until}, checked_at = ${now}, look_at = ${until}
    WHERE id IN (
      SELECT id FROM gym_square_refunds
      WHERE environment = ${environment} AND state = 'pending' AND look_at <= ${now}
        ${gymIds === null ? sql`` : sql`AND gym_id = ANY(${[...gymIds]}::uuid[])`}
      ORDER BY look_at LIMIT ${limit} FOR UPDATE SKIP LOCKED)
    RETURNING *`;
  return rows.map(toPress);
}

export async function lookAgain(sql: SqlOrTx, press: RefundPress, at: Date): Promise<void> {
  await sql`UPDATE gym_square_refunds SET look_at = ${at}, looks = looks + 1, checking_until = NULL WHERE gym_id = ${press.gymId} AND id = ${press.id} AND state = 'pending'`;
}

/** The press waiting on a Terminal for this Square payment, if any. */
export async function waitingOnTerminal(sql: SqlOrTx, gymId: string, squarePaymentId: string): Promise<RefundPress | null> {
  const [row] = await sql<RawPress[]>`
    SELECT * FROM gym_square_refunds WHERE gym_id = ${gymId} AND square_payment_id = ${squarePaymentId} AND state = 'asking' AND device_id IS NOT NULL LIMIT 1`;
  return row === undefined ? null : toPress(row);
}

/** The press waiting on a Terminal for any payment of this bill, if any: while it waits, nothing else is refunded on the bill. */
export async function waitingOnTerminalOfBill(sql: SqlOrTx, gymId: string, billId: string): Promise<RefundPress | null> {
  const [row] = await sql<RawPress[]>`
    SELECT q.* FROM gym_square_refunds q
    JOIN gym_member_payments p ON p.gym_id = q.gym_id AND p.id = q.payment_id
    WHERE q.gym_id = ${gymId} AND p.bill_id = ${billId} AND q.state = 'asking' AND q.device_id IS NOT NULL LIMIT 1`;
  return row === undefined ? null : toPress(row);
}

/** One press waiting on a Terminal, held for this request; null while another asks, or once it has ended. */
export async function claimPress(sql: SqlOrTx, gymId: string, id: string, now: Date, until: Date): Promise<RefundPress | null> {
  const [row] = await sql<RawPress[]>`
    UPDATE gym_square_refunds SET checking_until = ${until}, checked_at = ${now}
    WHERE gym_id = ${gymId} AND id = ${id} AND state = 'asking' AND device_id IS NOT NULL AND (checking_until IS NULL OR checking_until < ${now})
    RETURNING *`;
  return row === undefined ? null : toPress(row);
}

export async function setTerminalRefund(sql: SqlOrTx, press: RefundPress, terminalRefundId: string): Promise<void> {
  await sql`UPDATE gym_square_refunds SET terminal_refund_id = ${terminalRefundId} WHERE gym_id = ${press.gymId} AND id = ${press.id} AND state = 'asking'`;
}

export async function setPickedUp(sql: SqlOrTx, press: RefundPress): Promise<void> {
  await sql`UPDATE gym_square_refunds SET picked_up = true WHERE gym_id = ${press.gymId} AND id = ${press.id} AND state = 'asking'`;
}

/** Staff pressed Cancel: kept on the press, so whichever request asks Square next stops the Terminal first. False once it has ended. */
export async function wantCancel(sql: SqlOrTx, gymId: string, id: string, now: Date): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE gym_square_refunds SET cancel_wanted_at = COALESCE(cancel_wanted_at, ${now})
    WHERE gym_id = ${gymId} AND id = ${id} AND state = 'asking' AND device_id IS NOT NULL
    RETURNING id`;
  return rows.length === 1;
}

/** Square refused Cancel: the person has started, so it finishes there. */
export async function cancelRefusedTooLate(sql: SqlOrTx, press: RefundPress): Promise<void> {
  await sql`UPDATE gym_square_refunds SET cancel_wanted_at = NULL, cancel_too_late = true WHERE gym_id = ${press.gymId} AND id = ${press.id} AND state = 'asking'`;
}

/** Square said no, it stopped on the Terminal, or Square never answered: no refund is written. */
export async function endAsking(sql: SqlOrTx, press: RefundPress, end: { outcome: "refused" | "lost" | "cancelled"; code: string | null }, now: Date): Promise<void> {
  await sql`
    UPDATE gym_square_refunds SET state = 'done', outcome = ${end.outcome}, code = ${end.code}, finished_at = ${now}, checking_until = NULL,
      look_at = ${end.outcome === "lost" ? new Date(now.getTime() + LOST_LOOK_AFTER_MS) : null}
    WHERE gym_id = ${press.gymId} AND id = ${press.id} AND state = 'asking'`;
}

export async function endCompleted(sql: SqlOrTx, press: RefundPress, now: Date): Promise<void> {
  await sql`
    UPDATE gym_square_refunds SET state = 'done', outcome = 'completed', look_at = NULL, finished_at = ${now}, checking_until = NULL
    WHERE gym_id = ${press.gymId} AND id = ${press.id} AND state = 'pending'`;
}

const paymentOf = (press: RefundPress): string => {
  if (press.paymentId === null) throw new Error("a sale's refund press read as a member's payment's");
  return press.paymentId;
};

/** Square took the refund up: the money stands as given back, once. False where this press was already moved on. */
export async function recordTaken(sql: Sql, press: RefundPress, taken: { squareRefundId: string; today: string; now: Date; lookAt: Date }): Promise<boolean> {
  return await sql.begin(async (tx) => {
    await lockGym(tx, press.gymId);
    const [row] = await tx<{ state: string }[]>`SELECT state FROM gym_square_refunds WHERE gym_id = ${press.gymId} AND id = ${press.id} FOR UPDATE`;
    if (row?.state !== "asking") return false;
    const paymentId = paymentOf(press);
    const [where] = await tx<{ membership_id: string; entry_id: string | null }[]>`
      SELECT b.held_membership_id AS membership_id, h.entry_id
      FROM gym_member_payments p
      JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
      JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
      WHERE p.gym_id = ${press.gymId} AND p.id = ${paymentId}`;
    if (where === undefined) throw new Error("the payment of a refund press is gone");
    const target = await refundTargetOf(tx, press.gymId, where.membership_id, paymentId);
    if (target === null) throw new Error("the payment of a refund press no longer stands");
    const { bill, payment: standing } = target;
    // Square has the money on its way: what is written is what Square did.
    const memberRefundId = await writeRefund(tx, {
      gymId: press.gymId,
      entryId: where.entry_id,
      membershipId: where.membership_id,
      bill,
      standing,
      paymentId,
      requestKey: press.requestKey,
      amountMinor: press.amountMinor,
      currency: press.currency,
      // A refund to the card reads as the payment's own way, on the Terminal or from the card on file.
      method: memberRefundMethodSchema.parse(standing.method),
      reason: refundReasonSchema.parse(press.reason),
      today: taken.today,
      actorUserId: press.startedBy,
      now: taken.now,
      action: "org.member_refund_sent",
      card: press.brand === null || press.last4 === null ? null : { brand: press.brand, last4: press.last4 },
    });
    await tx`
      UPDATE gym_square_refunds
      SET state = 'pending', member_refund_id = ${memberRefundId}, square_refund_id = ${taken.squareRefundId}, look_at = ${taken.lookAt}, checking_until = NULL
      WHERE gym_id = ${press.gymId} AND id = ${press.id}`;
    return true;
  });
}

/** Square took the refund up, then said it failed: the money was never sent, so the refund is voided by the app, the bill
 *  reads as it did, and a friend's payment gives the member's gift again where none stands. */
export async function recordFailed(sql: Sql, press: RefundPress, failed: { code: string; today: string; now: Date }): Promise<boolean> {
  return await sql.begin(async (tx) => {
    await lockGym(tx, press.gymId);
    const [row] = await tx<{ state: string; member_refund_id: string | null }[]>`
      SELECT state, member_refund_id FROM gym_square_refunds WHERE gym_id = ${press.gymId} AND id = ${press.id} FOR UPDATE`;
    if (row?.state !== "pending") return false;
    // Made in Square and already noted by hand: nothing here was written from it, so nothing is voided.
    if (row.member_refund_id === null) {
      await tx`
        UPDATE gym_square_refunds SET state = 'done', outcome = 'failed', code = ${failed.code}, look_at = NULL, finished_at = ${failed.now}, checking_until = NULL
        WHERE gym_id = ${press.gymId} AND id = ${press.id}`;
      return true;
    }
    const paymentId = paymentOf(press);
    await tx`
      UPDATE gym_member_refunds SET undone_at = ${failed.now}, void_reason = 'square_failed'
      WHERE gym_id = ${press.gymId} AND id = ${row.member_refund_id} AND undone_at IS NULL`;
    const [where] = await tx<{ bill_id: string; entry_id: string | null; membership_id: string; period_index: number | null }[]>`
      SELECT b.id AS bill_id, h.entry_id, b.held_membership_id AS membership_id, b.period_index
      FROM gym_member_payments p
      JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
      JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
      WHERE p.gym_id = ${press.gymId} AND p.id = ${paymentId}`;
    if (where === undefined) throw new Error("the payment of a refund press is gone");
    await tx`UPDATE gym_member_bills SET status = 'paid', updated_at = ${failed.now} WHERE gym_id = ${press.gymId} AND id = ${where.bill_id} AND status = 'refunded'`;
    // A fee's payment never gives a member's gift.
    if (where.entry_id !== null && where.period_index !== null) {
      await giveMemberGift(tx, { gymId: press.gymId, friendEntryId: where.entry_id, by: { paymentId }, today: failed.today, now: failed.now });
    }
    await tx`
      UPDATE gym_square_refunds SET state = 'done', outcome = 'failed', code = ${failed.code}, look_at = NULL, finished_at = ${failed.now}, checking_until = NULL
      WHERE gym_id = ${press.gymId} AND id = ${press.id}`;
    await insertAudit(tx, {
      actorUserId: null,
      gymId: press.gymId,
      action: "org.member_refund_failed",
      targetType: "gym_member_refund",
      targetId: row.member_refund_id,
      meta: {
        ...(where.entry_id === null ? {} : { entryId: where.entry_id }),
        membershipId: where.membership_id,
        billId: where.bill_id,
        paymentId,
        amountMinor: String(press.amountMinor),
        currency: press.currency,
      },
    });
    return true;
  });
}

/** The row that holds this Square refund, if any: a press's, or one already taken in. */
export async function pressOfSquareRefund(sql: SqlOrTx, gymId: string, environment: SquareEnvironment, squareRefundId: string): Promise<RefundPress | null> {
  const [row] = await sql<RawPress[]>`SELECT * FROM gym_square_refunds WHERE environment = ${environment} AND square_refund_id = ${squareRefundId} AND gym_id = ${gymId}`;
  return row === undefined ? null : toPress(row);
}

/** Whether this gym holds a member's payment of this Square id. A sale's comes with 18d-iv-d-ii. */
export async function paymentHeldHere(sql: SqlOrTx, gymId: string, squarePaymentId: string): Promise<boolean> {
  const [row] = await sql<{ id: string }[]>`
    SELECT id FROM gym_member_payments WHERE gym_id = ${gymId} AND provider = 'square' AND provider_payment_id = ${squarePaymentId} AND undone_at IS NULL`;
  return row !== undefined;
}

export type MadeInSquareOutcome = { kind: "written"; press: RefundPress } | { kind: "waiting" | "already" | "no_payment" };

/** A refund Square made and no row here holds: written once, under the gym's lock. Only what Square gave back above what the app holds
 *  on this payment is written, so a refund staff already noted is not counted twice. A press left "We don't know" for this amount is
 *  this refund, and is moved on as its own. */
export async function recordMadeInSquare(
  sql: Sql,
  r: {
    gymId: string;
    environment: SquareEnvironment;
    accountId: string;
    squareRefundId: string;
    squarePaymentId: string;
    amountMinor: number;
    currency: string;
    card: { brand: string; last4: string } | null;
    madeAt: Date;
    today: string;
    now: Date;
    lookAt: Date;
  },
): Promise<MadeInSquareOutcome> {
  return await sql.begin(async (tx): Promise<MadeInSquareOutcome> => {
    await lockGym(tx, r.gymId);
    const [known] = await tx<{ id: string }[]>`SELECT id FROM gym_square_refunds WHERE environment = ${r.environment} AND square_refund_id = ${r.squareRefundId}`;
    if (known !== undefined) return { kind: "already" };
    const [asking] = await tx<{ id: string }[]>`SELECT id FROM gym_square_refunds WHERE gym_id = ${r.gymId} AND square_payment_id = ${r.squarePaymentId} AND state = 'asking' LIMIT 1`;
    if (asking !== undefined) return { kind: "waiting" };
    const [where] = await tx<{ id: string; membership_id: string; entry_id: string | null; currency: string }[]>`
      SELECT p.id, b.held_membership_id AS membership_id, h.entry_id, p.currency
      FROM gym_member_payments p
      JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
      JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
      WHERE p.gym_id = ${r.gymId} AND p.provider = 'square' AND p.provider_payment_id = ${r.squarePaymentId} AND p.undone_at IS NULL`;
    if (where === undefined || where.currency !== r.currency) return { kind: "no_payment" };
    const target = await refundTargetOf(tx, r.gymId, where.membership_id, where.id);
    if (target === null) return { kind: "no_payment" };
    const { bill, payment: standing } = target;

    const [held] = await tx<{ total: number }[]>`
      SELECT COALESCE(sum(amount_minor), 0)::int AS total FROM gym_square_refunds
      WHERE gym_id = ${r.gymId} AND payment_id = ${where.id} AND square_refund_id IS NOT NULL AND outcome IS DISTINCT FROM 'failed'`;
    const inSquare = (held?.total ?? 0) + r.amountMinor;
    // Only a note by card can be this refund: cash, UPI or a bank transfer never went through Square.
    const [byCard] = await tx<{ total: number }[]>`
      SELECT COALESCE(sum(amount_minor), 0)::int AS total FROM gym_member_refunds
      WHERE gym_id = ${r.gymId} AND payment_id = ${where.id} AND undone_at IS NULL AND method IN ('card_at_desk','company','terminal')`;
    const write = Math.max(0, Math.min(r.amountMinor, inSquare - (byCard?.total ?? 0), standing.amountMinor - standing.refundedMinor));
    const absorbed = r.amountMinor - write;

    const [lost] = await tx<RawPress[]>`
      SELECT * FROM gym_square_refunds
      WHERE gym_id = ${r.gymId} AND payment_id = ${where.id} AND outcome = 'lost' AND no_refund_at IS NULL AND amount_minor = ${r.amountMinor}
        AND started_at <= ${new Date(r.madeAt.getTime() + CLOCKS_APART_MS)} AND finished_at >= ${new Date(r.madeAt.getTime() - CLOCKS_APART_MS)}
      ORDER BY started_at DESC LIMIT 1 FOR UPDATE`;
    const press = lost === undefined ? null : toPress(lost);
    const requestKey = press?.requestKey ?? randomUUID();
    const memberRefundId =
      write === 0
        ? null
        : await writeRefund(tx, {
            gymId: r.gymId,
            entryId: where.entry_id,
            membershipId: where.membership_id,
            bill,
            standing,
            paymentId: where.id,
            requestKey,
            amountMinor: write,
            currency: r.currency,
            method: memberRefundMethodSchema.parse(standing.method),
            reason: press === null ? "other" : refundReasonSchema.parse(press.reason),
            today: r.today,
            actorUserId: press?.startedBy ?? null,
            now: r.now,
            action: press === null ? "org.member_refund_in_square" : "org.member_refund_sent",
            card: press?.brand != null && press.last4 !== null ? { brand: press.brand, last4: press.last4 } : r.card,
          });
    // Already noted: nothing moves, but the gym's record still says Square did it.
    if (write === 0 && press === null) {
      await insertAudit(tx, {
        actorUserId: null,
        gymId: r.gymId,
        action: "org.member_refund_in_square",
        targetType: "gym_member_payment",
        targetId: where.id,
        meta: {
          ...(where.entry_id === null ? {} : { entryId: where.entry_id }),
          membershipId: where.membership_id,
          billId: bill.id,
          paymentId: where.id,
          amountMinor: String(r.amountMinor),
          currency: r.currency,
          alreadyNoted: "true",
          ...(r.card === null ? {} : { brand: r.card.brand, last4: r.card.last4 }),
        },
      });
    }
    const [row] =
      press !== null
        ? await tx<RawPress[]>`
            UPDATE gym_square_refunds
            SET state = 'pending', outcome = NULL, code = NULL, finished_at = NULL, absorbed_minor = ${absorbed}, member_refund_id = ${memberRefundId}, square_refund_id = ${r.squareRefundId}, look_at = ${r.lookAt}, checking_until = NULL
            WHERE gym_id = ${r.gymId} AND id = ${press.id}
            RETURNING *`
        : await tx<RawPress[]>`
            INSERT INTO gym_square_refunds
              (id, gym_id, payment_id, member_refund_id, environment, account_id, square_payment_id, square_refund_id, amount_minor, currency, reason, brand, last4,
               request_key, state, look_at, from_square, absorbed_minor, started_at, checked_at)
            VALUES (${randomUUID()}, ${r.gymId}, ${where.id}, ${memberRefundId}, ${r.environment}, ${r.accountId}, ${r.squarePaymentId}, ${r.squareRefundId}, ${r.amountMinor}, ${r.currency}, 'other',
                    ${r.card?.brand ?? null}, ${r.card?.last4 ?? null}, ${requestKey}, 'pending', ${r.lookAt}, true, ${absorbed}, ${r.madeAt}, ${r.now})
            RETURNING *`;
    if (row === undefined) throw new Error("a refund made in Square was not written under the gym's lock");
    return { kind: "written", press: toPress(row) };
  });
}

/** Presses left "We don't know" due a read of Square's record, a member's payment's alone until 18d-iv-d-ii; each cleared, so it is read once unless it is set again. */
export async function claimLostLooks(sql: Sql, environment: SquareEnvironment, now: Date, limit: number, gymIds: readonly string[] | null): Promise<RefundPress[]> {
  const rows = await sql<RawPress[]>`
    UPDATE gym_square_refunds SET look_at = NULL
    WHERE id IN (
      SELECT id FROM gym_square_refunds
      WHERE environment = ${environment} AND outcome = 'lost' AND look_at <= ${now} AND payment_id IS NOT NULL AND no_refund_at IS NULL
        ${gymIds === null ? sql`` : sql`AND gym_id = ANY(${[...gymIds]}::uuid[])`}
      ORDER BY look_at LIMIT ${limit} FOR UPDATE SKIP LOCKED)
    RETURNING *`;
  return rows.map(toPress);
}

export async function setLostLook(sql: SqlOrTx, press: RefundPress, at: Date): Promise<void> {
  await sql`UPDATE gym_square_refunds SET look_at = ${at} WHERE gym_id = ${press.gymId} AND id = ${press.id} AND outcome = 'lost'`;
}

/** Square's record shows no such refund: a refund showing up later still moves it on. */
export async function markAnswered(sql: SqlOrTx, press: RefundPress, code: typeof NOT_IN_SQUARE | typeof FAILED_IN_SQUARE): Promise<void> {
  await sql`UPDATE gym_square_refunds SET code = ${code} WHERE gym_id = ${press.gymId} AND id = ${press.id} AND outcome = 'lost'`;
}

/** What a person's page says of a press with no answer yet, or none ever, by payment: the newest, until refunds written on that
 *  payment after it cover its amount: a smaller one leaves it open. Read only for the payments on the page. */
export async function openPressesOf(sql: SqlOrTx, gymId: string, paymentIds: readonly string[]): Promise<Map<string, CardRefundOpen>> {
  const open = new Map<string, CardRefundOpen>();
  if (paymentIds.length === 0) return open;
  const rows = await sql<{ payment_id: string; amount_minor: number; on_day: string; lost: boolean; no_record: boolean; failed_in_square: boolean; note_to_check: boolean; failed: boolean; on_terminal: boolean; decided_on: string | null; decided_by: string | null }[]>`
    SELECT DISTINCT ON (q.payment_id) q.payment_id, q.amount_minor, (q.started_at AT TIME ZONE g.timezone)::date::text AS on_day, q.state = 'done' AS lost, COALESCE(q.code = ${NOT_IN_SQUARE}, false) AS no_record, COALESCE(q.code = ${FAILED_IN_SQUARE}, false) AS failed_in_square, q.from_square AND q.outcome = 'failed' AS note_to_check, q.outcome = 'failed' AS failed,
           q.state = 'asking' AND q.device_id IS NOT NULL AS on_terminal,
           (q.no_refund_at AT TIME ZONE g.timezone)::date::text AS decided_on, u.display_name AS decided_by
    FROM gym_square_refunds q
    JOIN gyms g ON g.id = q.gym_id
    LEFT JOIN users u ON u.id = q.no_refund_by
    WHERE q.gym_id = ${gymId} AND q.payment_id = ANY(${[...paymentIds]}::uuid[]) AND (q.state = 'asking' OR q.outcome IN ('lost','failed')) AND (NOT q.from_square OR q.absorbed_minor > 0)
      AND (SELECT COALESCE(sum(r.amount_minor), 0) FROM gym_member_refunds r
           WHERE r.gym_id = q.gym_id AND r.payment_id = q.payment_id AND r.created_at > q.started_at AND r.undone_at IS NULL) < q.amount_minor
    ORDER BY q.payment_id, q.state = 'asking' DESC, COALESCE(q.outcome = 'lost' AND q.no_refund_at IS NULL, false) DESC, q.started_at DESC`;
  // A failed press says itself on the crossed-out line, unless staff decided on it; it is read so an older decision does not stand over it.
  for (const r of rows) if (!r.failed || r.decided_on !== null || r.note_to_check) open.set(r.payment_id, { amountMinor: r.amount_minor, on: r.on_day, lost: r.lost, noRecord: r.no_record, failedInSquare: r.failed_in_square, noteToCheck: r.note_to_check && r.decided_on === null, onTerminal: r.on_terminal, decided: r.decided_on === null ? null : { on: r.decided_on, by: r.decided_by } });
  return open;
}
