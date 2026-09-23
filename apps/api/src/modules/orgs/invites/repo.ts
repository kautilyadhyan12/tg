// The only file that touches the invitation tables (Part 3 §9.12). Every statement
// names its gym, except the two a public unsubscribe link reaches, which are keyed by
// an invitation id the link's MAC has already proved.
import type { Sql, TransactionSql } from "postgres";
import {
  memberInviteEmailReasonSchema,
  memberInviteEmailStateSchema,
  memberInviteStateSchema,
  type MemberInviteEmailReason,
  type MemberInviteState,
  type MemberListInvitation,
} from "@app/shared";

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
}

/** The gym's invitations to these addresses, by HMAC. */
export async function invitesFor(sql: SqlOrTx, gymId: string, hmacs: readonly string[]): Promise<Map<string, InviteRow>> {
  if (hmacs.length === 0) return new Map();
  const rows = await sql<{ id: string; email_hmac: string; state: string }[]>`
    SELECT id, email_hmac, state
    FROM gym_invites
    WHERE gym_id = ${gymId} AND email_hmac = ANY(${[...hmacs]}::text[])`;
  return new Map(rows.map((row) => [row.email_hmac, { id: row.id, hmac: row.email_hmac, state: parseState(row.state, row.id) }]));
}

/** Every invitation the gym has, by HMAC. */
export async function allInvites(sql: SqlOrTx, gymId: string): Promise<Map<string, MemberInviteState>> {
  const rows = await sql<{ id: string; email_hmac: string; state: string }[]>`
    SELECT id, email_hmac, state FROM gym_invites WHERE gym_id = ${gymId}`;
  return new Map(rows.map((row) => [row.email_hmac, parseState(row.state, row.id)]));
}

export type SuppressionReason = "unsubscribed" | "complained" | "bounced";

/** Which of these addresses no invitation from this gym may go to, and why: this
 *  gym's unsubscribes and complaints, and every gym's hard bounces. */
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
    -- A bounce outranks a complaint, which outranks an unsubscribe.
    ORDER BY CASE reason WHEN 'bounced' THEN 0 WHEN 'complained' THEN 1 ELSE 2 END`;
  const found = new Map<string, SuppressionReason>();
  for (const row of rows) {
    if (found.has(row.email_hmac)) continue;
    if (row.reason !== "unsubscribed" && row.reason !== "complained" && row.reason !== "bounced") {
      throw new Error("email suppression holds a reason that no longer parses");
    }
    found.set(row.email_hmac, row.reason);
  }
  return found;
}

/** Queue the first email for each address, creating its invitation. An address the
 *  gym has already invited is left alone (`ON CONFLICT`), so a second press, a second
 *  member of staff or a retry queues nothing more. Answers how many were queued. */
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
    invited AS (
      INSERT INTO gym_invites (gym_id, email_hmac, created_at)
      SELECT ${gymId}, input.hmac, ${at} FROM input ORDER BY input.ord
      ON CONFLICT (gym_id, email_hmac) DO NOTHING
      RETURNING id, email_hmac
    )
    INSERT INTO gym_invite_sends (gym_id, invite_id, kind, email, not_before, created_at)
    SELECT ${gymId}, invited.id, 'first', input.email, ${at}, ${at}
    FROM invited JOIN input ON input.hmac = invited.email_hmac
    RETURNING id`;
  return rows.length;
}

/** Queue one more email for an invitation, at the person's request, and make the
 *  invitation pending again (§10.2: "Invite again" re-opens a declined or withdrawn
 *  one). */
export async function queueAgain(tx: TransactionSql, gymId: string, inviteId: string, email: string, at: Date): Promise<void> {
  await tx`
    UPDATE gym_invites SET state = 'pending'
    WHERE gym_id = ${gymId} AND id = ${inviteId} AND state IN ('declined','withdrawn')`;
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
      again: number;
    }[]
  >`
    SELECT i.id, i.email_hmac, i.state, i.created_at,
           l.state AS email_state,
           l.reason AS email_reason,
           coalesce(l.finished_at, l.created_at) AS email_at,
           (SELECT count(*)::int FROM gym_invite_sends a
             WHERE a.gym_id = i.gym_id AND a.invite_id = i.id AND a.kind = 'again') AS again
    FROM gym_invites i
    LEFT JOIN LATERAL (
      SELECT s.state, s.reason, s.finished_at, s.created_at
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
      if (!state.success || (reason !== null && !reason.success)) {
        throw new Error(`gym invite ${row.id} has an email whose state no longer parses`);
      }
      email = { state: state.data, reason: reason === null ? null : reason.data, at: row.email_at.toISOString() };
    }
    views.set(row.email_hmac, {
      state: parseState(row.state, row.id),
      invitedAt: row.created_at.toISOString(),
      email,
      sentAgain: row.again,
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
 *  run cannot finish the row a second time. */
export interface ClaimedSend {
  id: string;
  gymId: string;
  inviteId: string;
  kind: "first" | "again";
  email: string | null;
  attempts: number;
}

/** A send whose lease ran out this long ago may already have gone and its idempotency
 *  key (24 hours at the email service) may have expired, so it is never sent again. */
export const STALE_SEND_MS = 20 * 60 * 60 * 1000;

/** Give up on sends whose worker vanished long ago: sending them now could send twice. */
export async function failStaleSends(sql: SqlOrTx, now: Date): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    UPDATE gym_invite_sends
    SET state = 'failed', reason = 'provider_unavailable', email = NULL, lease_until = NULL, finished_at = ${now}
    WHERE state = 'sending' AND lease_until < ${new Date(now.getTime() - STALE_SEND_MS)}
    RETURNING id`;
  return rows.length;
}

export interface ClaimLimits {
  now: Date;
  leaseMs: number;
  /** The most the whole app sends in any 24 hours. */
  platformPerDay: number;
  /** The most one gym sends in any 24 hours, on a paid plan and on a trial. */
  gymPerDay: number;
  trialGymPerDay: number;
}

/** Take the next email that is due and within every cap, and lease it. Claims are
 *  serialised by a transaction-level advisory lock, so two workers cannot both take
 *  the last place under a cap. Answers null when nothing is due, and `capped` when
 *  the whole app has reached its day. */
export async function claimNextSend(sql: Sql, limits: ClaimLimits): Promise<ClaimedSend | "capped" | null> {
  const dayAgo = new Date(limits.now.getTime() - 24 * 60 * 60 * 1000);
  const leaseUntil = new Date(limits.now.getTime() + limits.leaseMs);
  return await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('gym_invite_sends.claim'))`;
    const used = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM gym_invite_sends
      WHERE (state = 'sent' AND finished_at > ${dayAgo})
         OR (state = 'sending' AND lease_until >= ${limits.now})`;
    if ((used[0]?.n ?? 0) >= limits.platformPerDay) return "capped";
    const rows = await tx<{ id: string; gym_id: string; invite_id: string; kind: string; email: string | null; attempts: number }[]>`
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
            WHERE sub.owner_type = 'gym' AND sub.owner_id = busy.gym_id AND sub.status = 'trialing')
          THEN ${limits.trialGymPerDay}::int
          ELSE ${limits.gymPerDay}::int
        END
      ),
      next AS (
        SELECT s.id FROM gym_invite_sends s
        WHERE ((s.state = 'queued' AND s.not_before <= ${limits.now})
               OR (s.state = 'sending' AND s.lease_until < ${limits.now}))
          AND s.gym_id NOT IN (SELECT capped.gym_id FROM capped)
        ORDER BY s.not_before, s.created_at, s.id
        LIMIT 1
        FOR UPDATE OF s SKIP LOCKED
      )
      UPDATE gym_invite_sends u
      SET state = 'sending', lease_until = ${leaseUntil}, attempts = u.attempts + 1
      FROM next
      WHERE u.id = next.id
      RETURNING u.id, u.gym_id, u.invite_id, u.kind, u.email::text AS email, u.attempts`;
    const row = rows[0];
    if (row === undefined) return null;
    if (row.kind !== "first" && row.kind !== "again") throw new Error(`invite send ${row.id} holds a kind that no longer parses`);
    return { id: row.id, gymId: row.gym_id, inviteId: row.invite_id, kind: row.kind, email: row.email, attempts: row.attempts };
  });
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
  } | null;
  /** The gym's current entries holding exactly this address. */
  holders: { entryId: string; phone: string | null }[];
}

export async function sendContext(sql: SqlOrTx, send: ClaimedSend): Promise<SendContext> {
  const invites = await sql<{ email_hmac: string; state: string; id: string }[]>`
    SELECT id, email_hmac, state FROM gym_invites WHERE gym_id = ${send.gymId} AND id = ${send.inviteId}`;
  const gyms = await sql<
    { name: string; city: string | null; slug: string; postal_address: string | null; status: string; on_plan: boolean }[]
  >`
    SELECT g.name, g.city, g.slug, g.postal_address, g.status,
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
          },
    holders,
  };
}

export type SendOutcome =
  | { kind: "sent"; providerId: string | null }
  | { kind: "skipped"; reason: MemberInviteEmailReason }
  | { kind: "failed"; reason: MemberInviteEmailReason };

/** Finish a claimed email. The address is cleared in the same statement. False when
 *  the claim was no longer this run's. */
export async function finishSend(sql: SqlOrTx, send: ClaimedSend, outcome: SendOutcome, at: Date): Promise<boolean> {
  const reason = outcome.kind === "sent" ? null : outcome.reason;
  const providerId = outcome.kind === "sent" ? outcome.providerId : null;
  const rows = await sql<{ id: string }[]>`
    UPDATE gym_invite_sends
    SET state = ${outcome.kind}, reason = ${reason}, provider_id = ${providerId},
        email = NULL, lease_until = NULL, finished_at = ${at}
    WHERE id = ${send.id} AND gym_id = ${send.gymId} AND state = 'sending' AND attempts = ${send.attempts}
    RETURNING id`;
  return rows.length === 1;
}

/** Put a claimed email back to wait until `notBefore`. */
export async function retrySend(sql: SqlOrTx, send: ClaimedSend, notBefore: Date): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE gym_invite_sends
    SET state = 'queued', lease_until = NULL, not_before = ${notBefore}
    WHERE id = ${send.id} AND gym_id = ${send.gymId} AND state = 'sending' AND attempts = ${send.attempts}
    RETURNING id`;
  return rows.length === 1;
}
