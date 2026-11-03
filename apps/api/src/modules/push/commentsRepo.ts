// PHONE NOTIFICATIONS FOR COMMENTS (ROADMAP Stage 5 item 18b-ii-b): the only file that reads or clears
// `gym_post_comment_notices` (migration 0196) for sending. A new comment writes who it is owed to
// (`commentsRepo.insertComment`); the worker sends it here.
import type { Sql, TransactionSql } from "postgres";

type SqlOrTx = Sql | TransactionSql;

export interface CommentPair {
  userId: string;
  gymId: string;
  userZone: string | null;
  gymZone: string;
  /** Some waiting comment is recent enough to tell. */
  fresh: boolean;
  /** This person had a comments notification from this gym within `COMMENTS_AGAIN_MINUTES`. */
  toldLately: boolean;
  /** Another run is still sending this pair's comments notification. */
  busy: boolean;
  mark: CommentPairMark;
}

export interface CommentPairMark {
  at: string;
  userId: string;
  gymId: string;
}

/** One page of (person, gym) with comments owed and not yet taken, oldest first, after `after`: the run
 *  pages on past those that wait, so they never hold up the rest. */
export async function pendingCommentPairs(
  sql: SqlOrTx,
  input: { since: Date; toldSince: Date; claimedBefore: Date; limit: number; after: CommentPairMark | null; gymIds?: readonly string[] | undefined },
): Promise<CommentPair[]> {
  const { since, toldSince, claimedBefore, limit, after, gymIds } = input;
  const gyms = gymIds === undefined ? null : [...gymIds];
  const rows = await sql<{ user_id: string; gym_id: string; user_zone: string | null; gym_zone: string; fresh: boolean; told_lately: boolean; busy: boolean; first: string }[]>`
    SELECT x.user_id, x.gym_id, u.timezone AS user_zone, g.timezone AS gym_zone,
           bool_or(x.created_at >= ${since}) AS fresh,
           EXISTS (
             SELECT 1 FROM gym_post_comment_notices t
             WHERE t.user_id = x.user_id AND t.gym_id = x.gym_id AND t.told_at IS NOT NULL AND t.told_at > ${toldSince}
           ) AS told_lately,
           bool_or(x.claimed_at IS NOT NULL AND x.claimed_at >= ${claimedBefore}) AS busy,
           min(x.created_at)::text AS first
    FROM gym_post_comment_notices x
    JOIN users u ON u.id = x.user_id
    JOIN gyms g ON g.id = x.gym_id
    WHERE x.done_at IS NULL AND (${gyms}::uuid[] IS NULL OR x.gym_id = ANY(${gyms}::uuid[]))
    GROUP BY x.user_id, x.gym_id, u.timezone, g.timezone
    ${after === null ? sql`` : sql`HAVING (min(x.created_at), x.user_id, x.gym_id) > (${after.at}::timestamptz, ${after.userId}::uuid, ${after.gymId}::uuid)`}
    ORDER BY min(x.created_at), x.user_id, x.gym_id
    LIMIT ${limit}`;
  return rows.map((r) => ({
    userId: r.user_id,
    gymId: r.gym_id,
    userZone: r.user_zone,
    gymZone: r.gym_zone,
    fresh: r.fresh,
    toldLately: r.told_lately,
    busy: r.busy,
    mark: { at: r.first, userId: r.user_id, gymId: r.gym_id },
  }));
}

/** Takes the pair's waiting comments, once: a second run at the same instant, or while another run is
 *  still sending this pair's notification, or within the half hour of the last one, gets none back and
 *  sends nothing. Those recent enough to tell, by id. They stay owed until `settleComments`, so a run
 *  that stops halfway loses nothing: past `claimedBefore` the next run takes them again. */
export async function claimComments(
  sql: Sql,
  userId: string,
  gymId: string,
  input: { since: Date; toldSince: Date; claimedAt: Date; claimedBefore: Date },
): Promise<{ taken: number; fresh: string[] }> {
  const rows = await sql.begin(async (tx) => {
    // Two runs taking the same pair's comments wait for each other here, so the second reads the first's claim.
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`push-comments|${userId}|${gymId}`}))`;
    return tx<{ comment_id: string; fresh: boolean }[]>`
      UPDATE gym_post_comment_notices SET claimed_at = ${input.claimedAt}
      WHERE user_id = ${userId} AND gym_id = ${gymId} AND done_at IS NULL
        AND (claimed_at IS NULL OR claimed_at < ${input.claimedBefore})
        AND NOT EXISTS (
          SELECT 1 FROM gym_post_comment_notices t
          WHERE t.user_id = ${userId} AND t.gym_id = ${gymId}
            AND ((t.told_at IS NOT NULL AND t.told_at > ${input.toldSince})
              OR (t.done_at IS NULL AND t.claimed_at IS NOT NULL AND t.claimed_at >= ${input.claimedBefore}))
        )
      RETURNING comment_id, created_at >= ${input.since} AS fresh`;
  });
  return { taken: rows.length, fresh: rows.filter((r) => r.fresh).map((r) => r.comment_id) };
}

/** Puts back what this run took and Firebase did not take, so the next run tries again; what was seen on
 *  Updates meanwhile is already done and stays so. */
export async function unclaimComments(sql: SqlOrTx, userId: string, gymId: string, claimedAt: Date): Promise<void> {
  await sql`
    UPDATE gym_post_comment_notices SET claimed_at = NULL
    WHERE user_id = ${userId} AND gym_id = ${gymId} AND claimed_at = ${claimedAt}`;
}

/** What this run took is handled: a phone has it (`told`, and the next comments notification from this
 *  gym waits out the half hour), or nothing was still true to send. */
export async function settleComments(sql: SqlOrTx, userId: string, gymId: string, claimedAt: Date, now: Date, told: boolean): Promise<void> {
  await sql`
    UPDATE gym_post_comment_notices
    SET done_at = COALESCE(done_at, ${now}), told_at = CASE WHEN ${told} THEN ${now}::timestamptz ELSE told_at END, claimed_at = NULL
    WHERE user_id = ${userId} AND gym_id = ${gymId} AND claimed_at = ${claimedAt}`;
}

/** Comments a phone was told of, recent enough to tell, and not yet seen on that gym's Updates: the next
 *  notification replaces the one that holds them, so its count holds them too. */
export async function toldUnseen(sql: SqlOrTx, userId: string, gymId: string, since: Date): Promise<string[]> {
  const rows = await sql<{ comment_id: string }[]>`
    SELECT comment_id FROM gym_post_comment_notices
    WHERE user_id = ${userId} AND gym_id = ${gymId} AND told_at IS NOT NULL AND seen_at IS NULL AND created_at >= ${since}`;
  return rows.map((r) => r.comment_id);
}

/** The person opened this gym's Updates: what their phone was told of so far is seen, and what was still
 *  waiting (the half hour, the night) or being sent at this instant is seen there and never told as new. */
export async function markCommentsSeen(sql: SqlOrTx, userId: string, gymId: string, now: Date): Promise<void> {
  await sql`
    UPDATE gym_post_comment_notices SET seen_at = ${now}, done_at = COALESCE(done_at, ${now})
    WHERE user_id = ${userId} AND gym_id = ${gymId} AND seen_at IS NULL`;
}

/** What no run reads again (taken more than two days ago, past the day a comment is told within) goes,
 *  a bounded number a run. */
export async function pruneComments(sql: SqlOrTx, before: Date, most: number, gymIds?: readonly string[]): Promise<number> {
  const gyms = gymIds === undefined ? null : [...gymIds];
  const rows = await sql`
    DELETE FROM gym_post_comment_notices
    WHERE ctid IN (SELECT ctid FROM gym_post_comment_notices WHERE done_at < ${before} AND (${gyms}::uuid[] IS NULL OR gym_id = ANY(${gyms}::uuid[])) LIMIT ${most})`;
  return rows.count;
}
