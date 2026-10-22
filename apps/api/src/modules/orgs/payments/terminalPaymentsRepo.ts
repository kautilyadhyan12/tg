// Take payment on Terminal (ROADMAP 18d-vi-a; a fee, 18d-vi-b-i): one row a press, while the amount waits on the gym's
// Square Terminal and for a day after. Every read for a screen names the gym and the record; the
// worker's reads across gyms name the environment and hand each row back with its gym. A row is
// asked about by one request at a time (`checking_until`), and every change names the state it was
// read in, so two requests never both act on one answer. A press is written under the record's lock
// (as a payment by hand is) and the Terminal's, which a save on it (18d-ii-b-ii) takes too.
import { memberPayTarget, terminalPaymentOutcomeSchema, type TerminalPaymentOutcome } from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import { insertAudit } from "../repo.js";
import { recordPaymentIn } from "../memberships/billsRepo.js";
import { recordFeePaymentIn } from "../memberships/feesRepo.js";
import { billsFor } from "../memberships/billsSql.js";
import { lockedEntry, lockedHeld, settle } from "../memberships/heldRepo.js";
import { lockGym } from "../memberList/repo.js";
import type { SquareEnvironment } from "./square.js";

type SqlOrTx = Sql | TransactionSql;

export interface PayRow {
  id: string;
  gymId: string;
  /** Null once the record was deleted for good. */
  entryId: string | null;
  membershipId: string;
  /** The period it pays, or null for a fee. */
  periodIndex: number | null;
  /** The fee it pays (18d-vi-b-i), or null for a period. */
  feeBillId: string | null;
  amountMinor: number;
  currency: string;
  environment: SquareEnvironment;
  accountId: string;
  locationId: string;
  deviceId: string;
  state: "waiting" | "done";
  outcome: TerminalPaymentOutcome | null;
  checkoutKey: string;
  checkoutId: string | null;
  pickedUp: boolean;
  squarePaymentId: string | null;
  startedBy: string | null;
  startedAt: Date;
  /** Staff pressed Cancel: the next look at Square stops the Terminal first. */
  cancelWantedAt: Date | null;
  /** Square refused Cancel: the person was paying. */
  cancelTooLate: boolean;
  /** The payment's receipt, once it is on the bill. */
  receiptNumber: number | null;
}

interface RawPay {
  id: string;
  gym_id: string;
  entry_id: string | null;
  held_membership_id: string;
  period_index: number | null;
  fee_bill_id: string | null;
  amount_minor: number;
  currency: string;
  environment: SquareEnvironment;
  account_id: string;
  location_id: string;
  device_id: string;
  state: "waiting" | "done";
  outcome: string | null;
  checkout_key: string;
  checkout_id: string | null;
  picked_up: boolean;
  square_payment_id: string | null;
  started_by: string | null;
  started_at: Date;
  cancel_wanted_at: Date | null;
  cancel_too_late: boolean;
  receipt_number: number | null;
}

const toRow = (r: RawPay): PayRow => {
  const outcome = terminalPaymentOutcomeSchema.safeParse(r.outcome);
  return {
    id: r.id,
    gymId: r.gym_id,
    entryId: r.entry_id,
    membershipId: r.held_membership_id,
    periodIndex: r.period_index,
    feeBillId: r.fee_bill_id,
    amountMinor: r.amount_minor,
    currency: r.currency,
    environment: r.environment,
    accountId: r.account_id,
    locationId: r.location_id,
    deviceId: r.device_id,
    state: r.state,
    outcome: outcome.success ? outcome.data : null,
    checkoutKey: r.checkout_key,
    checkoutId: r.checkout_id,
    pickedUp: r.picked_up,
    squarePaymentId: r.square_payment_id,
    startedBy: r.started_by,
    startedAt: r.started_at,
    cancelWantedAt: r.cancel_wanted_at,
    cancelTooLate: r.cancel_too_late,
    receiptNumber: r.receipt_number,
  };
};

/** The row's own columns, and its payment's receipt number (the payment is on its gym). */
const COLUMNS = (sql: SqlOrTx) =>
  sql`t.id, t.gym_id, t.entry_id, t.held_membership_id, t.period_index, t.fee_bill_id, t.amount_minor, t.currency, t.environment,
      t.account_id, t.location_id, t.device_id, t.state, t.outcome, t.checkout_key, t.checkout_id, t.picked_up,
      t.square_payment_id, t.started_by, t.started_at, t.cancel_wanted_at, t.cancel_too_late,
      (SELECT p.receipt_number FROM gym_member_payments p WHERE p.gym_id = t.gym_id AND p.id = t.member_payment_id) AS receipt_number`;

/** Both kinds of Terminal work (a payment here, a card save in `terminalCardsRepo.ts`) take this
 *  lock before looking whether the Terminal is free, so one Terminal is never given both. */
export async function lockTerminal(tx: TransactionSql, environment: SquareEnvironment, accountId: string, deviceId: string): Promise<void> {
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`square_terminal:${environment}:${accountId}:${deviceId}`}, 0))`;
}

/** Whether a payment waits on this Terminal, for a card save asking under `lockTerminal`. */
export async function paymentWaitingOn(tx: TransactionSql, environment: SquareEnvironment, accountId: string, deviceId: string): Promise<boolean> {
  const [row] = await tx<{ id: string }[]>`
    SELECT id FROM gym_terminal_payments
    WHERE environment = ${environment} AND account_id = ${accountId} AND device_id = ${deviceId} AND state = 'waiting'`;
  return row !== undefined;
}

/** What a press pays: a period of the membership (18d-vi-a), or one of its fees (18d-vi-b-i). */
export type PayTarget = { kind: "period"; periodIndex: number } | { kind: "fee"; billId: string };

export interface NewPay {
  gymId: string;
  entryId: string;
  membershipId: string;
  target: PayTarget;
  amountMinor: number;
  environment: SquareEnvironment;
  accountId: string;
  locationId: string;
  /** The Square account's own money: a membership priced in another is not sent. */
  accountCurrency: string;
  deviceId: string;
  requestKey: string;
  checkoutKey: string;
  startedBy: string;
  today: string;
  now: Date;
  /** Held by the request that writes it, which asks Square straight after. */
  checkingUntil: Date;
}

export type StartOutcome =
  | { kind: "new" | "same_press" | "membership_waiting"; payment: PayRow }
  | { kind: "key_reused" | "entry_not_found" | "membership_not_found" | "not_allowed" | "terminal_busy" | "currency" }
  /** The fee is not this membership's, or is no longer owed as the screen showed it. */
  | { kind: "fee_not_found" | "fee_changed" }
  /** Another payment for the membership waits on a Terminal. */
  | { kind: "other_waiting" }
  | { kind: "too_much"; leftMinor: number; currency: string };

/** A new press, or why not. Asked under the record's lock with the same rules as a payment by
 *  hand (`recordPaymentIn`, `recordFeePaymentIn`), so the amount sent is one the bill can take now. */
export async function startPayment(sql: Sql, s: NewPay): Promise<StartOutcome> {
  const periodIndex = s.target.kind === "period" ? s.target.periodIndex : null;
  const feeBillId = s.target.kind === "fee" ? s.target.billId : null;
  return await sql.begin(async (tx): Promise<StartOutcome> => {
    const [same] = await tx<RawPay[]>`SELECT ${COLUMNS(tx)} FROM gym_terminal_payments t WHERE t.gym_id = ${s.gymId} AND t.request_key = ${s.requestKey}`;
    if (same !== undefined) {
      const repeat =
        same.entry_id === s.entryId &&
        same.held_membership_id === s.membershipId &&
        same.period_index === periodIndex &&
        same.fee_bill_id === feeBillId &&
        same.amount_minor === s.amountMinor;
      return repeat ? { kind: "same_press", payment: toRow(same) } : { kind: "key_reused" };
    }
    const entry = await lockedEntry(tx, s.gymId, s.entryId);
    if (entry === null) return { kind: "entry_not_found" };
    if (!entry.past) await settle(tx, s.gymId, s.entryId, s.today, s.now);
    const row = await lockedHeld(tx, s.gymId, s.entryId, s.membershipId);
    if (row === null) return { kind: "membership_not_found" };
    const [waiting] = await tx<RawPay[]>`
      SELECT ${COLUMNS(tx)} FROM gym_terminal_payments t WHERE t.gym_id = ${s.gymId} AND t.held_membership_id = ${row.id} AND t.state = 'waiting'`;
    // The same bill already waiting is answered; another bill of the membership waits its turn.
    if (waiting !== undefined) {
      return waiting.period_index === periodIndex && waiting.fee_bill_id === feeBillId ? { kind: "membership_waiting", payment: toRow(waiting) } : { kind: "other_waiting" };
    }
    let currency = row.currency;
    if (s.target.kind === "period") {
      const bills = await billsFor(tx, s.gymId, [row.id]);
      const target = memberPayTarget(row.membership, row.nextBillMinor, s.today, bills, entry.past);
      if (target === null || target.periodIndex !== s.target.periodIndex) return { kind: "not_allowed" };
      if (s.amountMinor > target.leftMinor) return { kind: "too_much", leftMinor: target.leftMinor, currency: row.currency };
    } else {
      // A fee is paid all at once, while it is owed, at the amount the screen showed.
      const [fee] = await tx<{ status: string; amount_minor: number; currency: string }[]>`
        SELECT status, amount_minor, currency FROM gym_member_bills
        WHERE gym_id = ${s.gymId} AND id = ${s.target.billId} AND held_membership_id = ${row.id} AND fee IS NOT NULL
        FOR UPDATE`;
      if (fee === undefined) return { kind: "fee_not_found" };
      if (fee.status !== "open" || fee.amount_minor !== s.amountMinor) return { kind: "fee_changed" };
      currency = fee.currency;
    }
    if (currency !== s.accountCurrency) return { kind: "currency" };

    await lockTerminal(tx, s.environment, s.accountId, s.deviceId);
    const [busy] = await tx<{ id: string }[]>`
      SELECT id FROM gym_terminal_payments
      WHERE environment = ${s.environment} AND account_id = ${s.accountId} AND device_id = ${s.deviceId} AND state = 'waiting'
      UNION ALL
      SELECT id FROM gym_terminal_card_saves
      WHERE environment = ${s.environment} AND account_id = ${s.accountId} AND device_id = ${s.deviceId} AND state IN ('agreeing','saving')
      LIMIT 1`;
    if (busy !== undefined) return { kind: "terminal_busy" };
    const [made] = await tx<{ id: string }[]>`
      INSERT INTO gym_terminal_payments (gym_id, entry_id, held_membership_id, period_index, fee_bill_id, amount_minor, currency,
                                         environment, account_id, location_id, device_id, request_key, state, checkout_key,
                                         started_by, started_at, checking_until, checked_at)
      VALUES (${s.gymId}, ${s.entryId}, ${row.id}, ${periodIndex}, ${feeBillId}, ${s.amountMinor}, ${currency}, ${s.environment},
              ${s.accountId}, ${s.locationId}, ${s.deviceId}, ${s.requestKey}, 'waiting', ${s.checkoutKey}, ${s.startedBy},
              ${s.now}, ${s.checkingUntil}, ${s.now})
      RETURNING id`;
    if (made === undefined) throw new Error("a Terminal payment was not written under its locks");
    const [written] = await tx<RawPay[]>`SELECT ${COLUMNS(tx)} FROM gym_terminal_payments t WHERE t.id = ${made.id}`;
    if (written === undefined) throw new Error("a Terminal payment just written was not read back");
    return { kind: "new", payment: toRow(written) };
  });
}

/** One of the record's payments. */
export async function readPayment(sql: SqlOrTx, gymId: string, entryId: string, id: string): Promise<PayRow | null> {
  const [row] = await sql<RawPay[]>`SELECT ${COLUMNS(sql)} FROM gym_terminal_payments t WHERE t.id = ${id} AND t.gym_id = ${gymId} AND t.entry_id = ${entryId}`;
  return row === undefined ? null : toRow(row);
}

/** The payments waiting for this record. */
export async function readWaitingOf(sql: SqlOrTx, gymId: string, entryId: string, environment: SquareEnvironment): Promise<PayRow[]> {
  const rows = await sql<RawPay[]>`
    SELECT ${COLUMNS(sql)} FROM gym_terminal_payments t
    WHERE t.gym_id = ${gymId} AND t.entry_id = ${entryId} AND t.environment = ${environment} AND t.state = 'waiting'
    ORDER BY t.started_at
    LIMIT 50`;
  return rows.map(toRow);
}

/** This request asks Square about the payment, and nobody else does until `until` or `release`.
 *  Null while another request holds it, or once it is done. */
export async function claimCheck(sql: SqlOrTx, gymId: string, entryId: string, id: string, now: Date, until: Date): Promise<PayRow | null> {
  const [row] = await sql<RawPay[]>`
    UPDATE gym_terminal_payments t SET checking_until = ${until}, checked_at = ${now}
    WHERE t.id = ${id} AND t.gym_id = ${gymId} AND t.entry_id = ${entryId} AND t.state = 'waiting'
      AND (t.checking_until IS NULL OR t.checking_until <= ${now})
    RETURNING ${COLUMNS(sql)}`;
  return row === undefined ? null : toRow(row);
}

/** The payment keeping a Terminal busy, whichever gym on its Square account pressed it, held for
 *  `until` so it can be asked about with its own gym's token; null when none, or while another
 *  request asks. */
export async function claimBlocking(sql: SqlOrTx, environment: SquareEnvironment, accountId: string, deviceId: string, now: Date, until: Date): Promise<PayRow | null> {
  const [row] = await sql<RawPay[]>`
    UPDATE gym_terminal_payments t SET checking_until = ${until}, checked_at = ${now}
    WHERE t.environment = ${environment} AND t.account_id = ${accountId} AND t.device_id = ${deviceId} AND t.state = 'waiting'
      AND (t.checking_until IS NULL OR t.checking_until <= ${now})
    RETURNING ${COLUMNS(sql)}`;
  return row === undefined ? null : toRow(row);
}

/** Let go of the payment, while this request still holds it (`until` is its own hold). */
export async function release(sql: SqlOrTx, id: string, until: Date): Promise<void> {
  await sql`UPDATE gym_terminal_payments SET checking_until = NULL WHERE id = ${id} AND checking_until = ${until}`;
}

/** Staff pressed Cancel: kept on the payment, so whichever request asks Square next stops the
 *  Terminal first. False when there is no such payment waiting. */
export async function wantCancel(sql: SqlOrTx, gymId: string, entryId: string, id: string, now: Date): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE gym_terminal_payments SET cancel_wanted_at = COALESCE(cancel_wanted_at, ${now})
    WHERE id = ${id} AND gym_id = ${gymId} AND entry_id = ${entryId} AND state = 'waiting'
    RETURNING id`;
  return rows.length === 1;
}

/** Square refused Cancel as too late (the person was paying): the box says so instead of waiting
 *  for a stop that will not come. */
export async function cancelRefusedTooLate(sql: SqlOrTx, id: string): Promise<void> {
  await sql`UPDATE gym_terminal_payments SET cancel_too_late = true, cancel_wanted_at = NULL WHERE id = ${id} AND state = 'waiting'`;
}

/** Whether Cancel has been pressed, read afresh: another request may have marked it meanwhile. */
export async function readCancelWanted(sql: SqlOrTx, id: string): Promise<Date | null> {
  const [row] = await sql<{ cancel_wanted_at: Date | null }[]>`SELECT cancel_wanted_at FROM gym_terminal_payments WHERE id = ${id}`;
  return row?.cancel_wanted_at ?? null;
}

/** Payments nobody has asked about for `idleMs`, for the worker: a page closed while it waited. */
export async function claimIdle(
  sql: Sql,
  environment: SquareEnvironment,
  now: Date,
  idleMs: number,
  until: Date,
  limit: number,
  gymIds: readonly string[] | null,
): Promise<PayRow[]> {
  const rows = await sql<RawPay[]>`
    WITH due AS (
      SELECT id FROM gym_terminal_payments
      WHERE environment = ${environment} AND state = 'waiting'
        AND checked_at <= ${new Date(now.getTime() - idleMs)}
        AND (checking_until IS NULL OR checking_until <= ${now})
        AND (${gymIds === null}::boolean OR gym_id = ANY(${[...(gymIds ?? [])]}::uuid[]))
      ORDER BY checked_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE gym_terminal_payments t SET checking_until = ${until}, checked_at = ${now}
    WHERE t.id IN (SELECT id FROM due)
    RETURNING ${COLUMNS(sql)}`;
  return rows.map(toRow);
}

export async function setCheckout(sql: SqlOrTx, id: string, checkoutId: string): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE gym_terminal_payments SET checkout_id = ${checkoutId}
    WHERE id = ${id} AND state = 'waiting' AND (checkout_id IS NULL OR checkout_id = ${checkoutId})
    RETURNING id`;
  return rows.length === 1;
}

export async function setPickedUp(sql: SqlOrTx, id: string): Promise<void> {
  await sql`UPDATE gym_terminal_payments SET picked_up = true WHERE id = ${id} AND NOT picked_up`;
}

/** Done with no money recorded. False when it was not waiting any more. `gone` (Square's answer
 *  could not be read, so the money may have been taken) is told to the gym's Staff activity. */
export async function finish(sql: Sql, id: string, outcome: Exclude<TerminalPaymentOutcome, "paid" | "not_recorded">, at: Date): Promise<boolean> {
  return await sql.begin(async (tx) => {
    const [row] = await tx<
      { gym_id: string; entry_id: string | null; held_membership_id: string; fee_bill_id: string | null; amount_minor: number; currency: string; started_by: string | null }[]
    >`
      UPDATE gym_terminal_payments SET state = 'done', outcome = ${outcome}, finished_at = ${at}, checking_until = NULL
      WHERE id = ${id} AND state = 'waiting'
      RETURNING gym_id, entry_id, held_membership_id, fee_bill_id, amount_minor, currency, started_by`;
    if (row === undefined) return false;
    if (outcome === "gone") {
      await insertAudit(tx, {
        actorUserId: row.started_by,
        gymId: row.gym_id,
        action: "org.terminal_payment_unchecked",
        targetType: "gym_terminal_payment",
        targetId: id,
        meta: {
          ...(row.entry_id === null ? {} : { entryId: row.entry_id }),
          membershipId: row.held_membership_id,
          ...(row.fee_bill_id === null ? {} : { feeBillId: row.fee_bill_id }),
          amountMinor: String(row.amount_minor),
          currency: row.currency,
        },
      });
    }
    return true;
  });
}

/** Whether a payment waits on one of the gym's Terminals: Disconnect Square waits for it. */
export async function anyWaitingIn(tx: TransactionSql, gymId: string, environment: SquareEnvironment): Promise<boolean> {
  const [row] = await tx<{ id: string }[]>`SELECT id FROM gym_terminal_payments WHERE gym_id = ${gymId} AND environment = ${environment} AND state = 'waiting' LIMIT 1`;
  return row !== undefined;
}

/** Square took the money: it is recorded on the bill, on whichever record holds the membership now,
 *  in the same transaction that marks the press paid. Where the bill can no longer take it, the
 *  press is marked not recorded, kept, and told to the gym's Staff activity. Null when another
 *  request finished it first. */
export async function recordPaid(
  sql: Sql,
  p: { pay: PayRow; squarePaymentId: string; today: string; now: Date; /** Square took other than asked: kept, never recorded. */ refuse?: string },
): Promise<{ outcome: "paid" | "not_recorded" } | null> {
  return await sql.begin(async (tx) => {
    const { pay } = p;
    // The gym's lock first: a join moving the membership to another record takes it too, so the
    // record read under it holds the membership while it is locked (review round one, Low 3).
    // A membership whose record was deleted for good has none.
    await lockGym(tx, pay.gymId);
    const [held] = await tx<{ entry_id: string | null }[]>`SELECT entry_id FROM gym_held_memberships WHERE gym_id = ${pay.gymId} AND id = ${pay.membershipId}`;
    const holder = held?.entry_id == null ? undefined : { entry_id: held.entry_id };
    // Then the record's, then the press: the order a payment by hand takes.
    if (holder !== undefined) await lockedEntry(tx, pay.gymId, holder.entry_id);
    const [still] = await tx<{ id: string }[]>`SELECT id FROM gym_terminal_payments WHERE id = ${pay.id} AND state = 'waiting' FOR UPDATE`;
    if (still === undefined) return null;
    // The press itself is the payment's key: the same press recorded twice is one payment.
    const paying = {
      gymId: pay.gymId,
      membershipId: pay.membershipId,
      requestKey: pay.id,
      amountMinor: pay.amountMinor,
      method: "terminal" as const,
      provider: { name: "square", paymentId: p.squarePaymentId },
      today: p.today,
      actorUserId: pay.startedBy,
      now: p.now,
    };
    const done =
      holder === undefined || p.refuse !== undefined
        ? null
        : pay.feeBillId !== null
          ? await recordFeePaymentIn(tx, { ...paying, entryId: holder.entry_id, billId: pay.feeBillId })
          : pay.periodIndex !== null
            ? await recordPaymentIn(tx, { ...paying, entryId: holder.entry_id, periodIndex: pay.periodIndex })
            : null;
    if (done?.kind === "recorded") {
      await tx`
        UPDATE gym_terminal_payments SET state = 'done', outcome = 'paid', square_payment_id = ${p.squarePaymentId},
               member_payment_id = ${done.paymentId}, finished_at = ${p.now}, checking_until = NULL
        WHERE id = ${pay.id}`;
      return { outcome: "paid" as const };
    }
    await tx`
      UPDATE gym_terminal_payments SET state = 'done', outcome = 'not_recorded', square_payment_id = ${p.squarePaymentId},
             finished_at = ${p.now}, checking_until = NULL
      WHERE id = ${pay.id}`;
    await insertAudit(tx, {
      actorUserId: pay.startedBy,
      gymId: pay.gymId,
      action: "org.terminal_payment_not_recorded",
      targetType: "gym_terminal_payment",
      targetId: pay.id,
      meta: {
        ...(holder === undefined ? {} : { entryId: holder.entry_id }),
        membershipId: pay.membershipId,
        ...(pay.feeBillId === null ? {} : { feeBillId: pay.feeBillId }),
        amountMinor: String(pay.amountMinor),
        currency: pay.currency,
        why: p.refuse ?? done?.kind ?? "membership_not_found",
      },
    });
    return { outcome: "not_recorded" as const };
  });
}

/** Done ones are kept a day, for the page that asks how one ended; one Square took money for but
 *  could not be recorded, and one whose end Square never said, are kept. */
export async function forgetDone(sql: Sql, before: Date, gymIds: readonly string[] | null): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    DELETE FROM gym_terminal_payments
    WHERE finished_at IS NOT NULL AND finished_at < ${before} AND outcome NOT IN ('not_recorded','gone')
      AND (${gymIds === null}::boolean OR gym_id = ANY(${[...(gymIds ?? [])]}::uuid[]))
    RETURNING id`;
  return rows.length;
}
