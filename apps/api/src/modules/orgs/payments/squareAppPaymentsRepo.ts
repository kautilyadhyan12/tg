// The database half of a payment taken in Square's own app (ROADMAP 18d-iii-b-i; `squareAppPayments.ts`).
//
// Each Square payment is kept once (`gym_square_app_payments`, unique on Square's own id), whichever of
// Square's messages or the hourly look found it first. The bills it could be for are read under the
// gym's lock and the records' own, after what the clock has done is written, as Record payment reads them.
import { randomUUID } from "node:crypto";
import { addDays, memberPayTarget, SQUARE_APP, type SquareAppCandidate, type SquareAppWaitReason, type SquarePayment } from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import { billsFor, paymentsFor, squareMoneyOut } from "../memberships/billsSql.js";
import { heldRowsOf, lockedEntry, settle } from "../memberships/heldRepo.js";
import { lockEntries } from "../memberList/repo.js";
import type { SquareEnvironment } from "./square.js";

type SqlOrTx = Sql | TransactionSql;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A payment the app took itself, on a Square Terminal or from a card on file: never taken in here.
 *  A Terminal checkout's payment names its checkout; a card on file's charge names the charge, which
 *  is written before Square is asked, so its message can never come first. */
export async function isOurs(sql: SqlOrTx, environment: SquareEnvironment, accountId: string, payment: SquarePayment): Promise<boolean> {
  if (payment.terminal_checkout_id != null) return true;
  const ref = payment.reference_id ?? null;
  const chargeId = ref !== null && UUID.test(ref) ? ref : null;
  const [row] = await sql<{ ours: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM gym_card_charges WHERE id = ${chargeId}::uuid)
        OR EXISTS (SELECT 1 FROM gym_card_charges WHERE environment = ${environment} AND account_id = ${accountId} AND square_payment_id = ${payment.id})
        OR EXISTS (SELECT 1 FROM gym_terminal_payments WHERE environment = ${environment} AND account_id = ${accountId} AND square_payment_id = ${payment.id})
        AS ours`;
  return row?.ours === true;
}

/** Taken in already, by a message or a look. */
export async function known(sql: SqlOrTx, environment: SquareEnvironment, accountId: string, squarePaymentId: string): Promise<boolean> {
  const [row] = await sql<{ id: string }[]>`
    SELECT id FROM gym_square_app_payments WHERE environment = ${environment} AND account_id = ${accountId} AND square_payment_id = ${squarePaymentId}`;
  return row !== undefined;
}

/** Square payments made before this are never taken in. */
export const SINCE_GRACE_MS = 10 * 60_000;

/** The gym's look at its Square payments, made where it has none and begun again where the
 *  connection moved to another account or location: when the app began watching. */
export async function watchingSince(sql: SqlOrTx, w: { gymId: string; environment: SquareEnvironment; accountId: string; locationId: string; now: Date }): Promise<Date> {
  const start = new Date(w.now.getTime() - SINCE_GRACE_MS);
  const [row] = await sql<{ watching_since: Date }[]>`
    INSERT INTO gym_square_payment_sweeps (gym_id, environment, account_id, location_id, watching_since, swept_until, due_at)
    VALUES (${w.gymId}, ${w.environment}, ${w.accountId}, ${w.locationId}, ${start}, ${start}, ${new Date(w.now.getTime() + SWEEP.everyMs)})
    ON CONFLICT (gym_id, environment) DO UPDATE
      SET account_id = EXCLUDED.account_id, location_id = EXCLUDED.location_id, watching_since = EXCLUDED.watching_since,
          swept_until = EXCLUDED.swept_until, lease_until = NULL
      WHERE gym_square_payment_sweeps.account_id <> EXCLUDED.account_id OR gym_square_payment_sweeps.location_id <> EXCLUDED.location_id
    RETURNING watching_since`;
  if (row !== undefined) return row.watching_since;
  const [kept] = await sql<{ watching_since: Date }[]>`
    SELECT watching_since FROM gym_square_payment_sweeps WHERE gym_id = ${w.gymId} AND environment = ${w.environment}`;
  return kept?.watching_since ?? start;
}

/** The records whose Square customer this is: the one the app made for them (18d-ii), and the one
 *  their card on file is saved on. In the gyms named. */
export async function linkedRecords(
  sql: SqlOrTx,
  q: { environment: SquareEnvironment; accountId: string; customerId: string; gymIds: readonly string[] },
): Promise<{ gymId: string; entryId: string }[]> {
  if (q.gymIds.length === 0) return [];
  const rows = await sql<{ gym_id: string; entry_id: string }[]>`
    SELECT gym_id, entry_id FROM gym_square_customers
    WHERE environment = ${q.environment} AND account_id = ${q.accountId} AND customer_id = ${q.customerId} AND gym_id = ANY(${[...q.gymIds]}::uuid[])
    UNION
    SELECT gym_id, entry_id FROM gym_member_cards
    WHERE environment = ${q.environment} AND account_id = ${q.accountId} AND customer_id = ${q.customerId} AND gym_id = ANY(${[...q.gymIds]}::uuid[])
    ORDER BY gym_id, entry_id`;
  return rows.map((r) => ({ gymId: r.gym_id, entryId: r.entry_id }));
}

/** The bills a payment from this record could be for: the next one of each of its memberships and of
 *  the people it pays for (18i), and their unpaid fees. Takes the records' locks and writes what the
 *  clock has done first; the caller holds the gym's. */
export async function candidatesFor(tx: TransactionSql, gymId: string, entryId: string, today: string, now: Date): Promise<SquareAppCandidate[]> {
  const paidFor = await tx<{ entry_id: string }[]>`SELECT entry_id FROM gym_member_payers WHERE gym_id = ${gymId} AND payer_entry_id = ${entryId}`;
  const people = [entryId, ...paidFor.map((r) => r.entry_id)];
  await lockEntries(tx, gymId, people);
  const out: SquareAppCandidate[] = [];
  const since = addDays(today, -SQUARE_APP.twiceDays);
  for (const person of people) {
    const entry = await lockedEntry(tx, gymId, person);
    if (entry === null) continue;
    if (!entry.past) await settle(tx, gymId, person, today, now);
    const ids = (
      await tx<{ id: string }[]>`
        SELECT h.id FROM gym_held_memberships h
        WHERE h.gym_id = ${gymId} AND h.entry_id = ${person}
          AND (h.status IN ('active','frozen')
               OR EXISTS (SELECT 1 FROM gym_member_bills b WHERE b.gym_id = h.gym_id AND b.held_membership_id = h.id AND b.status = 'open'))
        ORDER BY h.id`
    ).map((r) => r.id);
    if (ids.length === 0) continue;
    const rows = await heldRowsOf(tx, gymId, ids);
    const bills = await billsFor(tx, gymId, ids);
    const payments = await paymentsFor(tx, gymId, ids);
    const fees = await tx<{ id: string; held_membership_id: string; amount_minor: number; due_on: string }[]>`
      SELECT id, held_membership_id, amount_minor, due_on::text AS due_on FROM gym_member_bills
      WHERE gym_id = ${gymId} AND held_membership_id = ANY(${ids}::uuid[]) AND fee IS NOT NULL AND status = 'open'
      ORDER BY due_on, id`;
    for (const id of ids) {
      const row = rows.get(id);
      if (row === undefined) continue;
      const busy = (await squareMoneyOut(tx, gymId, id)) !== null;
      const target = memberPayTarget(
        row.membership,
        row.nextBillMinor,
        today,
        bills.filter((b) => b.membershipId === id),
        entry.past,
      );
      if (target !== null) {
        out.push({
          entryId: person,
          target: { kind: "period", membershipId: id, periodIndex: target.periodIndex },
          leftMinor: target.leftMinor,
          dueOn: target.dueOn,
          paidJustBefore: payments.some((p) => p.membershipId === id && p.periodIndex === target.periodIndex - 1 && p.paidOn >= since),
          busy,
        });
      }
      for (const fee of fees.filter((f) => f.held_membership_id === id)) {
        out.push({ entryId: person, target: { kind: "fee", membershipId: id, billId: fee.id }, leftMinor: fee.amount_minor, dueOn: fee.due_on, paidJustBefore: false, busy });
      }
    }
  }
  return out;
}

export interface TakenPayment {
  environment: SquareEnvironment;
  accountId: string;
  squarePaymentId: string;
  gymId: string | null;
  locationId: string;
  customerId: string | null;
  amountMinor: number;
  tipMinor: number;
  currency: string;
  source: string | null;
  brand: string | null;
  last4: string | null;
  takenAt: Date;
  entryId: string | null;
  /** The part staff entered as an amount, where it can be told (18d-iii-b-ii-a). */
  enteredMinor: number | null;
  refundedMinor: number;
  /** What Square has of a customer linked to nobody here. */
  customer: CustomerSeen | null;
}

/** What Square has of the customer on a payment, as the row keeps it. */
export interface CustomerSeen {
  name: string | null;
  email: string | null;
  phone: string | null;
}

export type TakenState =
  | { state: "recorded"; memberPaymentId: string; recordKey: string }
  | { state: "waiting"; reason: SquareAppWaitReason }
  | { state: "shop_sale" };

const tag = (value: string | null, re: RegExp): string | null => (value !== null && re.test(value) ? value : null);

/** Keep it, once. False where it was kept already: the first one stands. */
export async function insertTaken(tx: TransactionSql, p: TakenPayment, s: TakenState, now: Date): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    INSERT INTO gym_square_app_payments
      (environment, account_id, square_payment_id, gym_id, location_id, customer_id, amount_minor, tip_minor, currency,
       source, brand, last4, taken_at, state, reason, entry_id, member_payment_id, record_key, entered_minor, refunded_minor,
       customer_name, customer_email, customer_phone, created_at, updated_at)
    VALUES (${p.environment}, ${p.accountId}, ${p.squarePaymentId}, ${p.gymId}, ${p.locationId}, ${p.customerId}, ${p.amountMinor}, ${p.tipMinor},
            ${p.currency}, ${tag(p.source, /^[A-Z_]{1,40}$/)}, ${tag(p.brand, /^[A-Z_]{1,40}$/)}, ${tag(p.last4, /^[0-9]{4}$/)}, ${p.takenAt},
            ${s.state}, ${s.state === "waiting" ? s.reason : null}, ${p.entryId}, ${s.state === "recorded" ? s.memberPaymentId : null},
            ${s.state === "recorded" ? s.recordKey : randomUUID()}, ${p.enteredMinor}, ${p.refundedMinor},
            ${p.customer?.name ?? null}, ${p.customer?.email ?? null}, ${p.customer?.phone ?? null}, ${now}, ${now})
    ON CONFLICT (environment, account_id, square_payment_id) DO NOTHING
    RETURNING id`;
  return rows.length === 1;
}

/** Staff took the payment off the bill it was on ("Not this bill"): it waits again, with a new key
 *  for when it is recorded next. Null where the payment is not one taken in Square's own app. */
export async function takenOffBill(tx: TransactionSql, gymId: string, memberPaymentId: string, now: Date): Promise<{ id: string } | null> {
  const [row] = await tx<{ id: string }[]>`
    UPDATE gym_square_app_payments
    SET state = 'waiting', reason = 'not_this_bill', member_payment_id = NULL, record_key = gen_random_uuid(), updated_at = ${now}
    WHERE gym_id = ${gymId} AND member_payment_id = ${memberPaymentId} AND state = 'recorded'
    RETURNING id`;
  return row ?? null;
}

// ── The hourly look ──────────────────────────────────────────────────────────

export const SWEEP = {
  everyMs: 60 * 60_000,
  /** Looked at again, so a payment Square shows some seconds late is not passed over. */
  overlapMs: 15 * 60_000,
  /** Square's list can be some seconds behind ("eventually consistent"). */
  settleMs: 60_000,
  leaseMs: 5 * 60_000,
  /** A look that stopped part-way goes on this soon. */
  againMs: 60_000,
  pagesPerLook: 10,
  perRun: 20,
} as const;

/** The payment a look stopped at, Square giving no answer about its order, and when it was first asked. */
export interface SweepStuck {
  paymentId: string;
  since: Date;
}

export interface SweepRow {
  gymId: string;
  environment: SquareEnvironment;
  accountId: string;
  locationId: string;
  watchingSince: Date;
  sweptUntil: Date;
  stuck: SweepStuck | null;
}

/** Every connected gym with a location is watched: a row for one that has none yet. */
export async function watchConnected(sql: Sql, environment: SquareEnvironment, now: Date, gymIds: readonly string[] | null): Promise<number> {
  const start = new Date(now.getTime() - SINCE_GRACE_MS);
  const rows = await sql<{ gym_id: string }[]>`
    INSERT INTO gym_square_payment_sweeps (gym_id, environment, account_id, location_id, watching_since, swept_until, due_at)
    SELECT c.gym_id, c.environment, c.account_id, c.location_id, ${start}, ${start}, ${new Date(now.getTime() + SWEEP.everyMs)}
    FROM gym_payment_connections c
    WHERE c.provider = 'square' AND c.environment = ${environment} AND c.state = 'connected' AND c.location_id IS NOT NULL
      AND (${gymIds === null}::boolean OR c.gym_id = ANY(${[...(gymIds ?? [])]}::uuid[]))
    ON CONFLICT (gym_id, environment) DO NOTHING
    RETURNING gym_id`;
  return rows.length;
}

/** The looks that are due, each held for `leaseMs`: a second worker skips them. */
export async function claimDueSweeps(sql: Sql, environment: SquareEnvironment, now: Date, gymIds: readonly string[] | null): Promise<SweepRow[]> {
  const rows = await sql<
    {
      gym_id: string;
      environment: SquareEnvironment;
      account_id: string;
      location_id: string;
      watching_since: Date;
      swept_until: Date;
      stuck_payment_id: string | null;
      stuck_since: Date | null;
    }[]
  >`
    WITH due AS (
      SELECT gym_id, environment FROM gym_square_payment_sweeps
      WHERE environment = ${environment} AND due_at <= ${now} AND (lease_until IS NULL OR lease_until <= ${now})
        AND (${gymIds === null}::boolean OR gym_id = ANY(${[...(gymIds ?? [])]}::uuid[]))
      ORDER BY due_at
      LIMIT ${SWEEP.perRun}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE gym_square_payment_sweeps s SET lease_until = ${new Date(now.getTime() + SWEEP.leaseMs)}
    FROM due WHERE s.gym_id = due.gym_id AND s.environment = due.environment
    RETURNING s.gym_id, s.environment, s.account_id, s.location_id, s.watching_since, s.swept_until, s.stuck_payment_id, s.stuck_since`;
  return rows.map((r) => ({
    gymId: r.gym_id,
    environment: r.environment,
    accountId: r.account_id,
    locationId: r.location_id,
    watchingSince: r.watching_since,
    sweptUntil: r.swept_until,
    stuck: r.stuck_payment_id === null || r.stuck_since === null ? null : { paymentId: r.stuck_payment_id, since: r.stuck_since },
  }));
}

/** The look is done up to `sweptUntil`; the next is due at `dueAt`; `stuck`, the payment it stopped at,
 *  if any. Only for the account and location it looked at: a connection moved meanwhile starts its own. */
export async function finishSweep(sql: SqlOrTx, s: SweepRow, sweptUntil: Date, dueAt: Date, stuck: SweepStuck | null = null): Promise<void> {
  await sql`
    UPDATE gym_square_payment_sweeps
    SET swept_until = GREATEST(swept_until, ${sweptUntil}), due_at = ${dueAt}, lease_until = NULL,
        stuck_payment_id = ${stuck?.paymentId ?? null}, stuck_since = ${stuck?.since ?? null}
    WHERE gym_id = ${s.gymId} AND environment = ${s.environment} AND account_id = ${s.accountId} AND location_id = ${s.locationId}`;
}
