// Pay what they owe in the app (ROADMAP 18k-ii-a): one row a member's press, while Square's own payment page is open and
// after. Every read for a screen names the gym; the worker's reads across gyms name the environment and hand each row back
// with its gym. A row is asked about by one request at a time (`checking_until`), and every change names the state it was
// read in, so two requests never both act on one answer. A page is written under the record's lock with the same rules a
// payment by hand takes (`recordPaymentIn`), so its amount is one the bill can take, and nothing else is paid, voided or
// changed on the membership while it is open (`squareMoneyOut`).
import { memberPayTarget, type AppPaymentState } from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import { insertAudit } from "../repo.js";
import { recordPaymentIn } from "../memberships/billsRepo.js";
import { billsFor, cardCharging, terminalWaiting } from "../memberships/billsSql.js";
import { lockedEntry, lockedHeld, settle } from "../memberships/heldRepo.js";
import { lockGym } from "../memberList/repo.js";
import type { SquareEnvironment } from "./square.js";

type SqlOrTx = Sql | TransactionSql;

export type AppPayOutcome = "paid" | "closed" | "not_recorded" | "gone" | "no_answer";

export interface AppPayRow {
  id: string;
  gymId: string;
  /** Null once the record was deleted for good. */
  entryId: string | null;
  membershipId: string;
  periodIndex: number;
  amountMinor: number;
  currency: string;
  environment: SquareEnvironment;
  accountId: string;
  locationId: string;
  requestKey: string;
  openedBy: string | null;
  openedAt: Date;
  closesAt: Date;
  linkId: string;
  orderId: string;
  url: string;
  state: "open" | "done";
  outcome: AppPayOutcome | null;
  closeWantedAt: Date | null;
  closeWantedBy: "member" | "staff" | "expired" | null;
  squarePaymentId: string | null;
  /** The payment's receipt, once it is on the bill. */
  receiptNumber: number | null;
  finishedAt: Date | null;
}

interface RawPay {
  id: string;
  gym_id: string;
  entry_id: string | null;
  held_membership_id: string;
  period_index: number;
  amount_minor: number;
  currency: string;
  environment: SquareEnvironment;
  account_id: string;
  location_id: string;
  request_key: string;
  opened_by: string | null;
  opened_at: Date;
  closes_at: Date;
  link_id: string;
  order_id: string;
  url: string;
  state: "open" | "done";
  outcome: string | null;
  close_wanted_at: Date | null;
  close_wanted_by: string | null;
  square_payment_id: string | null;
  receipt_number: number | null;
  finished_at: Date | null;
}

const OUTCOMES: readonly AppPayOutcome[] = ["paid", "closed", "not_recorded", "gone", "no_answer"];
const CLOSERS = ["member", "staff", "expired"] as const;

const toRow = (r: RawPay): AppPayRow => ({
  id: r.id,
  gymId: r.gym_id,
  entryId: r.entry_id,
  membershipId: r.held_membership_id,
  periodIndex: r.period_index,
  amountMinor: r.amount_minor,
  currency: r.currency,
  environment: r.environment,
  accountId: r.account_id,
  locationId: r.location_id,
  requestKey: r.request_key,
  openedBy: r.opened_by,
  openedAt: r.opened_at,
  closesAt: r.closes_at,
  linkId: r.link_id,
  orderId: r.order_id,
  url: r.url,
  state: r.state,
  // Our own columns under a CHECK: a value this build does not know is read as none.
  outcome: OUTCOMES.find((o) => o === r.outcome) ?? null,
  closeWantedAt: r.close_wanted_at,
  closeWantedBy: CLOSERS.find((c) => c === r.close_wanted_by) ?? null,
  squarePaymentId: r.square_payment_id,
  receiptNumber: r.receipt_number,
  finishedAt: r.finished_at,
});

const COLUMNS = (sql: SqlOrTx) =>
  sql`a.id, a.gym_id, a.entry_id, a.held_membership_id, a.period_index, a.amount_minor, a.currency, a.environment, a.account_id,
      a.location_id, a.request_key, a.opened_by, a.opened_at, a.closes_at, a.link_id, a.order_id, a.url, a.state, a.outcome,
      a.close_wanted_at, a.close_wanted_by, a.square_payment_id, a.finished_at,
      (SELECT p.receipt_number FROM gym_member_payments p WHERE p.gym_id = a.gym_id AND p.id = a.member_payment_id) AS receipt_number`;

/** Ended with money Square may have taken that is not on the bill: Square took another amount or the bill could not
 *  take it, the gym left that Square account while the page was open, or Square never said how it ended. */
export const CHECK_OUTCOMES: readonly AppPayOutcome[] = ["not_recorded", "gone", "no_answer"];

/** How a press reads to the member: `open` while the page can be paid; `paid` on the bill; `closed` with nothing paid;
 *  `check` where Square may have taken money that is not on the bill. */
export function stateOf(row: Pick<AppPayRow, "state" | "outcome">): AppPaymentState {
  if (row.state === "open") return "open";
  if (row.outcome === "paid") return "paid";
  return row.outcome !== null && CHECK_OUTCOMES.includes(row.outcome) ? "check" : "closed";
}

/** The press this key made, at this gym. */
export async function readByKey(sql: SqlOrTx, gymId: string, requestKey: string): Promise<AppPayRow | null> {
  const [row] = await sql<RawPay[]>`SELECT ${COLUMNS(sql)} FROM gym_app_payments a WHERE a.gym_id = ${gymId} AND a.request_key = ${requestKey}`;
  return row === undefined ? null : toRow(row);
}

/** One press, read for the account that made it. */
export async function readOwn(sql: SqlOrTx, gymId: string, userId: string, id: string): Promise<AppPayRow | null> {
  const [row] = await sql<RawPay[]>`SELECT ${COLUMNS(sql)} FROM gym_app_payments a WHERE a.gym_id = ${gymId} AND a.id = ${id} AND a.opened_by = ${userId}`;
  return row === undefined ? null : toRow(row);
}

/** The pages this account has open at the gym. */
export async function readOpenOf(sql: SqlOrTx, gymId: string, userId: string): Promise<AppPayRow[]> {
  const rows = await sql<RawPay[]>`
    SELECT ${COLUMNS(sql)} FROM gym_app_payments a WHERE a.gym_id = ${gymId} AND a.opened_by = ${userId} AND a.state = 'open' ORDER BY a.opened_at`;
  return rows.map(toRow);
}

/** The page open on each of these memberships, for staff on the person's page: who opened it (the name of the record
 *  their account holds at the gym), and when it closes. */
export async function openOnMemberships(
  sql: SqlOrTx,
  gymId: string,
  membershipIds: readonly string[],
): Promise<Map<string, { id: string; payerName: string | null; closesAt: Date }>> {
  const found = new Map<string, { id: string; payerName: string | null; closesAt: Date }>();
  if (membershipIds.length === 0) return found;
  const rows = await sql<{ id: string; held_membership_id: string; closes_at: Date; payer_name: string | null }[]>`
    SELECT a.id, a.held_membership_id, a.closes_at,
           (SELECT o.full_name FROM gym_members gm
            JOIN gym_member_list_entries o ON o.gym_id = gm.gym_id AND o.id = gm.entry_id
            WHERE gm.gym_id = a.gym_id AND gm.user_id = a.opened_by LIMIT 1) AS payer_name
    FROM gym_app_payments a
    WHERE a.gym_id = ${gymId} AND a.state = 'open' AND a.held_membership_id = ANY(${[...membershipIds]}::uuid[])`;
  for (const r of rows) found.set(r.held_membership_id, { id: r.id, payerName: r.payer_name === "" ? null : r.payer_name, closesAt: r.closes_at });
  return found;
}

/** The record holding a membership now (a join may have moved it); null once it has none. */
export async function holderOf(sql: SqlOrTx, gymId: string, membershipId: string): Promise<string | null> {
  const [row] = await sql<{ entry_id: string | null }[]>`SELECT entry_id FROM gym_held_memberships WHERE gym_id = ${gymId} AND id = ${membershipId}`;
  return row?.entry_id ?? null;
}

export interface Pressing {
  gymId: string;
  entryId: string;
  membershipId: string;
  periodIndex: number;
  amountMinor: number;
  /** The Square account's own money: a membership priced in another is not sent. */
  accountCurrency: string;
  today: string;
  now: Date;
}

export type PayableOutcome =
  | { kind: "ok"; currency: string; covers: { from: string; to: string } | null; name: string }
  /** Another page of this membership is open: the same bill's is answered instead of a second. */
  | { kind: "open"; row: AppPayRow }
  | { kind: "entry_not_found" | "membership_not_found" | "changed" | "currency" }
  /** What they owe: due today or before. Paying ahead is taken at the desk. */
  | { kind: "not_due" }
  /** Staff are taking a payment for the membership on the Terminal, or the card on file is being charged. */
  | { kind: "at_desk" };

/** Whether the bill can be paid in the app now, asked under the record's lock with the same rules as a payment by hand:
 *  the one bill a payment can be taken for, all that is left of it, nothing else on its way through Square. */
async function payableIn(tx: TransactionSql, s: Pressing): Promise<PayableOutcome> {
  const entry = await lockedEntry(tx, s.gymId, s.entryId);
  if (entry === null) return { kind: "entry_not_found" };
  if (!entry.past) await settle(tx, s.gymId, s.entryId, s.today, s.now);
  const row = await lockedHeld(tx, s.gymId, s.entryId, s.membershipId);
  if (row === null) return { kind: "membership_not_found" };
  const [open] = await tx<RawPay[]>`SELECT ${COLUMNS(tx)} FROM gym_app_payments a WHERE a.gym_id = ${s.gymId} AND a.held_membership_id = ${row.id} AND a.state = 'open'`;
  if (open !== undefined) return { kind: "open", row: toRow(open) };
  if ((await terminalWaiting(tx, s.gymId, row.id)) || (await cardCharging(tx, s.gymId, row.id))) return { kind: "at_desk" };
  const bills = await billsFor(tx, s.gymId, [row.id]);
  const target = memberPayTarget(row.membership, row.nextBillMinor, s.today, bills, entry.past);
  // All that is left of the bill the screen showed, never part of it, never another.
  if (target === null || target.periodIndex !== s.periodIndex || target.leftMinor !== s.amountMinor) return { kind: "changed" };
  if (target.dueOn > s.today) return { kind: "not_due" };
  if (row.currency !== s.accountCurrency) return { kind: "currency" };
  return { kind: "ok", currency: row.currency, covers: target.covers, name: row.typeName };
}

/** The check before Square is asked to make the page: nothing is written. */
export async function payable(sql: Sql, s: Pressing): Promise<PayableOutcome> {
  return await sql.begin(async (tx) => await payableIn(tx, s));
}

export interface NewAppPay extends Pressing {
  id: string;
  environment: SquareEnvironment;
  accountId: string;
  locationId: string;
  requestKey: string;
  openedBy: string;
  closesAt: Date;
  linkKey: string;
  linkId: string;
  orderId: string;
  url: string;
}

export type OpenOutcome = { kind: "new"; row: AppPayRow } | Exclude<PayableOutcome, { kind: "ok" }> | { kind: "key_reused"; row: AppPayRow };

/** The page Square made, written once the same check passes again under the record's lock: anything that changed
 *  meanwhile refuses it, and the caller deletes the page at Square. */
export async function writeOpen(sql: Sql, s: NewAppPay): Promise<OpenOutcome> {
  return await sql.begin(async (tx): Promise<OpenOutcome> => {
    const check = await payableIn(tx, s);
    if (check.kind !== "ok") return check;
    const [same] = await tx<RawPay[]>`SELECT ${COLUMNS(tx)} FROM gym_app_payments a WHERE a.gym_id = ${s.gymId} AND a.request_key = ${s.requestKey}`;
    if (same !== undefined) return { kind: "key_reused", row: toRow(same) };
    await tx`
      INSERT INTO gym_app_payments (id, gym_id, entry_id, held_membership_id, period_index, amount_minor, currency, environment, account_id,
                                    location_id, request_key, opened_by, opened_at, closes_at, link_key, link_id, order_id, url, state, checked_at)
      VALUES (${s.id}, ${s.gymId}, ${s.entryId}, ${s.membershipId}, ${s.periodIndex}, ${s.amountMinor}, ${check.currency}, ${s.environment},
              ${s.accountId}, ${s.locationId}, ${s.requestKey}, ${s.openedBy}, ${s.now}, ${s.closesAt}, ${s.linkKey}, ${s.linkId}, ${s.orderId},
              ${s.url}, 'open', ${s.now})`;
    const [written] = await tx<RawPay[]>`SELECT ${COLUMNS(tx)} FROM gym_app_payments a WHERE a.gym_id = ${s.gymId} AND a.id = ${s.id}`;
    if (written === undefined) throw new Error("a payment page just written was not read back");
    return { kind: "new", row: toRow(written) };
  });
}

/** Whether any member's page is open at this gym in this Square environment, read under the connection's lock. */
export async function anyOpenIn(tx: TransactionSql, gymId: string, environment: SquareEnvironment): Promise<boolean> {
  const [row] = await tx<{ id: string }[]>`SELECT id FROM gym_app_payments WHERE gym_id = ${gymId} AND environment = ${environment} AND state = 'open' LIMIT 1`;
  return row !== undefined;
}

/** Held for asking Square until `until`; null while another request asks, or once it is not open. */
export async function claim(sql: SqlOrTx, gymId: string, id: string, now: Date, until: Date): Promise<AppPayRow | null> {
  const [row] = await sql<RawPay[]>`
    UPDATE gym_app_payments a SET checking_until = ${until}, checked_at = ${now}
    WHERE a.id = ${id} AND a.gym_id = ${gymId} AND a.state = 'open' AND (a.checking_until IS NULL OR a.checking_until <= ${now})
    RETURNING ${COLUMNS(sql)}`;
  return row === undefined ? null : toRow(row);
}

/** Pages nobody has asked about for `idleMs`, for the worker. */
export async function claimIdle(
  sql: Sql,
  environment: SquareEnvironment,
  now: Date,
  idleMs: number,
  until: Date,
  limit: number,
  gymIds: readonly string[] | null,
): Promise<AppPayRow[]> {
  const rows = await sql<RawPay[]>`
    WITH due AS (
      SELECT id FROM gym_app_payments
      WHERE environment = ${environment} AND state = 'open'
        AND checked_at <= ${new Date(now.getTime() - idleMs)}
        AND (checking_until IS NULL OR checking_until <= ${now})
        AND (${gymIds === null}::boolean OR gym_id = ANY(${[...(gymIds ?? [])]}::uuid[]))
      ORDER BY checked_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE gym_app_payments a SET checking_until = ${until}, checked_at = ${now}
    WHERE a.id IN (SELECT id FROM due)
    RETURNING ${COLUMNS(sql)}`;
  return rows.map(toRow);
}

/** Let go of it, while this request still holds it. */
export async function release(sql: SqlOrTx, gymId: string, id: string, until: Date): Promise<void> {
  await sql`UPDATE gym_app_payments SET checking_until = NULL WHERE gym_id = ${gymId} AND id = ${id} AND checking_until = ${until}`;
}

/** Somebody asked for it closed: kept, so whichever request asks Square next deletes the page first. The first reason
 *  stands. False when it is not open. */
export async function wantClose(sql: SqlOrTx, gymId: string, id: string, by: "member" | "staff" | "expired", staffUserId: string | null, now: Date): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE gym_app_payments SET close_wanted_at = COALESCE(close_wanted_at, ${now}), close_wanted_by = COALESCE(close_wanted_by, ${by}),
           closed_by_staff = COALESCE(closed_by_staff, ${staffUserId})
    WHERE id = ${id} AND gym_id = ${gymId} AND state = 'open'
    RETURNING id`;
  return rows.length === 1;
}

/** Staff pressed Close payment page: asked for it closed, and told to the gym's Staff activity. False when it is not open. */
export async function staffClose(sql: Sql, s: { gymId: string; id: string; entryId: string; membershipId: string; staffUserId: string; now: Date }): Promise<boolean> {
  return await sql.begin(async (tx) => {
    if (!(await wantClose(tx, s.gymId, s.id, "staff", s.staffUserId, s.now))) return false;
    await insertAudit(tx, {
      actorUserId: s.staffUserId,
      gymId: s.gymId,
      action: "org.app_payment_closed",
      targetType: "gym_app_payment",
      targetId: s.id,
      meta: { entryId: s.entryId, membershipId: s.membershipId },
    });
    return true;
  });
}

/** Ended with no money recorded. False when it was not open any more. */
export async function finish(sql: SqlOrTx, gymId: string, id: string, outcome: "closed" | "gone" | "no_answer", at: Date): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE gym_app_payments SET state = 'done', outcome = ${outcome}, finished_at = ${at}, checking_until = NULL
    WHERE gym_id = ${gymId} AND id = ${id} AND state = 'open'
    RETURNING id`;
  return rows.length === 1;
}

/** Square took the money: recorded on the bill as In the app, in the same transaction that marks the page paid, on
 *  whichever record holds the membership now; or, where Square took another amount than asked or the bill can no
 *  longer take it, kept as not recorded with Square's payment. Null when another request finished it first. */
export async function recordPaid(
  sql: Sql,
  p: { row: AppPayRow; squarePaymentId: string; card: { brand: string; last4: string } | null; taken: number | null; today: string; now: Date; refuse?: string },
): Promise<{ outcome: "paid" | "not_recorded" } | null> {
  const { row } = p;
  return await sql.begin(async (tx) => {
    // The gym's lock first, then the record's, then the page: the order a payment by hand takes.
    await lockGym(tx, row.gymId);
    const holder = await holderOf(tx, row.gymId, row.membershipId);
    if (holder !== null) await lockedEntry(tx, row.gymId, holder);
    const [still] = await tx<{ id: string }[]>`SELECT id FROM gym_app_payments WHERE gym_id = ${row.gymId} AND id = ${row.id} AND state = 'open' FOR UPDATE`;
    if (still === undefined) return null;
    const done =
      holder === null || p.refuse !== undefined
        ? null
        : await recordPaymentIn(tx, {
            gymId: row.gymId,
            entryId: holder,
            membershipId: row.membershipId,
            // The page itself is the payment's key: the same page recorded twice is one payment.
            requestKey: row.id,
            periodIndex: row.periodIndex,
            amountMinor: row.amountMinor,
            method: "app",
            provider: { name: "square", paymentId: p.squarePaymentId },
            today: p.today,
            // No member of staff recorded it: the member paid (`member.app_payment_paid` below).
            actorUserId: null,
            now: p.now,
          });
    if (done?.kind === "recorded") {
      await tx`
        UPDATE gym_app_payments SET state = 'done', outcome = 'paid', square_payment_id = ${p.squarePaymentId}, member_payment_id = ${done.paymentId},
               card_brand = ${p.card?.brand ?? null}, card_last4 = ${p.card?.last4 ?? null}, taken_minor = ${p.taken}, entry_id = ${holder}, finished_at = ${p.now}, checking_until = NULL
        WHERE gym_id = ${row.gymId} AND id = ${row.id}`;
      await insertAudit(tx, {
        actorUserId: row.openedBy,
        gymId: row.gymId,
        action: "member.app_payment_paid",
        targetType: "gym_member_payment",
        targetId: done.paymentId,
        meta: { ...(holder === null ? {} : { entryId: holder }), membershipId: row.membershipId, amountMinor: String(row.amountMinor), currency: row.currency },
      });
      return { outcome: "paid" as const };
    }
    await tx`
      UPDATE gym_app_payments SET state = 'done', outcome = 'not_recorded', square_payment_id = ${p.squarePaymentId},
             card_brand = ${p.card?.brand ?? null}, card_last4 = ${p.card?.last4 ?? null}, taken_minor = ${p.taken}, finished_at = ${p.now}, checking_until = NULL
      WHERE gym_id = ${row.gymId} AND id = ${row.id}`;
    await insertAudit(tx, {
      actorUserId: row.openedBy,
      gymId: row.gymId,
      action: "member.app_payment_not_recorded",
      targetType: "gym_app_payment",
      targetId: row.id,
      meta: {
        ...(holder === null ? {} : { entryId: holder }),
        membershipId: row.membershipId,
        amountMinor: String(row.amountMinor),
        currency: row.currency,
        why: p.refuse ?? done?.kind ?? "membership_not_found",
      },
    });
    return { outcome: "not_recorded" as const };
  });
}

/** Closed ones are kept a day, for the phone that asks how one ended; paid ones keep the card they name, and one Square
 *  took money for but could not be recorded, or never answered about, is kept. */
export async function forgetDone(sql: Sql, before: Date, gymIds: readonly string[] | null): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    DELETE FROM gym_app_payments
    WHERE finished_at IS NOT NULL AND finished_at < ${before} AND outcome = 'closed'
      AND (${gymIds === null}::boolean OR gym_id = ANY(${[...(gymIds ?? [])]}::uuid[]))
    RETURNING id`;
  return rows.length;
}

/** How a page ended, read afresh: null while it is open, or where there is no such page at the gym. */
export async function outcomeOf(sql: SqlOrTx, gymId: string, id: string): Promise<AppPayOutcome | null> {
  const [row] = await sql<{ outcome: string | null }[]>`SELECT outcome FROM gym_app_payments WHERE gym_id = ${gymId} AND id = ${id}`;
  return OUTCOMES.find((o) => o === row?.outcome) ?? null;
}

export interface AppCheckRow {
  periodIndex: number;
  /** What Square took, where it named it in the page's money; null where that is not known. */
  amountMinor: number | null;
  /** The day it ended, on the gym's calendar. */
  on: string;
  why: "taken" | "unknown";
  payerName: string | null;
}

/** For each of these memberships, the newest page that ended needing a check (`CHECK_OUTCOMES`), what Square took where it
 *  is known, and who opened it. The caller shows it while that bill is the one owed. */
export async function checksOnMemberships(sql: SqlOrTx, gymId: string, membershipIds: readonly string[]): Promise<Map<string, AppCheckRow>> {
  const found = new Map<string, AppCheckRow>();
  if (membershipIds.length === 0) return found;
  const rows = await sql<{ held_membership_id: string; period_index: number; taken_minor: number | null; on: string; outcome: string; payer_name: string | null }[]>`
    SELECT DISTINCT ON (a.held_membership_id) a.held_membership_id, a.period_index, a.taken_minor, a.outcome,
           ((a.finished_at AT TIME ZONE g.timezone)::date)::text AS on,
           (SELECT o.full_name FROM gym_members gm
            JOIN gym_member_list_entries o ON o.gym_id = gm.gym_id AND o.id = gm.entry_id
            WHERE gm.gym_id = a.gym_id AND gm.user_id = a.opened_by LIMIT 1) AS payer_name
    FROM gym_app_payments a
    JOIN gyms g ON g.id = a.gym_id
    WHERE a.gym_id = ${gymId} AND a.state = 'done' AND a.outcome IN ('not_recorded','gone','no_answer')
      AND a.held_membership_id = ANY(${[...membershipIds]}::uuid[])
    ORDER BY a.held_membership_id, a.finished_at DESC`;
  for (const r of rows) {
    found.set(r.held_membership_id, {
      periodIndex: r.period_index,
      amountMinor: r.outcome === "not_recorded" ? r.taken_minor : null,
      on: r.on,
      why: r.outcome === "not_recorded" ? "taken" : "unknown",
      payerName: r.payer_name === "" ? null : r.payer_name,
    });
  }
  return found;
}

/** Whether a page is open on any membership these records hold: Delete permanently waits for it, as what Square took would
 *  have no bill to go on. */
export async function anyOpenOfEntries(tx: TransactionSql, gymId: string, entryIds: readonly string[]): Promise<boolean> {
  if (entryIds.length === 0) return false;
  const [row] = await tx<{ id: string }[]>`
    SELECT a.id FROM gym_app_payments a
    JOIN gym_held_memberships h ON h.gym_id = a.gym_id AND h.id = a.held_membership_id
    WHERE a.gym_id = ${gymId} AND a.state = 'open' AND h.entry_id = ANY(${[...entryIds]}::uuid[]) LIMIT 1`;
  return row !== undefined;
}

/** The card each of these payments was paid with in the app, for the person's page. */
export async function cardsOfPayments(sql: SqlOrTx, gymId: string, paymentIds: readonly string[]): Promise<Map<string, { brand: string; last4: string }>> {
  const found = new Map<string, { brand: string; last4: string }>();
  if (paymentIds.length === 0) return found;
  const rows = await sql<{ member_payment_id: string; card_brand: string; card_last4: string }[]>`
    SELECT member_payment_id, card_brand, card_last4 FROM gym_app_payments
    WHERE gym_id = ${gymId} AND member_payment_id = ANY(${[...paymentIds]}::uuid[]) AND card_brand IS NOT NULL AND card_last4 IS NOT NULL`;
  for (const r of rows) found.set(r.member_payment_id, { brand: r.card_brand, last4: r.card_last4 });
  return found;
}
