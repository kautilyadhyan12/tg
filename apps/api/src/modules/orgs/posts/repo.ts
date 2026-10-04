// A GYM'S UPDATES, in the database (spec Part 3 §15.2; ROADMAP 19b-i). Every read and
// write names the gym.
import type { Sql, TransactionSql } from "postgres";
import type { GymPostReaction } from "@app/shared";

type SqlOrTx = Sql | TransactionSql;

export interface PostRow {
  id: string;
  /** The author's app name and address while their account is active; null otherwise. */
  authorName: string | null;
  authorEmail: string | null;
  /** Their name on this gym's list, shown when the app's name is an automatic one. */
  authorRecordName: string | null;
  body: string;
  pinnedAt: Date | null;
  createdAt: Date;
  removed: boolean;
}

interface RawPost {
  id: string;
  author_name: string | null;
  author_email: string | null;
  author_record_name: string | null;
  body: string;
  pinned_at: Date | null;
  created_at: Date;
  removed: boolean;
}

const toPost = (r: RawPost): PostRow => ({
  id: r.id,
  authorName: r.author_name,
  authorEmail: r.author_email,
  authorRecordName: r.author_record_name,
  body: r.body,
  pinnedAt: r.pinned_at,
  createdAt: r.created_at,
  removed: r.removed,
});

function posts(sql: SqlOrTx, gymId: string) {
  return sql`
    SELECT p.id, p.body, p.pinned_at, p.created_at, p.post_key, p.removed_at IS NOT NULL AS removed,
           CASE WHEN u.status = 'active' THEN u.display_name END AS author_name,
           CASE WHEN u.status = 'active' THEN u.email::text END AS author_email,
           CASE WHEN u.status = 'active' THEN nullif(btrim(e.full_name), '') END AS author_record_name
    FROM gym_posts p
    LEFT JOIN users u ON u.id = p.author_user_id
    LEFT JOIN gym_members am ON am.gym_id = p.gym_id AND am.user_id = p.author_user_id AND am.removed_at IS NULL
    LEFT JOIN gym_member_list_entries e ON e.gym_id = am.gym_id AND e.id = am.entry_id
    WHERE p.gym_id = ${gymId}`;
}

/** The gym's pinned posts, newest pin first. */
export async function pinnedPosts(sql: SqlOrTx, gymId: string): Promise<PostRow[]> {
  const rows = await sql<RawPost[]>`
    SELECT * FROM (${posts(sql, gymId)}) p
    WHERE NOT p.removed AND p.pinned_at IS NOT NULL
    ORDER BY p.pinned_at DESC, p.id DESC`;
  return rows.map(toPost);
}

/** The posts that are not pinned, newest first, from `before` (a post's instant and id) on. */
export async function postsPage(sql: SqlOrTx, gymId: string, before: { at: string; id: string } | null, limit: number): Promise<PostRow[]> {
  const from = before === null ? sql`` : sql`AND (p.created_at, p.id) < (${before.at}::timestamptz, ${before.id}::uuid)`;
  const rows = await sql<RawPost[]>`
    SELECT * FROM (${posts(sql, gymId)}) p
    WHERE NOT p.removed AND p.pinned_at IS NULL ${from}
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT ${limit}`;
  return rows.map(toPost);
}

/** One of this gym's posts that has not been removed, or null. */
export async function postById(sql: SqlOrTx, gymId: string, postId: string): Promise<PostRow | null> {
  const rows = await sql<RawPost[]>`
    SELECT * FROM (${posts(sql, gymId)}) p WHERE p.id = ${postId} AND NOT p.removed`;
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

export async function reactionCounts(
  sql: SqlOrTx,
  gymId: string,
  postIds: readonly string[],
): Promise<{ postId: string; reaction: string; count: number }[]> {
  if (postIds.length === 0) return [];
  const rows = await sql<{ post_id: string; reaction: string; n: number }[]>`
    SELECT post_id, reaction, count(*)::int AS n FROM gym_post_reactions
    WHERE gym_id = ${gymId} AND post_id = ANY (${[...postIds]}::uuid[])
    GROUP BY post_id, reaction`;
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

/** Who gave this reaction to this gym's post, newest first: people whose account is active. */
export async function reactorsOf(sql: SqlOrTx, gymId: string, postId: string, reaction: GymPostReaction, limit: number): Promise<ReactorRow[]> {
  const rows = await sql<{ display_name: string; email: string | null; record_name: string | null }[]>`
    SELECT u.display_name, u.email::text AS email, nullif(btrim(e.full_name), '') AS record_name
    FROM gym_post_reactions r
    JOIN users u ON u.id = r.user_id AND u.status = 'active'
    LEFT JOIN gym_members m ON m.gym_id = r.gym_id AND m.user_id = r.user_id AND m.removed_at IS NULL
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
  post: { id: string; postKey: string; body: string },
  authorId: string,
  at: Date,
): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    INSERT INTO gym_posts (id, gym_id, author_user_id, post_key, body, created_at)
    VALUES (${post.id}, ${gymId}, ${authorId}, ${post.postKey}, ${post.body}, ${at})
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

export async function setPinned(tx: TransactionSql, gymId: string, postId: string, pinnedAt: Date | null): Promise<void> {
  await tx`UPDATE gym_posts SET pinned_at = ${pinnedAt} WHERE gym_id = ${gymId} AND id = ${postId} AND removed_at IS NULL`;
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

/** A photo of this gym's post that has not been removed, or null. */
export async function photoOf(
  sql: SqlOrTx,
  gymId: string,
  postId: string,
  photoId: string,
): Promise<{ storageKey: string; contentType: string } | null> {
  const rows = await sql<{ storage_key: string; content_type: string }[]>`
    SELECT ph.storage_key, ph.content_type
    FROM gym_post_photos ph
    JOIN gym_posts p ON p.gym_id = ph.gym_id AND p.id = ph.post_id
    WHERE ph.gym_id = ${gymId} AND ph.post_id = ${postId} AND ph.id = ${photoId} AND p.removed_at IS NULL`;
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
