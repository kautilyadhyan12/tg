// The emails telling a cardholder a payment did not go through (18d-iii-ii-a): one a period of a
// membership or one a fee, queued with its first decline (`cardChargesRepo.ts`, `afterDecline`). The worker leases one row at a
// time and names its lease in every write that finishes it, as the staff invitations' queue does
// (`staffInvites/sendRepo.ts`). The address is cleared in the statement that finishes a row.
import type { Sql, TransactionSql } from "postgres";
import { pendingRetries } from "./cardChargesRepo.js";

type SqlOrTx = Sql | TransactionSql;

export interface ClaimedNotice {
  id: string;
  gymId: string;
  membershipId: string;
  /** The period it is about, or null for a fee. */
  periodIndex: number | null;
  /** The fee it is about, or null for a period. */
  billId: string | null;
  chargeId: string;
  email: string | null;
  attempts: number;
  maybeSentAt: Date | null;
  createdAt: Date;
}

/** Take the next email that is due, and lease it. One that may already have gone is taken first: it
 *  is the same email again. These are owed to the cardholder (Visa), so no daily cap holds them. */
export async function claimNextNotice(sql: Sql, q: { now: Date; leaseMs: number; gymIds: readonly string[] | null }): Promise<ClaimedNotice | null> {
  const rows = await sql<
    { id: string; gym_id: string; held_membership_id: string; period_index: number | null; bill_id: string | null; charge_id: string; email: string | null; attempts: number; maybe_sent_at: Date | null; created_at: Date }[]
  >`
    WITH next AS (
      SELECT n.id FROM gym_card_decline_notices n
      WHERE ((n.state = 'queued' AND n.not_before <= ${q.now}) OR (n.state = 'sending' AND n.lease_until < ${q.now}))
        AND (${q.gymIds === null}::boolean OR n.gym_id = ANY(${[...(q.gymIds ?? [])]}::uuid[]))
      ORDER BY (n.maybe_sent_at IS NULL), n.not_before, n.id
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE gym_card_decline_notices u
    SET state = 'sending', lease_until = ${new Date(q.now.getTime() + q.leaseMs)}, attempts = u.attempts + 1
    FROM next
    WHERE u.id = next.id
    RETURNING u.id, u.gym_id, u.held_membership_id, u.period_index, u.bill_id, u.charge_id, u.email::text AS email, u.attempts, u.maybe_sent_at, u.created_at`;
  const row = rows[0];
  return row === undefined
    ? null
    : {
        id: row.id,
        gymId: row.gym_id,
        membershipId: row.held_membership_id,
        periodIndex: row.period_index,
        billId: row.bill_id,
        chargeId: row.charge_id,
        email: row.email,
        attempts: row.attempts,
        maybeSentAt: row.maybe_sent_at,
        createdAt: row.created_at,
      };
}

/** Still owed: a fee's bill open, or a period whose bill is open or not yet written (a press paying
 *  ahead). Paid, cancelled or gone, and nothing is sent. Alias `s` is the notice. */
const stillOwed = (sql: SqlOrTx) => sql`
      ((s.bill_id IS NOT NULL AND EXISTS (SELECT 1 FROM gym_member_bills b WHERE b.gym_id = s.gym_id AND b.id = s.bill_id AND b.status = 'open'))
       OR (s.period_index IS NOT NULL
           AND EXISTS (SELECT 1 FROM gym_held_memberships h WHERE h.gym_id = s.gym_id AND h.id = s.held_membership_id)
           AND NOT EXISTS (SELECT 1 FROM gym_member_bills b
                           WHERE b.gym_id = s.gym_id AND b.held_membership_id = s.held_membership_id AND b.fee IS NULL
                             AND b.period_index = s.period_index AND b.status <> 'open')))`;

/** The bill the notice is about now: the fee's, or the period's once it is written. */
async function billNow(sql: SqlOrTx, n: ClaimedNotice): Promise<{ id: string; fee: string | null } | null> {
  const [bill] = await sql<{ id: string; fee: string | null }[]>`
    SELECT id, fee FROM gym_member_bills
    WHERE gym_id = ${n.gymId} AND status = 'open'
      AND (id = ${n.billId} OR (${n.billId}::uuid IS NULL AND held_membership_id = ${n.membershipId} AND fee IS NULL AND period_index = ${n.periodIndex}))
    LIMIT 1`;
  return bill ?? null;
}

/** What the email says and whether it still goes, read now. */
export interface NoticeFacts {
  /** The cardholder's record was joined away or deleted for good since: nothing is sent. */
  recordGone: boolean;
  gym: { name: string; active: boolean; timezone: string; country: string | null; contactEmail: string | null; contactPhone: string | null } | null;
  /** Null once the bill is paid, cancelled or gone: nothing is owed, so nothing is sent. */
  bill: { fee: string | null } | null;
  charge: {
    amountMinor: number;
    currency: string;
    brand: string;
    last4: string;
    code: string | null;
    /** The gym's own day it was declined on. */
    on: string;
    nextTryOn: string | null;
    /** The bill was charged again since (a try the email can no longer speak for). */
    newer: boolean;
    /** The cardholder's name, and the person the membership is for where somebody else pays. */
    holderName: string | null;
    forName: string | null;
  } | null;
}

export async function noticeFacts(sql: SqlOrTx, n: ClaimedNotice, now: Date): Promise<NoticeFacts> {
  const [row] = await sql<{ gone: boolean }[]>`SELECT entry_id IS NULL AS gone FROM gym_card_decline_notices WHERE gym_id = ${n.gymId} AND id = ${n.id}`;
  const [gym] = await sql<{ name: string; status: string; timezone: string; country: string | null; contact_email: string | null; contact_phone: string | null }[]>`
    SELECT name, status, timezone, country, contact_email, contact_phone FROM gyms WHERE id = ${n.gymId}`;
  const [owed] = await sql<{ owed: boolean }[]>`SELECT ${stillOwed(sql)} AS owed FROM gym_card_decline_notices s WHERE s.gym_id = ${n.gymId} AND s.id = ${n.id}`;
  const bill = owed?.owed === true ? await billNow(sql, n) : null;
  // The day the worker will try it again, by its own rule; none while the bill is not yet written.
  const next = bill === null ? new Map<string, string>() : await pendingRetries(sql, n.gymId, [bill.id], now);
  const [charge] = await sql<{ amount_minor: number; currency: string; brand: string; last4: string; decline_code: string | null; on: string; newer: boolean; holder_name: string | null; for_name: string | null }[]>`
    SELECT c.amount_minor, c.currency, c.brand, c.last4, c.decline_code,
           (c.started_at AT TIME ZONE g.timezone)::date::text AS on,
           EXISTS (SELECT 1 FROM gym_card_charges x
                   WHERE x.gym_id = c.gym_id AND x.held_membership_id = c.held_membership_id AND x.started_at > c.started_at
                     AND (x.bill_id = c.bill_id OR (x.period_index IS NOT DISTINCT FROM c.period_index AND c.period_index IS NOT NULL))) AS newer,
           (SELECT e.full_name FROM gym_member_list_entries e WHERE e.gym_id = c.gym_id AND e.id = COALESCE(c.payer_entry_id, c.entry_id)) AS holder_name,
           CASE WHEN c.payer_entry_id IS NOT NULL AND c.payer_entry_id IS DISTINCT FROM c.entry_id
                THEN (SELECT e.full_name FROM gym_member_list_entries e WHERE e.gym_id = c.gym_id AND e.id = c.entry_id) END AS for_name
    FROM gym_card_charges c
    JOIN gyms g ON g.id = c.gym_id
    WHERE c.gym_id = ${n.gymId} AND c.id = ${n.chargeId}`;
  return {
    recordGone: row?.gone ?? true,
    gym:
      gym === undefined
        ? null
        : { name: gym.name, active: gym.status === "active", timezone: gym.timezone, country: gym.country, contactEmail: gym.contact_email, contactPhone: gym.contact_phone },
    // Owed with no bill yet (a press paying ahead): a membership payment.
    bill: owed?.owed === true ? { fee: bill?.fee ?? null } : null,
    charge:
      charge === undefined
        ? null
        : {
            amountMinor: charge.amount_minor,
            currency: charge.currency,
            brand: charge.brand,
            last4: charge.last4,
            code: charge.decline_code,
            on: charge.on,
            nextTryOn: bill === null ? null : (next.get(bill.id) ?? null),
            newer: charge.newer,
            holderName: charge.holder_name,
            forName: charge.for_name,
          },
  };
}

/** Record, before the email is handed to Resend, that from now on it may have gone. False when the
 *  claim is no longer this run's, the bill is no longer owed, the cardholder's record is gone, or the
 *  address bounced or was refused anywhere: then nothing may be sent. One statement, so a payment
 *  committed before it is seen. */
export async function markMaybeSent(sql: SqlOrTx, n: ClaimedNotice, hmac: string, at: Date): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE gym_card_decline_notices s SET maybe_sent_at = coalesce(s.maybe_sent_at, ${at})
    WHERE s.id = ${n.id} AND s.gym_id = ${n.gymId} AND s.state = 'sending' AND s.attempts = ${n.attempts} AND s.entry_id IS NOT NULL
      AND ${stillOwed(sql)}
      AND NOT EXISTS (SELECT 1 FROM email_suppressions x WHERE x.email_hmac = ${hmac} AND x.gym_id IS NULL)
    RETURNING s.id`;
  return rows.length === 1;
}

export type NoticeOutcome = { kind: "sent"; providerId: string | null } | { kind: "skipped" | "failed"; reason: string };

/** Finish a claimed email; the address is cleared in the same statement. False when the claim was
 *  no longer this run's. */
export async function finishNotice(sql: SqlOrTx, n: ClaimedNotice, outcome: NoticeOutcome, at: Date): Promise<boolean> {
  const reason = outcome.kind === "sent" ? null : outcome.reason;
  const providerId = outcome.kind === "sent" ? outcome.providerId : null;
  const rows = await sql<{ id: string }[]>`
    UPDATE gym_card_decline_notices
    SET state = ${outcome.kind}, reason = ${reason}, provider_id = ${providerId}, email = NULL, lease_until = NULL, finished_at = ${at}
    WHERE id = ${n.id} AND gym_id = ${n.gymId} AND state = 'sending' AND attempts = ${n.attempts}
    RETURNING id`;
  return rows.length === 1;
}

/** Put a claimed email back to wait until `notBefore`. */
export async function retryNotice(sql: SqlOrTx, n: ClaimedNotice, notBefore: Date): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE gym_card_decline_notices SET state = 'queued', lease_until = NULL, not_before = ${notBefore}
    WHERE id = ${n.id} AND gym_id = ${n.gymId} AND state = 'sending' AND attempts = ${n.attempts}
    RETURNING id`;
  return rows.length === 1;
}
