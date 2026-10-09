// A GYM'S UPDATES, in the database (spec Part 3 §15.2, §15.3; ROADMAP 19b-i, 19b-ii-a, 19b-ii-c).
// Every read and write names the gym.
import type { Sql, TransactionSql } from "postgres";
import { GYM_POST_REPORTS_TO_HIDE, type GymPostReaction, type GymPostReportReason } from "@app/shared";

type SqlOrTx = Sql | TransactionSql;

export interface PostRow {
  id: string;
  /** Who wrote it, while that account exists. */
  authorId: string | null;
  /** A member's own post, as against one by the gym's staff. */
  byMember: boolean;
  /** The author's app name and address while their account is active; null otherwise. */
  authorName: string | null;
  authorEmail: string | null;
  /** Their name on this gym's list, shown when the app's name is an automatic one. */
  authorRecordName: string | null;
  body: string;
  pinnedAt: Date | null;
  createdAt: Date;
  removed: boolean;
  /** Reported by enough people to be hidden from members until staff decide. */
  hidden: boolean;
  /** The challenge whose result this post announces; null for every other post. */
  challengeId: string | null;
}

interface RawPost {
  id: string;
  author_id: string | null;
  by_member: boolean;
  author_name: string | null;
  author_email: string | null;
  author_record_name: string | null;
  body: string;
  pinned_at: Date | null;
  created_at: Date;
  removed: boolean;
  hidden: boolean;
  challenge_id: string | null;
}

const toPost = (r: RawPost): PostRow => ({
  id: r.id,
  authorId: r.author_id,
  byMember: r.by_member,
  authorName: r.author_name,
  authorEmail: r.author_email,
  authorRecordName: r.author_record_name,
  body: r.body,
  pinnedAt: r.pinned_at,
  createdAt: r.created_at,
  removed: r.removed,
  hidden: r.hidden,
  challengeId: r.challenge_id,
});

/** The gym's posts. `visible`: not removed and, for a member's own post, its writer still a
 *  live app member of the gym with an active account. A member who leaves, is removed or
 *  deletes their account takes their posts and photos off the page with them. `hidden`:
 *  five people reported it (`hideIfReported`) and staff have not kept it since. */
function posts(sql: SqlOrTx, gymId: string) {
  return sql`
    SELECT p.id, p.body, p.pinned_at, p.created_at, p.post_key, p.removed_at IS NOT NULL AS removed,
           p.author_user_id AS author_id, p.by_member,
           p.removed_at IS NULL AND (NOT p.by_member OR (u.status = 'active' AND am.user_id IS NOT NULL) IS TRUE) AS visible,
           p.hidden_at IS NOT NULL AS hidden, p.challenge_id,
           CASE WHEN u.status = 'active' THEN u.display_name END AS author_name,
           CASE WHEN u.status = 'active' THEN u.email::text END AS author_email,
           CASE WHEN u.status = 'active' THEN nullif(btrim(e.full_name), '') END AS author_record_name
    FROM gym_posts p
    LEFT JOIN users u ON u.id = p.author_user_id
    LEFT JOIN gym_members am ON am.gym_id = p.gym_id AND am.user_id = p.author_user_id AND am.removed_at IS NULL
    LEFT JOIN gym_member_list_entries e ON e.gym_id = am.gym_id AND e.id = am.entry_id
    WHERE p.gym_id = ${gymId}`;
}

/** Who is reading. A member is sent what everyone sees, less the member posts of anybody
 *  they have blocked and less a hidden post they did not write. `staff` is sent what
 *  everyone sees, hidden posts too. */
export type Reader = { member: string } | "staff";

/** The posts of `p` (a row of `posts`) this reader is sent. */
function seenBy(sql: SqlOrTx, gymId: string, reader: Reader) {
  if (reader === "staff") return sql`p.visible`;
  return sql`
    p.visible
    AND (NOT p.hidden OR p.author_id = ${reader.member})
    AND NOT (p.by_member AND EXISTS (
      SELECT 1 FROM gym_post_blocks b
      WHERE b.gym_id = ${gymId} AND b.user_id = ${reader.member} AND b.blocked_user_id = p.author_id))`;
}

/** The gym's pinned posts, newest pin first. */
export async function pinnedPosts(sql: SqlOrTx, gymId: string, reader: Reader): Promise<PostRow[]> {
  const rows = await sql<RawPost[]>`
    SELECT * FROM (${posts(sql, gymId)}) p
    WHERE ${seenBy(sql, gymId, reader)} AND p.pinned_at IS NOT NULL
    ORDER BY p.pinned_at DESC, p.id DESC`;
  return rows.map(toPost);
}

/** The posts that are not pinned, newest first, from `before` (a post's instant and id) on. */
export async function postsPage(sql: SqlOrTx, gymId: string, reader: Reader, before: { at: string; id: string } | null, limit: number): Promise<PostRow[]> {
  const from = before === null ? sql`` : sql`AND (p.created_at, p.id) < (${before.at}::timestamptz, ${before.id}::uuid)`;
  const rows = await sql<RawPost[]>`
    SELECT * FROM (${posts(sql, gymId)}) p
    WHERE ${seenBy(sql, gymId, reader)} AND p.pinned_at IS NULL ${from}
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT ${limit}`;
  return rows.map(toPost);
}

/** The posts one person made as a member that this reader is sent, newest first, a pinned
 *  one in its own place, from `before` on. */
export async function memberPostsPage(
  sql: SqlOrTx,
  gymId: string,
  reader: Reader,
  authorId: string,
  before: { at: string; id: string } | null,
  limit: number,
): Promise<PostRow[]> {
  const from = before === null ? sql`` : sql`AND (p.created_at, p.id) < (${before.at}::timestamptz, ${before.id}::uuid)`;
  const rows = await sql<RawPost[]>`
    SELECT * FROM (${posts(sql, gymId)}) p
    WHERE ${seenBy(sql, gymId, reader)} AND p.by_member AND p.author_id = ${authorId} ${from}
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT ${limit}`;
  return rows.map(toPost);
}

/** How many posts one person made as a member that this reader is sent. */
export async function countMemberPosts(sql: SqlOrTx, gymId: string, reader: Reader, authorId: string): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM (${posts(sql, gymId)}) p
    WHERE ${seenBy(sql, gymId, reader)} AND p.by_member AND p.author_id = ${authorId}`;
  return rows[0]?.n ?? 0;
}

/** One of this gym's posts this reader is sent, or null. */
export async function postById(sql: SqlOrTx, gymId: string, postId: string, reader: Reader): Promise<PostRow | null> {
  const rows = await sql<RawPost[]>`
    SELECT * FROM (${posts(sql, gymId)}) p WHERE p.id = ${postId} AND ${seenBy(sql, gymId, reader)}`;
  const r = rows[0];
  return r === undefined ? null : toPost(r);
}

/** The post this gym keeps under the browser's key, removed or not, or null. */
export async function postByKey(sql: SqlOrTx, gymId: string, postKey: string): Promise<PostRow | null> {
  const rows = await sql<RawPost[]>`
    SELECT * FROM (${posts(sql, gymId)}) p WHERE p.post_key = ${postKey}`;
  const r = rows[0];
  return r === undefined ? null : toPost(r);
}

export interface PostPhotoRow {
  postId: string;
  id: string;
  width: number;
  height: number;
}

/** The photos of these posts of this gym, each post's in its own order. */
export async function photosOf(sql: SqlOrTx, gymId: string, postIds: readonly string[]): Promise<PostPhotoRow[]> {
  if (postIds.length === 0) return [];
  const rows = await sql<{ post_id: string; id: string; width: number; height: number }[]>`
    SELECT post_id, id, width, height FROM gym_post_photos
    WHERE gym_id = ${gymId} AND post_id = ANY (${[...postIds]}::uuid[])
    ORDER BY post_id, position`;
  return rows.map((r) => ({ postId: r.post_id, id: r.id, width: r.width, height: r.height }));
}

/** A reaction counts, and its giver is named, only while they are a live app member of the
 *  gym with an active account: the number and the names staff see always agree. Joins `m`
 *  (the membership) and `u` (the account) to the reaction `r`. */
function liveReactor(sql: SqlOrTx) {
  // Nor does a reaction to the post of somebody its giver has blocked: a block deletes
  // those, and one sent at the same moment can land after the delete.
  return sql`
    JOIN gym_members m ON m.gym_id = r.gym_id AND m.user_id = r.user_id AND m.removed_at IS NULL
    JOIN users u ON u.id = r.user_id AND u.status = 'active'
    JOIN gym_posts rp ON rp.gym_id = r.gym_id AND rp.id = r.post_id
      AND NOT (rp.by_member AND EXISTS (
        SELECT 1 FROM gym_post_blocks rb
        WHERE rb.gym_id = r.gym_id AND rb.user_id = r.user_id AND rb.blocked_user_id = rp.author_user_id))`;
}

/** `viewerId`: a member reading, who is not sent the reactions of anybody they have blocked. */
export async function reactionCounts(
  sql: SqlOrTx,
  gymId: string,
  postIds: readonly string[],
  viewerId: string | null,
): Promise<{ postId: string; reaction: string; count: number }[]> {
  if (postIds.length === 0) return [];
  const unblocked =
    viewerId === null
      ? sql``
      : sql`AND NOT EXISTS (
          SELECT 1 FROM gym_post_blocks b
          WHERE b.gym_id = r.gym_id AND b.user_id = ${viewerId} AND b.blocked_user_id = r.user_id)`;
  const rows = await sql<{ post_id: string; reaction: string; n: number }[]>`
    SELECT r.post_id, r.reaction, count(*)::int AS n
    FROM gym_post_reactions r
    ${liveReactor(sql)}
    WHERE r.gym_id = ${gymId} AND r.post_id = ANY (${[...postIds]}::uuid[]) ${unblocked}
    GROUP BY r.post_id, r.reaction`;
  return rows.map((r) => ({ postId: r.post_id, reaction: r.reaction, count: r.n }));
}

/** One person's reactions to these posts. */
export async function reactionsOf(sql: SqlOrTx, gymId: string, postIds: readonly string[], userId: string): Promise<Map<string, string>> {
  if (postIds.length === 0) return new Map();
  const rows = await sql<{ post_id: string; reaction: string }[]>`
    SELECT post_id, reaction FROM gym_post_reactions
    WHERE gym_id = ${gymId} AND user_id = ${userId} AND post_id = ANY (${[...postIds]}::uuid[])`;
  return new Map(rows.map((r) => [r.post_id, r.reaction]));
}

export interface ReactorRow {
  displayName: string;
  email: string | null;
  recordName: string | null;
}

/** Who gave this reaction to this gym's post, newest first. */
export async function reactorsOf(sql: SqlOrTx, gymId: string, postId: string, reaction: GymPostReaction, limit: number): Promise<ReactorRow[]> {
  const rows = await sql<{ display_name: string; email: string | null; record_name: string | null }[]>`
    SELECT u.display_name, u.email::text AS email, nullif(btrim(e.full_name), '') AS record_name
    FROM gym_post_reactions r
    ${liveReactor(sql)}
    LEFT JOIN gym_member_list_entries e ON e.gym_id = m.gym_id AND e.id = m.entry_id
    WHERE r.gym_id = ${gymId} AND r.post_id = ${postId} AND r.reaction = ${reaction}
    ORDER BY r.created_at DESC, r.user_id
    LIMIT ${limit}`;
  return rows.map((r) => ({ displayName: r.display_name, email: r.email, recordName: r.record_name }));
}

/** Keeps the post; false when the gym already keeps one under this key. */
export async function insertPost(
  tx: TransactionSql,
  gymId: string,
  post: { id: string; postKey: string; body: string; byMember: boolean },
  authorId: string,
  at: Date,
): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    INSERT INTO gym_posts (id, gym_id, author_user_id, post_key, body, by_member, created_at)
    VALUES (${post.id}, ${gymId}, ${authorId}, ${post.postKey}, ${post.body}, ${post.byMember}, ${at})
    ON CONFLICT (gym_id, post_key) DO NOTHING
    RETURNING id`;
  return rows.length === 1;
}

export interface NewPostPhoto {
  id: string;
  storageKey: string;
  contentType: string;
  byteSize: number;
  width: number;
  height: number;
}

export async function insertPhotos(tx: TransactionSql, gymId: string, postId: string, photos: readonly NewPostPhoto[], at: Date): Promise<void> {
  for (const [position, photo] of photos.entries()) {
    await tx`
      INSERT INTO gym_post_photos (id, gym_id, post_id, storage_key, content_type, byte_size, width, height, position, created_at)
      VALUES (${photo.id}, ${gymId}, ${postId}, ${photo.storageKey}, ${photo.contentType}, ${photo.byteSize},
              ${photo.width}, ${photo.height}, ${position}, ${at})`;
  }
}

export async function countPinned(tx: TransactionSql, gymId: string): Promise<number> {
  const rows = await tx<{ n: number }[]>`
    SELECT count(*)::int AS n FROM gym_posts WHERE gym_id = ${gymId} AND removed_at IS NULL AND pinned_at IS NOT NULL`;
  return rows[0]?.n ?? 0;
}

/** False when the post is not there to pin: removed at this moment. */
export async function setPinned(tx: TransactionSql, gymId: string, postId: string, pinnedAt: Date | null): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_posts SET pinned_at = ${pinnedAt} WHERE gym_id = ${gymId} AND id = ${postId} AND removed_at IS NULL RETURNING id`;
  return rows.length === 1;
}

/** Marks this gym's post removed; false when it has none, or it was removed already. */
export async function markRemoved(tx: TransactionSql, gymId: string, postId: string, by: string, at: Date): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_posts SET removed_at = ${at}, removed_by_user_id = ${by}, pinned_at = NULL
    WHERE gym_id = ${gymId} AND id = ${postId} AND removed_at IS NULL
    RETURNING id`;
  return rows.length === 1;
}

/** Deletes a post's photo rows; their store keys. */
export async function deletePhotos(tx: TransactionSql, gymId: string, postId: string): Promise<string[]> {
  const rows = await tx<{ storage_key: string }[]>`
    DELETE FROM gym_post_photos WHERE gym_id = ${gymId} AND post_id = ${postId} RETURNING storage_key`;
  return rows.map((r) => r.storage_key);
}

export async function deleteReactions(tx: TransactionSql, gymId: string, postId: string): Promise<void> {
  await tx`DELETE FROM gym_post_reactions WHERE gym_id = ${gymId} AND post_id = ${postId}`;
}

/** The person's one reaction to this gym's post; false when the post is not there. The
 *  post is held while it is written, so a removal at the same moment leaves none behind. */
export async function setReaction(sql: SqlOrTx, gymId: string, postId: string, userId: string, reaction: GymPostReaction, at: Date): Promise<boolean> {
  const rows = await sql<{ post_id: string }[]>`
    INSERT INTO gym_post_reactions (gym_id, post_id, user_id, reaction, created_at)
    SELECT p.gym_id, p.id, ${userId}, ${reaction}, ${at}
    FROM gym_posts p
    WHERE p.gym_id = ${gymId} AND p.id = ${postId} AND p.removed_at IS NULL
    FOR SHARE
    ON CONFLICT (post_id, user_id) DO UPDATE SET reaction = EXCLUDED.reaction, created_at = EXCLUDED.created_at
    RETURNING post_id`;
  return rows.length === 1;
}

export async function clearReaction(sql: SqlOrTx, gymId: string, postId: string, userId: string): Promise<void> {
  await sql`DELETE FROM gym_post_reactions WHERE gym_id = ${gymId} AND post_id = ${postId} AND user_id = ${userId}`;
}

/** A photo of a post of this gym that this reader is sent, or null. */
export async function photoOf(
  sql: SqlOrTx,
  gymId: string,
  postId: string,
  photoId: string,
  reader: Reader,
): Promise<{ storageKey: string; contentType: string } | null> {
  const rows = await sql<{ storage_key: string; content_type: string }[]>`
    SELECT ph.storage_key, ph.content_type
    FROM gym_post_photos ph
    JOIN (${posts(sql, gymId)}) p ON p.id = ph.post_id
    WHERE ph.gym_id = ${gymId} AND ph.post_id = ${postId} AND ph.id = ${photoId} AND ${seenBy(sql, gymId, reader)}`;
  const r = rows[0];
  return r === undefined ? null : { storageKey: r.storage_key, contentType: r.content_type };
}

/** A live app member of the gym: the leaderboard's own rule (`leaderboard/repo.ts`). */
export async function isLiveMember(sql: SqlOrTx, gymId: string, userId: string): Promise<boolean> {
  const rows = await sql<{ ok: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM gym_members m
      JOIN users u ON u.id = m.user_id AND u.status = 'active'
      WHERE m.gym_id = ${gymId} AND m.user_id = ${userId} AND m.removed_at IS NULL
    ) AS ok`;
  return rows[0]?.ok ?? false;
}

// ── MEMBERS POST, REPORT, AND THE STAFF LIST (19b-ii-a) ──

/** The gym's switch: whether its members may post. */
export async function membersCanPost(sql: SqlOrTx, gymId: string): Promise<boolean> {
  const rows = await sql<{ members_can_post: boolean }[]>`SELECT members_can_post FROM gyms WHERE id = ${gymId}`;
  return rows[0]?.members_can_post ?? false;
}

/** Sets the switch; false when it already stood there. */
export async function setMembersCanPost(tx: TransactionSql, gymId: string, on: boolean): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    UPDATE gyms SET members_can_post = ${on} WHERE id = ${gymId} AND members_can_post <> ${on} RETURNING id`;
  return rows.length === 1;
}

export async function isStopped(sql: SqlOrTx, gymId: string, userId: string): Promise<boolean> {
  const rows = await sql<{ ok: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM gym_post_stops WHERE gym_id = ${gymId} AND user_id = ${userId}) AS ok`;
  return rows[0]?.ok ?? false;
}

/** Which of these people the gym has stopped posting. */
export async function stoppedAmong(sql: SqlOrTx, gymId: string, userIds: readonly string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await sql<{ user_id: string }[]>`
    SELECT user_id FROM gym_post_stops WHERE gym_id = ${gymId} AND user_id = ANY (${[...userIds]}::uuid[])`;
  return new Set(rows.map((r) => r.user_id));
}

/** Holds the person's membership of this gym, so their posts are counted, and a stop on
 *  them lands, one at a time. `liveOnly`: only while they are a member now. False when
 *  there is no such membership. */
export async function lockMember(tx: TransactionSql, gymId: string, userId: string, liveOnly: boolean): Promise<boolean> {
  const live = liveOnly ? tx`AND removed_at IS NULL` : tx``;
  const rows = await tx<{ ok: number }[]>`
    SELECT 1 AS ok FROM gym_members WHERE gym_id = ${gymId} AND user_id = ${userId} ${live} FOR UPDATE`;
  return rows.length > 0;
}

/** How many, and when the oldest of them was made: the count drops when that one is a day old. */
export interface Counted {
  n: number;
  oldest: Date | null;
}

/** The posts this member has made at this gym since `since`, removed ones too: removing
 *  a post gives no post back. */
export async function countMemberPostsSince(sql: SqlOrTx, gymId: string, userId: string, since: Date): Promise<Counted> {
  const rows = await sql<Counted[]>`
    SELECT count(*)::int AS n, min(created_at) AS oldest FROM gym_posts
    WHERE author_user_id = ${userId} AND gym_id = ${gymId} AND by_member AND created_at > ${since}`;
  return rows[0] ?? { n: 0, oldest: null };
}

/** Of those, the posts that carry photos now. A removed post's photos are deleted with it,
 *  whoever removed it, so it is not counted here: the day's ten above are what stop
 *  post-and-remove, and staff stop a person whose photos they keep taking down. */
export async function countMemberPhotoPostsSince(sql: SqlOrTx, gymId: string, userId: string, since: Date): Promise<Counted> {
  const rows = await sql<Counted[]>`
    SELECT count(*)::int AS n, min(p.created_at) AS oldest FROM gym_posts p
    WHERE p.author_user_id = ${userId} AND p.gym_id = ${gymId} AND p.by_member AND p.created_at > ${since}
      AND EXISTS (SELECT 1 FROM gym_post_photos ph WHERE ph.gym_id = p.gym_id AND ph.post_id = p.id)`;
  return rows[0] ?? { n: 0, oldest: null };
}

/** Marks a member's own post removed; false when it is not theirs, or was removed already. */
export async function markRemovedOwn(tx: TransactionSql, gymId: string, postId: string, userId: string, at: Date): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_posts SET removed_at = ${at}, removed_by_user_id = ${userId}, pinned_at = NULL
    WHERE gym_id = ${gymId} AND id = ${postId} AND author_user_id = ${userId} AND by_member AND removed_at IS NULL
    RETURNING id`;
  return rows.length === 1;
}

/** The person's one report of this gym's post; false when the post is not there. Reported
 *  again, nothing changes. The post is held to the end of the transaction, so reports of
 *  one post are counted one at a time (`hideIfReported`). */
export async function insertReport(
  sql: TransactionSql,
  gymId: string,
  postId: string,
  userId: string,
  reason: GymPostReportReason,
  note: string | null,
  at: Date,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    WITH post AS (
      SELECT p.gym_id, p.id FROM gym_posts p
      WHERE p.gym_id = ${gymId} AND p.id = ${postId} AND p.removed_at IS NULL
      FOR UPDATE
    ), made AS (
      INSERT INTO gym_post_reports (gym_id, post_id, user_id, reason, note, created_at)
      SELECT post.gym_id, post.id, ${userId}, ${reason}, ${note}, ${at} FROM post
      ON CONFLICT (post_id, user_id) DO NOTHING
    )
    SELECT id FROM post`;
  return rows.length === 1;
}

const waitingReports = (sql: SqlOrTx, gymId: string, postId: string) =>
  sql`(SELECT count(*) FROM gym_post_reports r WHERE r.gym_id = ${gymId} AND r.post_id = ${postId} AND r.closed_at IS NULL)`;

/** Hides the post from members once five reports of it are waiting. One report a person a
 *  post, so that is five people. Run after `insertReport`, in its transaction. */
export async function hideIfReported(tx: TransactionSql, gymId: string, postId: string, at: Date): Promise<void> {
  await tx`
    UPDATE gym_posts SET hidden_at = ${at}
    WHERE gym_id = ${gymId} AND id = ${postId} AND removed_at IS NULL AND hidden_at IS NULL
      AND ${waitingReports(tx, gymId, postId)} >= ${GYM_POST_REPORTS_TO_HIDE}`;
}

/** Holds the post to the end of the transaction, as a report of it does: Keep and a
 *  report of the same post run one after the other. */
export async function holdPost(tx: TransactionSql, gymId: string, postId: string): Promise<void> {
  await tx`SELECT 1 FROM gym_posts WHERE gym_id = ${gymId} AND id = ${postId} FOR UPDATE`;
}

/** Shows a kept post to members again. Not while five reports are waiting once more. */
export async function showAgain(tx: TransactionSql, gymId: string, postId: string): Promise<void> {
  await tx`
    UPDATE gym_posts SET hidden_at = NULL
    WHERE gym_id = ${gymId} AND id = ${postId} AND hidden_at IS NOT NULL
      AND ${waitingReports(tx, gymId, postId)} < ${GYM_POST_REPORTS_TO_HIDE}`;
}

/** Whether this person's report is on a post now hidden from them: their report sent again
 *  after a lost reply is answered as the first was. */
export async function reportedHidden(sql: SqlOrTx, gymId: string, postId: string, userId: string): Promise<boolean> {
  const rows = await sql<{ ok: number }[]>`
    SELECT 1 AS ok FROM (${posts(sql, gymId)}) p
    JOIN gym_post_reports r ON r.gym_id = ${gymId} AND r.post_id = p.id AND r.user_id = ${userId}
    WHERE p.id = ${postId} AND p.visible AND p.hidden`;
  return rows.length > 0;
}

/** Which of these posts the person has reported, answered or not. */
export async function reportedBy(sql: SqlOrTx, gymId: string, postIds: readonly string[], userId: string): Promise<Set<string>> {
  if (postIds.length === 0) return new Set();
  const rows = await sql<{ post_id: string }[]>`
    SELECT post_id FROM gym_post_reports
    WHERE gym_id = ${gymId} AND user_id = ${userId} AND post_id = ANY (${[...postIds]}::uuid[])`;
  return new Set(rows.map((r) => r.post_id));
}

/** One value for exactly these reports of a post: another report, or one fewer, changes it. */
const reportsMark = (sql: SqlOrTx) => sql`md5(coalesce(string_agg(a.id::text, ',' ORDER BY a.id), ''))`;

/** Closes a post's open reports; how many it closed. `shown`: only while the post's
 *  reports, answered or not, are exactly the ones staff were shown, and none otherwise.
 *  One statement, so a report that lands while it runs is neither compared nor closed. A
 *  report's own time cannot say whether staff saw it: it is read before the report is stored. */
export async function closeReports(tx: TransactionSql, gymId: string, postId: string, outcome: "removed" | "kept", at: Date, shown: string | null = null): Promise<number> {
  const seen =
    shown === null
      ? tx``
      : tx`AND (SELECT ${reportsMark(tx)} FROM gym_post_reports a WHERE a.gym_id = ${gymId} AND a.post_id = ${postId}) = ${shown}`;
  const rows = await tx<{ id: string }[]>`
    UPDATE gym_post_reports SET closed_at = ${at}, outcome = ${outcome}
    WHERE gym_id = ${gymId} AND post_id = ${postId} AND closed_at IS NULL ${seen}
    RETURNING id`;
  return rows.length;
}

/** A post's reports: every one it has had, and those nobody has answered. */
export async function countReports(tx: TransactionSql, gymId: string, postId: string): Promise<{ all: number; open: number }> {
  const rows = await tx<{ all: number; open: number }[]>`
    SELECT count(*)::int AS all, (count(*) FILTER (WHERE closed_at IS NULL))::int AS open
    FROM gym_post_reports WHERE gym_id = ${gymId} AND post_id = ${postId}`;
  return rows[0] ?? { all: 0, open: 0 };
}

/** Unpins this gym's pinned posts nobody is sent (a member's post whose writer has left):
 *  such a post must not hold one of the three pins. A post hidden while staff decide
 *  (`hidden`) keeps its pin: Keep shows it again where it was. */
export async function unpinUnseen(tx: TransactionSql, gymId: string): Promise<void> {
  await tx`
    UPDATE gym_posts g SET pinned_at = NULL
    WHERE g.gym_id = ${gymId} AND g.pinned_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM (${posts(tx, gymId)}) p WHERE p.id = g.id AND p.visible)`;
}

export interface ReportedRow {
  post: PostRow;
  reports: number;
  /** Every report the post has had, answered or not, and one value for exactly those. */
  allReports: number;
  reportsMark: string;
  firstAt: Date;
  lastAt: Date;
  /** Every reported post waiting, on each row. */
  total: number;
}

/** The posts with a report nobody has answered, longest waiting first. */
export async function reportedPosts(sql: SqlOrTx, gymId: string, limit: number): Promise<ReportedRow[]> {
  const rows = await sql<(RawPost & { reports: number; all_reports: number; reports_mark: string; first_at: Date; last_at: Date; total: number })[]>`
    SELECT p.*, r.reports, r.first_at, r.last_at, count(*) OVER ()::int AS total,
           (SELECT count(*)::int FROM gym_post_reports a WHERE a.gym_id = ${gymId} AND a.post_id = p.id) AS all_reports,
           (SELECT ${reportsMark(sql)} FROM gym_post_reports a WHERE a.gym_id = ${gymId} AND a.post_id = p.id) AS reports_mark
    FROM (${posts(sql, gymId)}) p
    JOIN (
      SELECT post_id, count(*)::int AS reports, min(created_at) AS first_at, max(created_at) AS last_at
      FROM gym_post_reports WHERE gym_id = ${gymId} AND closed_at IS NULL
      GROUP BY post_id
    ) r ON r.post_id = p.id
    WHERE p.visible
    ORDER BY r.first_at, p.id
    LIMIT ${limit}`;
  return rows.map((r) => ({ post: toPost(r), reports: r.reports, allReports: r.all_reports, reportsMark: r.reports_mark, firstAt: r.first_at, lastAt: r.last_at, total: r.total }));
}

/** How many posts have a report nobody has answered. */
export async function countReported(sql: SqlOrTx, gymId: string): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM (${posts(sql, gymId)}) p
    WHERE p.visible AND EXISTS (
      SELECT 1 FROM gym_post_reports r WHERE r.gym_id = ${gymId} AND r.post_id = p.id AND r.closed_at IS NULL)`;
  return rows[0]?.n ?? 0;
}

/** Why these posts' open reports were made, by reason. */
export async function openReportReasons(sql: SqlOrTx, gymId: string, postIds: readonly string[]): Promise<{ postId: string; reason: string; count: number }[]> {
  if (postIds.length === 0) return [];
  const rows = await sql<{ post_id: string; reason: string; n: number }[]>`
    SELECT post_id, reason, count(*)::int AS n FROM gym_post_reports
    WHERE gym_id = ${gymId} AND closed_at IS NULL AND post_id = ANY (${[...postIds]}::uuid[])
    GROUP BY post_id, reason`;
  return rows.map((r) => ({ postId: r.post_id, reason: r.reason, count: r.n }));
}

/** What the people who reported these posts typed, on reports still open: each post's
 *  oldest first, `limit` a post. */
export async function openReportNotes(sql: SqlOrTx, gymId: string, postIds: readonly string[], limit: number): Promise<{ postId: string; note: string }[]> {
  if (postIds.length === 0) return [];
  const rows = await sql<{ post_id: string; note: string }[]>`
    SELECT post_id, note FROM (
      SELECT post_id, note, created_at, id, row_number() OVER (PARTITION BY post_id ORDER BY created_at, id) AS rn
      FROM gym_post_reports
      WHERE gym_id = ${gymId} AND closed_at IS NULL AND note IS NOT NULL AND post_id = ANY (${[...postIds]}::uuid[])
    ) r
    WHERE rn <= ${limit}
    ORDER BY post_id, created_at, id`;
  return rows.map((r) => ({ postId: r.post_id, note: r.note }));
}

/** Stops the person posting at this gym; false when they already were. */
export async function insertStop(tx: TransactionSql, gymId: string, userId: string, at: Date): Promise<boolean> {
  const rows = await tx<{ user_id: string }[]>`
    INSERT INTO gym_post_stops (gym_id, user_id, created_at) VALUES (${gymId}, ${userId}, ${at})
    ON CONFLICT (gym_id, user_id) DO NOTHING RETURNING user_id`;
  return rows.length === 1;
}

/** Lets the person post again; false when they were not stopped. */
export async function deleteStop(tx: TransactionSql, gymId: string, userId: string): Promise<boolean> {
  const rows = await tx<{ user_id: string }[]>`
    DELETE FROM gym_post_stops WHERE gym_id = ${gymId} AND user_id = ${userId} RETURNING user_id`;
  return rows.length === 1;
}

export interface StoppedRow extends ReactorRow {
  userId: string;
  stoppedAt: Date;
}

/** The people this gym has stopped posting whose account is active, newest first. */
export async function stoppedPeople(sql: SqlOrTx, gymId: string, limit: number): Promise<StoppedRow[]> {
  const rows = await sql<{ user_id: string; created_at: Date; display_name: string; email: string | null; record_name: string | null }[]>`
    SELECT s.user_id, s.created_at, u.display_name, u.email::text AS email, nullif(btrim(e.full_name), '') AS record_name
    FROM gym_post_stops s
    JOIN users u ON u.id = s.user_id AND u.status = 'active'
    LEFT JOIN gym_members m ON m.gym_id = s.gym_id AND m.user_id = s.user_id AND m.removed_at IS NULL
    LEFT JOIN gym_member_list_entries e ON e.gym_id = m.gym_id AND e.id = m.entry_id
    WHERE s.gym_id = ${gymId}
    ORDER BY s.created_at DESC, s.user_id
    LIMIT ${limit}`;
  return rows.map((r) => ({ userId: r.user_id, stoppedAt: r.created_at, displayName: r.display_name, email: r.email, recordName: r.record_name }));
}

// ── BLOCK (19b-ii-b) ──

/** `userId` blocks `blockedId` at this gym. Blocked again, nothing changes. */
export async function insertBlock(sql: SqlOrTx, gymId: string, userId: string, blockedId: string, at: Date): Promise<void> {
  await sql`
    INSERT INTO gym_post_blocks (gym_id, user_id, blocked_user_id, created_at) VALUES (${gymId}, ${userId}, ${blockedId}, ${at})
    ON CONFLICT (gym_id, user_id, blocked_user_id) DO NOTHING`;
}

export async function hasBlocked(sql: SqlOrTx, gymId: string, userId: string, blockedId: string): Promise<boolean> {
  const rows = await sql<{ ok: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM gym_post_blocks WHERE gym_id = ${gymId} AND user_id = ${userId} AND blocked_user_id = ${blockedId}
    ) AS ok`;
  return rows[0]?.ok ?? false;
}

/** Whether this post is one the person is not sent only because they blocked its writer. */
export async function hiddenByOwnBlock(sql: SqlOrTx, gymId: string, postId: string, userId: string): Promise<boolean> {
  const rows = await sql<{ ok: number }[]>`
    SELECT 1 AS ok FROM (${posts(sql, gymId)}) p
    JOIN gym_post_blocks b ON b.gym_id = ${gymId} AND b.user_id = ${userId} AND b.blocked_user_id = p.author_id
    WHERE p.id = ${postId} AND p.visible AND p.by_member`;
  return rows.length > 0;
}

/** Deletes the reactions one person gave another's member posts at this gym. */
export async function deleteReactionsToMember(tx: TransactionSql, gymId: string, userId: string, authorId: string): Promise<void> {
  await tx`
    DELETE FROM gym_post_reactions r USING gym_posts p
    WHERE r.gym_id = ${gymId} AND r.user_id = ${userId}
      AND p.gym_id = r.gym_id AND p.id = r.post_id AND p.by_member AND p.author_user_id = ${authorId}`;
}

/** Takes one of the person's own blocks at this gym off; false when it is not theirs or is gone. */
export async function deleteBlock(sql: SqlOrTx, gymId: string, userId: string, blockId: string): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    DELETE FROM gym_post_blocks WHERE gym_id = ${gymId} AND user_id = ${userId} AND id = ${blockId} RETURNING id`;
  return rows.length === 1;
}

/** How many people with an active account this person has blocked at this gym. */
export async function countBlocked(sql: SqlOrTx, gymId: string, userId: string): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM gym_post_blocks b
    JOIN users u ON u.id = b.blocked_user_id AND u.status = 'active'
    WHERE b.gym_id = ${gymId} AND b.user_id = ${userId}`;
  return rows[0]?.n ?? 0;
}

export interface BlockedRow extends ReactorRow {
  id: string;
  blockedAt: Date;
}

/** The people this person has blocked at this gym whose account is active, newest first. */
export async function blockedPeople(sql: SqlOrTx, gymId: string, userId: string, limit: number): Promise<BlockedRow[]> {
  const rows = await sql<{ id: string; created_at: Date; display_name: string; email: string | null; record_name: string | null }[]>`
    SELECT b.id, b.created_at, u.display_name, u.email::text AS email, nullif(btrim(e.full_name), '') AS record_name
    FROM gym_post_blocks b
    JOIN users u ON u.id = b.blocked_user_id AND u.status = 'active'
    LEFT JOIN gym_members m ON m.gym_id = b.gym_id AND m.user_id = b.blocked_user_id AND m.removed_at IS NULL
    LEFT JOIN gym_member_list_entries e ON e.gym_id = m.gym_id AND e.id = m.entry_id
    WHERE b.gym_id = ${gymId} AND b.user_id = ${userId}
    ORDER BY b.created_at DESC, b.id
    LIMIT ${limit}`;
  return rows.map((r) => ({ id: r.id, blockedAt: r.created_at, displayName: r.display_name, email: r.email, recordName: r.record_name }));
}

// ── PHOTO FILES STILL TO REMOVE (`photo_files_to_remove`) ──

/** Notes these store keys as files to remove. */
export async function queueFiles(sql: SqlOrTx, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  await sql`
    INSERT INTO photo_files_to_remove (storage_key) SELECT unnest(${[...keys]}::text[])
    ON CONFLICT (storage_key) DO NOTHING`;
}

/** Takes these keys off the list: their files are gone, or are a kept post's. */
export async function unqueueFiles(sql: SqlOrTx, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  await sql`DELETE FROM photo_files_to_remove WHERE storage_key = ANY (${[...keys]}::text[])`;
}

/** Which of these keys are on the list. */
export async function queuedAmong(sql: SqlOrTx, keys: readonly string[]): Promise<string[]> {
  if (keys.length === 0) return [];
  const rows = await sql<{ storage_key: string }[]>`
    SELECT storage_key FROM photo_files_to_remove WHERE storage_key = ANY (${[...keys]}::text[])`;
  return rows.map((r) => r.storage_key);
}

/** The store keys of this gym's newest post photos and event posters. */
export async function newestPhotoKeys(sql: SqlOrTx, gymId: string, limit: number): Promise<string[]> {
  // A listed key's gym is read out of the key: one that is no id names no gym.
  if (!/^[0-9a-f-]{36}$/.test(gymId)) return [];
  const rows = await sql<{ storage_key: string }[]>`
    (SELECT storage_key FROM gym_post_photos WHERE gym_id = ${gymId} ORDER BY created_at DESC, id LIMIT ${limit})
    UNION ALL
    (SELECT poster_key FROM gym_events WHERE gym_id = ${gymId} AND poster_key IS NOT NULL ORDER BY updated_at DESC, id LIMIT ${limit})`;
  return rows.map((r) => r.storage_key);
}

/** Keys that have been on the list for longer than `minutes`, oldest first. */
export async function queuedFor(sql: SqlOrTx, minutes: number, limit: number): Promise<string[]> {
  const rows = await sql<{ storage_key: string }[]>`
    SELECT storage_key FROM photo_files_to_remove
    WHERE created_at < now() - make_interval(mins => ${minutes})
    ORDER BY created_at, storage_key
    LIMIT ${limit}`;
  return rows.map((r) => r.storage_key);
}

// ── A CHALLENGE'S RESULT (ROADMAP 19d-ii-b) ──

/** Makes the result post of every challenge that ended in the last `days` days on its
 *  gym's own calendar and has none: not a cancelled one, and not for a gym that is closed
 *  or on no plan, whose members are sent no posts. Nobody is its author. One statement;
 *  the unique index makes a second run, or two at once, write nothing more. `gymIds`: only
 *  these gyms, for a test on a database other tests are using. */
export async function insertChallengeResultPosts(tx: TransactionSql, now: Date, days: number, ending: string, gymIds: readonly string[] | null = null): Promise<{ id: string; gymId: string; challengeId: string }[]> {
  const rows = await tx<{ id: string; gym_id: string; challenge_id: string }[]>`
    INSERT INTO gym_posts (gym_id, author_user_id, post_key, body, by_member, created_at, challenge_id)
    SELECT c.gym_id, NULL, gen_random_uuid(), c.name || ${ending}, false, ${now}, c.id
    FROM gym_challenges c
    JOIN gyms g ON g.id = c.gym_id
    WHERE c.cancelled_at IS NULL
      AND g.status = 'active'
      ${gymIds === null ? tx`` : tx`AND c.gym_id = ANY(${[...gymIds]}::uuid[])`}
      AND c.ends_on < (${now}::timestamptz AT TIME ZONE g.timezone)::date
      AND c.ends_on >= (${now}::timestamptz AT TIME ZONE g.timezone)::date - ${days}::int
      AND EXISTS (
        SELECT 1 FROM subscriptions s
        WHERE s.owner_type = 'gym' AND s.owner_id = g.id AND s.status IN ('trialing','active','past_due'))
    ON CONFLICT (gym_id, challenge_id) WHERE challenge_id IS NOT NULL DO NOTHING
    RETURNING id, gym_id, challenge_id`;
  return rows.map((r) => ({ id: r.id, gymId: r.gym_id, challengeId: r.challenge_id }));
}

export interface ResultPostRow {
  postedAt: Date;
  /** Staff removed it. */
  removed: boolean;
  /** Reported by enough people to be hidden from members until staff decide. */
  hidden: boolean;
}

/** Each challenge's result post: when it was made, whether staff have removed it, and
 *  whether it is hidden from members while it waits in the reported list. */
export async function resultPostsOf(sql: SqlOrTx, gymId: string, challengeIds: readonly string[]): Promise<Map<string, ResultPostRow>> {
  const of = new Map<string, ResultPostRow>();
  if (challengeIds.length === 0) return of;
  const rows = await sql<{ challenge_id: string; created_at: Date; removed: boolean; hidden: boolean }[]>`
    SELECT challenge_id, created_at, removed_at IS NOT NULL AS removed, hidden_at IS NOT NULL AND removed_at IS NULL AS hidden
    FROM gym_posts WHERE gym_id = ${gymId} AND challenge_id IN ${sql(challengeIds)}`;
  for (const r of rows) of.set(r.challenge_id, { postedAt: r.created_at, removed: r.removed, hidden: r.hidden });
  return of;
}
