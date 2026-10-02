// The staff invitation emails' queue (ROADMAP 4a-i): the worker leases one row at a time
// under the app's daily cap, and names its lease in every write that finishes it, as the
// member invitations' queue does (`invites/repo.ts`).
import type { Sql, TransactionSql } from "postgres";
import { memberInviteEmailResultSchema, type MemberInviteEmailResult, type StaffInviteEmailReason } from "@app/shared";
import { emailsUsedToday } from "../invites/repo.js";

type SqlOrTx = Sql | TransactionSql;

/** The member invitations' and the leads' claims take the same lock, so the three
 *  queues cannot together pass the app's daily cap. */
const CLAIM_LOCK = "gym_invite_sends.claim";

export interface ClaimedStaffSend {
  id: string;
  gymId: string;
  inviteId: string;
  email: string | null;
  attempts: number;
  maybeSentAt: Date | null;
  createdAt: Date;
}

interface ClaimedRow {
  id: string;
  gym_id: string;
  invite_id: string;
  email: string | null;
  attempts: number;
  maybe_sent_at: Date | null;
  created_at: Date;
}

const toClaimed = (row: ClaimedRow): ClaimedStaffSend => ({
  id: row.id,
  gymId: row.gym_id,
  inviteId: row.invite_id,
  email: row.email,
  attempts: row.attempts,
  maybeSentAt: row.maybe_sent_at,
  createdAt: row.created_at,
});

/** Take the next email that is due, and lease it. One that may already have gone is
 *  taken first and outside the cap: it is the same email again. Null when nothing is
 *  due; `capped` when the whole app has reached its day. */
export async function claimNextStaffSend(
  sql: Sql,
  limits: { now: Date; leaseMs: number; platformPerDay: number; gymIds: readonly string[] | null },
): Promise<ClaimedStaffSend | "capped" | null> {
  const leaseUntil = new Date(limits.now.getTime() + limits.leaseMs);
  const everyGym = limits.gymIds === null;
  const onlyGyms = [...(limits.gymIds ?? [])];
  return await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${CLAIM_LOCK}))`;
    const take = async (retryOnly: boolean): Promise<ClaimedStaffSend | null> => {
      const rows = await tx<ClaimedRow[]>`
        WITH next AS (
          SELECT s.id FROM gym_staff_invite_sends s
          WHERE ((s.state = 'queued' AND s.not_before <= ${limits.now})
                 OR (s.state = 'sending' AND s.lease_until < ${limits.now}))
            AND (NOT ${retryOnly}::boolean OR s.maybe_sent_at IS NOT NULL)
            AND (${everyGym}::boolean OR s.gym_id = ANY(${onlyGyms}::uuid[]))
          ORDER BY s.not_before, s.created_at, s.id
          LIMIT 1
          FOR UPDATE OF s SKIP LOCKED
        )
        UPDATE gym_staff_invite_sends u
        SET state = 'sending', lease_until = ${leaseUntil}, attempts = u.attempts + 1
        FROM next
        WHERE u.id = next.id
        RETURNING u.id, u.gym_id, u.invite_id, u.email::text AS email, u.attempts, u.maybe_sent_at, u.created_at`;
      const row = rows[0];
      return row === undefined ? null : toClaimed(row);
    };
    const again = await take(true);
    if (again !== null) return again;
    if ((await emailsUsedToday(tx, limits.now)) >= limits.platformPerDay) return "capped";
    return await take(false);
  });
}

/** What the worker checks about a claimed email just before it goes. */
export interface StaffSendContext {
  invite: { email: string; role: "manager" | "trainer" | null; roleName: string | null; open: boolean; inviterName: string | null } | null;
  gym: { name: string; orgType: string; active: boolean; onPlan: boolean; stopped: boolean } | null;
}

export async function staffSendContext(sql: SqlOrTx, send: ClaimedStaffSend, now: Date): Promise<StaffSendContext> {
  const invites = await sql<{ email: string; role: string; role_name: string | null; open: boolean; inviter_name: string | null }[]>`
    SELECT i.email::text AS email, i.role, i.role_name,
           (i.state = 'pending' AND i.cleared_at IS NULL AND i.expires_at > ${now}) AS open,
           u.display_name AS inviter_name
    FROM gym_staff_invites i
    LEFT JOIN users u ON u.id = i.invited_by
    WHERE i.gym_id = ${send.gymId} AND i.id = ${send.inviteId}`;
  const gyms = await sql<{ name: string; org_type: string; status: string; on_plan: boolean; stopped: boolean }[]>`
    SELECT g.name, g.org_type, g.status, g.invites_stopped_at IS NOT NULL AS stopped,
           EXISTS (
             SELECT 1 FROM subscriptions s
             WHERE s.owner_type = 'gym' AND s.owner_id = g.id
               AND s.status IN ('trialing','active','past_due')) AS on_plan
    FROM gyms g WHERE g.id = ${send.gymId}`;
  const invite = invites[0];
  const gym = gyms[0];
  return {
    invite:
      invite === undefined
        ? null
        : {
            email: invite.email,
            role: invite.role === "manager" || invite.role === "trainer" ? invite.role : null,
            roleName: invite.role_name,
            open: invite.open,
            inviterName: invite.inviter_name,
          },
    gym:
      gym === undefined
        ? null
        : { name: gym.name, orgType: gym.org_type, active: gym.status === "active", onPlan: gym.on_plan, stopped: gym.stopped },
  };
}

/** Record, before an email is handed to Resend, that from now on it may have gone.
 *  False when the claim is no longer this run's, or when what the worker decided on
 *  moved since it read it (the invitation cancelled or ended, the address unsubscribed,
 *  the gym stopped): then nothing may be sent. One statement, so a change committed
 *  before it is seen here and one committed after it is after the email. */
export async function markMaybeSent(sql: SqlOrTx, send: ClaimedStaffSend, hmac: string, at: Date): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE gym_staff_invite_sends s SET maybe_sent_at = coalesce(s.maybe_sent_at, ${at})
    WHERE s.id = ${send.id} AND s.gym_id = ${send.gymId} AND s.state = 'sending' AND s.attempts = ${send.attempts}
      AND EXISTS (
        SELECT 1 FROM gym_staff_invites i
        WHERE i.id = s.invite_id AND i.gym_id = s.gym_id AND i.state = 'pending' AND i.cleared_at IS NULL
          AND i.expires_at > ${at} AND i.email = s.email)
      AND NOT EXISTS (
        SELECT 1 FROM email_suppressions x
        WHERE x.email_hmac = ${hmac} AND (x.gym_id = s.gym_id OR x.gym_id IS NULL))
      AND EXISTS (SELECT 1 FROM gyms g WHERE g.id = s.gym_id AND g.status = 'active' AND g.invites_stopped_at IS NULL)
    RETURNING s.id`;
  return rows.length === 1;
}

export type StaffSendOutcome =
  | { kind: "sent"; providerId: string | null }
  | { kind: "skipped" | "failed"; reason: StaffInviteEmailReason };

/** Finish a claimed email; the address is cleared in the same statement. False when the
 *  claim was no longer this run's. */
export async function finishSend(
  sql: SqlOrTx,
  send: ClaimedStaffSend,
  outcome: StaffSendOutcome,
  at: Date,
  certainlyNotSent = false,
): Promise<boolean> {
  const reason = outcome.kind === "sent" ? null : outcome.reason;
  const providerId = outcome.kind === "sent" ? outcome.providerId : null;
  const rows = await sql<{ id: string }[]>`
    UPDATE gym_staff_invite_sends
    SET state = ${outcome.kind}, reason = ${reason}, provider_id = ${providerId},
        email = NULL, lease_until = NULL, finished_at = ${at},
        maybe_sent_at = CASE WHEN ${certainlyNotSent}::boolean THEN NULL ELSE maybe_sent_at END
    WHERE id = ${send.id} AND gym_id = ${send.gymId} AND state = 'sending' AND attempts = ${send.attempts}
    RETURNING id`;
  return rows.length === 1;
}

/** Put a claimed email back to wait until `notBefore`. */
export async function retrySend(
  sql: SqlOrTx,
  send: ClaimedStaffSend,
  notBefore: Date,
  maybeSentAt: "keep" | Date | null = "keep",
): Promise<boolean> {
  const keep = maybeSentAt === "keep";
  const value = maybeSentAt === "keep" ? null : maybeSentAt;
  const rows = await sql<{ id: string }[]>`
    UPDATE gym_staff_invite_sends
    SET state = 'queued', lease_until = NULL, not_before = ${notBefore},
        maybe_sent_at = CASE WHEN ${keep}::boolean THEN maybe_sent_at ELSE ${value}::timestamptz END
    WHERE id = ${send.id} AND gym_id = ${send.gymId} AND state = 'sending' AND attempts = ${send.attempts}
    RETURNING id`;
  return rows.length === 1;
}

// ── What comes back (a Resend report, confirmed with Resend; `invites/results.ts`) ──

export interface ReportedStaffSend {
  id: string;
  gymId: string;
  state: string;
  reason: string | null;
  providerId: string | null;
}

/** The staff invitation email a report is about: the row its tag names, or else the sent
 *  row Resend knows by this id. */
export async function staffSendForReport(sql: SqlOrTx, report: { staffSendId: string | null; providerId: string }): Promise<ReportedStaffSend | null> {
  type Row = { id: string; gym_id: string; state: string; reason: string | null; provider_id: string | null };
  const rows =
    report.staffSendId !== null
      ? await sql<Row[]>`SELECT id, gym_id, state, reason, provider_id FROM gym_staff_invite_sends WHERE id = ${report.staffSendId}`
      : await sql<Row[]>`
          SELECT id, gym_id, state, reason, provider_id FROM gym_staff_invite_sends
          WHERE provider_id = ${report.providerId} AND state = 'sent'
          ORDER BY finished_at, id
          LIMIT 1`;
  const row = rows[0];
  return row === undefined ? null : { id: row.id, gymId: row.gym_id, state: row.state, reason: row.reason, providerId: row.provider_id };
}

/** An email the sender could not confirm, which Resend's record shows went. */
export async function markStaffWentAfterAll(tx: TransactionSql, gymId: string, sendId: string, providerId: string): Promise<void> {
  await tx`
    UPDATE gym_staff_invite_sends SET state = 'sent', reason = NULL, provider_id = ${providerId}
    WHERE gym_id = ${gymId} AND id = ${sendId} AND state = 'failed' AND reason = 'send_unknown'`;
}

/** The email's result now and its address's HMAC, read under the caller's lock. */
export async function staffSendForResult(
  tx: TransactionSql,
  gymId: string,
  sendId: string,
): Promise<{ result: MemberInviteEmailResult | null; hmac: string } | null> {
  const rows = await tx<{ result: string | null; email_hmac: string }[]>`
    SELECT result, email_hmac FROM gym_staff_invite_sends
    WHERE gym_id = ${gymId} AND id = ${sendId} AND state = 'sent'
    FOR UPDATE`;
  const row = rows[0];
  if (row === undefined) return null;
  const result = row.result === null ? null : memberInviteEmailResultSchema.safeParse(row.result);
  if (result !== null && !result.success) throw new Error(`staff invite send ${sendId} holds a result that no longer parses`);
  return { result: result === null ? null : result.data, hmac: row.email_hmac };
}

export async function setStaffResult(tx: TransactionSql, gymId: string, sendId: string, result: MemberInviteEmailResult, at: Date): Promise<void> {
  await tx`
    UPDATE gym_staff_invite_sends SET result = ${result}, result_at = ${at}
    WHERE gym_id = ${gymId} AND id = ${sendId} AND state = 'sent'`;
}
