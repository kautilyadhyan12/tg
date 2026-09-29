// "Send them for me" in the database (ROADMAP 20c-v-a): the gym's switch, and each
// follow-up the app takes. Every statement names its gym, except the worker's claim,
// which looks across every gym that switched it on, and the unsubscribe link's read,
// which knows only the email it came in.
import type { Sql, TransactionSql } from "postgres";
import { emailsUsedToday } from "../invites/repo.js";

type SqlOrTx = Sql | TransactionSql;

/** The gym's sending day by its own clock: emails go from 8:00 until 20:00. */
export const SENDING_HOURS = { from: 8, until: 20 } as const;

/** The claim's lock, the invitations' own, so the two share the whole app's day. */
const CLAIM_LOCK = "gym_invite_sends.claim";

export interface LeadEmailSwitch {
  sendForMe: boolean;
  replyTo: string | null;
}

export async function emailSwitchFor(sql: SqlOrTx, gymId: string): Promise<LeadEmailSwitch> {
  const rows = await sql<{ send_for_me: boolean; reply_to: string | null }[]>`
    SELECT send_for_me, reply_to::text AS reply_to FROM gym_lead_email_settings WHERE gym_id = ${gymId}`;
  const row = rows[0];
  return row === undefined ? { sendForMe: false, replyTo: null } : { sendForMe: row.send_for_me, replyTo: row.reply_to };
}

export async function writeEmailSwitch(tx: TransactionSql, gymId: string, value: LeadEmailSwitch, at: Date): Promise<void> {
  await tx`
    INSERT INTO gym_lead_email_settings (gym_id, send_for_me, reply_to, updated_at)
    VALUES (${gymId}, ${value.sendForMe}, ${value.replyTo}, ${at})
    ON CONFLICT (gym_id) DO UPDATE
    SET send_for_me = EXCLUDED.send_for_me, reply_to = EXCLUDED.reply_to, updated_at = EXCLUDED.updated_at`;
}

/** What the gym's leads and its Settings box need to say who sends: the switch, whether
 *  the gym can send now, and how many new leads the app has emailed in its month. */
export interface GymSendingFacts extends LeadEmailSwitch {
  name: string;
  hasPostalAddress: boolean;
  stopped: boolean;
  active: boolean;
  onPlan: boolean;
  usedThisMonth: number;
}

export async function gymSendingFacts(sql: SqlOrTx, gymId: string, now: Date): Promise<GymSendingFacts | null> {
  const rows = await sql<
    {
      send_for_me: boolean | null;
      reply_to: string | null;
      name: string;
      has_postal: boolean;
      stopped: boolean;
      status: string;
      on_plan: boolean;
      used: number;
    }[]
  >`
    SELECT s.send_for_me, s.reply_to::text AS reply_to, g.name,
           g.postal_address IS NOT NULL AS has_postal,
           g.invites_stopped_at IS NOT NULL AS stopped,
           g.status,
           EXISTS (
             SELECT 1 FROM subscriptions sub
             WHERE sub.owner_type = 'gym' AND sub.owner_id = g.id AND sub.status IN ('trialing','active','past_due')) AS on_plan,
           (SELECT count(*)::int FROM gym_lead_sends m
            WHERE m.gym_id = g.id AND m.counted
              AND m.month = to_char(${now}::timestamptz AT TIME ZONE g.timezone, 'YYYY-MM')) AS used
    FROM gyms g
    LEFT JOIN gym_lead_email_settings s ON s.gym_id = g.id
    WHERE g.id = ${gymId}`;
  const row = rows[0];
  if (row === undefined) return null;
  return {
    sendForMe: row.send_for_me ?? false,
    replyTo: row.reply_to,
    name: row.name,
    hasPostalAddress: row.has_postal,
    stopped: row.stopped,
    active: row.status === "active",
    onPlan: row.on_plan,
    usedThisMonth: row.used,
  };
}

/** For each lead: whether the app has emailed it under its current tick (then it goes on
 *  sending the rest, outside the month's count), and what became of the app's try at
 *  its next one, if there was one. */
export interface LeadSendState {
  continuing: boolean;
  next: { state: string; reason: string | null } | null;
}

export async function leadSendStates(sql: SqlOrTx, gymId: string, leadIds: readonly string[]): Promise<Map<string, LeadSendState>> {
  if (leadIds.length === 0) return new Map();
  const rows = await sql<{ id: string; continuing: boolean; state: string | null; reason: string | null }[]>`
    SELECT l.id,
           EXISTS (
             SELECT 1 FROM gym_lead_sends c
             WHERE c.gym_id = l.gym_id AND c.lead_id = l.id AND c.ok_at = l.email_ok_at AND c.counted) AS continuing,
           x.state, x.reason
    FROM gym_leads l
    LEFT JOIN gym_lead_sends x ON x.lead_id = l.id AND x.ok_at = l.email_ok_at AND x.step = l.follow_ups_sent + 1
    WHERE l.gym_id = ${gymId} AND l.id = ANY(${[...leadIds]}::uuid[])`;
  return new Map(
    rows.map((row) => [row.id, { continuing: row.continuing, next: row.state === null ? null : { state: row.state, reason: row.reason } }]),
  );
}

/** Of these address HMACs, the ones that asked this gym to stop (an unsubscribe or a
 *  complaint), how, and when. */
export async function optedOut(
  sql: SqlOrTx,
  gymId: string,
  hmacs: readonly string[],
): Promise<Map<string, { reason: "unsubscribed" | "complained"; at: Date }>> {
  if (hmacs.length === 0) return new Map();
  const rows = await sql<{ email_hmac: string; reason: string; created_at: Date }[]>`
    SELECT email_hmac, reason, created_at
    FROM email_suppressions
    WHERE gym_id = ${gymId} AND reason IN ('unsubscribed','complained') AND email_hmac = ANY(${[...hmacs]}::text[])`;
  const found = new Map<string, { reason: "unsubscribed" | "complained"; at: Date }>();
  for (const row of rows) {
    const reason = row.reason === "complained" ? "complained" : "unsubscribed";
    const kept = found.get(row.email_hmac);
    // A complaint says more than an unsubscribe.
    if (kept === undefined || (reason === "complained" && kept.reason !== "complained")) found.set(row.email_hmac, { reason, at: row.created_at });
  }
  return found;
}

/** The staff's own "Email due": a follow-up due by `today` that the app will not send.
 *  With the switch on (`app.on`, and the gym able to send), the app takes a lead it has
 *  already emailed under this tick, or any lead while the month has room, unless its
 *  try at this very email ended without sending. Kept beside `whoSends`, its twin for
 *  one lead. */
export const staffDueCondition = (sql: SqlOrTx, today: string, app: { on: boolean; roomLeft: boolean }) => sql`
  l.follow_up_due_on <= ${today}::date
  AND NOT (
    ${app.on}::boolean
    AND NOT EXISTS (
      SELECT 1 FROM gym_lead_sends x
      WHERE x.lead_id = l.id AND x.ok_at = l.email_ok_at AND x.step = l.follow_ups_sent + 1
        AND (x.state = 'skipped' OR (x.state = 'failed' AND x.reason <> 'send_unknown')))
    AND (${app.roomLeft}::boolean OR EXISTS (
      SELECT 1 FROM gym_lead_sends c
      WHERE c.gym_id = l.gym_id AND c.lead_id = l.id AND c.ok_at = l.email_ok_at AND c.counted)))`;

// ── The worker ───────────────────────────────────────────────────────────────

/** A follow-up the worker has taken. `attempts` is the claim's own number: every write
 *  that finishes it names it, so a claim that timed out and was taken over cannot
 *  finish the row a second time. */
export interface ClaimedLeadSend {
  id: string;
  gymId: string;
  leadId: string | null;
  step: number;
  email: string | null;
  emailHmac: string;
  attempts: number;
  maybeSentAt: Date | null;
  createdAt: Date;
}

interface ClaimedRow {
  id: string;
  gym_id: string;
  lead_id: string | null;
  step: number;
  email: string | null;
  email_hmac: string;
  attempts: number;
  maybe_sent_at: Date | null;
  created_at: Date;
}

const toClaimed = (row: ClaimedRow): ClaimedLeadSend => ({
  id: row.id,
  gymId: row.gym_id,
  leadId: row.lead_id,
  step: row.step,
  email: row.email,
  emailHmac: row.email_hmac,
  attempts: row.attempts,
  maybeSentAt: row.maybe_sent_at,
  createdAt: row.created_at,
});

export interface LeadClaimLimits {
  now: Date;
  leaseMs: number;
  /** The most emails the whole app sends in any 24 hours, invitations included. */
  platformPerDay: number;
  /** New leads a gym's follow-ups go to in one of its months. */
  perMonth: number;
  /** The HMAC an address is kept under. */
  hmacOf: (email: string) => string;
  /** Only these gyms' leads (a test's own); null for every gym. */
  gymIds: readonly string[] | null;
  /** Passed over for the rest of this run: gyms that cannot send now, and leads whose
   *  email turned out not to be due. */
  skipGyms: readonly string[];
  skipLeads: readonly string[];
}

/** Take the next follow-up that is due, and lease it. First an email already taken
 *  that waits to be tried again, or whose lease ran out (one that may already have
 *  gone before the whole app's cap and at any hour: it is the same email again, and
 *  Resend forgets its key after a day); then a New, ticked lead whose next one is due today by its gym's
 *  clock, in the gym's sending hours, with the switch on and the gym able to send, the
 *  app not yet having tried that one under this tick, and room in the gym's month
 *  unless the app already emails this lead. The lead is locked while its row is
 *  written, so a member of staff marking the same email as sent waits, and then finds
 *  it taken. Claims are serialised with the invitations' own, under the whole app's
 *  day. Answers null when nothing is due and `capped` at the day's cap. */
export async function claimNextLeadSend(sql: Sql, limits: LeadClaimLimits): Promise<ClaimedLeadSend | "capped" | null> {
  const now = limits.now;
  const leaseUntil = new Date(now.getTime() + limits.leaseMs);
  const everyGym = limits.gymIds === null;
  const onlyGyms = [...(limits.gymIds ?? [])];
  const skipGyms = [...limits.skipGyms];
  const skipLeads = [...limits.skipLeads];
  return await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${CLAIM_LOCK}))`;
    const waiting = (mayHaveGone: boolean) => tx<ClaimedRow[]>`
      WITH next AS (
        SELECT s.id FROM gym_lead_sends s
        WHERE ((s.state = 'queued' AND s.not_before <= ${now}) OR (s.state = 'sending' AND s.lease_until < ${now}))
          AND (s.maybe_sent_at IS NOT NULL) = ${mayHaveGone}
          -- One that certainly has not gone waits for the gym's sending hours, as a new one does.
          AND (${mayHaveGone}::boolean OR EXISTS (
            SELECT 1 FROM gyms g
            WHERE g.id = s.gym_id
              AND EXTRACT(HOUR FROM ${now}::timestamptz AT TIME ZONE g.timezone) >= ${SENDING_HOURS.from}
              AND EXTRACT(HOUR FROM ${now}::timestamptz AT TIME ZONE g.timezone) < ${SENDING_HOURS.until}))
          AND (${everyGym}::boolean OR s.gym_id = ANY(${onlyGyms}::uuid[]))
          AND s.gym_id <> ALL(${skipGyms}::uuid[])
        ORDER BY s.not_before, s.id
        LIMIT 1
        FOR UPDATE OF s SKIP LOCKED
      )
      UPDATE gym_lead_sends u
      SET state = 'sending', lease_until = ${leaseUntil}, attempts = u.attempts + 1
      FROM next
      WHERE u.id = next.id
      RETURNING u.id, u.gym_id, u.lead_id, u.step, u.email::text AS email, u.email_hmac, u.attempts, u.maybe_sent_at, u.created_at`;
    const again = (await waiting(true))[0];
    if (again !== undefined) return toClaimed(again);
    if ((await emailsUsedToday(tx, now)) >= limits.platformPerDay) return "capped";
    const held = (await waiting(false))[0];
    if (held !== undefined) return toClaimed(held);

    // The gyms that may send now, each with its day, its month and whether the month has room.
    const gyms = await tx<{ id: string; today: string; month: string; has_room: boolean }[]>`
      WITH gym AS (
        SELECT g.id,
               (${now}::timestamptz AT TIME ZONE g.timezone)::date::text AS today,
               to_char(${now}::timestamptz AT TIME ZONE g.timezone, 'YYYY-MM') AS month
        FROM gym_lead_email_settings s
        JOIN gyms g ON g.id = s.gym_id
        WHERE s.send_for_me
          AND g.status = 'active'
          AND g.invites_stopped_at IS NULL
          AND g.postal_address IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM subscriptions sub
            WHERE sub.owner_type = 'gym' AND sub.owner_id = g.id AND sub.status IN ('trialing','active','past_due'))
          AND EXTRACT(HOUR FROM ${now}::timestamptz AT TIME ZONE g.timezone) >= ${SENDING_HOURS.from}
          AND EXTRACT(HOUR FROM ${now}::timestamptz AT TIME ZONE g.timezone) < ${SENDING_HOURS.until}
          AND (${everyGym}::boolean OR g.id = ANY(${onlyGyms}::uuid[]))
          AND g.id <> ALL(${skipGyms}::uuid[])
      )
      SELECT gym.id, gym.today, gym.month,
             (SELECT count(*) FROM gym_lead_sends m
              WHERE m.gym_id = gym.id AND m.counted AND m.month = gym.month) < ${limits.perMonth} AS has_room
      FROM gym
      ORDER BY gym.id`;
    let lead: { id: string; gym_id: string; email: string; step: number; month: string; continuing: boolean } | undefined;
    for (const gym of gyms) {
      // Each gym's leads in the order they fell due, then asked (`gym_leads_follow_up_due_order_idx`),
      // stopping at the first the app may take: with room in the month, any; with none,
      // only one the app already emails under this tick, found from those emails.
      const picked = gym.has_room
        ? await tx<{ id: string; email: string; step: number; continuing: boolean }[]>`
            SELECT l.id, l.email::text AS email, l.follow_ups_sent + 1 AS step,
                   EXISTS (
                     SELECT 1 FROM gym_lead_sends c
                     WHERE c.gym_id = l.gym_id AND c.lead_id = l.id AND c.ok_at = l.email_ok_at AND c.counted) AS continuing
            FROM gym_leads l
            WHERE l.gym_id = ${gym.id}
              AND l.follow_up_due_on IS NOT NULL
              AND l.follow_up_due_on <= ${gym.today}::date
              AND l.status = 'new'
              AND l.email IS NOT NULL
              AND l.email_ok_at IS NOT NULL
              AND l.id <> ALL(${skipLeads}::uuid[])
              AND NOT EXISTS (
                SELECT 1 FROM gym_lead_sends x
                WHERE x.lead_id = l.id AND x.ok_at = l.email_ok_at AND x.step = l.follow_ups_sent + 1)
            ORDER BY l.follow_up_due_on, l.created_at, l.id
            LIMIT 1
            FOR UPDATE OF l SKIP LOCKED`
        : await tx<{ id: string; email: string; step: number; continuing: boolean }[]>`
            SELECT l.id, l.email::text AS email, l.follow_ups_sent + 1 AS step, true AS continuing
            FROM gym_lead_sends c
            JOIN gym_leads l ON l.gym_id = c.gym_id AND l.id = c.lead_id AND l.email_ok_at = c.ok_at
            WHERE c.gym_id = ${gym.id}
              AND c.counted
              AND l.follow_up_due_on IS NOT NULL
              AND l.follow_up_due_on <= ${gym.today}::date
              AND l.status = 'new'
              AND l.email IS NOT NULL
              AND l.email_ok_at IS NOT NULL
              AND l.id <> ALL(${skipLeads}::uuid[])
              AND NOT EXISTS (
                SELECT 1 FROM gym_lead_sends x
                WHERE x.lead_id = l.id AND x.ok_at = l.email_ok_at AND x.step = l.follow_ups_sent + 1)
            ORDER BY l.follow_up_due_on, l.created_at, l.id
            LIMIT 1
            FOR UPDATE OF l SKIP LOCKED`;
      const first = picked[0];
      if (first !== undefined) {
        lead = { ...first, gym_id: gym.id, month: gym.month };
        break;
      }
    }
    if (lead === undefined) return null;
    // The tick is copied inside the database: a JavaScript Date would drop its microseconds.
    const rows = await tx<ClaimedRow[]>`
      INSERT INTO gym_lead_sends (gym_id, lead_id, ok_at, step, month, counted, email, email_hmac,
                                  state, attempts, not_before, lease_until, created_at)
      SELECT l.gym_id, l.id, l.email_ok_at, ${lead.step}, ${lead.month}, ${!lead.continuing}, l.email, ${limits.hmacOf(lead.email)},
             'sending', 1, ${now}, ${leaseUntil}, ${now}
      FROM gym_leads l
      WHERE l.gym_id = ${lead.gym_id} AND l.id = ${lead.id}
      RETURNING id, gym_id, lead_id, step, email::text AS email, email_hmac, attempts, maybe_sent_at, created_at`;
    const row = rows[0];
    if (row === undefined) throw new Error(`lead ${lead.id} vanished under its lock`);
    return toClaimed(row);
  });
}

/** What the worker checks about a taken follow-up just before it goes, read in the
 *  caller's transaction with the lead locked, so staff cannot change it underneath. */
export interface LeadSendContext {
  gym: {
    name: string;
    postalAddress: string | null;
    timezone: string;
    active: boolean;
    onPlan: boolean;
    stopped: boolean;
    sendForMe: boolean;
    replyTo: string | null;
  } | null;
  lead: {
    fullName: string;
    email: string | null;
    status: string;
    sameTick: boolean;
    sent: number;
    due: boolean;
    emailOkAt: Date | null;
    followUpLastAt: Date | null;
  } | null;
}

export async function lockSendContext(tx: TransactionSql, send: ClaimedLeadSend, now: Date): Promise<LeadSendContext> {
  const gyms = await tx<
    {
      name: string;
      postal_address: string | null;
      timezone: string;
      status: string;
      on_plan: boolean;
      stopped: boolean;
      send_for_me: boolean | null;
      reply_to: string | null;
    }[]
  >`
    SELECT g.name, g.postal_address, g.timezone, g.status, g.invites_stopped_at IS NOT NULL AS stopped,
           s.send_for_me, s.reply_to::text AS reply_to,
           EXISTS (
             SELECT 1 FROM subscriptions sub
             WHERE sub.owner_type = 'gym' AND sub.owner_id = g.id AND sub.status IN ('trialing','active','past_due')) AS on_plan
    FROM gyms g
    LEFT JOIN gym_lead_email_settings s ON s.gym_id = g.id
    WHERE g.id = ${send.gymId}`;
  const leads =
    send.leadId === null
      ? []
      : await tx<
          {
            full_name: string;
            email: string | null;
            status: string;
            same_tick: boolean;
            sent: number;
            due: boolean;
            email_ok_at: Date | null;
            follow_up_last_at: Date | null;
          }[]
        >`
          SELECT l.full_name, l.email::text AS email, l.status,
                 coalesce(l.email_ok_at = s.ok_at, false) AS same_tick,
                 l.follow_ups_sent AS sent,
                 coalesce(l.follow_up_due_on <= (${now}::timestamptz AT TIME ZONE g.timezone)::date, false) AS due,
                 l.email_ok_at, l.follow_up_last_at
          FROM gym_lead_sends s
          JOIN gym_leads l ON l.gym_id = s.gym_id AND l.id = s.lead_id
          JOIN gyms g ON g.id = s.gym_id
          WHERE s.id = ${send.id} AND s.gym_id = ${send.gymId}
          FOR UPDATE OF l`;
  const gym = gyms[0];
  const lead = leads[0];
  return {
    gym:
      gym === undefined
        ? null
        : {
            name: gym.name,
            postalAddress: gym.postal_address,
            timezone: gym.timezone,
            active: gym.status === "active",
            onPlan: gym.on_plan,
            stopped: gym.stopped,
            sendForMe: gym.send_for_me ?? false,
            replyTo: gym.reply_to,
          },
    lead:
      lead === undefined
        ? null
        : {
            fullName: lead.full_name,
            email: lead.email,
            status: lead.status,
            sameTick: lead.same_tick,
            sent: lead.sent,
            due: lead.due,
            emailOkAt: lead.email_ok_at,
            followUpLastAt: lead.follow_up_last_at,
          },
  };
}

/** Record, before an email is handed to Resend, that from now on it may have gone.
 *  False when the claim is no longer this run's: then nothing may be sent. */
export async function markMaybeSent(tx: TransactionSql, send: ClaimedLeadSend, at: Date): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_lead_sends SET maybe_sent_at = coalesce(maybe_sent_at, ${at})
    WHERE id = ${send.id} AND gym_id = ${send.gymId} AND state = 'sending' AND attempts = ${send.attempts}
    RETURNING id`;
  return rows.length === 1;
}

/** Forget a taken email that never went: it was not due any more. False when the claim
 *  was no longer this run's. */
export async function dropSend(sql: SqlOrTx, send: ClaimedLeadSend): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    DELETE FROM gym_lead_sends
    WHERE id = ${send.id} AND gym_id = ${send.gymId} AND state = 'sending' AND attempts = ${send.attempts} AND maybe_sent_at IS NULL
    RETURNING id`;
  return rows.length === 1;
}

export type LeadSendOutcome =
  | { kind: "sent"; providerId: string | null }
  | { kind: "skipped"; reason: string }
  | { kind: "failed"; reason: string };

/** Finish a taken email; the address is cleared in the same statement. Only one that
 *  went, or may have gone, keeps its place in the gym's month. False when the claim
 *  was no longer this run's. `certainlyNotSent` clears the mark this attempt made before
 *  handing it over, when Resend said it did not go. */
export async function finishSend(
  sql: SqlOrTx,
  send: ClaimedLeadSend,
  outcome: LeadSendOutcome,
  at: Date,
  certainlyNotSent = false,
): Promise<boolean> {
  const reason = outcome.kind === "sent" ? null : outcome.reason;
  const providerId = outcome.kind === "sent" ? outcome.providerId : null;
  const keepsPlace = outcome.kind === "sent" || reason === "send_unknown";
  const rows = await sql<{ id: string }[]>`
    UPDATE gym_lead_sends
    SET state = ${outcome.kind}, reason = ${reason}, provider_id = ${providerId},
        email = NULL, lease_until = NULL, finished_at = ${at},
        counted = counted AND ${keepsPlace}::boolean,
        maybe_sent_at = CASE WHEN ${certainlyNotSent}::boolean THEN NULL ELSE maybe_sent_at END
    WHERE id = ${send.id} AND gym_id = ${send.gymId} AND state = 'sending' AND attempts = ${send.attempts}
    RETURNING id`;
  return rows.length === 1;
}

/** Put a taken email back to wait until `notBefore`. `maybeSentAt` is what the row
 *  should say afterwards: the claim's own value when Resend said it did not go. */
export async function retrySend(
  sql: SqlOrTx,
  send: ClaimedLeadSend,
  notBefore: Date,
  maybeSentAt: "keep" | Date | null = "keep",
): Promise<boolean> {
  const keep = maybeSentAt === "keep";
  const value = maybeSentAt === "keep" ? null : maybeSentAt;
  const rows = await sql<{ id: string }[]>`
    UPDATE gym_lead_sends
    SET state = 'queued', lease_until = NULL, not_before = ${notBefore},
        maybe_sent_at = CASE WHEN ${keep}::boolean THEN maybe_sent_at ELSE ${value}::timestamptz END
    WHERE id = ${send.id} AND gym_id = ${send.gymId} AND state = 'sending' AND attempts = ${send.attempts}
    RETURNING id`;
  return rows.length === 1;
}

/** The lead's follow-up columns after the app sent `step`: written only while the lead
 *  still has one fewer, to the same address. */
export async function writeLeadSent(
  tx: TransactionSql,
  gymId: string,
  leadId: string,
  values: { step: number; lastAt: Date; dueOn: string | null },
): Promise<void> {
  await tx`
    UPDATE gym_leads
    SET follow_ups_sent = ${values.step}, follow_up_last_at = ${values.lastAt}, follow_up_due_on = ${values.dueOn}::date,
        updated_at = ${values.lastAt}
    WHERE gym_id = ${gymId} AND id = ${leadId} AND follow_ups_sent = ${values.step - 1}`;
}

/** An app email that is going, may have gone or went, for this lead's `step` under its
 *  current tick: staff marking the same one by hand would send it twice. */
export async function appHasStep(tx: TransactionSql, gymId: string, leadId: string, step: number): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    SELECT s.id FROM gym_lead_sends s
    JOIN gym_leads l ON l.gym_id = s.gym_id AND l.id = s.lead_id
    WHERE s.gym_id = ${gymId} AND s.lead_id = ${leadId} AND s.ok_at = l.email_ok_at AND s.step = ${step}
      AND (s.state IN ('queued','sending','sent') OR s.reason = 'send_unknown')
    LIMIT 1`;
  return rows.length > 0;
}

// ── The Stop link ────────────────────────────────────────────────────────────

/** The email a Stop link names: its gym and address, and the lead it went to. */
export async function sendForStop(
  sql: SqlOrTx,
  sendId: string,
): Promise<{ gymId: string; leadId: string | null; hmac: string; gymName: string } | null> {
  const rows = await sql<{ gym_id: string; lead_id: string | null; email_hmac: string; name: string }[]>`
    SELECT s.gym_id, s.lead_id, s.email_hmac, g.name
    FROM gym_lead_sends s JOIN gyms g ON g.id = s.gym_id
    WHERE s.id = ${sendId}`;
  const row = rows[0];
  return row === undefined ? null : { gymId: row.gym_id, leadId: row.lead_id, hmac: row.email_hmac, gymName: row.name };
}

/** The lead a Stop link names, locked: its address and tick. */
export async function lockLeadForStop(
  tx: TransactionSql,
  gymId: string,
  leadId: string,
): Promise<{ email: string | null; emailOkAt: Date | null } | null> {
  const rows = await tx<{ email: string | null; email_ok_at: Date | null }[]>`
    SELECT email::text AS email, email_ok_at FROM gym_leads
    WHERE gym_id = ${gymId} AND id = ${leadId}
    FOR UPDATE`;
  const row = rows[0];
  return row === undefined ? null : { email: row.email, emailOkAt: row.email_ok_at };
}

/** Take a lead's "Happy to hear from us" tick off, and with it every follow-up due. */
export async function untickLead(tx: TransactionSql, gymId: string, leadId: string, at: Date): Promise<void> {
  await tx`
    UPDATE gym_leads SET email_ok_at = NULL, follow_up_due_on = NULL, updated_at = ${at}
    WHERE gym_id = ${gymId} AND id = ${leadId}`;
}
