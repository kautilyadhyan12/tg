// The only file that touches the invitation tables (Part 3 §9.12). Every statement
// names its gym, except the two a public unsubscribe link reaches, which are keyed by
// an invitation id the link's MAC has already proved, the one a Resend report
// reaches, keyed by the email's tag or Resend's id for it, whose gym every later
// write then names, and the two a signed-in person's own address reaches (§10.2),
// keyed by that address's HMAC.
import type { Sql, TransactionSql } from "postgres";
import {
  memberInviteEmailReasonSchema,
  memberInviteEmailResultSchema,
  memberInviteEmailStateSchema,
  memberInviteStateSchema,
  type MemberInviteEmailReason,
  type MemberInviteEmailResult,
  type MemberInviteState,
  type MemberListInvitation,
} from "@app/shared";
import { INVITE_STANDING, mayGymSend, type GateFacts, type GymCounts, type StopReason } from "./standing.js";

type SqlOrTx = Sql | TransactionSql;

/** The three word filters, each folded by the caller, null meaning everybody. */
export interface WordFilters {
  statuses: readonly string[] | null;
  membershipTypes: readonly string[] | null;
  paymentStatuses: readonly string[] | null;
}

export interface Candidate {
  entryId: string;
  email: string | null;
}

/** The list's current people an Invite with these filters is for, in the list's order.
 *  The filters are `entriesPage`'s own. */
export async function inviteCandidates(sql: SqlOrTx, gymId: string, filters: WordFilters): Promise<Candidate[]> {
  const statuses = filters.statuses === null ? null : [...filters.statuses];
  const membershipTypes = filters.membershipTypes === null ? null : [...filters.membershipTypes];
  const paymentStatuses = filters.paymentStatuses === null ? null : [...filters.paymentStatuses];
  const rows = await sql<{ id: string; email: string | null }[]>`
    SELECT e.id, e.email::text AS email
    FROM gym_member_list_entries e
    WHERE e.gym_id = ${gymId}
      AND e.former_at IS NULL
      AND (${statuses}::text[] IS NULL OR lower(coalesce(e.status, '')) = ANY(${statuses}::text[]))
      AND (${membershipTypes}::text[] IS NULL
           OR lower(coalesce(e.membership_type, '')) = ANY(${membershipTypes}::text[]))
      AND (${paymentStatuses}::text[] IS NULL
           OR lower(coalesce(e.payment_status, '')) = ANY(${paymentStatuses}::text[]))
    ORDER BY e.listed_seq`;
  return rows.map((row) => ({ entryId: row.id, email: row.email }));
}

/** Every entry of the gym that has an address, current or former, for the list's
 *  invitation filter. */
export async function entryAddresses(sql: SqlOrTx, gymId: string): Promise<{ entryId: string; email: string }[]> {
  const rows = await sql<{ id: string; email: string }[]>`
    SELECT e.id, e.email::text AS email
    FROM gym_member_list_entries e
    WHERE e.gym_id = ${gymId} AND e.email IS NOT NULL`;
  return rows.map((row) => ({ entryId: row.id, email: row.email }));
}

/** The gym's current entries that have an address: only the id and the address, since
 *  every one is read to be hashed and a few are kept. */
export async function currentEntryAddresses(sql: SqlOrTx, gymId: string): Promise<{ entryId: string; email: string }[]> {
  const rows = await sql<{ id: string; email: string }[]>`
    SELECT e.id, e.email::text AS email
    FROM gym_member_list_entries e
    WHERE e.gym_id = ${gymId} AND e.former_at IS NULL AND e.email IS NOT NULL`;
  return rows.map((row) => ({ entryId: row.id, email: row.email }));
}

/** These entries' names, by id. */
export async function entryNames(sql: SqlOrTx, gymId: string, entryIds: readonly string[]): Promise<Map<string, string>> {
  if (entryIds.length === 0) return new Map();
  const rows = await sql<{ id: string; full_name: string }[]>`
    SELECT id, full_name FROM gym_member_list_entries WHERE gym_id = ${gymId} AND id = ANY(${[...entryIds]}::uuid[])`;
  return new Map(rows.map((row) => [row.id, row.full_name]));
}

/** The gym's invitations that came back "Not me", by HMAC, with when. */
export async function notMeInvitations(sql: SqlOrTx, gymId: string): Promise<Map<string, Date>> {
  const rows = await sql<{ email_hmac: string; not_me_at: Date }[]>`
    SELECT email_hmac, not_me_at FROM gym_invites WHERE gym_id = ${gymId} AND not_me_at IS NOT NULL`;
  return new Map(rows.map((row) => [row.email_hmac, row.not_me_at]));
}

/** The addresses of these entries of the gym, lower-cased. */
export async function emailsOfEntries(sql: SqlOrTx, gymId: string, entryIds: readonly string[]): Promise<Set<string>> {
  if (entryIds.length === 0) return new Set();
  const rows = await sql<{ email: string }[]>`
    SELECT lower(e.email::text) AS email
    FROM gym_member_list_entries e
    WHERE e.gym_id = ${gymId} AND e.id = ANY(${[...entryIds]}::uuid[]) AND e.email IS NOT NULL`;
  return new Set(rows.map((row) => row.email));
}

/** The gym's current entries holding exactly this address. */
export async function addressHolders(sql: SqlOrTx, gymId: string, email: string): Promise<{ entryId: string; phone: string | null }[]> {
  const rows = await sql<{ id: string; phone_e164: string | null }[]>`
    SELECT id, phone_e164 FROM gym_member_list_entries
    WHERE gym_id = ${gymId} AND former_at IS NULL AND email = ${email}::citext`;
  return rows.map((row) => ({ entryId: row.id, phone: row.phone_e164 }));
}

/** The gym's postal address, for the check before anything is queued. */
export async function gymPostalAddress(sql: SqlOrTx, gymId: string): Promise<string | null> {
  const rows = await sql<{ postal_address: string | null }[]>`SELECT postal_address FROM gyms WHERE id = ${gymId}`;
  return rows[0]?.postal_address ?? null;
}

const parseState = (value: string, id: string): MemberInviteState => {
  const parsed = memberInviteStateSchema.safeParse(value);
  if (!parsed.success) throw new Error(`gym invite ${id} holds a state that no longer parses`);
  return parsed.data;
};

export interface InviteRow {
  id: string;
  hmac: string;
  state: MemberInviteState;
  /** An email of this invitation went, may have gone, or is waiting to go. Without one,
   *  nobody was ever emailed about it and a press may queue its first email again. */
  reached: boolean;
}

/** The gym's invitations to these addresses, by HMAC. */
export async function invitesFor(sql: SqlOrTx, gymId: string, hmacs: readonly string[]): Promise<Map<string, InviteRow>> {
  if (hmacs.length === 0) return new Map();
  const rows = await sql<{ id: string; email_hmac: string; state: string; reached: boolean }[]>`
    SELECT i.id, i.email_hmac, i.state,
           EXISTS (
             SELECT 1 FROM gym_invite_sends s
             WHERE s.gym_id = i.gym_id AND s.invite_id = i.id
               AND (s.state IN ('queued','sending','sent') OR s.reason = 'send_unknown')
           ) AS reached
    FROM gym_invites i
    WHERE i.gym_id = ${gymId} AND i.email_hmac = ANY(${[...hmacs]}::text[])`;
  return new Map(
    rows.map((row) => [
      row.email_hmac,
      { id: row.id, hmac: row.email_hmac, state: parseState(row.state, row.id), reached: row.reached },
    ]),
  );
}

/** Is this invitation done with, as far as a press or Invite is concerned: answered,
 *  or an email of it went, may have gone, or is on its way? One email per person per
 *  gym is about emails, so an invitation nobody was ever emailed about can have its
 *  first email queued again. */
export const alreadyInvited = (invite: InviteRow): boolean => invite.state !== "pending" || invite.reached;

/** Every invitation the gym has, by HMAC. */
export async function allInvites(sql: SqlOrTx, gymId: string): Promise<Map<string, MemberInviteState>> {
  const rows = await sql<{ id: string; email_hmac: string; state: string }[]>`
    SELECT id, email_hmac, state FROM gym_invites WHERE gym_id = ${gymId}`;
  return new Map(rows.map((row) => [row.email_hmac, parseState(row.state, row.id)]));
}

export type SuppressionReason = "unsubscribed" | "complained" | "bounced" | "refused";

/** Which of these addresses no invitation from this gym may go to, and why: this
 *  gym's unsubscribes and complaints, and every gym's hard bounces and refusals. */
export async function suppressionsFor(
  sql: SqlOrTx,
  gymId: string,
  hmacs: readonly string[],
): Promise<Map<string, SuppressionReason>> {
  if (hmacs.length === 0) return new Map();
  const rows = await sql<{ email_hmac: string; reason: string }[]>`
    SELECT email_hmac, reason
    FROM email_suppressions
    WHERE email_hmac = ANY(${[...hmacs]}::text[]) AND (gym_id = ${gymId} OR gym_id IS NULL)
    -- A bounce outranks a refusal, then a complaint, then an unsubscribe.
    ORDER BY CASE reason WHEN 'bounced' THEN 0 WHEN 'refused' THEN 1 WHEN 'complained' THEN 2 ELSE 3 END`;
  const found = new Map<string, SuppressionReason>();
  for (const row of rows) {
    if (found.has(row.email_hmac)) continue;
    if (row.reason !== "unsubscribed" && row.reason !== "complained" && row.reason !== "bounced" && row.reason !== "refused") {
      throw new Error("email suppression holds a reason that no longer parses");
    }
    found.set(row.email_hmac, row.reason);
  }
  return found;
}

/** Queue the first email for each address, creating its invitation, or, for a pending
 *  invitation nobody was ever emailed about, queueing its first email again. An address
 *  with an email that went, may have gone or is waiting is left alone — by the check
 *  here and, for two presses at once, by the unique index on a live first email — so a
 *  second press, a second member of staff or a retry queues nothing more. Answers how
 *  many were queued. */
export async function queueFirst(
  tx: SqlOrTx,
  gymId: string,
  people: readonly { hmac: string; email: string }[],
  at: Date,
): Promise<number> {
  if (people.length === 0) return 0;
  const payload = people.map((person, ord) => ({ hmac: person.hmac, email: person.email, ord }));
  const rows = await tx<{ id: string }[]>`
    WITH input AS (
      SELECT r.hmac, r.email, r.ord
      FROM jsonb_to_recordset(${tx.json(payload)}) AS r(hmac text, email text, ord int)
    ),
    created AS (
      INSERT INTO gym_invites (gym_id, email_hmac, created_at)
      SELECT ${gymId}, input.hmac, ${at} FROM input ORDER BY input.ord
      ON CONFLICT (gym_id, email_hmac) DO NOTHING
      RETURNING id, email_hmac
    ),
    -- The new invitations, and the pending ones that were already there (a statement
    -- does not see its own inserts, so nothing is here twice).
    invited AS (
      SELECT created.id, created.email_hmac FROM created
      UNION ALL
      SELECT i.id, i.email_hmac FROM gym_invites i JOIN input ON input.hmac = i.email_hmac
      WHERE i.gym_id = ${gymId} AND i.state = 'pending'
    )
    INSERT INTO gym_invite_sends (gym_id, invite_id, kind, email, not_before, created_at)
    SELECT ${gymId}, invited.id, 'first', input.email, ${at}, ${at}
    FROM invited JOIN input ON input.hmac = invited.email_hmac
    WHERE NOT EXISTS (
      SELECT 1 FROM gym_invite_sends s
      WHERE s.gym_id = ${gymId} AND s.invite_id = invited.id
        AND (s.state IN ('queued','sending','sent') OR s.reason = 'send_unknown'))
    ON CONFLICT (invite_id) WHERE kind = 'first' AND (state IN ('queued','sending','sent') OR reason = 'send_unknown')
    DO NOTHING
    RETURNING id`;
  return rows.length;
}

/** Make a declined or withdrawn invitation pending again (§10.2: "Invite again"
 *  re-opens it). */
export async function reopenInvitation(tx: TransactionSql, gymId: string, inviteId: string): Promise<void> {
  await tx`
    UPDATE gym_invites SET state = 'pending', answered_at = NULL, not_me_at = NULL
    WHERE gym_id = ${gymId} AND id = ${inviteId} AND state IN ('declined','withdrawn')`;
}

/** Has the person this invitation reached said it is not theirs? */
export async function saidNotMe(sql: SqlOrTx, gymId: string, inviteId: string): Promise<boolean> {
  const rows = await sql<{ not_me: boolean }[]>`
    SELECT not_me_at IS NOT NULL AS not_me FROM gym_invites WHERE gym_id = ${gymId} AND id = ${inviteId}`;
  return rows[0]?.not_me ?? false;
}

/** Queue one more email for an invitation, at the person's request. */
export async function queueAgain(tx: TransactionSql, gymId: string, inviteId: string, email: string, at: Date): Promise<void> {
  await tx`
    INSERT INTO gym_invite_sends (gym_id, invite_id, kind, email, not_before, created_at)
    VALUES (${gymId}, ${inviteId}, 'again', ${email}, ${at}, ${at})`;
}

/** Is an email for this invitation still waiting to go, or going? */
export async function hasOpenSend(sql: SqlOrTx, gymId: string, inviteId: string): Promise<boolean> {
  const rows = await sql<{ open: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM gym_invite_sends
      WHERE gym_id = ${gymId} AND invite_id = ${inviteId} AND state IN ('queued','sending')
    ) AS open`;
  return rows[0]?.open ?? false;
}

/** "Send again" so far: for this invitation in the last `personDays` days, and for the
 *  gym in the last 24 hours. An email the worker skipped or could not send does not
 *  count: nobody received it. */
export async function againUsage(
  sql: SqlOrTx,
  gymId: string,
  inviteId: string,
  at: Date,
  personDays: number,
): Promise<{ person: number; gym: number }> {
  const personSince = new Date(at.getTime() - personDays * 24 * 60 * 60 * 1000);
  const gymSince = new Date(at.getTime() - 24 * 60 * 60 * 1000);
  const rows = await sql<{ person: number; gym: number }[]>`
    SELECT
      (SELECT count(*)::int FROM gym_invite_sends
        WHERE gym_id = ${gymId} AND invite_id = ${inviteId} AND kind = 'again'
          AND state NOT IN ('skipped','failed') AND created_at > ${personSince}) AS person,
      (SELECT count(*)::int FROM gym_invite_sends
        WHERE gym_id = ${gymId} AND kind = 'again'
          AND state NOT IN ('skipped','failed') AND created_at > ${gymSince}) AS gym`;
  return { person: rows[0]?.person ?? 0, gym: rows[0]?.gym ?? 0 };
}

/** The gym's invitations to these addresses as a person's page and the list show
 *  them, by HMAC: the state, when, the newest email and how many were sent again. */
export async function invitationViews(
  sql: SqlOrTx,
  gymId: string,
  hmacs: readonly string[],
): Promise<Map<string, MemberListInvitation>> {
  if (hmacs.length === 0) return new Map();
  const rows = await sql<
    {
      id: string;
      email_hmac: string;
      state: string;
      created_at: Date;
      email_state: string | null;
      email_reason: string | null;
      email_at: Date | null;
      email_result: string | null;
      again: number;
      waiting_since: Date | null;
      not_me_at: Date | null;
    }[]
  >`
    SELECT i.id, i.email_hmac, i.state, i.created_at, i.waiting_since, i.not_me_at,
           l.state AS email_state,
           l.reason AS email_reason,
           coalesce(l.finished_at, l.created_at) AS email_at,
           l.result AS email_result,
           (SELECT count(*)::int FROM gym_invite_sends a
             WHERE a.gym_id = i.gym_id AND a.invite_id = i.id AND a.kind = 'again' AND a.state = 'sent') AS again
    FROM gym_invites i
    LEFT JOIN LATERAL (
      SELECT s.state, s.reason, s.finished_at, s.created_at, s.result
      FROM gym_invite_sends s
      WHERE s.gym_id = i.gym_id AND s.invite_id = i.id
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT 1
    ) l ON true
    WHERE i.gym_id = ${gymId} AND i.email_hmac = ANY(${[...hmacs]}::text[])`;
  const views = new Map<string, MemberListInvitation>();
  for (const row of rows) {
    let email: MemberListInvitation["email"] = null;
    if (row.email_state !== null && row.email_at !== null) {
      const state = memberInviteEmailStateSchema.safeParse(row.email_state);
      const reason = row.email_reason === null ? null : memberInviteEmailReasonSchema.safeParse(row.email_reason);
      const result = row.email_result === null ? null : memberInviteEmailResultSchema.safeParse(row.email_result);
      if (!state.success || (reason !== null && !reason.success) || (result !== null && !result.success)) {
        throw new Error(`gym invite ${row.id} has an email whose state no longer parses`);
      }
      email = {
        state: state.data,
        reason: reason === null ? null : reason.data,
        at: row.email_at.toISOString(),
        result: result === null ? null : result.data,
      };
    }
    views.set(row.email_hmac, {
      state: parseState(row.state, row.id),
      invitedAt: row.created_at.toISOString(),
      email,
      sentAgain: row.again,
      waitingSince: row.waiting_since?.toISOString() ?? null,
      notMeAt: row.not_me_at?.toISOString() ?? null,
    });
  }
  return views;
}

// ── The unsubscribe link (public; the token's MAC has proved the id) ─────────

/** The invitation an unsubscribe link names, with its gym's name. */
export async function inviteForUnsubscribe(
  sql: SqlOrTx,
  inviteId: string,
): Promise<{ gymId: string; hmac: string; gymName: string } | null> {
  const rows = await sql<{ gym_id: string; email_hmac: string; name: string }[]>`
    SELECT i.gym_id, i.email_hmac, g.name
    FROM gym_invites i JOIN gyms g ON g.id = i.gym_id
    WHERE i.id = ${inviteId}`;
  const row = rows[0];
  return row === undefined ? null : { gymId: row.gym_id, hmac: row.email_hmac, gymName: row.name };
}

/** The invitation a "Not me" link names, locked, under the caller's lock on its gym. */
export async function lockInvitationById(
  tx: TransactionSql,
  gymId: string,
  inviteId: string,
): Promise<{ id: string; state: MemberInviteState; notMe: boolean } | null> {
  const rows = await tx<{ id: string; state: string; not_me: boolean }[]>`
    SELECT id, state, not_me_at IS NOT NULL AS not_me FROM gym_invites
    WHERE gym_id = ${gymId} AND id = ${inviteId}
    FOR UPDATE`;
  const row = rows[0];
  return row === undefined ? null : { id: row.id, state: parseState(row.state, row.id), notMe: row.not_me };
}

/** Keep this address from this gym's invitations. Twice is once. */
export async function suppressForGym(sql: SqlOrTx, gymId: string, hmac: string, reason: "unsubscribed" | "complained"): Promise<void> {
  await sql`
    INSERT INTO email_suppressions (email_hmac, gym_id, reason)
    VALUES (${hmac}, ${gymId}, ${reason})
    ON CONFLICT (email_hmac, gym_id) WHERE gym_id IS NOT NULL DO NOTHING`;
}

// ── The worker ───────────────────────────────────────────────────────────────

/** An email the worker has claimed. `attempts` is the claim's own number: every write
 *  that finishes it names it, so a claim that timed out and was taken over by another
 *  run cannot finish the row a second time. `maybeSentAt` is set once an attempt may
 *  have reached Resend. */
export interface ClaimedSend {
  id: string;
  gymId: string;
  inviteId: string;
  kind: "first" | "again";
  email: string | null;
  attempts: number;
  maybeSentAt: Date | null;
  createdAt: Date;
}

interface ClaimedRow {
  id: string;
  gym_id: string;
  invite_id: string;
  kind: string;
  email: string | null;
  attempts: number;
  maybe_sent_at: Date | null;
  created_at: Date;
}

const toClaimed = (row: ClaimedRow): ClaimedSend => {
  if (row.kind !== "first" && row.kind !== "again") throw new Error(`invite send ${row.id} holds a kind that no longer parses`);
  return {
    id: row.id,
    gymId: row.gym_id,
    inviteId: row.invite_id,
    kind: row.kind,
    email: row.email,
    attempts: row.attempts,
    maybeSentAt: row.maybe_sent_at,
    createdAt: row.created_at,
  };
};

export interface ClaimLimits {
  now: Date;
  leaseMs: number;
  /** The most the whole app sends in any 24 hours. */
  platformPerDay: number;
  /** The most one gym sends in any 24 hours, on a paid plan and on a trial. */
  gymPerDay: number;
  trialGymPerDay: number;
}

/** For each gym with an email due: whether it is stopped, and how far its first batch
 *  has gone (`mayGymSend` decides). Counts start at the gym's `invites_counted_from`. */
export async function gateFacts(sql: SqlOrTx, now: Date): Promise<{ gymId: string; facts: GateFacts }[]> {
  const rows = await sql<
    { id: string; stopped: boolean; sent_or_sending: number; first_sent: number; with_result: number; last_sent_at: Date | null }[]
  >`
    WITH due AS (
      SELECT DISTINCT s.gym_id FROM gym_invite_sends s
      WHERE (s.state = 'queued' AND s.not_before <= ${now}) OR (s.state = 'sending' AND s.lease_until < ${now})
    )
    SELECT g.id,
           g.invites_stopped_at IS NOT NULL AS stopped,
           (SELECT count(*)::int FROM (
              SELECT 1 FROM gym_invite_sends x
              WHERE x.gym_id = g.id
                AND ((x.state = 'sent' AND x.finished_at >= coalesce(g.invites_counted_from, '-infinity'::timestamptz))
                     OR (x.state = 'sending' AND x.lease_until >= ${now}))
              LIMIT ${INVITE_STANDING.firstBatch}) n) AS sent_or_sending,
           f.first_sent, f.with_result, f.last_sent_at
    FROM gyms g
    JOIN due ON due.gym_id = g.id
    CROSS JOIN LATERAL (
      SELECT count(*)::int AS first_sent,
             count(*) FILTER (WHERE b.result IS NOT NULL)::int AS with_result,
             max(b.finished_at) AS last_sent_at
      FROM (
        SELECT x.result, x.finished_at FROM gym_invite_sends x
        WHERE x.gym_id = g.id AND x.state = 'sent'
          AND x.finished_at >= coalesce(g.invites_counted_from, '-infinity'::timestamptz)
        ORDER BY x.finished_at, x.id
        LIMIT ${INVITE_STANDING.firstBatch}
      ) b
    ) f`;
  return rows.map((row) => ({
    gymId: row.id,
    facts: {
      stopped: row.stopped,
      sentOrSending: row.sent_or_sending,
      firstBatch: { sent: row.first_sent, withResult: row.with_result, lastSentAt: row.last_sent_at },
    },
  }));
}

/** Take the next email that is due and within every cap, and lease it. A gym that is
 *  stopped, or waiting for its first 50 emails' results, is passed over. Claims are
 *  serialised by a transaction-level advisory lock, so two workers cannot both take
 *  the last place under a cap. An email that may already have gone is taken first and
 *  outside the caps: it is the same email again, and Resend forgets its key after a day.
 *  Answers null when nothing is due, and `capped` when the whole app has reached its day. */
export async function claimNextSend(sql: Sql, limits: ClaimLimits): Promise<ClaimedSend | "capped" | null> {
  const dayAgo = new Date(limits.now.getTime() - 24 * 60 * 60 * 1000);
  const leaseUntil = new Date(limits.now.getTime() + limits.leaseMs);
  return await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('gym_invite_sends.claim'))`;
    const again = await tx<ClaimedRow[]>`
      WITH next AS (
        SELECT s.id FROM gym_invite_sends s
        WHERE s.maybe_sent_at IS NOT NULL
          AND ((s.state = 'queued' AND s.not_before <= ${limits.now})
               OR (s.state = 'sending' AND s.lease_until < ${limits.now}))
        ORDER BY s.not_before, s.id
        LIMIT 1
        FOR UPDATE OF s SKIP LOCKED
      )
      UPDATE gym_invite_sends u
      SET state = 'sending', lease_until = ${leaseUntil}, attempts = u.attempts + 1
      FROM next
      WHERE u.id = next.id
      RETURNING u.id, u.gym_id, u.invite_id, u.kind, u.email::text AS email, u.attempts, u.maybe_sent_at, u.created_at`;
    const retry = again[0];
    if (retry !== undefined) return toClaimed(retry);
    const used = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM gym_invite_sends
      WHERE (state = 'sent' AND finished_at > ${dayAgo})
         OR (state = 'sending' AND lease_until >= ${limits.now})`;
    if ((used[0]?.n ?? 0) >= limits.platformPerDay) return "capped";
    const waiting = (await gateFacts(tx, limits.now)).flatMap((gym) => (mayGymSend(gym.facts, limits.now) ? [] : [gym.gymId]));
    const rows = await tx<ClaimedRow[]>`
      WITH busy AS (
        SELECT x.gym_id, count(*) AS n
        FROM gym_invite_sends x
        WHERE (x.state = 'sent' AND x.finished_at > ${dayAgo})
           OR (x.state = 'sending' AND x.lease_until >= ${limits.now})
        GROUP BY x.gym_id
      ),
      capped AS (
        SELECT busy.gym_id FROM busy
        WHERE busy.n >= CASE
          WHEN EXISTS (
            SELECT 1 FROM subscriptions sub
            WHERE sub.owner_type = 'gym' AND sub.owner_id = busy.gym_id AND sub.status = 'trialing'
              AND sub.provider <> 'paddle')
          THEN ${limits.trialGymPerDay}::int
          ELSE ${limits.gymPerDay}::int
        END
      ),
      next AS (
        SELECT s.id FROM gym_invite_sends s
        WHERE ((s.state = 'queued' AND s.not_before <= ${limits.now})
               OR (s.state = 'sending' AND s.lease_until < ${limits.now}))
          AND s.gym_id NOT IN (SELECT capped.gym_id FROM capped)
          AND s.gym_id <> ALL(${waiting}::uuid[])
        ORDER BY s.not_before, s.created_at, s.id
        LIMIT 1
        FOR UPDATE OF s SKIP LOCKED
      )
      UPDATE gym_invite_sends u
      SET state = 'sending', lease_until = ${leaseUntil}, attempts = u.attempts + 1
      FROM next
      WHERE u.id = next.id
      RETURNING u.id, u.gym_id, u.invite_id, u.kind, u.email::text AS email, u.attempts, u.maybe_sent_at, u.created_at`;
    const row = rows[0];
    return row === undefined ? null : toClaimed(row);
  });
}

/** Record, before an email is handed to Resend, that from now on it may have gone.
 *  False when the claim is no longer this run's: then nothing may be sent. */
export async function markMaybeSent(sql: SqlOrTx, send: ClaimedSend, at: Date): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE gym_invite_sends SET maybe_sent_at = coalesce(maybe_sent_at, ${at})
    WHERE id = ${send.id} AND gym_id = ${send.gymId} AND state = 'sending' AND attempts = ${send.attempts}
    RETURNING id`;
  return rows.length === 1;
}

/** What the worker checks about a claimed email just before it goes. */
export interface SendContext {
  invite: { hmac: string; state: MemberInviteState } | null;
  gym: {
    name: string;
    city: string | null;
    slug: string;
    postalAddress: string | null;
    active: boolean;
    onPlan: boolean;
    stopped: boolean;
  } | null;
  /** The gym's current entries holding exactly this address. */
  holders: { entryId: string; phone: string | null }[];
}

export async function sendContext(sql: SqlOrTx, send: ClaimedSend): Promise<SendContext> {
  const invites = await sql<{ email_hmac: string; state: string; id: string }[]>`
    SELECT id, email_hmac, state FROM gym_invites WHERE gym_id = ${send.gymId} AND id = ${send.inviteId}`;
  const gyms = await sql<
    {
      name: string;
      city: string | null;
      slug: string;
      postal_address: string | null;
      status: string;
      on_plan: boolean;
      stopped: boolean;
    }[]
  >`
    SELECT g.name, g.city, g.slug, g.postal_address, g.status, g.invites_stopped_at IS NOT NULL AS stopped,
           EXISTS (
             SELECT 1 FROM subscriptions s
             WHERE s.owner_type = 'gym' AND s.owner_id = g.id
               AND s.status IN ('trialing','active','past_due')) AS on_plan
    FROM gyms g WHERE g.id = ${send.gymId}`;
  const holders = send.email === null ? [] : await addressHolders(sql, send.gymId, send.email);
  const invite = invites[0];
  const gym = gyms[0];
  return {
    invite: invite === undefined ? null : { hmac: invite.email_hmac, state: parseState(invite.state, invite.id) },
    gym:
      gym === undefined
        ? null
        : {
            name: gym.name,
            city: gym.city,
            slug: gym.slug,
            postalAddress: gym.postal_address,
            active: gym.status === "active",
            onPlan: gym.on_plan,
            stopped: gym.stopped,
          },
    holders,
  };
}

export type SendOutcome =
  | { kind: "sent"; providerId: string | null }
  | { kind: "skipped"; reason: MemberInviteEmailReason }
  | { kind: "failed"; reason: MemberInviteEmailReason };

/** Finish a claimed email. The address is cleared in the same statement. False when
 *  the claim was no longer this run's. `certainlyNotSent` clears the mark this attempt
 *  made before handing it over, when Resend said it did not go. */
export async function finishSend(
  sql: SqlOrTx,
  send: ClaimedSend,
  outcome: SendOutcome,
  at: Date,
  certainlyNotSent = false,
): Promise<boolean> {
  const reason = outcome.kind === "sent" ? null : outcome.reason;
  const providerId = outcome.kind === "sent" ? outcome.providerId : null;
  const rows = await sql<{ id: string }[]>`
    UPDATE gym_invite_sends
    SET state = ${outcome.kind}, reason = ${reason}, provider_id = ${providerId},
        email = NULL, lease_until = NULL, finished_at = ${at},
        maybe_sent_at = CASE WHEN ${certainlyNotSent}::boolean THEN NULL ELSE maybe_sent_at END
    WHERE id = ${send.id} AND gym_id = ${send.gymId} AND state = 'sending' AND attempts = ${send.attempts}
    RETURNING id`;
  return rows.length === 1;
}

/** Put a claimed email back to wait until `notBefore`. `maybeSentAt` is what the row
 *  should say afterwards: the claim's own value when Resend said the email did not go,
 *  so an attempt that certainly did not send marks nothing. */
export async function retrySend(
  sql: SqlOrTx,
  send: ClaimedSend,
  notBefore: Date,
  maybeSentAt: "keep" | Date | null = "keep",
): Promise<boolean> {
  const keep = maybeSentAt === "keep";
  const value = maybeSentAt === "keep" ? null : maybeSentAt;
  const rows = await sql<{ id: string }[]>`
    UPDATE gym_invite_sends
    SET state = 'queued', lease_until = NULL, not_before = ${notBefore},
        maybe_sent_at = CASE WHEN ${keep}::boolean THEN maybe_sent_at ELSE ${value}::timestamptz END
    WHERE id = ${send.id} AND gym_id = ${send.gymId} AND state = 'sending' AND attempts = ${send.attempts}
    RETURNING id`;
  return rows.length === 1;
}

// ── What comes back (a Resend report, confirmed with Resend) ─────────────────

/** The gym's name, for the operator's note. */
export async function gymName(sql: SqlOrTx, gymId: string): Promise<string | null> {
  const rows = await sql<{ name: string }[]>`SELECT name FROM gyms WHERE id = ${gymId}`;
  return rows[0]?.name ?? null;
}

/** Has this gym's sending been stopped? */
export async function gymInvitesStopped(sql: SqlOrTx, gymId: string): Promise<boolean> {
  const rows = await sql<{ stopped: boolean }[]>`
    SELECT invites_stopped_at IS NOT NULL AS stopped FROM gyms WHERE id = ${gymId}`;
  return rows[0]?.stopped ?? false;
}

/** The invitation email a report is about: the row its tag names, in any state, or
 *  else the sent row Resend knows by this id. Null: not an invitation. */
export interface ReportedSend {
  id: string;
  gymId: string;
  state: string;
  reason: string | null;
  providerId: string | null;
}

export async function sendForReport(sql: SqlOrTx, report: { sendId: string | null; providerId: string }): Promise<ReportedSend | null> {
  const rows =
    report.sendId !== null
      ? await sql<{ id: string; gym_id: string; state: string; reason: string | null; provider_id: string | null }[]>`
          SELECT id, gym_id, state, reason, provider_id FROM gym_invite_sends WHERE id = ${report.sendId}`
      : await sql<{ id: string; gym_id: string; state: string; reason: string | null; provider_id: string | null }[]>`
          SELECT id, gym_id, state, reason, provider_id FROM gym_invite_sends
          WHERE provider_id = ${report.providerId} AND state = 'sent'
          ORDER BY finished_at, id
          LIMIT 1`;
  const row = rows[0];
  return row === undefined
    ? null
    : { id: row.id, gymId: row.gym_id, state: row.state, reason: row.reason, providerId: row.provider_id };
}

/** An email the sender could not confirm, which Resend's own record shows went: it is
 *  sent after all, under Resend's id. */
export async function markWentAfterAll(tx: TransactionSql, gymId: string, sendId: string, providerId: string): Promise<void> {
  await tx`
    UPDATE gym_invite_sends SET state = 'sent', reason = NULL, provider_id = ${providerId}
    WHERE gym_id = ${gymId} AND id = ${sendId} AND state = 'failed' AND reason = 'send_unknown'`;
}

/** The email's result now, and the address its invitation is for, read under the
 *  caller's lock. */
export async function sendForResult(
  tx: TransactionSql,
  gymId: string,
  sendId: string,
): Promise<{ result: MemberInviteEmailResult | null; hmac: string } | null> {
  const rows = await tx<{ result: string | null; email_hmac: string }[]>`
    SELECT s.result, i.email_hmac
    FROM gym_invite_sends s JOIN gym_invites i ON i.id = s.invite_id AND i.gym_id = s.gym_id
    WHERE s.gym_id = ${gymId} AND s.id = ${sendId} AND s.state = 'sent'
    FOR UPDATE OF s`;
  const row = rows[0];
  if (row === undefined) return null;
  const result = row.result === null ? null : memberInviteEmailResultSchema.safeParse(row.result);
  if (result !== null && !result.success) throw new Error(`invite send ${sendId} holds a result that no longer parses`);
  return { result: result === null ? null : result.data, hmac: row.email_hmac };
}

export async function setResult(tx: TransactionSql, gymId: string, sendId: string, result: MemberInviteEmailResult, at: Date): Promise<void> {
  await tx`
    UPDATE gym_invite_sends SET result = ${result}, result_at = ${at}
    WHERE gym_id = ${gymId} AND id = ${sendId} AND state = 'sent'`;
}

/** Keep this address from every gym's invitations: a hard bounce, or an address Resend
 *  refuses. Twice is once; a bounce replaces a refusal, never the other way round. */
export async function suppressEveryGym(sql: SqlOrTx, hmac: string, reason: "bounced" | "refused"): Promise<void> {
  await sql`
    INSERT INTO email_suppressions (email_hmac, gym_id, reason)
    VALUES (${hmac}, NULL, ${reason})
    ON CONFLICT (email_hmac) WHERE gym_id IS NULL
    DO UPDATE SET reason = EXCLUDED.reason
    WHERE email_suppressions.reason = 'refused' AND EXCLUDED.reason = 'bounced'`;
}

/** What the gym has sent since its counts start, and what came back. An email Resend
 *  refused to deliver never reached anybody, so it is not counted at all. */
export async function gymCounts(sql: SqlOrTx, gymId: string): Promise<GymCounts> {
  const rows = await sql<{ sent: number; bounced: number; complained_early: boolean }[]>`
    WITH counted AS (
      SELECT x.result, x.finished_at, x.id
      FROM gym_invite_sends x JOIN gyms g ON g.id = x.gym_id
      WHERE x.gym_id = ${gymId} AND x.state = 'sent' AND x.result IS DISTINCT FROM 'refused'
        AND x.finished_at >= coalesce(g.invites_counted_from, '-infinity'::timestamptz)
    )
    SELECT (SELECT count(*)::int FROM counted) AS sent,
           (SELECT count(*)::int FROM counted WHERE result = 'bounced') AS bounced,
           EXISTS (
             SELECT 1 FROM (
               SELECT result FROM counted ORDER BY finished_at, id LIMIT ${INVITE_STANDING.complaintWindow}
             ) early WHERE early.result = 'complained') AS complained_early`;
  const row = rows[0];
  return { sent: row?.sent ?? 0, bounced: row?.bounced ?? 0, complainedEarly: row?.complained_early ?? false };
}

/** Stop the gym's invitations. Its waiting emails that certainly have not gone are
 *  skipped, so nothing is spent and a later press may queue them again; one that may
 *  have gone is stopped by the worker's own check. True only for the call that stopped
 *  it. */
export async function stopGym(tx: TransactionSql, gymId: string, reason: StopReason, at: Date): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    UPDATE gyms SET invites_stopped_at = ${at}, invites_stopped_reason = ${reason}
    WHERE id = ${gymId} AND invites_stopped_at IS NULL
    RETURNING id`;
  if (rows.length === 0) return false;
  await tx`
    UPDATE gym_invite_sends
    SET state = 'skipped', reason = 'sending_stopped', email = NULL, finished_at = ${at}
    WHERE gym_id = ${gymId} AND state = 'queued' AND maybe_sent_at IS NULL`;
  return true;
}

/** The gyms whose invitations are stopped: Kd's "have a look" list. */
export async function stoppedGyms(
  sql: SqlOrTx,
): Promise<{ gymId: string; name: string; reason: StopReason; stoppedAt: Date }[]> {
  const rows = await sql<{ id: string; name: string; invites_stopped_reason: string; invites_stopped_at: Date }[]>`
    SELECT id, name, invites_stopped_reason, invites_stopped_at FROM gyms
    WHERE invites_stopped_at IS NOT NULL
    ORDER BY invites_stopped_at`;
  return rows.map((row) => {
    if (row.invites_stopped_reason !== "bounces" && row.invites_stopped_reason !== "complaint") {
      throw new Error(`gym ${row.id} holds a stop reason that no longer parses`);
    }
    return { gymId: row.id, name: row.name, reason: row.invites_stopped_reason, stoppedAt: row.invites_stopped_at };
  });
}

/** Start a stopped gym again. Its counts start afresh, so it sends a first 50 and waits
 *  again. False if it was not stopped. */
export async function resumeGym(sql: SqlOrTx, gymId: string, at: Date): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE gyms SET invites_stopped_at = NULL, invites_stopped_reason = NULL, invites_counted_from = ${at}
    WHERE id = ${gymId} AND invites_stopped_at IS NOT NULL
    RETURNING id`;
  return rows.length === 1;
}
// ── Joining (§10.2): the invitation's own person, found by the address's HMAC ──
//
// Every statement below that finds an invitation names the caller's address HMAC as
// well as any id, so an invitation is only ever reached through the address it was
// sent to; the gym each one belongs to is named in every write.

export interface WaitingInvitationRow {
  id: string;
  state: "pending" | "declined";
  gymId: string;
  gymName: string;
  gymCity: string | null;
  orgType: string;
  onPlan: boolean;
  /** Its person said it is not theirs. */
  notMe: boolean;
}

/** The invitations this address may answer: waiting or declined, at an active gym whose
 *  current list still holds the address, where the person is not already a member. */
export async function invitationsForAddress(
  sql: SqlOrTx,
  input: { hmac: string; email: string; userId: string },
): Promise<WaitingInvitationRow[]> {
  const rows = await sql<
    {
      id: string;
      state: string;
      gym_id: string;
      name: string;
      city: string | null;
      org_type: string;
      on_plan: boolean;
      not_me: boolean;
    }[]
  >`
    SELECT i.id, i.state, g.id AS gym_id, g.name, g.city, g.org_type, i.not_me_at IS NOT NULL AS not_me,
           EXISTS (
             SELECT 1 FROM subscriptions s
             WHERE s.owner_type = 'gym' AND s.owner_id = g.id
               AND s.status IN ('trialing','active','past_due') -- gymHasLivePlan's set
           ) AS on_plan
    FROM gym_invites i
    JOIN gyms g ON g.id = i.gym_id
    WHERE i.email_hmac = ${input.hmac}
      AND i.state IN ('pending','declined')
      AND g.status = 'active'
      AND EXISTS (
        SELECT 1 FROM gym_member_list_entries e
        WHERE e.gym_id = i.gym_id AND e.former_at IS NULL AND e.email = ${input.email}::citext)
      AND NOT EXISTS (
        SELECT 1 FROM gym_members m
        WHERE m.gym_id = i.gym_id AND m.user_id = ${input.userId} AND m.removed_at IS NULL)
    ORDER BY i.created_at, i.id`;
  return rows.map((row) => {
    if (row.state !== "pending" && row.state !== "declined") throw new Error(`gym invite ${row.id} read in a state it was not asked for`);
    return {
      id: row.id,
      state: row.state,
      gymId: row.gym_id,
      gymName: row.name,
      gymCity: row.city,
      orgType: row.org_type,
      onPlan: row.on_plan,
      notMe: row.not_me,
    };
  });
}

/** The gym of this address's invitation, or null: the id alone finds nothing. */
export async function invitationGym(sql: SqlOrTx, inviteId: string, hmac: string): Promise<string | null> {
  const rows = await sql<{ gym_id: string }[]>`
    SELECT gym_id FROM gym_invites WHERE id = ${inviteId} AND email_hmac = ${hmac}`;
  return rows[0]?.gym_id ?? null;
}

/** The invitation, locked, under the caller's lock on its gym. */
export async function lockInvitation(
  tx: TransactionSql,
  input: { gymId: string; inviteId: string; hmac: string },
): Promise<{ id: string; state: MemberInviteState; notMe: boolean } | null> {
  const rows = await tx<{ id: string; state: string; not_me: boolean }[]>`
    SELECT id, state, not_me_at IS NOT NULL AS not_me FROM gym_invites
    WHERE gym_id = ${input.gymId} AND id = ${input.inviteId} AND email_hmac = ${input.hmac}
    FOR UPDATE`;
  const row = rows[0];
  return row === undefined ? null : { id: row.id, state: parseState(row.state, row.id), notMe: row.not_me };
}

/** Joined or declined. */
export async function answerInvitation(
  tx: TransactionSql,
  input: { gymId: string; inviteId: string; state: "accepted" | "declined"; at: Date },
): Promise<void> {
  await tx`
    UPDATE gym_invites SET state = ${input.state}, answered_at = ${input.at}, waiting_since = NULL, not_me_at = NULL
    WHERE gym_id = ${input.gymId} AND id = ${input.inviteId}`;
}

/** "Not me": declined, and marked as reaching the wrong person, so staff check the
 *  address they have. Answers false when it already said so. */
export async function markNotMe(tx: TransactionSql, input: { gymId: string; inviteId: string; at: Date }): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_invites SET state = 'declined', answered_at = ${input.at}, waiting_since = NULL, not_me_at = ${input.at}
    WHERE gym_id = ${input.gymId} AND id = ${input.inviteId} AND state IN ('pending','declined') AND not_me_at IS NULL
    RETURNING id`;
  return rows.length === 1;
}

/** A Join the gym had no place for: the invitation waits (a declined one too, since the
 *  person has now asked to join), and staff see since when. */
export async function markWaitingForPlace(tx: TransactionSql, input: { gymId: string; inviteId: string; at: Date }): Promise<void> {
  await tx`
    UPDATE gym_invites SET state = 'pending', answered_at = NULL, not_me_at = NULL,
                           waiting_since = coalesce(waiting_since, ${input.at})
    WHERE gym_id = ${input.gymId} AND id = ${input.inviteId}`;
}

/** Staff took these addresses off the list, or removed their member: their invitations
 *  let nobody in until one is sent again. Answers how many changed. */
export async function withdrawInvitations(
  tx: TransactionSql,
  input: { gymId: string; hmacs: readonly string[]; at: Date },
): Promise<number> {
  if (input.hmacs.length === 0) return 0;
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_invites SET state = 'withdrawn', answered_at = ${input.at}, waiting_since = NULL, not_me_at = NULL
    WHERE gym_id = ${input.gymId} AND email_hmac = ANY(${[...input.hmacs]}::text[]) AND state <> 'withdrawn'
    RETURNING id`;
  return rows.length;
}

/** Is this person a live member of the gym? */
export async function isLiveMember(sql: SqlOrTx, gymId: string, userId: string): Promise<boolean> {
  const rows = await sql<{ live: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM gym_members WHERE gym_id = ${gymId} AND user_id = ${userId} AND removed_at IS NULL
    ) AS live`;
  return rows[0]?.live ?? false;
}

/** The accounts' addresses, for withdrawing their invitations when staff remove them. */
export async function accountAddresses(sql: SqlOrTx, userIds: readonly string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await sql<{ email: string }[]>`
    SELECT email::text AS email FROM users WHERE id = ANY(${[...userIds]}::uuid[]) AND email IS NOT NULL`;
  return rows.map((row) => row.email);
}