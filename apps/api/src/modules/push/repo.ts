// PHONE NOTIFICATIONS: the only file that reads or writes `push_tokens` for sending, and the
// messages' `push_done_at` (ROADMAP Stage 5 item 18b-i).
import type { Sql, TransactionSql } from "postgres";

type SqlOrTx = Sql | TransactionSql;

/** A sign-in that is still open on a phone: some refresh token of the family is neither ended nor
 *  out of date. Sign out and "signed in on another phone" both end the family. */
const LIVE_PHONE_FAMILY = (sql: SqlOrTx, userId: string, familyId: string, now: Date) => sql`
  EXISTS (
    SELECT 1 FROM refresh_tokens rt
    WHERE rt.user_id = ${userId} AND rt.family_id = ${familyId} AND rt.client = 'phone'
      AND rt.revoked_at IS NULL AND rt.expires_at > ${now}
  )`;

/** Keeps the phone's address for this person and this sign-in. An address another account held
 *  moves to this one (the same phone, somebody else signed in), and the sign-in's older address goes
 *  (Firebase gave the phone a new one). Nothing is kept for a sign-in that is not an open phone one. */
export async function saveToken(
  sql: Sql,
  input: { userId: string; familyId: string; token: string; platform: "android"; now: Date },
): Promise<boolean> {
  const { userId, familyId, token, platform, now } = input;
  return sql.begin(async (tx) => {
    // Two calls from one sign-in at once (two openings, two new addresses) end on one address.
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`push-family|${familyId}`}))`;
    const saved = await tx<{ token: string }[]>`
      INSERT INTO push_tokens (user_id, token, platform, family_id, last_seen_at)
      SELECT ${userId}, ${token}, ${platform}, ${familyId}, ${now}
      WHERE ${LIVE_PHONE_FAMILY(tx, userId, familyId, now)}
      ON CONFLICT (token) DO UPDATE
        SET user_id = EXCLUDED.user_id, family_id = EXCLUDED.family_id,
            platform = EXCLUDED.platform, last_seen_at = EXCLUDED.last_seen_at
      RETURNING token`;
    if (saved.length === 0) return false;
    await tx`DELETE FROM push_tokens WHERE family_id = ${familyId} AND token <> ${token}`;
    // The person's addresses from sign-ins that have ended: nothing is sent to them, so none is kept.
    await tx`
      DELETE FROM push_tokens p
      WHERE p.user_id = ${userId} AND p.family_id <> ${familyId}
        AND NOT EXISTS (
          SELECT 1 FROM refresh_tokens rt
          WHERE rt.user_id = p.user_id AND rt.family_id = p.family_id AND rt.client = 'phone'
            AND rt.revoked_at IS NULL AND rt.expires_at > ${now}
        )`;
    return true;
  });
}

/** The addresses a notification for this person may go to now: only those given under a phone
 *  sign-in that is still open. */
export async function liveTokens(sql: SqlOrTx, userId: string, now: Date): Promise<string[]> {
  const rows = await sql<{ token: string }[]>`
    SELECT p.token FROM push_tokens p
    WHERE p.user_id = ${userId}
      AND EXISTS (
        SELECT 1 FROM refresh_tokens rt
        WHERE rt.user_id = p.user_id AND rt.family_id = p.family_id AND rt.client = 'phone'
          AND rt.revoked_at IS NULL AND rt.expires_at > ${now}
      )`;
  return rows.map((row) => row.token);
}

/** An address Firebase says no longer exists. Only for that person, so a late answer never removes
 *  an address that has since moved to somebody else. */
export async function forgetToken(sql: SqlOrTx, userId: string, token: string): Promise<void> {
  await sql`DELETE FROM push_tokens WHERE token = ${token} AND user_id = ${userId}`;
}

export interface PendingPair {
  userId: string;
  gymId: string;
  gymName: string;
  userZone: string | null;
  gymZone: string;
  /** Some message waiting is unread, still in the inbox and recent enough to tell. */
  fresh: boolean;
  /** Where the next page starts after this pair: its oldest waiting message, to the microsecond. */
  mark: PairMark;
}

export interface PairMark {
  at: string;
  userId: string;
  gymId: string;
}

/** One page of (person, gym) with messages not yet handed to the notifications, oldest first, after
 *  `after`: the run pages on past pairs left for the morning, so they never hold up the rest. */
export async function pendingPairs(
  sql: SqlOrTx,
  input: { now: Date; since: Date; claimedBefore: Date; limit: number; after: PairMark | null; gymIds?: readonly string[] | undefined },
): Promise<PendingPair[]> {
  const { now, since, claimedBefore, limit, after, gymIds } = input;
  const rows = await sql<{ user_id: string; gym_id: string; gym_name: string; user_zone: string | null; gym_zone: string; fresh: boolean; first: string }[]>`
    SELECT x.user_id, x.gym_id, g.name AS gym_name, u.timezone AS user_zone, g.timezone AS gym_zone,
           bool_or(x.read_at IS NULL AND x.expires_at > ${now} AND x.sent_at >= ${since}) AS fresh,
           min(x.sent_at)::text AS first
    FROM gym_member_messages x
    JOIN users u ON u.id = x.user_id
    JOIN gyms g ON g.id = x.gym_id
    WHERE x.push_done_at IS NULL AND x.sent_at <= ${now}
      AND (x.push_claimed_at IS NULL OR x.push_claimed_at < ${claimedBefore})
      ${gymIds === undefined ? sql`` : sql`AND x.gym_id IN ${sql(gymIds)}`}
    GROUP BY x.user_id, x.gym_id, g.name, u.timezone, g.timezone
    ${after === null ? sql`` : sql`HAVING (min(x.sent_at), x.user_id, x.gym_id) > (${after.at}::timestamptz, ${after.userId}::uuid, ${after.gymId}::uuid)`}
    ORDER BY min(x.sent_at), x.user_id, x.gym_id
    LIMIT ${limit}`;
  return rows.map((row) => ({
    userId: row.user_id,
    gymId: row.gym_id,
    gymName: row.gym_name,
    userZone: row.user_zone,
    gymZone: row.gym_zone,
    fresh: row.fresh,
    mark: { at: row.first, userId: row.user_id, gymId: row.gym_id },
  }));
}

/** The newest message still waiting to be read in this gym's inbox. */
export async function newestUnread(sql: SqlOrTx, userId: string, gymId: string, now: Date): Promise<string | null> {
  const rows = await sql<{ body: string }[]>`
    SELECT x.body FROM gym_member_messages x
    WHERE x.user_id = ${userId} AND x.gym_id = ${gymId} AND x.read_at IS NULL
      AND x.sent_at <= ${now} AND x.expires_at > ${now}
    ORDER BY x.sent_at DESC
    LIMIT 1`;
  return rows[0]?.body ?? null;
}

/** How long a run's claim holds a notification. A run that stops between taking it and finishing (the
 *  worker restarted, its process killed) leaves it owed, and past this the next run takes it again; a
 *  run's own send ends long before (Firebase is given 10 seconds an address). */
export const PUSH_CLAIM_MINUTES = 5;

/** Puts back a pair's messages that this run claimed and could not hand to Firebase, so the next run
 *  tries again while they are still fresh. */
export async function unclaim(sql: SqlOrTx, userId: string, gymId: string, claimedAt: Date): Promise<void> {
  await sql`
    UPDATE gym_member_messages SET push_claimed_at = NULL
    WHERE user_id = ${userId} AND gym_id = ${gymId} AND push_claimed_at = ${claimedAt} AND push_done_at IS NULL`;
}

/** Takes the pair's waiting messages, once: a second run at the same instant gets none back and sends
 *  nothing. They stay owed until `settle`. */
export async function claim(sql: SqlOrTx, userId: string, gymId: string, input: { now: Date; claimedAt: Date; claimedBefore: Date }): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    UPDATE gym_member_messages SET push_claimed_at = ${input.claimedAt}
    WHERE user_id = ${userId} AND gym_id = ${gymId} AND push_done_at IS NULL AND sent_at <= ${input.now}
      AND (push_claimed_at IS NULL OR push_claimed_at < ${input.claimedBefore})
    RETURNING id`;
  return rows.length;
}

/** What this run took is handled: a phone has it, or nothing was still true to send. */
export async function settle(sql: SqlOrTx, userId: string, gymId: string, claimedAt: Date, now: Date): Promise<void> {
  await sql`
    UPDATE gym_member_messages SET push_done_at = ${now}, push_claimed_at = NULL
    WHERE user_id = ${userId} AND gym_id = ${gymId} AND push_claimed_at = ${claimedAt} AND push_done_at IS NULL`;
}
