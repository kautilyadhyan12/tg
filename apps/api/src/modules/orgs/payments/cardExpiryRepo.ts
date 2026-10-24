// The emails reminding a cardholder that their card on file expires this month (18d-iii-c). One rule
// says which cards are due one (`dueCard`), and the queue, the box in Bills, a person's page and the
// statement before each email all read it. The worker leases one row at a time and names its lease in
// every write that finishes it, as the decline emails' queue does (`cardNoticesRepo.ts`). The address
// is cleared in the statement that finishes a row.
import { CARD_EXPIRY_LAST_DAY } from "@app/shared";
import type { Sql, TransactionSql } from "postgres";
import type { SquareEnvironment } from "./square.js";

type SqlOrTx = Sql | TransactionSql;

/** The card (alias `k`) pays for a membership that renews: its holder's own, where nobody else pays
 *  for them, or that of somebody they pay for; of a current member, running or frozen. The card the
 *  app would charge for it (`payerCard` in `cardChargesRepo.ts`). */
const paysForRenewal = (sql: SqlOrTx) => sql`
      (EXISTS (
         SELECT 1 FROM gym_held_memberships h
         WHERE h.gym_id = k.gym_id AND h.entry_id = k.entry_id AND ${renewing(sql)}
           AND NOT EXISTS (SELECT 1 FROM gym_member_payers p WHERE p.gym_id = k.gym_id AND p.entry_id = k.entry_id))
       OR EXISTS (
         SELECT 1 FROM gym_member_payers p
         JOIN gym_held_memberships h ON h.gym_id = p.gym_id AND h.entry_id = p.entry_id
         WHERE p.gym_id = k.gym_id AND p.payer_entry_id = k.entry_id AND ${renewing(sql)}))`;

/** A membership (alias `h`) that renews, running or frozen, of a current member. Each half of
 *  `paysForRenewal` finds it by its record, so neither reads the gym's other memberships. */
const renewing = (sql: SqlOrTx) => sql`
      h.kind = 'recurring' AND h.renews AND h.status IN ('active','frozen')
      AND NOT EXISTS (SELECT 1 FROM gym_member_list_entries m WHERE m.gym_id = h.gym_id AND m.id = h.entry_id AND m.former_at IS NOT NULL)`;

/** The card (alias `k`) is due a reminder, in the gym's month `today` (alias `d` names the gym's day,
 *  its connected Square account and its switch): the gym sends them, it is active, the card is in the
 *  account it is connected to now, the card's last month is this one, and it pays for a renewal. */
const dueCard = (sql: SqlOrTx) => sql`
      d.reminders AND d.active
      AND k.gym_id = d.gym_id AND k.environment = d.environment AND k.account_id = d.account_id
      AND k.exp_year = extract(year FROM d.today) AND k.exp_month = extract(month FROM d.today)
      AND ${paysForRenewal(sql)}`;

interface DayQuery {
  environment: SquareEnvironment | null;
  now: Date;
  remindingOnly: boolean;
}

/** Each gym's own day, switch and connected Square account, for the connections `only` picks. */
const gymDaySelect = (sql: SqlOrTx, q: DayQuery, only: ReturnType<typeof sql>) => sql`
      SELECT g.id AS gym_id, g.timezone, g.card_expiry_reminders AS reminders, g.status = 'active' AS active,
             c.environment, c.account_id,
             (${q.now}::timestamptz AT TIME ZONE g.timezone)::date AS today,
             extract(hour FROM ${q.now}::timestamptz AT TIME ZONE g.timezone) AS hour
      FROM gym_payment_connections c
      JOIN gyms g ON g.id = c.gym_id
      WHERE (${q.environment === null}::boolean OR c.environment = ${q.environment}) AND c.state = 'connected' AND c.location_id IS NOT NULL
        AND (NOT ${q.remindingOnly}::boolean OR g.card_expiry_reminders)
        AND ${only}`;

const gymDay = (sql: SqlOrTx, q: DayQuery & { gymIds: readonly string[] | null }) => sql`
    gym_day AS (${gymDaySelect(sql, q, q.gymIds === null ? sql`true` : sql`c.gym_id = ANY(${[...q.gymIds]}::uuid[])`)})`;

/** Write the reminders that are due, from 6 in the morning on each gym's clock up to the
 *  `CARD_EXPIRY_LAST_DAY` of the month, for the cards whose holder has an email address; once a card
 *  and expiry date. Safe to run twice at once. Answers how many were written. */
export async function queueDueNotices(sql: SqlOrTx, q: { environment: SquareEnvironment; now: Date; gymIds: readonly string[] | null }): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    WITH ${gymDay(sql, { ...q, remindingOnly: true })}
    INSERT INTO gym_card_expiry_notices (gym_id, entry_id, environment, account_id, card_id, exp_month, exp_year, email, state, not_before, created_at)
    SELECT k.gym_id, k.entry_id, k.environment, k.account_id, k.card_id, k.exp_month, k.exp_year, e.email, 'queued', ${q.now}, ${q.now}
    FROM gym_day d
    JOIN gym_member_cards k ON k.gym_id = d.gym_id AND k.environment = d.environment AND k.account_id = d.account_id
    JOIN gym_member_list_entries e ON e.gym_id = k.gym_id AND e.id = k.entry_id
    WHERE d.hour >= 6 AND extract(day FROM d.today) <= ${CARD_EXPIRY_LAST_DAY} AND e.email IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM gym_card_expiry_notices n
        WHERE n.gym_id = k.gym_id AND n.environment = k.environment AND n.account_id = k.account_id AND n.card_id = k.card_id
          AND n.exp_year = k.exp_year AND n.exp_month = k.exp_month)
      AND ${dueCard(sql)}
    ON CONFLICT (gym_id, environment, account_id, card_id, exp_year, exp_month) DO NOTHING
    RETURNING id`;
  return rows.length;
}

/** Whether the gym sends the reminders. */
export async function remindersOn(sql: SqlOrTx, gymId: string): Promise<boolean> {
  const [row] = await sql<{ on: boolean }[]>`SELECT card_expiry_reminders AS on FROM gyms WHERE id = ${gymId}`;
  return row?.on === true;
}

export async function setReminders(sql: SqlOrTx, gymId: string, on: boolean): Promise<void> {
  await sql`UPDATE gyms SET card_expiry_reminders = ${on} WHERE id = ${gymId}`;
}

export type NoticeState = "queued" | "sending" | "sent" | "skipped" | "failed";

/** A card on file that expires this month, as the box in Bills lists it. */
export interface ExpiringCard {
  entryId: string;
  name: string;
  brand: string;
  last4: string;
  /** The holder's address, to be checked against the addresses that bounced; never sent to a screen. */
  email: string | null;
  /** It pays for a membership that renews. */
  renewing: boolean;
  /** Its reminder for this expiry date, if one was written. */
  notice: Notice | null;
}

/** A reminder written: its state, the gym's day it was sent, and why it was not. */
export interface Notice {
  state: NoticeState;
  on: string | null;
  reason: string | null;
}

/** The cards on file in the gym's connected account that expire in the gym's month now, whether the
 *  gym sends reminders or not, by name. Null where the gym is not connected to Square. */
export async function expiringCards(
  sql: SqlOrTx,
  q: { gymId: string; environment: SquareEnvironment | null; now: Date },
): Promise<{ today: string; cards: ExpiringCard[] } | null> {
  const [day] = await sql<{ today: string }[]>`
    SELECT ((${q.now}::timestamptz AT TIME ZONE g.timezone)::date)::text AS today
    FROM gyms g JOIN gym_payment_connections c ON c.gym_id = g.id
    WHERE g.id = ${q.gymId} AND (${q.environment === null}::boolean OR c.environment = ${q.environment}) AND c.state = 'connected' AND c.location_id IS NOT NULL
    LIMIT 1`;
  if (day === undefined) return null;
  const rows = await sql<
    { entry_id: string; full_name: string | null; brand: string; last4: string; email: string | null; renewing: boolean; state: NoticeState | null; reason: string | null; on: string | null }[]
  >`
    WITH ${gymDay(sql, { environment: q.environment, now: q.now, gymIds: [q.gymId], remindingOnly: false })}
    SELECT k.entry_id, e.full_name, k.brand, k.last4, e.email::text AS email,
           ${paysForRenewal(sql)} AS renewing,
           n.state, n.reason, CASE WHEN n.state = 'sent' THEN ((n.finished_at AT TIME ZONE d.timezone)::date)::text END AS on
    FROM gym_day d
    JOIN gym_member_cards k ON k.gym_id = d.gym_id AND k.environment = d.environment AND k.account_id = d.account_id
    JOIN gym_member_list_entries e ON e.gym_id = k.gym_id AND e.id = k.entry_id
    LEFT JOIN gym_card_expiry_notices n
      ON n.gym_id = k.gym_id AND n.environment = k.environment AND n.account_id = k.account_id AND n.card_id = k.card_id
     AND n.exp_year = k.exp_year AND n.exp_month = k.exp_month
    WHERE k.exp_year = extract(year FROM d.today) AND k.exp_month = extract(month FROM d.today)
    ORDER BY e.full_name, k.entry_id`;
  return {
    today: day.today,
    cards: rows.map((r) => ({
      entryId: r.entry_id,
      name: r.full_name ?? "",
      brand: r.brand,
      last4: r.last4,
      email: r.email,
      renewing: r.renewing,
      notice: r.state === null ? null : { state: r.state, on: r.on, reason: r.reason },
    })),
  };
}

/** Of these address keys (`emailHmac`), the ones that bounced or were refused anywhere: never sent to. */
export async function blockedOf(sql: SqlOrTx, hmacs: readonly string[]): Promise<Set<string>> {
  if (hmacs.length === 0) return new Set();
  const rows = await sql<{ email_hmac: string }[]>`
    SELECT email_hmac FROM email_suppressions WHERE gym_id IS NULL AND email_hmac = ANY(${[...hmacs]}::text[])`;
  return new Set(rows.map((r) => r.email_hmac));
}

/** Whether the record's card pays for a membership that renews (`paysForRenewal`). */
export async function cardPaysForRenewal(sql: SqlOrTx, card: { gymId: string; entryId: string }): Promise<boolean> {
  const [row] = await sql<{ renewing: boolean }[]>`
    SELECT ${paysForRenewal(sql)} AS renewing FROM gym_member_cards k WHERE k.gym_id = ${card.gymId} AND k.entry_id = ${card.entryId}`;
  return row?.renewing === true;
}

/** This month's reminders not sent for their address (bounced or refused, or not an address), at the
 *  gyms that send them, with the address on the cardholder's record now: the sender takes off those
 *  whose address now can be sent to, so the queue writes them again for it (review round one). */
export async function skippedForAddress(sql: Sql, q: { now: Date; gymIds: readonly string[] | null }): Promise<{ id: string; gymId: string; email: string | null }[]> {
  const rows = await sql<{ id: string; gym_id: string; email: string | null }[]>`
    SELECT s.id, s.gym_id, e.email::text AS email
    FROM gym_card_expiry_notices s
    JOIN gyms g ON g.id = s.gym_id AND g.card_expiry_reminders
    JOIN gym_member_list_entries e ON e.gym_id = s.gym_id AND e.id = s.entry_id
    WHERE s.state = 'skipped' AND s.reason IN ('address_blocked','address_invalid')
      AND s.exp_year = extract(year FROM (${q.now}::timestamptz AT TIME ZONE g.timezone)::date)
      AND s.exp_month = extract(month FROM (${q.now}::timestamptz AT TIME ZONE g.timezone)::date)
      AND (${q.gymIds === null}::boolean OR s.gym_id = ANY(${[...(q.gymIds ?? [])]}::uuid[]))`;
  return rows.map((r) => ({ id: r.id, gymId: r.gym_id, email: r.email }));
}

/** Take off a reminder skipped for its address, so the queue writes it again. */
export async function dropSkipped(sql: Sql, row: { id: string; gymId: string }): Promise<void> {
  await sql`
    DELETE FROM gym_card_expiry_notices
    WHERE id = ${row.id} AND gym_id = ${row.gymId} AND state = 'skipped' AND reason IN ('address_blocked','address_invalid')`;
}

/** A record's card's reminder for the expiry date it has now: its state and the gym's day it was
 *  sent. Null where none was written. */
export async function noticeOfCard(
  sql: SqlOrTx,
  card: { gymId: string; environment: SquareEnvironment; accountId: string; cardId: string; expMonth: number; expYear: number },
): Promise<Notice | null> {
  const [row] = await sql<Notice[]>`
    SELECT n.state, n.reason, CASE WHEN n.state = 'sent' THEN ((n.finished_at AT TIME ZONE g.timezone)::date)::text END AS on
    FROM gym_card_expiry_notices n JOIN gyms g ON g.id = n.gym_id
    WHERE n.gym_id = ${card.gymId} AND n.environment = ${card.environment} AND n.account_id = ${card.accountId} AND n.card_id = ${card.cardId}
      AND n.exp_year = ${card.expYear} AND n.exp_month = ${card.expMonth}`;
  return row ?? null;
}

export interface ClaimedNotice {
  id: string;
  gymId: string;
  entryId: string | null;
  email: string | null;
  attempts: number;
  maybeSentAt: Date | null;
  createdAt: Date;
}

/** Take the next email that is due, and lease it. One that may already have gone is taken first: it
 *  is the same email again. */
export async function claimNextNotice(sql: SqlOrTx, q: { now: Date; leaseMs: number; gymIds: readonly string[] | null }): Promise<ClaimedNotice | null> {
  const rows = await sql<{ id: string; gym_id: string; entry_id: string | null; email: string | null; attempts: number; maybe_sent_at: Date | null; created_at: Date }[]>`
    WITH next AS (
      SELECT n.id FROM gym_card_expiry_notices n
      WHERE ((n.state = 'queued' AND n.not_before <= ${q.now}) OR (n.state = 'sending' AND n.lease_until < ${q.now}))
        AND (${q.gymIds === null}::boolean OR n.gym_id = ANY(${[...(q.gymIds ?? [])]}::uuid[]))
      ORDER BY (n.maybe_sent_at IS NULL), n.not_before, n.id
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE gym_card_expiry_notices u
    SET state = 'sending', lease_until = ${new Date(q.now.getTime() + q.leaseMs)}, attempts = u.attempts + 1
    FROM next
    WHERE u.id = next.id
    RETURNING u.id, u.gym_id, u.entry_id, u.email::text AS email, u.attempts, u.maybe_sent_at, u.created_at`;
  const row = rows[0];
  return row === undefined
    ? null
    : { id: row.id, gymId: row.gym_id, entryId: row.entry_id, email: row.email, attempts: row.attempts, maybeSentAt: row.maybe_sent_at, createdAt: row.created_at };
}

/** The notice (alias `s`) is still due now: `dueCard` of the card it was written for, unchanged on the
 *  same record, which still has the address it was written with. Read for its own gym and card only. */
const stillDue = (sql: SqlOrTx, now: Date) => sql`
      s.entry_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM (${gymDaySelect(sql, { environment: null, now, remindingOnly: true }, sql`c.gym_id = s.gym_id AND c.environment = s.environment AND c.account_id = s.account_id`)}) d
        JOIN gym_member_cards k ON k.gym_id = s.gym_id AND k.entry_id = s.entry_id
        WHERE k.environment = s.environment AND k.account_id = s.account_id
          AND k.card_id = s.card_id AND k.exp_year = s.exp_year AND k.exp_month = s.exp_month
          AND ${dueCard(sql)})
      AND EXISTS (SELECT 1 FROM gym_member_list_entries e WHERE e.gym_id = s.gym_id AND e.id = s.entry_id AND e.email = s.email)`;

/** What the email says, read now. */
export interface NoticeFacts {
  /** Still due by the rule, to the address it was written with. */
  due: boolean;
  gym: { name: string; country: string | null; contactEmail: string | null; contactPhone: string | null } | null;
  card: { brand: string; last4: string; expMonth: number; expYear: number } | null;
  holderName: string | null;
  /** Whose renewing memberships the card pays for: the holder's own (`self`), and the others' names. */
  paysForSelf: boolean;
  paysForOthers: string[];
}

export async function noticeFacts(sql: SqlOrTx, n: ClaimedNotice, now: Date): Promise<NoticeFacts> {
  const [due] = await sql<{ due: boolean }[]>`SELECT ${stillDue(sql, now)} AS due FROM gym_card_expiry_notices s WHERE s.gym_id = ${n.gymId} AND s.id = ${n.id}`;
  const [gym] = await sql<{ name: string; country: string | null; contact_email: string | null; contact_phone: string | null }[]>`
    SELECT name, country, contact_email, contact_phone FROM gyms WHERE id = ${n.gymId}`;
  const [card] = await sql<{ brand: string; last4: string; exp_month: number; exp_year: number; holder_name: string | null }[]>`
    SELECT k.brand, k.last4, k.exp_month, k.exp_year, e.full_name AS holder_name
    FROM gym_card_expiry_notices s
    JOIN gym_member_cards k ON k.gym_id = s.gym_id AND k.entry_id = s.entry_id AND k.card_id = s.card_id
    JOIN gym_member_list_entries e ON e.gym_id = k.gym_id AND e.id = k.entry_id
    WHERE s.gym_id = ${n.gymId} AND s.id = ${n.id}`;
  const people =
    n.entryId === null
      ? []
      : await sql<{ entry_id: string; full_name: string | null }[]>`
    SELECT DISTINCT e.id AS entry_id, e.full_name
    FROM (
      SELECT h.* FROM gym_held_memberships h
      WHERE h.gym_id = ${n.gymId} AND h.entry_id = ${n.entryId}
        AND NOT EXISTS (SELECT 1 FROM gym_member_payers p WHERE p.gym_id = h.gym_id AND p.entry_id = h.entry_id)
      UNION ALL
      SELECT h.* FROM gym_member_payers p
      JOIN gym_held_memberships h ON h.gym_id = p.gym_id AND h.entry_id = p.entry_id
      WHERE p.gym_id = ${n.gymId} AND p.payer_entry_id = ${n.entryId}
    ) h
    JOIN gym_member_list_entries e ON e.gym_id = h.gym_id AND e.id = h.entry_id
    WHERE ${renewing(sql)}
    ORDER BY e.full_name, e.id`;
  return {
    due: due?.due === true,
    gym: gym === undefined ? null : { name: gym.name, country: gym.country, contactEmail: gym.contact_email, contactPhone: gym.contact_phone },
    card: card === undefined ? null : { brand: card.brand, last4: card.last4, expMonth: card.exp_month, expYear: card.exp_year },
    holderName: card?.holder_name ?? null,
    paysForSelf: people.some((p) => p.entry_id === n.entryId),
    paysForOthers: people.filter((p) => p.entry_id !== n.entryId).map((p) => p.full_name ?? ""),
  };
}

/** Record, before the email is handed to Resend, that from now on it may have gone. False when the
 *  claim is no longer this run's, the card is no longer due one, the record's address changed, or
 *  the address bounced or was refused anywhere: then nothing may be sent. One statement, so a change
 *  committed before it is seen. */
export async function markMaybeSent(sql: SqlOrTx, n: ClaimedNotice, hmac: string, at: Date): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE gym_card_expiry_notices s SET maybe_sent_at = coalesce(s.maybe_sent_at, ${at})
    WHERE s.id = ${n.id} AND s.gym_id = ${n.gymId} AND s.state = 'sending' AND s.attempts = ${n.attempts}
      AND ${stillDue(sql, at)}
      AND NOT EXISTS (SELECT 1 FROM email_suppressions x WHERE x.email_hmac = ${hmac} AND x.gym_id IS NULL)
    RETURNING s.id`;
  return rows.length === 1;
}

/** Whether the address is one that bounced or was refused anywhere. */
export async function addressBlocked(sql: SqlOrTx, hmac: string): Promise<boolean> {
  const [row] = await sql<{ blocked: boolean }[]>`SELECT EXISTS (SELECT 1 FROM email_suppressions x WHERE x.email_hmac = ${hmac} AND x.gym_id IS NULL) AS blocked`;
  return row?.blocked === true;
}

/** A claimed email no longer due and never handed over: taken off, so the queue writes it again
 *  should the card be due one again (an address added, reminders switched on again). False when the
 *  claim was no longer this run's. */
export async function dropNotice(sql: SqlOrTx, n: ClaimedNotice): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    DELETE FROM gym_card_expiry_notices
    WHERE id = ${n.id} AND gym_id = ${n.gymId} AND state = 'sending' AND attempts = ${n.attempts} AND maybe_sent_at IS NULL
    RETURNING id`;
  return rows.length === 1;
}

export type NoticeOutcome = { kind: "sent"; providerId: string | null } | { kind: "skipped" | "failed"; reason: string };

/** Finish a claimed email; the address is cleared in the same statement. False when the claim was
 *  no longer this run's. */
export async function finishNotice(sql: SqlOrTx, n: ClaimedNotice, outcome: NoticeOutcome, at: Date): Promise<boolean> {
  const reason = outcome.kind === "sent" ? null : outcome.reason;
  const providerId = outcome.kind === "sent" ? outcome.providerId : null;
  const rows = await sql<{ id: string }[]>`
    UPDATE gym_card_expiry_notices
    SET state = ${outcome.kind}, reason = ${reason}, provider_id = ${providerId}, email = NULL, lease_until = NULL, finished_at = ${at}
    WHERE id = ${n.id} AND gym_id = ${n.gymId} AND state = 'sending' AND attempts = ${n.attempts}
    RETURNING id`;
  return rows.length === 1;
}

/** Put a claimed email back to wait until `notBefore`. */
export async function retryNotice(sql: SqlOrTx, n: ClaimedNotice, notBefore: Date): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE gym_card_expiry_notices SET state = 'queued', lease_until = NULL, not_before = ${notBefore}
    WHERE id = ${n.id} AND gym_id = ${n.gymId} AND state = 'sending' AND attempts = ${n.attempts}
    RETURNING id`;
  return rows.length === 1;
}
