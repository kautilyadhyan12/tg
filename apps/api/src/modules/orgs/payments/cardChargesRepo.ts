// The saved card charged (ROADMAP 18d-iii-i): one row a charge, kept. A charge is started under the
// record's lock (as a payment by hand is), with the same rules, so the amount Square is asked for is
// one the bill can take now; while it is `charging`, nothing else pays, voids or cancels that
// membership's bills (`squareMoneyOut`). A row is asked about by one request at a time
// (`checking_until`), and every change names the state it was read in, so two requests never both
// act on one answer. Every read for a screen names the gym; the worker's reads across gyms name the
// environment and hand each row back with its gym.
import type { ChargeStop } from "@app/shared";
import {
  CARD_RETRY,
  appCardRetry,
  appRetryDue,
  cardChargeOutcomeSchema,
  cardDeclineClassOf,
  cardDeclineReasonOf,
  heldMembershipView,
  memberPayTarget,
  staffCardRetry,
  type CardChargeOutcome,
  type CardChargeTry,
  type CardDeclined,
  type CardNotice,
  type CardUnchecked,
} from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import { insertAudit } from "../repo.js";
import { chargebackEnded, chargebackHolder, chargebackStops, chargesStoppedOf } from "./chargebacksRepo.js";
import { recordPaymentIn } from "../memberships/billsRepo.js";
import { recordFeePaymentIn } from "../memberships/feesRepo.js";
import { billsFor, squareMoneyOut } from "../memberships/billsSql.js";
import { lockedEntry, lockedHeld, settle } from "../memberships/heldRepo.js";
import { lockGym } from "../memberList/repo.js";
import type { SquareEnvironment } from "./square.js";

type SqlOrTx = Sql | TransactionSql;

export interface ChargeRow {
  id: string;
  gymId: string;
  /** Null once the record was deleted for good. */
  entryId: string | null;
  membershipId: string;
  /** Null for a period with no bill yet, which only a press charges. */
  billId: string | null;
  /** The period it pays, or null for a fee. */
  periodIndex: number | null;
  payerEntryId: string | null;
  environment: SquareEnvironment;
  accountId: string;
  locationId: string;
  customerId: string;
  cardId: string;
  brand: string;
  last4: string;
  amountMinor: number;
  currency: string;
  bySchedule: boolean;
  paymentKey: string;
  state: "charging" | "done";
  outcome: CardChargeOutcome | null;
  declineCode: string | null;
  squarePaymentId: string | null;
  startedBy: string | null;
  startedAt: Date;
  /** When Square was last asked about it: past `startedAt`, Square was asked before, and may have
   *  taken the money then. */
  checkedAt: Date;
  /** The payment's receipt, once it is on the bill. */
  receiptNumber: number | null;
  /** The fee it charges, while its bill is kept: a freeze fee, a late cancel or a no-show. */
  feeKind: string | null;
}

interface RawCharge {
  id: string;
  gym_id: string;
  entry_id: string | null;
  held_membership_id: string;
  bill_id: string | null;
  period_index: number | null;
  payer_entry_id: string | null;
  environment: SquareEnvironment;
  account_id: string;
  location_id: string;
  customer_id: string;
  card_id: string;
  brand: string;
  last4: string;
  amount_minor: number;
  currency: string;
  by_schedule: boolean;
  payment_key: string;
  state: "charging" | "done";
  outcome: string | null;
  decline_code: string | null;
  square_payment_id: string | null;
  started_by: string | null;
  started_at: Date;
  checked_at: Date;
  receipt_number: number | null;
  fee_kind: string | null;
}

const toRow = (r: RawCharge): ChargeRow => {
  const outcome = cardChargeOutcomeSchema.safeParse(r.outcome);
  return {
    id: r.id,
    gymId: r.gym_id,
    entryId: r.entry_id,
    membershipId: r.held_membership_id,
    billId: r.bill_id,
    periodIndex: r.period_index,
    payerEntryId: r.payer_entry_id,
    environment: r.environment,
    accountId: r.account_id,
    locationId: r.location_id,
    customerId: r.customer_id,
    cardId: r.card_id,
    brand: r.brand,
    last4: r.last4,
    amountMinor: r.amount_minor,
    currency: r.currency,
    bySchedule: r.by_schedule,
    paymentKey: r.payment_key,
    state: r.state,
    outcome: outcome.success ? outcome.data : null,
    declineCode: r.decline_code,
    squarePaymentId: r.square_payment_id,
    startedBy: r.started_by,
    startedAt: r.started_at,
    checkedAt: r.checked_at,
    receiptNumber: r.receipt_number,
    feeKind: r.fee_kind,
  };
};

const COLUMNS = (sql: SqlOrTx) =>
  sql`c.id, c.gym_id, c.entry_id, c.held_membership_id, c.bill_id, c.period_index, c.payer_entry_id, c.environment, c.account_id,
      c.location_id, c.customer_id, c.card_id, c.brand, c.last4, c.amount_minor, c.currency, c.by_schedule, c.payment_key,
      c.state, c.outcome, c.decline_code, c.square_payment_id, c.started_by, c.started_at, c.checked_at,
      (SELECT p.receipt_number FROM gym_member_payments p WHERE p.gym_id = c.gym_id AND p.id = c.member_payment_id) AS receipt_number,
      (SELECT b.fee FROM gym_member_bills b WHERE b.gym_id = c.gym_id AND b.id = c.bill_id) AS fee_kind`;

/** What a charge pays: a period of the membership, or one of its fees (by its bill). */
export type ChargeTarget = { kind: "period"; periodIndex: number } | { kind: "fee"; billId: string };

export interface NewCharge {
  gymId: string;
  entryId: string;
  membershipId: string;
  target: ChargeTarget;
  /** What staff asked for; null for the app's own charge, which takes all that is left. */
  amountMinor: number | null;
  /** The card the screen showed (`cardRefOf`); null for the app's own charge. */
  cardRef: string | null;
  environment: SquareEnvironment;
  accountId: string;
  locationId: string;
  /** The Square account's own money: a membership priced in another is not charged. */
  accountCurrency: string;
  bySchedule: boolean;
  requestKey: string;
  /** The row's own id, chosen before it is written: a press's key at Square. */
  id: string;
  startedBy: string | null;
  today: string;
  now: Date;
  /** Held by the request that writes it, which asks Square straight after. */
  checkingUntil: Date;
}

export type StartChargeOutcome =
  | { kind: "new" | "same_press"; charge: ChargeRow }
  | { kind: "key_reused" | "entry_not_found" | "membership_not_found" | "not_allowed" | "no_card" | "card_changed" | "currency" }
  | { kind: "terminal_waiting" | "card_charging" }
  | { kind: "fee_not_found" | "fee_changed" }
  | { kind: "too_much"; leftMinor: number; currency: string }
  /** Staff: the card was declined for this bill less than a day ago; for good; or 3 times. */
  | { kind: "card_wait"; from: Date; brand: string; last4: string }
  | { kind: "card_stopped" | "card_tried_out" };

/** The bill's charges, oldest first, as the retry rule reads them: by the bill, and a press for its
 *  period made before it was open (which keeps no bill). `billId` null: a period with no bill yet. */
export async function triesOf(
  sql: SqlOrTx,
  gymId: string,
  membershipId: string,
  billId: string | null,
  periodIndex: number | null,
): Promise<CardChargeTry[]> {
  const rows = await sql<{ card_id: string; outcome: string | null; decline_code: string | null; by_schedule: boolean; started_at: Date; day: string }[]>`
    SELECT c.card_id, c.outcome, c.decline_code, c.by_schedule, c.started_at, (c.started_at AT TIME ZONE g.timezone)::date::text AS day
    FROM gym_card_charges c
    JOIN gyms g ON g.id = c.gym_id
    WHERE c.gym_id = ${gymId}
      AND ((${billId}::uuid IS NOT NULL AND c.bill_id = ${billId})
           OR (${periodIndex}::int IS NOT NULL AND c.bill_id IS NULL AND c.held_membership_id = ${membershipId} AND c.period_index = ${periodIndex}))
    ORDER BY c.started_at, c.id`;
  return rows.map((r) => {
    const outcome = cardChargeOutcomeSchema.safeParse(r.outcome);
    return { cardId: r.card_id, outcome: outcome.success ? outcome.data : null, code: r.decline_code, bySchedule: r.by_schedule, startedAt: r.started_at, day: r.day };
  });
}

/** Whether the bank declined this card for good, for any bill of the gym: never charged again. */
export async function cardStopped(sql: SqlOrTx, gymId: string, cardId: string): Promise<boolean> {
  const rows = await sql<{ decline_code: string }[]>`
    SELECT DISTINCT decline_code FROM gym_card_charges WHERE gym_id = ${gymId} AND card_id = ${cardId} AND outcome = 'declined' AND decline_code IS NOT NULL`;
  return rows.some((r) => cardDeclineClassOf(r.decline_code) === "new_card");
}

/** The card a charge for this record is made to: the payer's where somebody pays for them (18i),
 *  otherwise their own, in the Square account named. Locked for the transaction. */
async function lockedCardFor(tx: TransactionSql, gymId: string, entryId: string, environment: SquareEnvironment, accountId: string) {
  const [payer] = await tx<{ payer_entry_id: string }[]>`SELECT payer_entry_id FROM gym_member_payers WHERE gym_id = ${gymId} AND entry_id = ${entryId}`;
  const holder = payer?.payer_entry_id ?? entryId;
  const [card] = await tx<{ entry_id: string; customer_id: string; card_id: string; brand: string; last4: string; saved_at: Date }[]>`
    SELECT entry_id, customer_id, card_id, brand, last4, saved_at FROM gym_member_cards
    WHERE gym_id = ${gymId} AND entry_id = ${holder} AND environment = ${environment} AND account_id = ${accountId}
    FOR UPDATE`;
  return card === undefined ? null : { ...card, payerEntryId: payer === undefined ? null : holder };
}

/** What the screen is told of a card so a press names it: whose it is and when it was saved. A card
 *  replaced, or a payer changed, since the screen read it reads differently. */
export function cardRefOf(card: { entry_id: string; saved_at: Date }): string {
  return `${card.entry_id}:${card.saved_at.toISOString()}`;
}

/** A new charge, or why not. Asked under the record's lock with the same rules as a payment by hand
 *  (`recordPaymentIn`, `recordFeePaymentIn`). The app's own charge takes only a renewing
 *  membership's bill after its first, or its freeze fee, on a current member, for all that is left. */
export async function startCharge(sql: Sql, s: NewCharge): Promise<StartChargeOutcome> {
  const periodIndex = s.target.kind === "period" ? s.target.periodIndex : null;
  return await sql.begin(async (tx): Promise<StartChargeOutcome> => {
    const [same] = await tx<RawCharge[]>`SELECT ${COLUMNS(tx)} FROM gym_card_charges c WHERE c.gym_id = ${s.gymId} AND c.request_key = ${s.requestKey}`;
    if (same !== undefined) {
      const repeat =
        !s.bySchedule &&
        !same.by_schedule &&
        same.held_membership_id === s.membershipId &&
        same.period_index === periodIndex &&
        (s.target.kind === "period" || same.bill_id === s.target.billId) &&
        same.amount_minor === s.amountMinor;
      return repeat ? { kind: "same_press", charge: toRow(same) } : { kind: "key_reused" };
    }
    const entry = await lockedEntry(tx, s.gymId, s.entryId);
    if (entry === null) return { kind: "entry_not_found" };
    if (s.bySchedule && entry.past) return { kind: "not_allowed" };
    if (!entry.past) await settle(tx, s.gymId, s.entryId, s.today, s.now);
    const row = await lockedHeld(tx, s.gymId, s.entryId, s.membershipId);
    if (row === null) return { kind: "membership_not_found" };
    const out = await squareMoneyOut(tx, s.gymId, row.id);
    if (out !== null) return out;
    if (s.bySchedule && (row.membership.kind !== "recurring" || !row.membership.renews)) return { kind: "not_allowed" };
    // The app's own charge stops the moment a membership is cancelled (Visa's dispute 13.2): a
    // period's bill only while it is in use, a freeze fee only while it is frozen (review round one).
    const status = heldMembershipView(row.membership, s.today).status;
    if (s.bySchedule && status !== (s.target.kind === "period" ? "active" : "frozen")) return { kind: "not_allowed" };
    // Whoever pays told their bank a charge was wrong (18d-iv-e-i): the app does not charge them again by itself. Staff still may.
    if (s.bySchedule && (await chargesStoppedOf(tx, s.gymId, [row.id])).size > 0) return { kind: "not_allowed" };

    let billId: string | null;
    let amountMinor: number;
    let currency = row.currency;
    if (s.target.kind === "period") {
      const bills = await billsFor(tx, s.gymId, [row.id]);
      const target = memberPayTarget(row.membership, row.nextBillMinor, s.today, bills, entry.past);
      if (target === null || target.periodIndex !== s.target.periodIndex || target.leftMinor <= 0) return { kind: "not_allowed" };
      const bill = bills.find((b) => b.periodIndex === target.periodIndex);
      // The app's own charge: a bill that has fallen due, and never the membership's first, which is
      // taken at the desk when it is given; a membership given with an earlier start has its first
      // bill for a later period, so it is the bill with none before it, not period 0.
      const renewal = bills.some((b) => b.periodIndex < target.periodIndex);
      if (s.bySchedule && (bill === undefined || bill.status !== "open" || !renewal || bill.dueOn > s.today)) return { kind: "not_allowed" };
      billId = bill?.id ?? null;
      amountMinor = s.amountMinor ?? target.leftMinor;
      if (amountMinor > target.leftMinor) return { kind: "too_much", leftMinor: target.leftMinor, currency: row.currency };
    } else {
      // A fee is charged all at once, while it is owed, at the amount the screen showed.
      const [fee] = await tx<{ id: string; status: string; amount_minor: number; currency: string; fee: string; freeze_stopped: boolean; due_on: string }[]>`
        SELECT id, status, amount_minor, currency, fee, freeze_stopped, due_on::text AS due_on FROM gym_member_bills
        WHERE gym_id = ${s.gymId} AND id = ${s.target.billId} AND held_membership_id = ${row.id} AND fee IS NOT NULL
        FOR UPDATE`;
      if (fee === undefined) return { kind: "fee_not_found" };
      if (fee.status !== "open" || (s.amountMinor !== null && fee.amount_minor !== s.amountMinor)) return { kind: "fee_changed" };
      // Late cancel and no-show fees are never charged by themselves (rulings/2026-10-22-18d-vi-b-i.md).
      if (s.bySchedule && (fee.fee !== "freeze" || fee.freeze_stopped || fee.due_on > s.today)) return { kind: "not_allowed" };
      billId = fee.id;
      amountMinor = fee.amount_minor;
      currency = fee.currency;
    }
    if (currency !== s.accountCurrency) return { kind: "currency" };

    const card = await lockedCardFor(tx, s.gymId, s.entryId, s.environment, s.accountId);
    if (card === null) return { kind: "no_card" };
    if (s.cardRef !== null && s.cardRef !== cardRefOf(card)) return { kind: "card_changed" };
    // The bill's charges so far, read under the record's lock: a second run at the same instant waits
    // for it, then finds the first's row. The app charges a bill by itself first on its date, then
    // again only on the days the retry rule names after a decline a later try may cure; never after
    // a refusal, or an answer Square did not give (the money may be taken). Staff charge a card again
    // a whole day after its decline, never after the bank declined it for good, at most 3 times.
    const tries = await triesOf(tx, s.gymId, row.id, billId, periodIndex);
    const stopped = await cardStopped(tx, s.gymId, card.card_id);
    if (s.bySchedule) {
      const retry = appCardRetry(tries, card.card_id, stopped);
      if (retry.kind === "no" || (retry.kind === "on" && !appRetryDue(retry, s.today, s.now))) return { kind: "not_allowed" };
    } else {
      const retry = staffCardRetry(tries, card.card_id, stopped, s.now);
      if (retry.kind === "wait") return { kind: "card_wait", from: retry.from, brand: card.brand, last4: card.last4 };
      if (retry.kind === "no") return { kind: retry.why === "new_card" ? "card_stopped" : "card_tried_out" };
    }
    // The app's own tries are asked with the bill's id, then "<bill>:2" and "<bill>:3": whatever
    // happens to this row, Square takes each try once. A press is asked with its own id.
    const appTry = tries.filter((t) => t.bySchedule).length + 1;
    const paymentKey = s.bySchedule && billId !== null ? (appTry === 1 ? billId : `${billId}:${String(appTry)}`) : s.id;
    // A new charge of the bill ends any try the app had set for it.
    await tx`
      UPDATE gym_card_charges SET next_try_on = NULL
      WHERE gym_id = ${s.gymId} AND next_try_on IS NOT NULL
        AND (bill_id = ${billId} OR (bill_id IS NULL AND held_membership_id = ${row.id} AND period_index = ${periodIndex}))`;
    const [made] = await tx<{ id: string }[]>`
      INSERT INTO gym_card_charges (id, gym_id, entry_id, held_membership_id, bill_id, period_index, payer_entry_id, environment,
                                    account_id, location_id, customer_id, card_id, brand, last4, amount_minor, currency,
                                    by_schedule, request_key, payment_key, state, started_by, started_at, checking_until, checked_at)
      VALUES (${s.id}, ${s.gymId}, ${s.entryId}, ${row.id}, ${billId}, ${periodIndex}, ${card.payerEntryId}, ${s.environment},
              ${s.accountId}, ${s.locationId}, ${card.customer_id}, ${card.card_id}, ${card.brand}, ${card.last4}, ${amountMinor},
              ${currency}, ${s.bySchedule}, ${s.requestKey}, ${paymentKey}, 'charging', ${s.startedBy}, ${s.now}, ${s.checkingUntil}, ${s.now})
      RETURNING id`;
    if (made === undefined) throw new Error("a card charge was not written under its locks");
    const [written] = await tx<RawCharge[]>`SELECT ${COLUMNS(tx)} FROM gym_card_charges c WHERE c.id = ${made.id}`;
    if (written === undefined) throw new Error("a card charge just written was not read back");
    return { kind: "new", charge: toRow(written) };
  });
}

/** One of the record's charges. */
export async function readCharge(sql: SqlOrTx, gymId: string, entryId: string, id: string): Promise<ChargeRow | null> {
  const [row] = await sql<RawCharge[]>`SELECT ${COLUMNS(sql)} FROM gym_card_charges c WHERE c.id = ${id} AND c.gym_id = ${gymId} AND c.entry_id = ${entryId}`;
  return row === undefined ? null : toRow(row);
}

/** Let go of the charge, while this request still holds it (`until` is its own hold). */
export async function release(sql: SqlOrTx, id: string, until: Date): Promise<void> {
  await sql`UPDATE gym_card_charges SET checking_until = NULL WHERE id = ${id} AND checking_until = ${until}`;
}

/** Charges Square has not answered and nobody holds, for the worker. */
export async function claimUnanswered(sql: Sql, environment: SquareEnvironment, now: Date, idleMs: number, until: Date, limit: number, gymIds: readonly string[] | null): Promise<ChargeRow[]> {
  const rows = await sql<RawCharge[]>`
    WITH due AS (
      SELECT id FROM gym_card_charges
      WHERE environment = ${environment} AND state = 'charging'
        AND checked_at <= ${new Date(now.getTime() - idleMs)}
        AND (checking_until IS NULL OR checking_until <= ${now})
        AND (${gymIds === null}::boolean OR gym_id = ANY(${[...(gymIds ?? [])]}::uuid[]))
      ORDER BY checked_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE gym_card_charges c SET checking_until = ${until}, checked_at = ${now}
    WHERE c.id IN (SELECT id FROM due)
    RETURNING ${COLUMNS(sql)}`;
  return rows.map(toRow);
}

/** Done with no money recorded: declined by the card's bank, refused by Square, or never answered
 *  (`gone`). Each is told to the gym's Staff activity. False when it was not charging any more. */
export async function finish(
  sql: Sql,
  id: string,
  end: { outcome: "declined" | "refused" | "gone"; code: string | null; squarePaymentId: string | null },
  at: Date,
): Promise<boolean> {
  return await sql.begin(async (tx) => {
    const [row] = await tx<{ gym_id: string; entry_id: string | null; held_membership_id: string; bill_id: string | null; period_index: number | null; payer_entry_id: string | null; card_id: string; amount_minor: number; currency: string; brand: string; last4: string; started_by: string | null; by_schedule: boolean }[]>`
      UPDATE gym_card_charges SET state = 'done', outcome = ${end.outcome}, decline_code = ${end.code}, square_payment_id = ${end.squarePaymentId},
             finished_at = ${at}, checking_until = NULL
      WHERE id = ${id} AND state = 'charging'
      RETURNING gym_id, entry_id, held_membership_id, bill_id, period_index, payer_entry_id, card_id, amount_minor, currency, brand, last4, started_by, by_schedule`;
    if (row === undefined) return false;
    if (end.outcome === "declined") await afterDecline(tx, { ...row, id }, at);
    await insertAudit(tx, {
      actorUserId: row.started_by,
      gymId: row.gym_id,
      action: end.outcome === "declined" ? "org.card_charge_declined" : end.outcome === "refused" ? "org.card_charge_refused" : "org.card_charge_unchecked",
      targetType: "gym_card_charge",
      targetId: id,
      meta: {
        ...(row.entry_id === null ? {} : { entryId: row.entry_id }),
        membershipId: row.held_membership_id,
        ...(row.bill_id === null ? {} : { billId: row.bill_id }),
        amountMinor: String(row.amount_minor),
        currency: row.currency,
        brand: row.brand,
        last4: row.last4,
        by: row.by_schedule ? "schedule" : "staff",
        ...(end.outcome === "declined" && end.code !== null ? { reason: cardDeclineReasonOf(end.code) } : {}),
      },
    });
    return true;
  });
}

/** A decline (18d-iii-ii-a): the day the app tries the card again, where the retry rule names one
 *  and the bill is one the app charges by itself (a renewal, or a freeze fee); and, with the bill's
 *  first decline, the email telling the cardholder, or a note that nobody has an address. */
async function afterDecline(
  tx: TransactionSql,
  c: { id: string; gym_id: string; entry_id: string | null; held_membership_id: string; bill_id: string | null; period_index: number | null; payer_entry_id: string | null; card_id: string },
  at: Date,
): Promise<void> {
  // The bill it was for: by its id, or the period's bill for a press made before it was open.
  const [bill] = await tx<{ id: string; fee: string | null; renewal: boolean }[]>`
    SELECT b.id, b.fee,
           EXISTS (SELECT 1 FROM gym_member_bills o
                   WHERE o.gym_id = b.gym_id AND o.held_membership_id = b.held_membership_id AND o.fee IS NULL AND o.period_index < b.period_index) AS renewal
    FROM gym_member_bills b
    WHERE b.gym_id = ${c.gym_id} AND b.held_membership_id = ${c.held_membership_id}
      AND (b.id = ${c.bill_id} OR (${c.bill_id}::uuid IS NULL AND b.fee IS NULL AND b.period_index = ${c.period_index}))
    LIMIT 1`;
  if (bill !== undefined && c.bill_id !== null && (bill.fee === "freeze" || (bill.fee === null && bill.renewal))) {
    const retry = appCardRetry(await triesOf(tx, c.gym_id, c.held_membership_id, c.bill_id, c.period_index), c.card_id, await cardStopped(tx, c.gym_id, c.card_id));
    if (retry.kind === "on") await tx`UPDATE gym_card_charges SET next_try_on = ${retry.day} WHERE id = ${c.id}`;
  }
  // Whoever's card it is: the person's own, or the record that pays for them.
  const holder = c.payer_entry_id ?? c.entry_id;
  const [person] = holder === null ? [] : await tx<{ email: string | null }[]>`SELECT email::text AS email FROM gym_member_list_entries WHERE gym_id = ${c.gym_id} AND id = ${holder}`;
  const email = person?.email ?? null;
  // One a period of the membership, or one a fee. A press paying ahead has no bill yet: its notice
  // is the period's, and the bill reads it once open (review round one).
  const billId = c.period_index === null ? (bill?.id ?? c.bill_id) : null;
  if (c.period_index === null && billId === null) return;
  await tx`
    INSERT INTO gym_card_decline_notices (gym_id, held_membership_id, period_index, bill_id, charge_id, entry_id, email, state, reason, not_before, created_at, finished_at)
    VALUES (${c.gym_id}, ${c.held_membership_id}, ${c.period_index}, ${billId}, ${c.id}, ${holder}, ${email}, ${email === null ? "skipped" : "queued"},
            ${email === null ? "no_email" : null}, ${at}, ${at}, ${email === null ? at : null})
    ON CONFLICT DO NOTHING`;
}

/** Square took the money: it is recorded on the bill, on whichever record holds the membership now,
 *  in the same transaction that marks the charge paid. Where the bill can no longer take it, the
 *  charge is marked not recorded, kept, and told to the gym's Staff activity. Null when another
 *  request finished it first. */
export async function recordCharged(
  sql: Sql,
  p: { charge: ChargeRow; squarePaymentId: string; today: string; now: Date; /** Square took other than asked: kept, never recorded. */ refuse?: string },
): Promise<{ outcome: "paid" | "not_recorded" } | null> {
  return await sql.begin(async (tx) => {
    const { charge } = p;
    // The gym's lock first: a join moving the membership to another record takes it too.
    await lockGym(tx, charge.gymId);
    const [held] = await tx<{ entry_id: string | null }[]>`SELECT entry_id FROM gym_held_memberships WHERE gym_id = ${charge.gymId} AND id = ${charge.membershipId}`;
    const holder = held?.entry_id ?? null;
    if (holder !== null) await lockedEntry(tx, charge.gymId, holder);
    const [still] = await tx<{ id: string }[]>`SELECT id FROM gym_card_charges WHERE id = ${charge.id} AND state = 'charging' FOR UPDATE`;
    if (still === undefined) return null;
    // The charge itself is the payment's key: the same charge recorded twice is one payment.
    const paying = {
      gymId: charge.gymId,
      membershipId: charge.membershipId,
      requestKey: charge.id,
      amountMinor: charge.amountMinor,
      method: "company" as const,
      provider: { name: "square", paymentId: p.squarePaymentId },
      today: p.today,
      actorUserId: charge.startedBy,
      now: p.now,
    };
    const done =
      holder === null || p.refuse !== undefined
        ? null
        : charge.periodIndex !== null
          ? await recordPaymentIn(tx, { ...paying, entryId: holder, periodIndex: charge.periodIndex })
          : charge.billId !== null
            ? await recordFeePaymentIn(tx, { ...paying, entryId: holder, billId: charge.billId })
            : null;
    if (done?.kind === "recorded") {
      await tx`
        UPDATE gym_card_charges SET state = 'done', outcome = 'paid', square_payment_id = ${p.squarePaymentId},
               member_payment_id = ${done.paymentId}, finished_at = ${p.now}, checking_until = NULL
        WHERE id = ${charge.id}`;
      return { outcome: "paid" as const };
    }
    await tx`
      UPDATE gym_card_charges SET state = 'done', outcome = 'not_recorded', square_payment_id = ${p.squarePaymentId},
             finished_at = ${p.now}, checking_until = NULL
      WHERE id = ${charge.id}`;
    await insertAudit(tx, {
      actorUserId: charge.startedBy,
      gymId: charge.gymId,
      action: "org.card_charge_not_recorded",
      targetType: "gym_card_charge",
      targetId: charge.id,
      meta: {
        ...(holder === null ? {} : { entryId: holder }),
        membershipId: charge.membershipId,
        ...(charge.billId === null ? {} : { billId: charge.billId }),
        amountMinor: String(charge.amountMinor),
        currency: charge.currency,
        brand: charge.brand,
        last4: charge.last4,
        why: p.refuse ?? done?.kind ?? "membership_not_found",
      },
    });
    return { outcome: "not_recorded" as const };
  });
}

/** Whether a card on file is being charged for one of the gym's memberships: Disconnect Square waits. */
export async function anyChargingIn(tx: TransactionSql, gymId: string, environment: SquareEnvironment): Promise<boolean> {
  const [row] = await tx<{ id: string }[]>`SELECT id FROM gym_card_charges WHERE gym_id = ${gymId} AND environment = ${environment} AND state = 'charging' LIMIT 1`;
  return row !== undefined;
}

export interface DueBill {
  gymId: string;
  entryId: string;
  membershipId: string;
  billId: string;
  /** The period it is for, or null for a freeze fee. */
  periodIndex: number | null;
  timezone: string;
}

/** What makes a bill (alias `b`, its membership `h`, its gym's day and connection `d`) one the app
 *  charges by itself, whatever try it is: a renewing membership's bill with a bill before it while
 *  it is in use, or its freeze fee while it is frozen, of a current member, open, in the Square
 *  account's money. The worker's looks, the bill's "retried automatically on" and the email's all
 *  read it (review round one: the bill must never promise what the worker will not do). */
const appCharges = (sql: SqlOrTx) => sql`${appChargesKind(sql)} AND NOT EXISTS (${chargebackStops(sql)})`;

/** The same, with or without a chargeback standing (18d-iv-e-i). */
const appChargesKind = (sql: SqlOrTx) => sql`
      b.status = 'open'
      AND h.kind = 'recurring' AND h.renews AND b.currency = d.currency AND h.entry_id IS NOT NULL
      -- A current member: looked up by the record's key, row by row, so the plan does not lean on the
      -- list's statistics (a join here took 17 s with 6,000 due just after they were added).
      AND NOT EXISTS (SELECT 1 FROM gym_member_list_entries e WHERE e.gym_id = h.gym_id AND e.id = h.entry_id AND e.former_at IS NOT NULL)
      -- A period's bill while the membership is in use, a freeze fee while it is frozen: never once it
      -- is cancelled. The write checks the membership as the clock has it.
      AND ((b.fee IS NULL AND h.status = 'active') OR (b.fee = 'freeze' AND NOT b.freeze_stopped AND h.status = 'frozen'))
      -- A renewal: the membership had a bill before this one (its first is taken at the desk), and
      -- none of those is still owed (periods are paid in order).
      AND (b.fee IS NOT NULL OR (
        EXISTS (
          SELECT 1 FROM gym_member_bills o
          WHERE o.gym_id = b.gym_id AND o.held_membership_id = b.held_membership_id AND o.fee IS NULL AND o.period_index < b.period_index)
        AND NOT EXISTS (
          SELECT 1 FROM gym_member_bills o
          WHERE o.gym_id = b.gym_id AND o.held_membership_id = b.held_membership_id AND o.fee IS NULL AND o.status = 'open' AND o.period_index < b.period_index)))`;

/** From 6 in the morning on the gym's clock, with nothing else on its way through Square for that
 *  membership: when the worker charges, now. */
const chargesNow = (sql: SqlOrTx) => sql`
      d.hour >= 6
      AND NOT EXISTS (SELECT 1 FROM gym_card_charges x WHERE x.gym_id = b.gym_id AND x.held_membership_id = b.held_membership_id AND x.state = 'charging')
      AND NOT EXISTS (SELECT 1 FROM gym_terminal_payments t WHERE t.gym_id = b.gym_id AND t.held_membership_id = b.held_membership_id AND t.state = 'waiting')`;

/** The card the app would charge for the bill's membership: its payer's, in the connected account. */
const payerCard = (sql: SqlOrTx) => sql`
      SELECT k.card_id FROM gym_member_cards k
      WHERE k.gym_id = b.gym_id AND k.environment = d.environment AND k.account_id = d.account_id
        AND k.entry_id = COALESCE((SELECT p.payer_entry_id FROM gym_member_payers p WHERE p.gym_id = h.gym_id AND p.entry_id = h.entry_id), h.entry_id)`;

/** Each gym's own day and its connected Square account; `environment` null: whichever it is connected
 *  in (a person's page). */
const gymDay = (sql: SqlOrTx, q: { environment: SquareEnvironment | null; now: Date; gymIds: readonly string[] | null }) => sql`
    gym_day AS (
      SELECT g.id AS gym_id, g.timezone, c.environment, c.account_id, c.currency,
             (${q.now}::timestamptz AT TIME ZONE g.timezone)::date AS today,
             extract(hour FROM ${q.now}::timestamptz AT TIME ZONE g.timezone) AS hour
      FROM gym_payment_connections c
      JOIN gyms g ON g.id = c.gym_id
      WHERE (${q.environment === null}::boolean OR c.environment = ${q.environment}) AND c.state = 'connected' AND c.location_id IS NOT NULL
        AND (${q.gymIds === null}::boolean OR c.gym_id = ANY(${[...(q.gymIds ?? [])]}::uuid[]))
    )`;

interface DueRow {
  gym_id: string;
  entry_id: string;
  held_membership_id: string;
  bill_id: string;
  period_index: number | null;
  timezone: string;
}
const toDue = (r: DueRow): DueBill => ({ gymId: r.gym_id, entryId: r.entry_id, membershipId: r.held_membership_id, billId: r.bill_id, periodIndex: r.period_index, timezone: r.timezone });

export interface DueQuery {
  environment: SquareEnvironment;
  now: Date;
  limit: number;
  after: { gymId: string; billId: string } | null;
  gymIds: readonly string[] | null;
}

/** Bills the app charges by itself for the first time now, across gyms, after `after` in (gym, bill)
 *  order: those of `appCharges`, due today or in the two days before on the gym's clock, whose payer
 *  has a card in the Square account the gym is connected to, never charged before by the app or by
 *  staff. The write checks it all again under the record's lock. */
export async function dueBills(sql: Sql, q: DueQuery): Promise<DueBill[]> {
  const rows = await sql<DueRow[]>`
    WITH ${gymDay(sql, q)}
    SELECT b.gym_id, h.entry_id, b.held_membership_id, b.id AS bill_id, b.period_index, d.timezone
    FROM gym_day d
    JOIN gym_member_bills b ON b.gym_id = d.gym_id AND b.status = 'open' AND b.due_on BETWEEN d.today - 2 AND d.today
    JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
    WHERE ${appCharges(sql)} AND ${chargesNow(sql)}
      AND (${q.after === null}::boolean OR (b.gym_id, b.id) > (${q.after?.gymId ?? null}::uuid, ${q.after?.billId ?? null}::uuid))
      AND EXISTS (${payerCard(sql)})
      -- No card was charged for it before, by the app or by staff: a later try is found by retryBills.
      AND NOT EXISTS (SELECT 1 FROM gym_card_charges x WHERE x.gym_id = b.gym_id AND x.bill_id = b.id)
      AND (b.fee IS NOT NULL OR NOT EXISTS (
        SELECT 1 FROM gym_card_charges x
        WHERE x.gym_id = b.gym_id AND x.bill_id IS NULL AND x.held_membership_id = b.held_membership_id AND x.period_index = b.period_index))
    ORDER BY b.gym_id, b.id
    LIMIT ${q.limit}`;
  return rows.map(toDue);
}

/** A decline the app will try again (alias `x`): its day set, not more than 3 days gone (a try the
 *  worker could not make by then is staff's), on a bill of `appCharges`, and the same card the payer
 *  has on file now in the connected account. */
const retryPending = (sql: SqlOrTx) => sql`
      x.next_try_on IS NOT NULL AND x.next_try_on >= d.today - 3 AND x.environment = d.environment
      AND ${appCharges(sql)}
      AND x.card_id = (${payerCard(sql)})`;

/** Bills whose card the app tries again now (18d-iii-ii-a), after `after` in (gym, bill) order: those
 *  of `retryPending` whose day is reached and a whole day after the decline. Found from the declines
 *  (`gym_card_charges_retry_idx`), as they are few. The write checks it all again. */
export async function retryBills(sql: Sql, q: DueQuery): Promise<DueBill[]> {
  const rows = await sql<DueRow[]>`
    WITH ${gymDay(sql, q)}
    SELECT b.gym_id, h.entry_id, b.held_membership_id, b.id AS bill_id, b.period_index, d.timezone
    FROM gym_card_charges x
    JOIN gym_day d ON d.gym_id = x.gym_id AND d.account_id = x.account_id
    JOIN gym_member_bills b ON b.gym_id = x.gym_id AND b.id = x.bill_id
    JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
    WHERE ${retryPending(sql)} AND ${chargesNow(sql)}
      AND x.next_try_on <= d.today AND x.started_at <= ${new Date(q.now.getTime() - CARD_RETRY.gapMs)}
      AND (${q.after === null}::boolean OR (b.gym_id, b.id) > (${q.after?.gymId ?? null}::uuid, ${q.after?.billId ?? null}::uuid))
    ORDER BY b.gym_id, b.id
    LIMIT ${q.limit}`;
  return rows.map(toDue);
}

/** A try again the worker's write refused: the bill's decline no longer sets a day. */
export async function clearRetry(sql: Sql, gymId: string, billId: string): Promise<void> {
  await sql`UPDATE gym_card_charges SET next_try_on = NULL WHERE gym_id = ${gymId} AND bill_id = ${billId} AND next_try_on IS NOT NULL`;
}

/** Each of these bills the app would have charged by itself but for a chargeback, by the worker's own rule: one standing, or one ended
 *  that left the bill past the days the app charges. Its payer has a card, so "charge the card" is true. */
export async function chargeStopsOfBills(sql: SqlOrTx, gymId: string, billIds: readonly string[], now: Date): Promise<Map<string, ChargeStop>> {
  if (billIds.length === 0) return new Map();
  const rows = await sql<{ id: string; stopped: boolean; ended: boolean; old: boolean; held_by: string | null }[]>`
    WITH ${gymDay(sql, { environment: null, now, gymIds: [gymId] })}
    SELECT b.id, EXISTS (${chargebackStops(sql)}) AS stopped, EXISTS (${chargebackEnded(sql)}) AS ended, b.due_on < d.today - 2 AS old, (${chargebackHolder(sql)}) AS held_by
    FROM gym_day d
    JOIN gym_member_bills b ON b.gym_id = d.gym_id
    JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
    WHERE b.id = ANY(${[...billIds]}::uuid[]) AND ${appChargesKind(sql)} AND EXISTS (${payerCard(sql)})`;
  const out = new Map<string, ChargeStop>();
  for (const r of rows) {
    if (r.stopped) out.set(r.id, { kind: "stopped", heldBy: r.held_by });
    else if (r.ended && r.old) out.set(r.id, { kind: "missed", heldBy: null });
  }
  return out;
}

/** The day the app will try each of these bills again, by the worker's own rule (`retryPending`): the
 *  bill's line and the email say it only where the worker will do it. */
export async function pendingRetries(sql: SqlOrTx, gymId: string, billIds: readonly string[], now: Date): Promise<Map<string, string>> {
  if (billIds.length === 0) return new Map();
  const rows = await sql<{ bill_id: string; next_try_on: string }[]>`
    WITH ${gymDay(sql, { environment: null, now, gymIds: [gymId] })}
    SELECT b.id AS bill_id, x.next_try_on::text AS next_try_on
    FROM gym_card_charges x
    JOIN gym_day d ON d.gym_id = x.gym_id AND d.account_id = x.account_id
    JOIN gym_member_bills b ON b.gym_id = x.gym_id AND b.id = x.bill_id
    JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
    WHERE x.gym_id = ${gymId} AND b.id = ANY(${[...billIds]}::uuid[]) AND ${retryPending(sql)}`;
  return new Map(rows.map((r) => [r.bill_id, r.next_try_on]));
}

/** For a person's page: each bill's newest charge (declined, with what the app does next and the
 *  email to the cardholder; never answered by Square; or charging now), and the card each payment
 *  was charged to. */
export async function chargesOfBills(
  sql: SqlOrTx,
  gymId: string,
  billIds: readonly string[],
  paymentIds: readonly string[],
  now: Date,
): Promise<{
  declined: Map<string, CardDeclined>;
  unchecked: Map<string, CardUnchecked>;
  charging: Set<string>;
  cardOfPayment: Map<string, { brand: string; last4: string }>;
}> {
  const declined = new Map<string, CardDeclined>();
  const unchecked = new Map<string, CardUnchecked>();
  const charging = new Set<string>();
  const cardOfPayment = new Map<string, { brand: string; last4: string }>();
  if (billIds.length === 0 && paymentIds.length === 0) return { declined, unchecked, charging, cardOfPayment };
  const rows = await sql<
    {
      bill_id: string | null;
      id: string;
      state: string;
      outcome: string | null;
      decline_code: string | null;
      card_id: string;
      by_schedule: boolean;
      started_at: Date;
      brand: string;
      last4: string;
      on: string;
      member_payment_id: string | null;
      next_try_on: string | null;
    }[]
  >`
    WITH asked AS (
      -- Each bill's charges: by the bill, and a press for its period made before it was open, which
      -- keeps no bill (re-check: such a charge Square never answered must still be said on the bill).
      SELECT b.id AS bill_id, c.id, c.state, c.outcome, c.decline_code, c.card_id, c.by_schedule, c.brand, c.last4, c.member_payment_id, c.started_at, c.gym_id, c.next_try_on
      FROM gym_member_bills b
      JOIN gym_card_charges c ON c.gym_id = b.gym_id AND c.bill_id = b.id
      WHERE b.gym_id = ${gymId} AND b.id = ANY(${[...billIds]}::uuid[])
      UNION
      SELECT b.id AS bill_id, c.id, c.state, c.outcome, c.decline_code, c.card_id, c.by_schedule, c.brand, c.last4, c.member_payment_id, c.started_at, c.gym_id, c.next_try_on
      FROM gym_member_bills b
      JOIN gym_card_charges c
        ON c.gym_id = b.gym_id AND c.bill_id IS NULL AND c.held_membership_id = b.held_membership_id AND c.period_index = b.period_index
      WHERE b.gym_id = ${gymId} AND b.id = ANY(${[...billIds]}::uuid[]) AND b.fee IS NULL
      UNION
      SELECT c.bill_id, c.id, c.state, c.outcome, c.decline_code, c.card_id, c.by_schedule, c.brand, c.last4, c.member_payment_id, c.started_at, c.gym_id, c.next_try_on
      FROM gym_card_charges c
      WHERE c.gym_id = ${gymId} AND c.member_payment_id = ANY(${[...paymentIds]}::uuid[])
    )
    SELECT a.bill_id, a.id, a.state, a.outcome, a.decline_code, a.card_id, a.by_schedule, a.started_at, a.brand, a.last4, a.member_payment_id,
           a.next_try_on::text AS next_try_on, (a.started_at AT TIME ZONE g.timezone)::date::text AS on
    FROM asked a
    JOIN gyms g ON g.id = a.gym_id
    ORDER BY a.started_at, a.id`;
  // Per bill: the card its payer has on file in the connected account, and its email (by the bill,
  // or by the period for a press made before the bill was open).
  const declinedBills = [...new Set(rows.filter((r) => r.bill_id !== null && r.outcome === "declined").map((r) => r.bill_id ?? ""))];
  const facts =
    declinedBills.length === 0
      ? []
      : await sql<{ bill_id: string; card_id: string | null; notice_state: string | null; notice_reason: string | null; notice_on: string | null }[]>`
          SELECT b.id AS bill_id,
                 (SELECT k.card_id FROM gym_member_cards k
                  JOIN gym_payment_connections pc ON pc.gym_id = k.gym_id AND pc.environment = k.environment AND pc.account_id = k.account_id AND pc.state = 'connected'
                  WHERE k.gym_id = b.gym_id
                    AND k.entry_id = COALESCE((SELECT p.payer_entry_id FROM gym_member_payers p WHERE p.gym_id = h.gym_id AND p.entry_id = h.entry_id), h.entry_id)
                  LIMIT 1) AS card_id,
                 n.state AS notice_state, n.reason AS notice_reason, (n.finished_at AT TIME ZONE g.timezone)::date::text AS notice_on
          FROM gym_member_bills b
          JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
          JOIN gyms g ON g.id = b.gym_id
          LEFT JOIN gym_card_decline_notices n
            ON n.gym_id = b.gym_id
           AND ((n.period_index IS NULL AND n.bill_id = b.id)
                OR (b.fee IS NULL AND n.held_membership_id = b.held_membership_id AND n.period_index = b.period_index))
          WHERE b.gym_id = ${gymId} AND b.id = ANY(${declinedBills}::uuid[])`;
  const pending = await pendingRetries(sql, gymId, declinedBills, now);
  const stoppedCards = await stoppedCardsOf(sql, gymId, [...new Set(facts.map((f) => f.card_id).filter((c): c is string => c !== null))]);
  const byBill = new Map<string, (typeof rows)[number][]>();
  for (const r of rows) {
    if (r.member_payment_id !== null) cardOfPayment.set(r.member_payment_id, { brand: r.brand, last4: r.last4 });
    if (r.bill_id === null) continue;
    byBill.set(r.bill_id, [...(byBill.get(r.bill_id) ?? []), r]);
  }
  for (const [billId, charges] of byBill) {
    const r = charges[charges.length - 1];
    if (r === undefined) continue;
    if (r.state === "charging") charging.add(billId);
    if (r.outcome === "gone") unchecked.set(billId, { brand: r.brand, last4: r.last4, on: r.on });
    if (r.outcome !== "declined" || r.decline_code === null) continue;
    const fact = facts.find((f) => f.bill_id === billId);
    const tries: CardChargeTry[] = charges.map((c) => {
      const outcome = cardChargeOutcomeSchema.safeParse(c.outcome);
      return { cardId: c.card_id, outcome: outcome.success ? outcome.data : null, code: c.decline_code, bySchedule: c.by_schedule, startedAt: c.started_at, day: c.on };
    });
    const stopped = stoppedCards.has(r.card_id);
    const retry = appCardRetry(tries, r.card_id, stopped);
    // Whether staff may charge it again at all; a decline under a day old waits, which the line does
    // not say, so the wait is read as past.
    const staff = staffCardRetry(tries, r.card_id, stopped, new Date(8_640_000_000_000_000));
    // The day the worker will try it, by the worker's own rule; else why not (every decline says what
    // comes next: Kd, 2026-10-23).
    const next = pending.get(billId) ?? null;
    const sameCard = (fact?.card_id ?? null) === r.card_id;
    const stop =
      next !== null
        ? null
        : !sameCard
          ? ("manual" as const)
          : staff.kind === "no"
            ? staff.why
            : retry.kind === "no" && retry.why === "bank"
              ? ("bank" as const)
              : ("manual" as const);
    declined.set(billId, { brand: r.brand, last4: r.last4, on: r.on, reason: cardDeclineReasonOf(r.decline_code), next, stop, notice: noticeOf(fact) });
  }
  return { declined, unchecked, charging, cardOfPayment };
}

function noticeOf(fact: { notice_state: string | null; notice_reason: string | null; notice_on: string | null } | undefined): CardNotice | null {
  if (fact?.notice_state == null) return null;
  if (fact.notice_state === "sent") return { state: "emailed", on: fact.notice_on };
  if (fact.notice_state === "queued" || fact.notice_state === "sending") return { state: "sending", on: null };
  if (fact.notice_reason === "no_email") return { state: "no_email", on: null };
  return { state: "not_sent", on: null };
}

/** The card Charge card on file would charge for this record now, as `startCharge` picks it, with
 *  the payer's name where somebody else pays. */
export async function readChargeCard(
  sql: SqlOrTx,
  gymId: string,
  entryId: string,
  environment: SquareEnvironment,
  accountId: string,
): Promise<{ entry_id: string; card_id: string; brand: string; last4: string; exp_month: number; exp_year: number; saved_at: Date; payerName: string | null } | null> {
  const [row] = await sql<{ entry_id: string; card_id: string; brand: string; last4: string; exp_month: number; exp_year: number; saved_at: Date; payer_name: string | null; paid_for: boolean }[]>`
    WITH holder AS (
      SELECT COALESCE((SELECT p.payer_entry_id FROM gym_member_payers p WHERE p.gym_id = ${gymId} AND p.entry_id = ${entryId}), ${entryId}::uuid) AS entry_id
    )
    SELECT k.entry_id, k.card_id, k.brand, k.last4, k.exp_month, k.exp_year, k.saved_at, e.full_name AS payer_name, k.entry_id <> ${entryId}::uuid AS paid_for
    FROM holder h
    JOIN gym_member_cards k ON k.gym_id = ${gymId} AND k.entry_id = h.entry_id AND k.environment = ${environment} AND k.account_id = ${accountId}
    JOIN gym_member_list_entries e ON e.gym_id = k.gym_id AND e.id = k.entry_id`;
  return row === undefined
    ? null
    : { entry_id: row.entry_id, card_id: row.card_id, brand: row.brand, last4: row.last4, exp_month: row.exp_month, exp_year: row.exp_year, saved_at: row.saved_at, payerName: row.paid_for ? row.payer_name : null };
}

/** `readChargeCard` for many records at once (the Failed payments list, 18d-iii-ii-b): the same
 *  statement, keyed by each record. */
export async function readChargeCards(
  sql: SqlOrTx,
  gymId: string,
  entryIds: readonly string[],
  environment: SquareEnvironment,
  accountId: string,
): Promise<Map<string, NonNullable<Awaited<ReturnType<typeof readChargeCard>>>>> {
  if (entryIds.length === 0) return new Map();
  const rows = await sql<{ for_id: string; entry_id: string; card_id: string; brand: string; last4: string; exp_month: number; exp_year: number; saved_at: Date; payer_name: string | null; paid_for: boolean }[]>`
    WITH holder AS (
      SELECT x.id AS for_id, COALESCE((SELECT p.payer_entry_id FROM gym_member_payers p WHERE p.gym_id = ${gymId} AND p.entry_id = x.id), x.id) AS entry_id
      FROM unnest(${[...entryIds]}::uuid[]) AS x(id)
    )
    SELECT h.for_id, k.entry_id, k.card_id, k.brand, k.last4, k.exp_month, k.exp_year, k.saved_at, e.full_name AS payer_name, k.entry_id <> h.for_id AS paid_for
    FROM holder h
    JOIN gym_member_cards k ON k.gym_id = ${gymId} AND k.entry_id = h.entry_id AND k.environment = ${environment} AND k.account_id = ${accountId}
    JOIN gym_member_list_entries e ON e.gym_id = k.gym_id AND e.id = k.entry_id`;
  return new Map(
    rows.map((row) => [
      row.for_id,
      { entry_id: row.entry_id, card_id: row.card_id, brand: row.brand, last4: row.last4, exp_month: row.exp_month, exp_year: row.exp_year, saved_at: row.saved_at, payerName: row.paid_for ? row.payer_name : null },
    ]),
  );
}

/** `triesOf` for many bills at once, by bill id; each bill's charges oldest first. */
export async function triesOfBills(
  sql: SqlOrTx,
  gymId: string,
  bills: readonly { membershipId: string; billId: string; periodIndex: number | null }[],
): Promise<Map<string, CardChargeTry[]>> {
  const out = new Map<string, CardChargeTry[]>(bills.map((b) => [b.billId, []]));
  if (bills.length === 0) return out;
  const rows = await sql<{ for_bill: string; card_id: string; outcome: string | null; decline_code: string | null; by_schedule: boolean; started_at: Date; day: string }[]>`
    WITH asked AS (
      SELECT * FROM unnest(${bills.map((b) => b.billId)}::uuid[], ${bills.map((b) => b.membershipId)}::uuid[], ${bills.map((b) => b.periodIndex)}::int[]) AS a(bill_id, membership_id, period_index)
    )
    SELECT a.bill_id AS for_bill, c.card_id, c.outcome, c.decline_code, c.by_schedule, c.started_at, (c.started_at AT TIME ZONE g.timezone)::date::text AS day
    FROM asked a
    JOIN gym_card_charges c
      ON c.gym_id = ${gymId}
     AND (c.bill_id = a.bill_id OR (a.period_index IS NOT NULL AND c.bill_id IS NULL AND c.held_membership_id = a.membership_id AND c.period_index = a.period_index))
    JOIN gyms g ON g.id = c.gym_id
    ORDER BY c.started_at, c.id`;
  for (const r of rows) {
    const outcome = cardChargeOutcomeSchema.safeParse(r.outcome);
    out.get(r.for_bill)?.push({ cardId: r.card_id, outcome: outcome.success ? outcome.data : null, code: r.decline_code, bySchedule: r.by_schedule, startedAt: r.started_at, day: r.day });
  }
  return out;
}

/** `cardStopped` for many cards at once: the ones the bank declined for good. */
export async function stoppedCardsOf(sql: SqlOrTx, gymId: string, cardIds: readonly string[]): Promise<Set<string>> {
  if (cardIds.length === 0) return new Set();
  const rows = await sql<{ card_id: string; decline_code: string }[]>`
    SELECT DISTINCT card_id, decline_code FROM gym_card_charges
    WHERE gym_id = ${gymId} AND card_id = ANY(${[...cardIds]}::text[]) AND outcome = 'declined' AND decline_code IS NOT NULL`;
  return new Set(rows.filter((r) => cardDeclineClassOf(r.decline_code) === "new_card").map((r) => r.card_id));
}
