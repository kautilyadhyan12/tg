// The saved card charged (ROADMAP 18d-iii-i): one row a charge, kept. A charge is started under the
// record's lock (as a payment by hand is), with the same rules, so the amount Square is asked for is
// one the bill can take now; while it is `charging`, nothing else pays, voids or cancels that
// membership's bills (`squareMoneyOut`). A row is asked about by one request at a time
// (`checking_until`), and every change names the state it was read in, so two requests never both
// act on one answer. Every read for a screen names the gym; the worker's reads across gyms name the
// environment and hand each row back with its gym.
import { cardDeclineReasonOf, cardChargeOutcomeSchema, memberPayTarget, type CardChargeOutcome, type CardDeclined } from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import { insertAudit } from "../repo.js";
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
    receiptNumber: r.receipt_number,
    feeKind: r.fee_kind,
  };
};

const COLUMNS = (sql: SqlOrTx) =>
  sql`c.id, c.gym_id, c.entry_id, c.held_membership_id, c.bill_id, c.period_index, c.payer_entry_id, c.environment, c.account_id,
      c.location_id, c.customer_id, c.card_id, c.brand, c.last4, c.amount_minor, c.currency, c.by_schedule, c.payment_key,
      c.state, c.outcome, c.decline_code, c.square_payment_id, c.started_by, c.started_at,
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
  | { kind: "too_much"; leftMinor: number; currency: string };

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
    // The app charges a bill by itself once: a second run at the same instant waits for this lock,
    // then finds the first's row.
    if (s.bySchedule && billId !== null) {
      const [before] = await tx<{ id: string }[]>`SELECT id FROM gym_card_charges WHERE gym_id = ${s.gymId} AND bill_id = ${billId} AND by_schedule`;
      if (before !== undefined) return { kind: "not_allowed" };
    }

    const card = await lockedCardFor(tx, s.gymId, s.entryId, s.environment, s.accountId);
    if (card === null) return { kind: "no_card" };
    if (s.cardRef !== null && s.cardRef !== cardRefOf(card)) return { kind: "card_changed" };
    // The app's own charge is asked with the bill's id: whatever happens to this row, Square takes
    // that bill once. A press is asked with its own.
    const paymentKey = s.bySchedule && billId !== null ? billId : s.id;
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
    const [row] = await tx<{ gym_id: string; entry_id: string | null; held_membership_id: string; bill_id: string | null; amount_minor: number; currency: string; brand: string; last4: string; started_by: string | null; by_schedule: boolean }[]>`
      UPDATE gym_card_charges SET state = 'done', outcome = ${end.outcome}, decline_code = ${end.code}, square_payment_id = ${end.squarePaymentId},
             finished_at = ${at}, checking_until = NULL
      WHERE id = ${id} AND state = 'charging'
      RETURNING gym_id, entry_id, held_membership_id, bill_id, amount_minor, currency, brand, last4, started_by, by_schedule`;
    if (row === undefined) return false;
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

/** Bills the app charges by itself now, across gyms, after `after` in (gym, bill) order: a renewing
 *  membership's bill with a bill before it, or its freeze fee, open, due today or in the two days before
 *  on its gym's clock and from 6 in the morning there, never charged by the app before, whose payer
 *  has a card in the Square account the gym is connected to, and with nothing else on its way
 *  through Square for that membership. The write checks it all again under the record's lock. */
export async function dueBills(
  sql: Sql,
  q: { environment: SquareEnvironment; now: Date; limit: number; after: { gymId: string; billId: string } | null; gymIds: readonly string[] | null },
): Promise<DueBill[]> {
  const rows = await sql<{ gym_id: string; entry_id: string; held_membership_id: string; bill_id: string; period_index: number | null; timezone: string }[]>`
    WITH gym_day AS (
      SELECT g.id AS gym_id, g.timezone, c.account_id,
             (${q.now}::timestamptz AT TIME ZONE g.timezone)::date AS today,
             extract(hour FROM ${q.now}::timestamptz AT TIME ZONE g.timezone) AS hour
      FROM gym_payment_connections c
      JOIN gyms g ON g.id = c.gym_id
      WHERE c.environment = ${q.environment} AND c.state = 'connected' AND c.location_id IS NOT NULL
        AND (${q.gymIds === null}::boolean OR c.gym_id = ANY(${[...(q.gymIds ?? [])]}::uuid[]))
    )
    SELECT b.gym_id, h.entry_id, b.held_membership_id, b.id AS bill_id, b.period_index, d.timezone
    FROM gym_day d
    JOIN gym_member_bills b ON b.gym_id = d.gym_id AND b.status = 'open' AND b.due_on BETWEEN d.today - 2 AND d.today
    JOIN gym_held_memberships h ON h.gym_id = b.gym_id AND h.id = b.held_membership_id
    WHERE d.hour >= 6
      AND h.kind = 'recurring' AND h.renews AND h.entry_id IS NOT NULL
      AND (b.fee IS NULL OR (b.fee = 'freeze' AND NOT b.freeze_stopped))
      -- A renewal: the membership had a bill before this one (its first is taken at the desk), and
      -- none of those is still owed (periods are paid in order).
      AND (b.fee IS NOT NULL OR (
        EXISTS (
          SELECT 1 FROM gym_member_bills o
          WHERE o.gym_id = b.gym_id AND o.held_membership_id = b.held_membership_id AND o.fee IS NULL AND o.period_index < b.period_index)
        AND NOT EXISTS (
          SELECT 1 FROM gym_member_bills o
          WHERE o.gym_id = b.gym_id AND o.held_membership_id = b.held_membership_id AND o.fee IS NULL AND o.status = 'open' AND o.period_index < b.period_index)))
      AND (${q.after === null}::boolean OR (b.gym_id, b.id) > (${q.after?.gymId ?? null}::uuid, ${q.after?.billId ?? null}::uuid))
      AND EXISTS (
        SELECT 1 FROM gym_member_cards k
        WHERE k.gym_id = b.gym_id AND k.environment = ${q.environment} AND k.account_id = d.account_id
          AND k.entry_id = COALESCE((SELECT p.payer_entry_id FROM gym_member_payers p WHERE p.gym_id = h.gym_id AND p.entry_id = h.entry_id), h.entry_id))
      AND NOT EXISTS (SELECT 1 FROM gym_card_charges x WHERE x.gym_id = b.gym_id AND x.bill_id = b.id AND x.by_schedule)
      AND NOT EXISTS (SELECT 1 FROM gym_card_charges x WHERE x.gym_id = b.gym_id AND x.held_membership_id = b.held_membership_id AND x.state = 'charging')
      AND NOT EXISTS (SELECT 1 FROM gym_terminal_payments t WHERE t.gym_id = b.gym_id AND t.held_membership_id = b.held_membership_id AND t.state = 'waiting')
    ORDER BY b.gym_id, b.id
    LIMIT ${q.limit}`;
  return rows.map((r) => ({ gymId: r.gym_id, entryId: r.entry_id, membershipId: r.held_membership_id, billId: r.bill_id, periodIndex: r.period_index, timezone: r.timezone }));
}

/** For a person's page: each bill's newest charge (declined; or charging now), and the card each
 *  payment was charged to. */
export async function chargesOfBills(
  sql: SqlOrTx,
  gymId: string,
  billIds: readonly string[],
  paymentIds: readonly string[],
): Promise<{ declined: Map<string, CardDeclined>; charging: Set<string>; cardOfPayment: Map<string, { brand: string; last4: string }> }> {
  const declined = new Map<string, CardDeclined>();
  const charging = new Set<string>();
  const cardOfPayment = new Map<string, { brand: string; last4: string }>();
  if (billIds.length === 0 && paymentIds.length === 0) return { declined, charging, cardOfPayment };
  const rows = await sql<{ bill_id: string | null; state: string; outcome: string | null; decline_code: string | null; brand: string; last4: string; on: string; member_payment_id: string | null; newest: boolean }[]>`
    SELECT c.bill_id, c.state, c.outcome, c.decline_code, c.brand, c.last4, c.member_payment_id,
           (c.started_at AT TIME ZONE g.timezone)::date::text AS on,
           row_number() OVER (PARTITION BY c.bill_id ORDER BY c.started_at DESC, c.id DESC) = 1 AS newest
    FROM gym_card_charges c
    JOIN gyms g ON g.id = c.gym_id
    WHERE c.gym_id = ${gymId} AND (c.bill_id = ANY(${[...billIds]}::uuid[]) OR c.member_payment_id = ANY(${[...paymentIds]}::uuid[]))`;
  for (const r of rows) {
    if (r.member_payment_id !== null) cardOfPayment.set(r.member_payment_id, { brand: r.brand, last4: r.last4 });
    if (!r.newest || r.bill_id === null) continue;
    if (r.state === "charging") charging.add(r.bill_id);
    if (r.outcome === "declined" && r.decline_code !== null) {
      declined.set(r.bill_id, { brand: r.brand, last4: r.last4, on: r.on, reason: cardDeclineReasonOf(r.decline_code) });
    }
  }
  return { declined, charging, cardOfPayment };
}

/** The card Charge card on file would charge for this record now, as `startCharge` picks it, with
 *  the payer's name where somebody else pays. */
export async function readChargeCard(
  sql: SqlOrTx,
  gymId: string,
  entryId: string,
  environment: SquareEnvironment,
  accountId: string,
): Promise<{ entry_id: string; brand: string; last4: string; exp_month: number; exp_year: number; saved_at: Date; payerName: string | null } | null> {
  const [row] = await sql<{ entry_id: string; brand: string; last4: string; exp_month: number; exp_year: number; saved_at: Date; payer_name: string | null; paid_for: boolean }[]>`
    WITH holder AS (
      SELECT COALESCE((SELECT p.payer_entry_id FROM gym_member_payers p WHERE p.gym_id = ${gymId} AND p.entry_id = ${entryId}), ${entryId}::uuid) AS entry_id
    )
    SELECT k.entry_id, k.brand, k.last4, k.exp_month, k.exp_year, k.saved_at, e.full_name AS payer_name, k.entry_id <> ${entryId}::uuid AS paid_for
    FROM holder h
    JOIN gym_member_cards k ON k.gym_id = ${gymId} AND k.entry_id = h.entry_id AND k.environment = ${environment} AND k.account_id = ${accountId}
    JOIN gym_member_list_entries e ON e.gym_id = k.gym_id AND e.id = k.entry_id`;
  return row === undefined
    ? null
    : { entry_id: row.entry_id, brand: row.brand, last4: row.last4, exp_month: row.exp_month, exp_year: row.exp_year, saved_at: row.saved_at, payerName: row.paid_for ? row.payer_name : null };
}
