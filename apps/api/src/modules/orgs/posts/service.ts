// A GYM'S UPDATES (spec Part 3 §15.2; ROADMAP 19b-i).
//
// The worst thing this could do to a real person: show a gym's post or photo to somebody
// outside that gym, or keep a photo with the place it was taken inside it. So a post and
// its photos are read only by a live app member of that gym on a live plan, or by its
// staff holding `posts.manage`, everybody else getting the 404 of a gym that does not
// exist; and every photo goes through `cleanPhoto` before it is stored.
import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import {
  GYM_POSTS_PAGE,
  GYM_POST_MAX_PINNED,
  GYM_POST_REACTIONS,
  GYM_POST_REACTORS_SHOWN,
  GYM_POST_WORDS,
  gymPostReactionResponseSchema,
  gymPostReactorsResponseSchema,
  type GymPostReactorsResponse,
  type GymPostsCursor,
  gymPostSchema,
  gymPostsResponseSchema,
  staffGymPostsResponseSchema,
  type AddGymPostRequest,
  type GymPost,
  type GymPostReaction,
  type GymPostReactionCounts,
  type GymPostReactionResponse,
  type GymPostsResponse,
  type StaffGymPostsResponse,
} from "@app/shared";
import { getOrgById, gymHasLivePlan, insertAudit } from "../repo.js";
import { OrgsError, holdsPrivilege, requirePrivilege, requireWritablePrivilege } from "../service.js";
import { cleanPhoto } from "../gymPage/photoBytes.js";
import { postPhotoKey, type PhotoStore } from "../gymPage/photoStore.js";
import { PHOTO_PROBLEM_STATUS, type PhotoFile } from "../gymPage/service.js";
import { fullName, shownName } from "../leaderboard/rank.js";
import { lockGym } from "../memberList/repo.js";
import * as repo from "./repo.js";

export interface PostsDeps {
  sql: Sql;
  now: () => Date;
  photos: PhotoStore;
  /** A file left behind after its row went is said here, never thrown at the person. */
  log: { warn: (obj: object, msg: string) => void };
}

/** The route's rate limit, asked after the tick: false when it has already answered 429. */
export type Limit = () => Promise<boolean>;

const TICK = "posts.manage";

const notFound = (): OrgsError => new OrgsError(404, "org_not_found", "Organisation not found.");
const postNotFound = (): OrgsError => new OrgsError(404, "post_not_found", GYM_POST_WORDS.not_found);

const noReactions = (): GymPostReactionCounts => ({ like: 0, strong: 0, fire: 0, love: 0 });

function countsOf(rows: readonly { postId: string; reaction: string; count: number }[], postId: string): GymPostReactionCounts {
  const counts = noReactions();
  for (const row of rows) {
    if (row.postId !== postId) continue;
    const reaction = GYM_POST_REACTIONS.find((r) => r === row.reaction);
    if (reaction !== undefined) counts[reaction] = row.count;
  }
  return counts;
}

/** Posts as their reader sees them: members a first name and last initial, staff the
 *  whole name; the reader's own reaction beside the counts. */
async function shaped(deps: Pick<PostsDeps, "sql">, gymId: string, rows: readonly repo.PostRow[], viewerId: string, staff: boolean): Promise<GymPost[]> {
  const ids = rows.map((r) => r.id);
  const [photos, counts, mine] = await Promise.all([
    repo.photosOf(deps.sql, gymId, ids),
    repo.reactionCounts(deps.sql, gymId, ids),
    repo.reactionsOf(deps.sql, gymId, ids, viewerId),
  ]);
  return rows.map((r) => {
    // An automatic app name (the email's first part) is never shown: the gym's record of
    // the person names them, and with neither the screen says the gym's own name.
    const who = { displayName: r.authorName ?? "", email: r.authorEmail, recordName: r.authorRecordName };
    const named = staff ? fullName(who) : shownName(who);
    return gymPostSchema.parse({
      id: r.id,
      author: { name: named?.name ?? null, initials: named?.name == null ? "" : named.initials },
      body: r.body,
      photos: photos.filter((p) => p.postId === r.id).map((p) => ({ id: p.id, width: p.width, height: p.height })),
      pinned: r.pinnedAt !== null,
      createdAt: r.createdAt.toISOString(),
      reactions: countsOf(counts, r.id),
      mine: GYM_POST_REACTIONS.find((reaction) => reaction === mine.get(r.id)) ?? null,
    });
  });
}

const cursorOf = (row: repo.PostRow): string => `${row.createdAt.toISOString()}_${row.id}`;

/** One page: the pinned posts on the first, then the rest newest first. */
async function page(deps: Pick<PostsDeps, "sql">, gymId: string, viewerId: string, before: GymPostsCursor | undefined, staff: boolean) {
  const from = before ?? null;
  const [pinned, rows] = await Promise.all([
    from === null ? repo.pinnedPosts(deps.sql, gymId) : Promise.resolve([]),
    repo.postsPage(deps.sql, gymId, from, GYM_POSTS_PAGE + 1),
  ]);
  const shown = rows.slice(0, GYM_POSTS_PAGE);
  const last = shown[shown.length - 1];
  const all = await shaped(deps, gymId, [...pinned, ...shown], viewerId, staff);
  return {
    pinned: all.slice(0, pinned.length),
    posts: all.slice(pinned.length),
    next: rows.length > GYM_POSTS_PAGE && last !== undefined ? cursorOf(last) : null,
  };
}

/** The gym is open and on a trial or a paid plan: its members see its page. */
async function gymIsLive(sql: Sql, gymId: string, status: string): Promise<boolean> {
  return status === "active" && (await gymHasLivePlan(sql, gymId));
}

/** The gym's posts for a live app member of it; 404 for everybody else. */
export async function getPosts(deps: Pick<PostsDeps, "sql">, userId: string, gymId: string, before: GymPostsCursor | undefined): Promise<GymPostsResponse> {
  const org = await getOrgById(deps.sql, gymId);
  if (org === null || !(await repo.isLiveMember(deps.sql, gymId, userId))) throw notFound();
  if (!(await gymIsLive(deps.sql, gymId, org.status))) {
    return gymPostsResponseSchema.parse({ gymId, gymName: org.name, status: "paused", pinned: [], posts: [], next: null });
  }
  return gymPostsResponseSchema.parse({ gymId, gymName: org.name, status: "shown", ...(await page(deps, gymId, userId, before, false)) });
}

/** The gym's posts for its staff holding the tick. */
export async function getStaffPosts(
  deps: Pick<PostsDeps, "sql">,
  staffId: string,
  gymId: string,
  before: GymPostsCursor | undefined,
  limit: Limit,
): Promise<StaffGymPostsResponse | null> {
  const { org } = await requirePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  return staffGymPostsResponseSchema.parse({ gymId, gymName: org.name, ...(await page(deps, gymId, staffId, before, true)) });
}

/** Who gave one reaction to a post, by whole name, for staff holding the tick. Members are
 *  never sent this: they see the counts only. */
export async function getReactors(
  deps: Pick<PostsDeps, "sql">,
  staffId: string,
  gymId: string,
  postId: string,
  reaction: GymPostReaction,
  limit: Limit,
): Promise<GymPostReactorsResponse | null> {
  await requirePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  if ((await repo.postById(deps.sql, gymId, postId)) === null) throw postNotFound();
  const [counts, people] = await Promise.all([
    repo.reactionCounts(deps.sql, gymId, [postId]),
    repo.reactorsOf(deps.sql, gymId, postId, reaction, GYM_POST_REACTORS_SHOWN),
  ]);
  return gymPostReactorsResponseSchema.parse({
    reaction,
    total: countsOf(counts, postId)[reaction],
    people: people.map((p) => {
      const named = fullName(p);
      return { name: named.name, initials: named.name === null ? "" : named.initials };
    }),
  });
}

async function removeFiles(deps: Pick<PostsDeps, "photos" | "log">, keys: readonly string[]): Promise<void> {
  for (const key of keys) {
    try {
      await deps.photos.remove(key);
    } catch (err) {
      deps.log.warn({ event: "gym_post.photo_left_behind", err }, "a removed photo's file could not be deleted");
    }
  }
}

async function staffPost(deps: Pick<PostsDeps, "sql">, gymId: string, postId: string, staffId: string): Promise<GymPost> {
  const row = await repo.postById(deps.sql, gymId, postId);
  if (row === null) throw postNotFound();
  const [post] = await shaped(deps, gymId, [row], staffId, true);
  if (post === undefined) throw postNotFound();
  return post;
}

/** Staff who may post at a gym that can be changed; anybody else is refused as every
 *  staff write here refuses them. The route asks it before it reads a post's body. */
export async function requirePoster(deps: Pick<PostsDeps, "sql">, staffId: string, gymId: string): Promise<void> {
  await requireWritablePrivilege(deps, gymId, staffId, TICK);
}

/** A new post. Sent twice under one key (a reply lost on the way back), it is one post. */
export async function addPost(deps: PostsDeps, staffId: string, gymId: string, body: AddGymPostRequest): Promise<GymPost> {
  await requirePoster(deps, staffId, gymId);
  const kept = await repo.postByKey(deps.sql, gymId, body.postKey);
  if (kept !== null) return await staffPost(deps, gymId, kept.id, staffId);

  const photos: (repo.NewPostPhoto & { bytes: Uint8Array })[] = [];
  for (const [i, base64] of body.photos.entries()) {
    // One photo at a time, with the thread free for other requests between them.
    if (i > 0) await new Promise((resolve) => setImmediate(resolve));
    const read = cleanPhoto(new Uint8Array(Buffer.from(base64, "base64")));
    if (!read.ok) {
      const problem = PHOTO_PROBLEM_STATUS[read.problem];
      throw new OrgsError(400, problem.code, GYM_POST_WORDS.photo(i + 1, problem.message));
    }
    const id = randomUUID();
    photos.push({ id, storageKey: postPhotoKey(gymId, id, read.type), contentType: read.type, byteSize: read.bytes.length, width: read.width, height: read.height, bytes: read.bytes });
  }
  const keys = photos.map((p) => p.storageKey);
  const id = randomUUID();
  const at = deps.now();
  let made: boolean;
  try {
    for (const photo of photos) await deps.photos.put(photo.storageKey, photo.bytes);
    made = await deps.sql.begin(async (tx) => {
      // The same key sent twice at once: the second finds the first's row and keeps nothing.
      if (!(await repo.insertPost(tx, gymId, { id, postKey: body.postKey, body: body.body.trim() }, staffId, at))) return false;
      await repo.insertPhotos(tx, gymId, id, photos, at);
      await insertAudit(tx, { actorUserId: staffId, gymId, action: "org.post_added", targetType: "post", targetId: id, meta: { photos: String(photos.length) } });
      return true;
    });
  } catch (err) {
    await removeFiles(deps, keys);
    throw err;
  }
  if (made) return await staffPost(deps, gymId, id, staffId);
  await removeFiles(deps, keys);
  const first = await repo.postByKey(deps.sql, gymId, body.postKey);
  if (first === null) throw postNotFound();
  return await staffPost(deps, gymId, first.id, staffId);
}

/** Pin a post to the top, or unpin it. At most three are pinned, counted under the gym's lock. */
export async function setPinned(deps: Pick<PostsDeps, "sql" | "now">, staffId: string, gymId: string, postId: string, pinned: boolean, limit: Limit): Promise<GymPost | null> {
  await requireWritablePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  await deps.sql.begin(async (tx) => {
    await lockGym(tx, gymId);
    const post = await repo.postById(tx, gymId, postId);
    if (post === null) throw postNotFound();
    if (pinned === (post.pinnedAt !== null)) return;
    if (pinned && (await repo.countPinned(tx, gymId)) >= GYM_POST_MAX_PINNED) {
      throw new OrgsError(409, "pins_full", GYM_POST_WORDS.pins_full);
    }
    await repo.setPinned(tx, gymId, postId, pinned ? deps.now() : null);
    await insertAudit(tx, { actorUserId: staffId, gymId, action: pinned ? "org.post_pinned" : "org.post_unpinned", targetType: "post", targetId: postId, meta: {} });
  });
  return await staffPost(deps, gymId, postId, staffId);
}

/** Remove a post: gone for everyone, its photos and reactions deleted. */
export async function removePost(deps: PostsDeps, staffId: string, gymId: string, postId: string, limit: Limit): Promise<true | null> {
  await requireWritablePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  const keys = await deps.sql.begin(async (tx) => {
    if (!(await repo.markRemoved(tx, gymId, postId, staffId, deps.now()))) throw postNotFound();
    const files = await repo.deletePhotos(tx, gymId, postId);
    await repo.deleteReactions(tx, gymId, postId);
    await insertAudit(tx, { actorUserId: staffId, gymId, action: "org.post_removed", targetType: "post", targetId: postId, meta: {} });
    return files;
  });
  await removeFiles(deps, keys);
  return true;
}

/** A live app member of a gym on a live plan; 404 for everybody else. */
async function requireMember(deps: Pick<PostsDeps, "sql">, gymId: string, userId: string): Promise<void> {
  const org = await getOrgById(deps.sql, gymId);
  if (org === null || !(await repo.isLiveMember(deps.sql, gymId, userId))) throw notFound();
  if (!(await gymIsLive(deps.sql, gymId, org.status))) throw notFound();
}

/** The member's one reaction to a post: set, changed, or taken off with null. */
export async function react(
  deps: Pick<PostsDeps, "sql" | "now">,
  userId: string,
  gymId: string,
  postId: string,
  reaction: GymPostReaction | null,
): Promise<GymPostReactionResponse> {
  await requireMember(deps, gymId, userId);
  if (reaction === null) {
    if ((await repo.postById(deps.sql, gymId, postId)) === null) throw postNotFound();
    await repo.clearReaction(deps.sql, gymId, postId, userId);
  } else if (!(await repo.setReaction(deps.sql, gymId, postId, userId, reaction, deps.now()))) {
    throw postNotFound();
  }
  const counts = await repo.reactionCounts(deps.sql, gymId, [postId]);
  return gymPostReactionResponseSchema.parse({ reactions: countsOf(counts, postId), mine: reaction });
}

/** A post's photo, for a member who may read the post or staff holding the tick. With
 *  `wantBytes` false (the reader's browser already holds it) the same checks run and null
 *  is the answer: it is still theirs to show. */
export async function getPhoto(
  deps: Pick<PostsDeps, "sql" | "photos">,
  userId: string,
  gymId: string,
  postId: string,
  photoId: string,
  wantBytes: boolean,
): Promise<PhotoFile | null> {
  const org = await getOrgById(deps.sql, gymId);
  if (org === null) throw notFound();
  const member = (await repo.isLiveMember(deps.sql, gymId, userId)) && (await gymIsLive(deps.sql, gymId, org.status));
  if (!member && !(await holdsPrivilege(deps, gymId, userId, TICK))) throw notFound();
  const photo = await repo.photoOf(deps.sql, gymId, postId, photoId);
  if (photo === null) throw new OrgsError(404, "photo_not_found", GYM_POST_WORDS.photo_not_found);
  if (!wantBytes) return null;
  const bytes = await deps.photos.get(photo.storageKey);
  if (bytes === null) throw new OrgsError(404, "photo_not_found", GYM_POST_WORDS.photo_not_found);
  return { contentType: photo.contentType, bytes };
}
