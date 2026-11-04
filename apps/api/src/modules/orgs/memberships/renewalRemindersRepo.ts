// The emails reminding whoever pays for a membership that it renews soon, or that its minimum term ends soon
// (18v-iv). The rule is `renewalReminderNext` in `@app/shared`; this file reads what it needs and keeps the
// queue. The worker leases one row at a time and names its lease in every write that finishes it, as the card
// expiry queue does (`cardExpiryRepo.ts`). The address is cleared in the statement that finishes a row.
import { periodListedMinor, RENEWAL_REMINDER_FROM_HOUR, type RenewalReminderSetting, type RenewalReminderWhat } from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import { renewalReminderOf } from "./repo.js";
import { billOf } from "./billsSql.js";
import { heldRowsOf, type HeldRow } from "./heldRepo.js";
import { autopayPaused } from "../payments/autopayRepo.js";
import { chargebackStops } from "../payments/chargebacksRepo.js";

type SqlOrTx = Sql | TransactionSql;

/** The gyms whose reminders are to be looked for now: open, past 8 in the morning on their own clock, not yet
 *  looked at today, with a line that asks for one. */
export async function gymsToCheck(sql: SqlOrTx, q: { now: Date; gymIds: readonly string[] | null }): Promise<{ gymId: string; today: string }[]> {
  const rows = await sql<{ id: string; today: string }[]>`
    SELECT g.id, ((${q.now}::timestamptz AT TIME ZONE g.timezone)::date)::text AS today
    FROM gyms g
    WHERE g.status = 'active'
      AND extract(hour FROM ${q.now}::timestamptz AT TIME ZONE g.timezone) >= ${RENEWAL_REMINDER_FROM_HOUR}
      AND (g.renewal_reminders_checked_on IS NULL OR g.renewal_reminders_checked_on < (${q.now}::timestamptz AT TIME ZONE g.timezone)::date)
      AND EXISTS (SELECT 1 FROM gym_membership_types t WHERE t.gym_id = g.id AND t.renewal_reminder IS NOT NULL)
      AND (${q.gymIds === null}::boolean OR g.id = ANY(${[...(q.gymIds ?? [])]}::uuid[]))
    ORDER BY g.id`;
  return rows.map((r) => ({ gymId: r.id, today: r.today }));
}

/** The gym's day the reminders were looked for; a gym looked at again the same day is not marked twice. */
export async function markChecked(sql: SqlOrTx, gymId: string, today: string): Promise<void> {
  await sql`UPDATE gyms SET renewal_reminders_checked_on = ${today}::date WHERE id = ${gymId}`;
}

/** One membership whose line asks for a reminder, with whoever pays for it. */
export interface RemindedHeld {
  row: HeldRow;
  setting: RenewalReminderSetting;
  /** The record holding it. */
  entryId: string;
  holderName: string;
  /** Whoever pays for it: the record of its payer, or its own. */
  payerEntryId: string;
  payerName: string;
  payerEmail: string | null;
  /** Its payer's record is a past member's, or it is the gym's own list's and was never paid for here. */
  skipped: "former_payer" | "billed_elsewhere" | null;
}

/** The memberships in use, of the gym's current records, whose line asks for a reminder; or of one line, or
 *  one membership. Each with whoever pays for it (18i) and the address on that record now. */
export async function remindedHeld(
  sql: SqlOrTx,
  q: { gymId: string; typeId?: string; heldId?: string; entryId?: string; setting?: RenewalReminderSetting },
): Promise<RemindedHeld[]> {
  const asked = q.setting !== undefined;
  const rows = await sql<
    {
      id: string;
      entry_id: string;
      holder_name: string | null;
      renewal_reminder: string | null;
      renewal_reminder_days: number | null;
      payer_entry_id: string;
      payer_name: string | null;
      payer_email: string | null;
      payer_former: boolean;
      billed_elsewhere: boolean;
    }[]
  >`
    SELECT h.id, h.entry_id, e.full_name AS holder_name, t.renewal_reminder, t.renewal_reminder_days,
           pe.id AS payer_entry_id, pe.full_name AS payer_name, pe.email::text AS payer_email, (pe.former_at IS NOT NULL) AS payer_former,
           -- One taken from the gym's own list is billed here only once a payment for it was recorded here.
           (h.from_list AND NOT EXISTS (
              SELECT 1 FROM gym_member_bills b JOIN gym_member_payments p ON p.gym_id = b.gym_id AND p.bill_id = b.id AND p.undone_at IS NULL
              WHERE b.gym_id = h.gym_id AND b.held_membership_id = h.id)) AS billed_elsewhere
    FROM gym_held_memberships h
    JOIN gym_membership_types t ON t.gym_id = h.gym_id AND t.id = h.membership_type_id
    JOIN gym_member_list_entries e ON e.gym_id = h.gym_id AND e.id = h.entry_id AND e.former_at IS NULL
    JOIN gym_member_list_entries pe ON pe.gym_id = h.gym_id
      AND pe.id = COALESCE((SELECT x.payer_entry_id FROM gym_member_payers x WHERE x.gym_id = h.gym_id AND x.entry_id = h.entry_id), h.entry_id)
    WHERE h.gym_id = ${q.gymId} AND h.status IN ('active','frozen') AND h.kind = 'recurring' AND (${asked}::boolean OR t.renewal_reminder IS NOT NULL)
      AND (${q.typeId ?? null}::uuid IS NULL OR t.id = ${q.typeId ?? null}::uuid)
      AND (${q.heldId ?? null}::uuid IS NULL OR h.id = ${q.heldId ?? null}::uuid)
      AND (${q.entryId ?? null}::uuid IS NULL OR h.entry_id = ${q.entryId ?? null}::uuid)
    ORDER BY e.full_name, h.id`;
  const held = await heldRowsOf(
    sql,
    q.gymId,
    rows.map((r) => r.id),
  );
  return rows.flatMap((r) => {
    const row = held.get(r.id);
    const setting = q.setting ?? renewalReminderOf(r.renewal_reminder, r.renewal_reminder_days);
    if (row === undefined || setting === null) return [];
    return [
      {
        row,
        setting,
        entryId: r.entry_id,
        holderName: r.holder_name ?? "",
        payerEntryId: r.payer_entry_id,
        payerName: r.payer_name ?? "",
        payerEmail: r.payer_email,
        skipped: r.payer_former ? "former_payer" : r.billed_elsewhere ? "billed_elsewhere" : null,
      },
    ];
  });
}

/** What the renewal (or the first payment after a minimum term) comes to: its period's price, its tax in. */
export function renewalAmountMinor(row: HeldRow, periodIndex: number): number {
  return billOf(periodListedMinor(row.membership, periodIndex, row.priceMinor), row.taxApplied).amountMinor;
}

export interface QueuedReminder {
  gymId: string;
  heldId: string;
  entryId: string;
  occasion: string;
  what: RenewalReminderWhat;
  aboutOn: string;
  email: string;
}

/** Write these reminders, once a membership and occasion. Safe to run twice at once. Answers how many were written. */
export async function queueReminders(sql: SqlOrTx, rows: readonly QueuedReminder[], now: Date): Promise<number> {
  if (rows.length === 0) return 0;
  const written = await sql<{ id: string }[]>`
    INSERT INTO gym_renewal_reminders (gym_id, held_membership_id, entry_id, occasion, what, about_on, email, state, not_before, created_at)
    SELECT r.gym_id, r.held_id, r.entry_id, r.occasion, r.what, r.about_on, r.email, 'queued', ${now}, ${now}
    FROM unnest(
      ${rows.map((r) => r.gymId)}::uuid[], ${rows.map((r) => r.heldId)}::uuid[], ${rows.map((r) => r.entryId)}::uuid[],
      ${rows.map((r) => r.occasion)}::text[], ${rows.map((r) => r.what)}::text[], ${rows.map((r) => r.aboutOn)}::date[], ${rows.map((r) => r.email)}::citext[]
    ) AS r(gym_id, held_id, entry_id, occasion, what, about_on, email)
    ON CONFLICT (gym_id, held_membership_id, occasion) DO NOTHING
    RETURNING id`;
  return written.length;
}

export type ReminderState = "queued" | "sending" | "sent" | "skipped" | "failed";

/** A reminder written: its occasion, state, the gym's day it was sent, and why it was not. */
export interface ReminderWritten {
  heldId: string;
  occasion: string;
  state: ReminderState;
  on: string | null;
  reason: string | null;
}

/** The reminders written for these memberships, each with the gym's day it was sent. */
export async function remindersOf(sql: SqlOrTx, gymId: string, heldIds: readonly string[]): Promise<ReminderWritten[]> {
  if (heldIds.length === 0) return [];
  const rows = await sql<{ held_membership_id: string; occasion: string; state: ReminderState; reason: string | null; on: string | null }[]>`
    SELECT n.held_membership_id, n.occasion, n.state, n.reason,
           CASE WHEN n.state = 'sent' THEN ((n.finished_at AT TIME ZONE g.timezone)::date)::text END AS on
    FROM gym_renewal_reminders n JOIN gyms g ON g.id = n.gym_id
    WHERE n.gym_id = ${gymId} AND n.held_membership_id = ANY(${[...heldIds]}::uuid[])`;
  return rows.map((r) => ({ heldId: r.held_membership_id, occasion: r.occasion, state: r.state, on: r.on, reason: r.reason }));
}

/** The gym's day now. */
export async function gymToday(sql: SqlOrTx, gymId: string, now: Date): Promise<string | null> {
  const [row] = await sql<{ today: string }[]>`SELECT ((${now}::timestamptz AT TIME ZONE timezone)::date)::text AS today FROM gyms WHERE id = ${gymId}`;
  return row?.today ?? null;
}

/** The card the app would charge for this membership by itself: whoever pays for it, in the Square account the
 *  gym is connected to, with automatic payments not paused and no chargeback stopping them. "Visa", "1111". */
export async function chargedCard(sql: SqlOrTx, gymId: string, heldId: string): Promise<{ brand: string; last4: string } | null> {
  const [row] = await sql<{ brand: string; last4: string }[]>`
    SELECT k.brand, k.last4
    FROM gym_held_memberships h
    JOIN gym_payment_connections c ON c.gym_id = h.gym_id AND c.state = 'connected' AND c.location_id IS NOT NULL
    JOIN gym_member_cards k ON k.gym_id = h.gym_id AND k.environment = c.environment AND k.account_id = c.account_id
      AND k.entry_id = COALESCE((SELECT p.payer_entry_id FROM gym_member_payers p WHERE p.gym_id = h.gym_id AND p.entry_id = h.entry_id), h.entry_id)
    WHERE h.gym_id = ${gymId} AND h.id = ${heldId} AND h.currency = c.currency
      AND NOT EXISTS (${autopayPaused(sql)}) AND NOT EXISTS (${chargebackStops(sql)})
    LIMIT 1`;
  return row ?? null;
}

export interface ClaimedReminder {
  id: string;
  gymId: string;
  heldId: string;
  entryId: string | null;
  occasion: string;
  what: RenewalReminderWhat;
  aboutOn: string;
  email: string | null;
  attempts: number;
  maybeSentAt: Date | null;
  createdAt: Date;
}

/** Take the next email that is due, and lease it. One that may already have gone is taken first: it is the
 *  same email again. */
export async function claimNext(sql: SqlOrTx, q: { now: Date; leaseMs: number; gymIds: readonly string[] | null }): Promise<ClaimedReminder | null> {
  const rows = await sql<
    { id: string; gym_id: string; held_membership_id: string; entry_id: string | null; occasion: string; what: RenewalReminderWhat; about_on: string; email: string | null; attempts: number; maybe_sent_at: Date | null; created_at: Date }[]
  >`
    WITH next AS (
      SELECT n.id FROM gym_renewal_reminders n
      WHERE ((n.state = 'queued' AND n.not_before <= ${q.now}) OR (n.state = 'sending' AND n.lease_until < ${q.now}))
        AND (${q.gymIds === null}::boolean OR n.gym_id = ANY(${[...(q.gymIds ?? [])]}::uuid[]))
      ORDER BY (n.maybe_sent_at IS NULL), n.not_before, n.id
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE gym_renewal_reminders u
    SET state = 'sending', lease_until = ${new Date(q.now.getTime() + q.leaseMs)}, attempts = u.attempts + 1
    FROM next
    WHERE u.id = next.id
    RETURNING u.id, u.gym_id, u.held_membership_id, u.entry_id, u.occasion, u.what, u.about_on::text AS about_on, u.email::text AS email, u.attempts, u.maybe_sent_at, u.created_at`;
  const r = rows[0];
  return r === undefined
    ? null
    : {
        id: r.id,
        gymId: r.gym_id,
        heldId: r.held_membership_id,
        entryId: r.entry_id,
        occasion: r.occasion,
        what: r.what,
        aboutOn: r.about_on,
        email: r.email,
        attempts: r.attempts,
        maybeSentAt: r.maybe_sent_at,
        createdAt: r.created_at,
      };
}

/** Hold the membership while the check before an email reads it: a cancel, a freeze or a payment waits until
 *  the email is marked as maybe sent. */
export async function holdMembership(tx: TransactionSql, gymId: string, heldId: string): Promise<void> {
  await tx`SELECT 1 FROM gym_held_memberships WHERE gym_id = ${gymId} AND id = ${heldId} FOR SHARE`;
}

/** Record, before the email is handed to the email service, that from now on it may have gone. False when the
 *  claim is no longer this run's, or the address bounced or was refused anywhere. */
export async function markMaybeSent(sql: SqlOrTx, n: ClaimedReminder, hmac: string, at: Date): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE gym_renewal_reminders s SET maybe_sent_at = coalesce(s.maybe_sent_at, ${at})
    WHERE s.id = ${n.id} AND s.gym_id = ${n.gymId} AND s.state = 'sending' AND s.attempts = ${n.attempts}
      AND NOT EXISTS (SELECT 1 FROM email_suppressions x WHERE x.email_hmac = ${hmac} AND x.gym_id IS NULL)
    RETURNING s.id`;
  return rows.length === 1;
}

/** A claimed email no longer due and never handed over: taken off, so it is written again should it be due
 *  again. False when the claim was no longer this run's. */
export async function dropReminder(sql: SqlOrTx, n: ClaimedReminder): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    DELETE FROM gym_renewal_reminders
    WHERE id = ${n.id} AND gym_id = ${n.gymId} AND state = 'sending' AND attempts = ${n.attempts} AND maybe_sent_at IS NULL
    RETURNING id`;
  return rows.length === 1;
}

export type ReminderOutcome = { kind: "sent"; providerId: string | null } | { kind: "skipped" | "failed"; reason: string };

/** Finish a claimed email; the address is cleared in the same statement. False when the claim was no longer
 *  this run's. */
export async function finishReminder(sql: SqlOrTx, n: ClaimedReminder, outcome: ReminderOutcome, at: Date): Promise<boolean> {
  const reason = outcome.kind === "sent" ? null : outcome.reason;
  const providerId = outcome.kind === "sent" ? outcome.providerId : null;
  const rows = await sql<{ id: string }[]>`
    UPDATE gym_renewal_reminders
    SET state = ${outcome.kind}, reason = ${reason}, provider_id = ${providerId}, email = NULL, lease_until = NULL, finished_at = ${at}
    WHERE id = ${n.id} AND gym_id = ${n.gymId} AND state = 'sending' AND attempts = ${n.attempts}
    RETURNING id`;
  return rows.length === 1;
}

/** Put a claimed email back to wait until `notBefore`. */
export async function retryReminder(sql: SqlOrTx, n: ClaimedReminder, notBefore: Date): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE gym_renewal_reminders SET state = 'queued', lease_until = NULL, not_before = ${notBefore}
    WHERE id = ${n.id} AND gym_id = ${n.gymId} AND state = 'sending' AND attempts = ${n.attempts}
    RETURNING id`;
  return rows.length === 1;
}

/** Of these address keys, the ones that bounced or were refused anywhere: never sent to. */
export async function blockedOf(sql: SqlOrTx, hmacs: readonly string[]): Promise<Set<string>> {
  if (hmacs.length === 0) return new Set();
  const rows = await sql<{ email_hmac: string }[]>`
    SELECT email_hmac FROM email_suppressions WHERE gym_id IS NULL AND email_hmac = ANY(${[...hmacs]}::text[])`;
  return new Set(rows.map((r) => r.email_hmac));
}

/** The gym's name and how to reach it. */
export async function gymContact(sql: SqlOrTx, gymId: string): Promise<{ name: string; contactEmail: string | null; contactPhone: string | null } | null> {
  const [gym] = await sql<{ name: string; contact_email: string | null; contact_phone: string | null }[]>`
    SELECT name, contact_email, contact_phone FROM gyms WHERE id = ${gymId} AND status = 'active'`;
  return gym === undefined ? null : { name: gym.name, contactEmail: gym.contact_email, contactPhone: gym.contact_phone };
}


/** Whether the line is this gym's, live or archived. */
export async function typeOfGym(sql: SqlOrTx, gymId: string, typeId: string): Promise<boolean> {
  const [row] = await sql<{ id: string }[]>`SELECT id FROM gym_membership_types WHERE gym_id = ${gymId} AND id = ${typeId}`;
  return row !== undefined;
}
