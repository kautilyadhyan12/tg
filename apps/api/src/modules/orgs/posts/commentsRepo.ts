// COMMENTS ON A GYM'S UPDATES, in the database (ROADMAP Stage 5 17e; spec Part 3 §15.2). Every read
// and write names the gym.
import type { Sql, TransactionSql } from "postgres";
import { GYM_POST_COMMENT_COUNT_MOST, GYM_POST_COMMENT_REPORTS_TO_HIDE, type GymMemberPosting, type GymPostCommentReportReason, type GymPostReaction } from "@app/shared";
import { posts, type Reader, type ReactorRow } from "./repo.js";

type SqlOrTx = Sql | TransactionSql;

export interface CommentRow {
  id: string;
  postId: string;
  parentId: string | null;
  replyToId: string | null;
  authorId: string | null;
  byMember: boolean;
  authorName: string | null;
  authorEmail: string | null;
  authorRecordName: string | null;
  body: string;
  createdAt: Date;
  hidden: boolean;
}

interface RawComment {
  id: string;
  post_id: string;
  parent_id: string | null;
  reply_to_id: string | null;
  author_id: string | null;
  by_member: boolean;
  author_name: string | null;
  author_email: string | null;
  author_record_name: string | null;
  body: string;
  created_at: Date;
  hidden: boolean;
}

const toComment = (r: RawComment): CommentRow => ({
  id: r.id,
  postId: r.post_id,
  parentId: r.parent_id,
  replyToId: r.reply_to_id,
  authorId: r.author_id,
  byMember: r.by_member,
  authorName: r.author_name,
  authorEmail: r.author_email,
  authorRecordName: r.author_record_name,
  body: r.body,
  createdAt: r.created_at,
  hidden: r.hidden,
});

/** A member's writing shows only while they are a live app member with an active account. */
const liveWriter = (sql: SqlOrTx, alias: string) =>
  sql`
    (NOT ${sql(alias)}.by_member OR EXISTS (
      SELECT 1 FROM users wu
      JOIN gym_members wm ON wm.user_id = wu.id AND wm.removed_at IS NULL
      WHERE wu.id = ${sql(alias)}.author_user_id AND wu.status = 'active' AND wm.gym_id = ${sql(alias)}.gym_id))`;

/** Whether this reader is sent the one row: never a removed one, one whose writer has left, or for
 *  a member one reported until hidden that they did not write, or a blocked member's. */
const rowSeen = (sql: SqlOrTx, alias: string, reader: Reader) => {
  const writer = sql`${sql(alias)}.removed_at IS NULL AND ${liveWriter(sql, alias)}`;
  if (reader === "staff") return writer;
  return sql`
    ${writer}
    AND (${sql(alias)}.hidden_at IS NULL OR ${sql(alias)}.author_user_id = ${reader.member})
    AND NOT (${sql(alias)}.by_member AND EXISTS (
      SELECT 1 FROM gym_post_blocks wb
      WHERE wb.gym_id = ${sql(alias)}.gym_id AND wb.user_id = ${reader.member} AND wb.blocked_user_id = ${sql(alias)}.author_user_id))`;
};

/** `c` is sent to this reader: the row itself and, for a reply, the comment it sits under. */
const seenBy = (sql: SqlOrTx, reader: Reader) => sql`
  ${rowSeen(sql, "c", reader)}
  AND (c.parent_id IS NULL OR EXISTS (
    SELECT 1 FROM gym_post_comments pc
    WHERE pc.gym_id = c.gym_id AND pc.id = c.parent_id AND ${rowSeen(sql, "pc", reader)}))`;

const shown = (sql: SqlOrTx) => sql`
  SELECT c.id, c.post_id, c.parent_id, c.reply_to_id, c.author_user_id AS author_id, c.by_member, c.body, c.created_at,
         c.hidden_at IS NOT NULL AS hidden,
         CASE WHEN u.status = 'active' THEN u.display_name END AS author_name,
         CASE WHEN u.status = 'active' THEN u.email::text END AS author_email,
         CASE WHEN u.status = 'active' THEN nullif(btrim(e.full_name), '') END AS author_record_name
  FROM gym_post_comments c
  LEFT JOIN users u ON u.id = c.author_user_id
  LEFT JOIN gym_members am ON am.gym_id = c.gym_id AND am.user_id = c.author_user_id AND am.removed_at IS NULL
  LEFT JOIN gym_member_list_entries e ON e.gym_id = am.gym_id AND e.id = am.entry_id`;

const afterCursor = (sql: SqlOrTx, after: { at: string; id: string } | null) =>
  after === null ? sql`` : sql`AND (c.created_at, c.id) > (${after.at}::timestamptz, ${after.id}::uuid)`;

/** A post's comments this reader is sent, oldest first. */
export async function commentsPage(sql: SqlOrTx, gymId: string, postId: string, reader: Reader, after: { at: string; id: string } | null, limit: number): Promise<CommentRow[]> {
  const rows = await sql<RawComment[]>`
    ${shown(sql)}
    WHERE c.gym_id = ${gymId} AND c.post_id = ${postId} AND c.parent_id IS NULL AND ${seenBy(sql, reader)} ${afterCursor(sql, after)}
    ORDER BY c.created_at, c.id
    LIMIT ${limit}`;
  return rows.map(toComment);
}

/** A comment's replies this reader is sent, oldest first. */
export async function repliesPage(sql: SqlOrTx, gymId: string, parentId: string, reader: Reader, after: { at: string; id: string } | null, limit: number): Promise<CommentRow[]> {
  const rows = await sql<RawComment[]>`
    ${shown(sql)}
    WHERE c.gym_id = ${gymId} AND c.parent_id = ${parentId} AND ${seenBy(sql, reader)} ${afterCursor(sql, after)}
    ORDER BY c.created_at, c.id
    LIMIT ${limit}`;
  return rows.map(toComment);
}

/** One comment or reply this reader is sent, or null. */
export async function commentById(sql: SqlOrTx, gymId: string, commentId: string, reader: Reader): Promise<CommentRow | null> {
  const rows = await sql<RawComment[]>`${shown(sql)} WHERE c.gym_id = ${gymId} AND c.id = ${commentId} AND ${seenBy(sql, reader)}`;
  const r = rows[0];
  return r === undefined ? null : toComment(r);
}

/** A member's own comment or reply, as they are sent it whatever has happened to the comment above it: sent again after
 *  that comment was hidden or its writer blocked, the server holds it and says so. */
export async function ownComment(sql: SqlOrTx, gymId: string, commentId: string, userId: string): Promise<CommentRow | null> {
  const rows = await sql<RawComment[]>`${shown(sql)} WHERE c.gym_id = ${gymId} AND c.id = ${commentId} AND ${rowSeen(sql, "c", { member: userId })}`;
  const r = rows[0];
  return r === undefined ? null : toComment(r);
}

/** Those of these comments and replies this reader is sent. */
export async function commentsByIds(sql: SqlOrTx, gymId: string, ids: readonly string[], reader: Reader): Promise<CommentRow[]> {
  if (ids.length === 0) return [];
  const rows = await sql<RawComment[]>`${shown(sql)} WHERE c.gym_id = ${gymId} AND c.id = ANY (${[...ids]}::uuid[]) AND ${seenBy(sql, reader)}`;
  return rows.map(toComment);
}

/** How many comments and replies this reader is sent, by post, each counted up to the most a page says: every read of a
 *  page asks this, and a crowded post must not slow it for the gym. */
export async function commentCounts(sql: SqlOrTx, gymId: string, postIds: readonly string[], reader: Reader): Promise<Map<string, number>> {
  if (postIds.length === 0) return new Map();
  const rows = await sql<{ post_id: string; n: number }[]>`
    SELECT p.post_id, x.n
    FROM unnest(${[...postIds]}::uuid[]) AS p(post_id)
    CROSS JOIN LATERAL (
      SELECT count(*)::int AS n FROM (
        SELECT 1 FROM gym_post_comments c
        WHERE c.gym_id = ${gymId} AND c.post_id = p.post_id AND ${seenBy(sql, reader)}
        LIMIT ${GYM_POST_COMMENT_COUNT_MOST}
      ) counted
    ) x
    WHERE x.n > 0`;
  return new Map(rows.map((r) => [r.post_id, r.n]));
}

/** How many replies this reader is sent, by comment. */
export async function replyCounts(sql: SqlOrTx, gymId: string, parentIds: readonly string[], reader: Reader): Promise<Map<string, number>> {
  if (parentIds.length === 0) return new Map();
  const rows = await sql<{ parent_id: string; n: number }[]>`
    SELECT c.parent_id, count(*)::int AS n FROM gym_post_comments c
    WHERE c.gym_id = ${gymId} AND c.parent_id = ANY (${[...parentIds]}::uuid[]) AND ${seenBy(sql, reader)}
    GROUP BY c.parent_id`;
  return new Map(rows.map((r) => [r.parent_id, r.n]));
}

/** A reaction counts while its giver is a live app member of the gym who has not blocked the comment's writer, or the
 *  writer of the comment it sits under: they can no longer see it to take the reaction off. */
const countedReaction = (sql: SqlOrTx) => sql`
  JOIN gym_members m ON m.gym_id = r.gym_id AND m.user_id = r.user_id AND m.removed_at IS NULL
  JOIN users u ON u.id = r.user_id AND u.status = 'active'
  JOIN gym_post_comments rc ON rc.gym_id = r.gym_id AND rc.id = r.comment_id
    AND NOT (rc.by_member AND EXISTS (
      SELECT 1 FROM gym_post_blocks rb
      WHERE rb.gym_id = r.gym_id AND rb.user_id = r.user_id AND rb.blocked_user_id = rc.author_user_id))
    AND NOT EXISTS (
      SELECT 1 FROM gym_post_comments rp
      JOIN gym_post_blocks pb ON pb.gym_id = rp.gym_id AND pb.user_id = r.user_id AND pb.blocked_user_id = rp.author_user_id
      WHERE rp.gym_id = rc.gym_id AND rp.id = rc.parent_id AND rp.by_member)`;

/** The reactions counted for these comments; a member reading is not sent those of anybody they blocked, as on a post. */
export async function reactionCounts(sql: SqlOrTx, gymId: string, commentIds: readonly string[], viewerId: string | null): Promise<{ commentId: string; reaction: string; count: number }[]> {
  if (commentIds.length === 0) return [];
  const unblocked =
    viewerId === null
      ? sql``
      : sql`AND NOT EXISTS (
          SELECT 1 FROM gym_post_blocks b
          WHERE b.gym_id = r.gym_id AND b.user_id = ${viewerId} AND b.blocked_user_id = r.user_id)`;
  const rows = await sql<{ comment_id: string; reaction: string; n: number }[]>`
    SELECT r.comment_id, r.reaction, count(*)::int AS n
    FROM gym_post_comment_reactions r
    ${countedReaction(sql)}
    WHERE r.gym_id = ${gymId} AND r.comment_id = ANY (${[...commentIds]}::uuid[]) ${unblocked}
    GROUP BY r.comment_id, r.reaction`;
  return rows.map((r) => ({ commentId: r.comment_id, reaction: r.reaction, count: r.n }));
}

export async function reactionsOf(sql: SqlOrTx, gymId: string, commentIds: readonly string[], userId: string): Promise<Map<string, string>> {
  if (commentIds.length === 0) return new Map();
  const rows = await sql<{ comment_id: string; reaction: string }[]>`
    SELECT comment_id, reaction FROM gym_post_comment_reactions
    WHERE gym_id = ${gymId} AND user_id = ${userId} AND comment_id = ANY (${[...commentIds]}::uuid[])`;
  return new Map(rows.map((r) => [r.comment_id, r.reaction]));
}

export async function reportedBy(sql: SqlOrTx, gymId: string, commentIds: readonly string[], userId: string): Promise<Set<string>> {
  if (commentIds.length === 0) return new Set();
  const rows = await sql<{ comment_id: string }[]>`
    SELECT comment_id FROM gym_post_comment_reports
    WHERE gym_id = ${gymId} AND user_id = ${userId} AND comment_id = ANY (${[...commentIds]}::uuid[])`;
  return new Set(rows.map((r) => r.comment_id));
}

/** The gym's switch, then a stop on the person (the one stop posting has). */
export async function commentingOf(sql: SqlOrTx, gymId: string, userId: string): Promise<GymMemberPosting> {
  const rows = await sql<{ on: boolean; stopped: boolean }[]>`
    SELECT g.members_can_comment AS on,
           EXISTS (SELECT 1 FROM gym_post_stops s WHERE s.gym_id = g.id AND s.user_id = ${userId}) AS stopped
    FROM gyms g WHERE g.id = ${gymId}`;
  const row = rows[0];
  if (row === undefined || !row.on) return "off";
  return row.stopped ? "stopped" : "on";
}

/** The comment this gym keeps under the phone's key, removed or not. */
export async function commentByKey(sql: SqlOrTx, gymId: string, commentKey: string): Promise<{ id: string; postId: string; authorId: string | null; byMember: boolean; removed: boolean } | null> {
  const rows = await sql<{ id: string; post_id: string; author_user_id: string | null; by_member: boolean; removed: boolean }[]>`
    SELECT id, post_id, author_user_id, by_member, removed_at IS NOT NULL AS removed FROM gym_post_comments WHERE gym_id = ${gymId} AND comment_key = ${commentKey}`;
  const r = rows[0];
  return r === undefined ? null : { id: r.id, postId: r.post_id, authorId: r.author_user_id, byMember: r.by_member, removed: r.removed };
}

/** The comments and replies this member has written here since `since`, removed ones too. */
export async function countMemberCommentsSince(sql: SqlOrTx, gymId: string, userId: string, since: Date): Promise<{ n: number; oldest: Date | null }> {
  const rows = await sql<{ n: number; oldest: Date | null }[]>`
    SELECT count(*)::int AS n, min(created_at) AS oldest FROM gym_post_comments
    WHERE author_user_id = ${userId} AND gym_id = ${gymId} AND by_member AND created_at > ${since}`;
  return rows[0] ?? { n: 0, oldest: null };
}

/** Keeps a comment or reply. Its post, and the comment it sits under, are held while it is written,
 *  so a removal at the same moment waits for it and takes it too, or goes first and this keeps
 *  nothing: "gone". "taken": the gym already keeps one under this key. */
export async function insertComment(
  tx: TransactionSql,
  gymId: string,
  comment: { id: string; postId: string; parentId: string | null; replyToId: string | null; commentKey: string; body: string; byMember: boolean },
  authorId: string,
  at: Date,
): Promise<"made" | "taken" | "gone"> {
  const post = await tx`SELECT 1 AS ok FROM gym_posts WHERE gym_id = ${gymId} AND id = ${comment.postId} AND removed_at IS NULL FOR SHARE`;
  if (post.length === 0) return "gone";
  if (comment.parentId !== null) {
    const parent = await tx`
      SELECT 1 AS ok FROM gym_post_comments
      WHERE gym_id = ${gymId} AND id = ${comment.parentId} AND post_id = ${comment.postId} AND parent_id IS NULL AND removed_at IS NULL FOR SHARE`;
    if (parent.length === 0) return "gone";
  }
  const rows = await tx<{ id: string }[]>`
    INSERT INTO gym_post_comments (id, gym_id, post_id, parent_id, reply_to_id, author_user_id, by_member, comment_key, body, created_at)
    VALUES (${comment.id}, ${gymId}, ${comment.postId}, ${comment.parentId}, ${comment.replyToId}, ${authorId}, ${comment.byMember}, ${comment.commentKey}, ${comment.body}, ${at})
    ON CONFLICT (gym_id, comment_key) DO NOTHING
    RETURNING id`;
  return rows.length === 1 ? "made" : "taken";
}

/** What goes with removed comments, in the removal's step: their reactions, and open reports answered. */
async function clearRemoved(tx: TransactionSql, gymId: string, ids: readonly string[], at: Date): Promise<void> {
  if (ids.length === 0) return;
  await tx`DELETE FROM gym_post_comment_reactions WHERE gym_id = ${gymId} AND comment_id = ANY (${[...ids]}::uuid[])`;
  await tx`
    UPDATE gym_post_comment_reports SET closed_at = ${at}, outcome = 'removed'
    WHERE gym_id = ${gymId} AND comment_id = ANY (${[...ids]}::uuid[]) AND closed_at IS NULL`;
}

/** The post a comment is on, held for a removal of the comment. A post's removal takes the post first and then its comments
 *  in no set order, so this makes both meet on one row instead of waiting on each other for good. */
async function holdPostOf(tx: TransactionSql, gymId: string, commentId: string): Promise<void> {
  await tx`
    SELECT 1 AS ok FROM gym_posts p
    WHERE p.gym_id = ${gymId} AND p.id = (SELECT c.post_id FROM gym_post_comments c WHERE c.gym_id = ${gymId} AND c.id = ${commentId})
    FOR SHARE`;
}

/** A member removes their own comment or reply, and a comment's replies go with it. False when it is
 *  not theirs, or was removed already. */
export async function removeOwn(tx: TransactionSql, gymId: string, commentId: string, userId: string, at: Date): Promise<boolean> {
  await holdPostOf(tx, gymId, commentId);
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_post_comments SET removed_at = ${at}, removed_by_user_id = ${userId}
    WHERE gym_id = ${gymId} AND id = ${commentId} AND author_user_id = ${userId} AND by_member AND removed_at IS NULL
    RETURNING id`;
  if (rows.length === 0) return false;
  const replies = await tx<{ id: string }[]>`
    UPDATE gym_post_comments SET removed_at = ${at}, removed_by_user_id = ${userId}
    WHERE gym_id = ${gymId} AND parent_id = ${commentId} AND removed_at IS NULL
    RETURNING id`;
  await clearRemoved(tx, gymId, [commentId, ...replies.map((r) => r.id)], at);
  return true;
}

/** Staff remove anybody's comment or reply, and a comment's replies go with it. False when it was
 *  removed already. */
export async function removeByStaff(tx: TransactionSql, gymId: string, commentId: string, staffId: string, at: Date): Promise<boolean> {
  await holdPostOf(tx, gymId, commentId);
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_post_comments SET removed_at = ${at}, removed_by_user_id = ${staffId}
    WHERE gym_id = ${gymId} AND id = ${commentId} AND removed_at IS NULL
    RETURNING id`;
  if (rows.length === 0) return false;
  const replies = await tx<{ id: string }[]>`
    UPDATE gym_post_comments SET removed_at = ${at}, removed_by_user_id = ${staffId}
    WHERE gym_id = ${gymId} AND parent_id = ${commentId} AND removed_at IS NULL
    RETURNING id`;
  await clearRemoved(tx, gymId, [commentId, ...replies.map((r) => r.id)], at);
  return true;
}

/** Everything on a post that has just been removed. */
export async function removeAllOnPost(tx: TransactionSql, gymId: string, postId: string, at: Date): Promise<void> {
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_post_comments SET removed_at = ${at}
    WHERE gym_id = ${gymId} AND post_id = ${postId} AND removed_at IS NULL
    RETURNING id`;
  await clearRemoved(tx, gymId, rows.map((r) => r.id), at);
}

/** The person's one reaction; false when the comment is not there. Held while written, as on a post. */
export async function setReaction(sql: SqlOrTx, gymId: string, commentId: string, userId: string, reaction: GymPostReaction, at: Date): Promise<boolean> {
  const rows = await sql<{ comment_id: string }[]>`
    INSERT INTO gym_post_comment_reactions (gym_id, comment_id, user_id, reaction, created_at)
    SELECT c.gym_id, c.id, ${userId}, ${reaction}, ${at}
    FROM gym_post_comments c
    WHERE c.gym_id = ${gymId} AND c.id = ${commentId} AND c.removed_at IS NULL
    FOR SHARE
    ON CONFLICT (comment_id, user_id) DO UPDATE SET reaction = EXCLUDED.reaction, created_at = EXCLUDED.created_at
    RETURNING comment_id`;
  return rows.length === 1;
}

export async function clearReaction(sql: SqlOrTx, gymId: string, commentId: string, userId: string): Promise<void> {
  await sql`DELETE FROM gym_post_comment_reactions WHERE gym_id = ${gymId} AND comment_id = ${commentId} AND user_id = ${userId}`;
}

/** One report a person; again, nothing changes. The comment is held so reports count one at a time,
 *  and hidden in the same step when the fifth lands. False when it is not there. */
export async function insertReport(tx: TransactionSql, gymId: string, commentId: string, userId: string, reason: GymPostCommentReportReason, note: string | null, at: Date): Promise<boolean> {
  const held = await tx`SELECT 1 AS ok FROM gym_post_comments WHERE gym_id = ${gymId} AND id = ${commentId} AND removed_at IS NULL FOR UPDATE`;
  if (held.length === 0) return false;
  await tx`
    INSERT INTO gym_post_comment_reports (gym_id, comment_id, user_id, reason, note, created_at)
    VALUES (${gymId}, ${commentId}, ${userId}, ${reason}, ${note}, ${at})
    ON CONFLICT (comment_id, user_id) DO NOTHING`;
  await tx`
    UPDATE gym_post_comments SET hidden_at = ${at}
    WHERE gym_id = ${gymId} AND id = ${commentId} AND hidden_at IS NULL
      AND (SELECT count(*) FROM gym_post_comment_reports r WHERE r.gym_id = ${gymId} AND r.comment_id = ${commentId} AND r.closed_at IS NULL) >= ${GYM_POST_COMMENT_REPORTS_TO_HIDE}`;
  return true;
}

/** Whether this person's report is on a comment now hidden from them: sent again after a lost reply. */
export async function reportedHidden(sql: SqlOrTx, gymId: string, commentId: string, userId: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 AS ok FROM gym_post_comment_reports r
    JOIN gym_post_comments c ON c.gym_id = r.gym_id AND c.id = r.comment_id
    WHERE r.gym_id = ${gymId} AND r.comment_id = ${commentId} AND r.user_id = ${userId} AND c.removed_at IS NULL AND c.hidden_at IS NOT NULL`;
  return rows.length > 0;
}

/** Whether this comment is one the person is not sent only because they blocked its writer. */
export async function hiddenByOwnBlock(sql: SqlOrTx, gymId: string, commentId: string, userId: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 AS ok FROM gym_post_comments c
    JOIN gym_post_blocks b ON b.gym_id = c.gym_id AND b.user_id = ${userId} AND b.blocked_user_id = c.author_user_id
    WHERE c.gym_id = ${gymId} AND c.id = ${commentId} AND c.by_member AND c.removed_at IS NULL`;
  return rows.length > 0;
}

/** Deletes the reactions one person gave another's member comments at this gym, and the replies under those comments,
 *  which leave the blocker's screen with them and could not be taken off again. */
export async function deleteReactionsToMember(tx: TransactionSql, gymId: string, userId: string, authorId: string): Promise<void> {
  await tx`
    DELETE FROM gym_post_comment_reactions r USING gym_post_comments c
    WHERE r.gym_id = ${gymId} AND r.user_id = ${userId}
      AND c.gym_id = r.gym_id AND c.id = r.comment_id
      AND ((c.by_member AND c.author_user_id = ${authorId}) OR EXISTS (
        SELECT 1 FROM gym_post_comments pc
        WHERE pc.gym_id = c.gym_id AND pc.id = c.parent_id AND pc.by_member AND pc.author_user_id = ${authorId}))`;
}

// ── FOR STAFF (17e-ii) ──

/** Who gave this reaction to this comment, newest first: exactly those the counts count. */
export async function reactorsOf(sql: SqlOrTx, gymId: string, commentId: string, reaction: GymPostReaction, limit: number): Promise<ReactorRow[]> {
  const rows = await sql<{ display_name: string; email: string | null; record_name: string | null }[]>`
    SELECT u.display_name, u.email::text AS email, nullif(btrim(e.full_name), '') AS record_name
    FROM gym_post_comment_reactions r
    ${countedReaction(sql)}
    LEFT JOIN gym_member_list_entries e ON e.gym_id = m.gym_id AND e.id = m.entry_id
    WHERE r.gym_id = ${gymId} AND r.comment_id = ${commentId} AND r.reaction = ${reaction}
    ORDER BY r.created_at DESC, r.user_id
    LIMIT ${limit}`;
  return rows.map((r) => ({ displayName: r.display_name, email: r.email, recordName: r.record_name }));
}

export async function membersCanComment(sql: SqlOrTx, gymId: string): Promise<boolean> {
  const rows = await sql<{ members_can_comment: boolean }[]>`SELECT members_can_comment FROM gyms WHERE id = ${gymId}`;
  return rows[0]?.members_can_comment ?? true;
}

/** The gym's switch; false when it was already so. */
export async function setMembersCanComment(tx: TransactionSql, gymId: string, on: boolean): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    UPDATE gyms SET members_can_comment = ${on} WHERE id = ${gymId} AND members_can_comment <> ${on} RETURNING id`;
  return rows.length === 1;
}

export interface ReportedCommentRow {
  comment: CommentRow;
  post: { id: string; body: string; byMember: boolean; hidden: boolean; authorName: string | null; authorEmail: string | null; authorRecordName: string | null };
  reports: number;
  allReports: number;
  reportsMark: string;
  total: number;
}

/** One value for exactly these reports of a comment: another report, or one fewer, changes it. */
const reportsMark = (sql: SqlOrTx) => sql`md5(coalesce(string_agg(a.id::text, ',' ORDER BY a.id), ''))`;

/** The comments and replies with a report nobody has answered, that staff can still read, on a post
 *  they can still read; longest waiting first. Never who reported. */
export async function reportedComments(sql: SqlOrTx, gymId: string, limit: number): Promise<ReportedCommentRow[]> {
  const rows = await sql<(RawComment & {
    post_body: string; post_by_member: boolean; post_hidden: boolean; post_author_name: string | null; post_author_email: string | null; post_author_record_name: string | null;
    reports: number; all_reports: number; reports_mark: string; total: number;
  })[]>`
    SELECT x.*, p.body AS post_body, p.by_member AS post_by_member, p.hidden AS post_hidden, p.author_name AS post_author_name, p.author_email AS post_author_email, p.author_record_name AS post_author_record_name,
           r.reports, count(*) OVER ()::int AS total,
           (SELECT count(*)::int FROM gym_post_comment_reports a WHERE a.gym_id = ${gymId} AND a.comment_id = x.id) AS all_reports,
           (SELECT ${reportsMark(sql)} FROM gym_post_comment_reports a WHERE a.gym_id = ${gymId} AND a.comment_id = x.id) AS reports_mark
    FROM (
      SELECT comment_id, count(*)::int AS reports, min(created_at) AS first_at
      FROM gym_post_comment_reports WHERE gym_id = ${gymId} AND closed_at IS NULL
      GROUP BY comment_id
    ) r
    JOIN LATERAL (${shown(sql)} WHERE c.gym_id = ${gymId} AND c.id = r.comment_id AND ${seenBy(sql, "staff")}) x ON true
    JOIN (${posts(sql, gymId)}) p ON p.id = x.post_id AND p.visible
    ORDER BY r.first_at, x.id
    LIMIT ${limit}`;
  return rows.map((r) => ({
    comment: toComment(r),
    post: { id: r.post_id, body: r.post_body, byMember: r.post_by_member, hidden: r.post_hidden, authorName: r.post_author_name, authorEmail: r.post_author_email, authorRecordName: r.post_author_record_name },
    reports: r.reports,
    allReports: r.all_reports,
    reportsMark: r.reports_mark,
    total: r.total,
  }));
}

/** Why these comments' open reports were made, by reason. */
export async function openReportReasons(sql: SqlOrTx, gymId: string, commentIds: readonly string[]): Promise<{ commentId: string; reason: string; count: number }[]> {
  if (commentIds.length === 0) return [];
  const rows = await sql<{ comment_id: string; reason: string; n: number }[]>`
    SELECT comment_id, reason, count(*)::int AS n FROM gym_post_comment_reports
    WHERE gym_id = ${gymId} AND closed_at IS NULL AND comment_id = ANY (${[...commentIds]}::uuid[])
    GROUP BY comment_id, reason`;
  return rows.map((r) => ({ commentId: r.comment_id, reason: r.reason, count: r.n }));
}

/** What the people who reported these comments typed, on reports still open: each one's oldest first. */
export async function openReportNotes(sql: SqlOrTx, gymId: string, commentIds: readonly string[], limit: number): Promise<{ commentId: string; note: string }[]> {
  if (commentIds.length === 0) return [];
  const rows = await sql<{ comment_id: string; note: string }[]>`
    SELECT comment_id, note FROM (
      SELECT comment_id, note, created_at, id, row_number() OVER (PARTITION BY comment_id ORDER BY created_at, id) AS rn
      FROM gym_post_comment_reports
      WHERE gym_id = ${gymId} AND closed_at IS NULL AND note IS NOT NULL AND comment_id = ANY (${[...commentIds]}::uuid[])
    ) r
    WHERE rn <= ${limit}
    ORDER BY comment_id, created_at, id`;
  return rows.map((r) => ({ commentId: r.comment_id, note: r.note }));
}

/** Holds a comment against reports landing while staff answer them. */
export async function holdComment(tx: TransactionSql, gymId: string, commentId: string): Promise<void> {
  await tx`SELECT 1 FROM gym_post_comments WHERE gym_id = ${gymId} AND id = ${commentId} FOR UPDATE`;
}

/** Closes a comment's open reports as kept, only while its reports, answered or not, are exactly the
 *  ones staff were shown. One statement, as for a post. How many it closed. */
export async function keepReports(tx: TransactionSql, gymId: string, commentId: string, at: Date, shownMark: string): Promise<number> {
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_post_comment_reports SET closed_at = ${at}, outcome = 'kept'
    WHERE gym_id = ${gymId} AND comment_id = ${commentId} AND closed_at IS NULL
      AND (SELECT ${reportsMark(tx)} FROM gym_post_comment_reports a WHERE a.gym_id = ${gymId} AND a.comment_id = ${commentId}) = ${shownMark}
    RETURNING id`;
  return rows.length;
}

/** A comment's reports: every one it has had, and those nobody has answered. */
export async function countReports(tx: TransactionSql, gymId: string, commentId: string): Promise<{ all: number; open: number }> {
  const rows = await tx<{ all: number; open: number }[]>`
    SELECT count(*)::int AS all, (count(*) FILTER (WHERE closed_at IS NULL))::int AS open
    FROM gym_post_comment_reports WHERE gym_id = ${gymId} AND comment_id = ${commentId}`;
  return rows[0] ?? { all: 0, open: 0 };
}

/** Shows a kept comment to members again. Not while five reports are waiting once more. */
export async function showAgain(tx: TransactionSql, gymId: string, commentId: string): Promise<void> {
  await tx`
    UPDATE gym_post_comments SET hidden_at = NULL
    WHERE gym_id = ${gymId} AND id = ${commentId} AND hidden_at IS NOT NULL
      AND (SELECT count(*) FROM gym_post_comment_reports r WHERE r.gym_id = ${gymId} AND r.comment_id = ${commentId} AND r.closed_at IS NULL) < ${GYM_POST_COMMENT_REPORTS_TO_HIDE}`;
}
