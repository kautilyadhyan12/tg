// PHONE NOTIFICATIONS FOR COMMENTS (ROADMAP Stage 5 item 18b-ii-b): the only file that reads or clears
// `gym_post_comment_notices` (migration 0195) for sending. A new comment writes who it is owed to
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
  input: { since: Date; toldSince: Date; limit: number; after: CommentPairMark | null; gymIds?: readonly string[] | undefined },
): Promise<CommentPair[]> {
  const { since, toldSince, limit, after, gymIds } = input;
  const gyms = gymIds === undefined ? null : [...gymIds];
  const rows = await sql<{ user_id: string; gym_id: string; user_zone: string | null; gym_zone: string; fresh: boolean; told_lately: boolean; first: string }[]>`
    SELECT x.user_id, x.gym_id, u.timezone AS user_zone, g.timezone AS gym_zone,
           bool_or(x.created_at >= ${since}) AS fresh,
           EXISTS (
             SELECT 1 FROM gym_post_comment_notices t
             WHERE t.user_id = x.user_id AND t.gym_id = x.gym_id AND t.told_at IS NOT NULL AND t.told_at > ${toldSince}
           ) AS told_lately,
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
    mark: { at: r.first, userId: r.user_id, gymId: r.gym_id },
  }));
}

/** Takes the pair's waiting comments, once: a second run at the same instant gets none back and sends
 *  nothing. Those recent enough to tell, by id. */
export async function claimComments(sql: SqlOrTx, userId: string, gymId: string, since: Date, now: Date): Promise<{ taken: number; fresh: string[] }> {
  const rows = await sql<{ comment_id: string; fresh: boolean }[]>`
    UPDATE gym_post_comment_notices SET done_at = ${now}
    WHERE user_id = ${userId} AND gym_id = ${gymId} AND done_at IS NULL
    RETURNING comment_id, created_at >= ${since} AS fresh`;
  return { taken: rows.length, fresh: rows.filter((r) => r.fresh).map((r) => r.comment_id) };
}

/** Puts back what this run took and Firebase did not take, so the next run tries again. */
export async function unclaimComments(sql: SqlOrTx, userId: string, gymId: string, claimedAt: Date): Promise<void> {
  await sql`
    UPDATE gym_post_comment_notices SET done_at = NULL
    WHERE user_id = ${userId} AND gym_id = ${gymId} AND done_at = ${claimedAt} AND told_at IS NULL`;
}

/** A phone has what this run took: the next comments notification from this gym waits out the half hour. */
export async function markCommentsTold(sql: SqlOrTx, userId: string, gymId: string, claimedAt: Date, now: Date): Promise<void> {
  await sql`
    UPDATE gym_post_comment_notices SET told_at = ${now}
    WHERE user_id = ${userId} AND gym_id = ${gymId} AND done_at = ${claimedAt}`;
}
