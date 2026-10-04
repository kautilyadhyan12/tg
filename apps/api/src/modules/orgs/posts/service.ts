// A GYM'S UPDATES (spec Part 3 §15.2, §15.3; ROADMAP 19b-i, 19b-ii-a).
//
// The worst thing this could do to a real person: show a gym's post or photo to somebody
// outside that gym, keep a photo with the place it was taken inside it, or leave a cruel
// post in front of a whole gym after it was reported. So a post and its photos are read
// only by a live app member of that gym on a live plan, or by its staff holding
// `posts.manage`, everybody else getting the 404 of a gym that does not exist; every photo
// goes through `cleanPhoto` before it is stored; and a post staff remove is gone for
// everyone in that one step, its photos' files with it.
import { randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import {
  GYM_MEMBER_POSTS_A_DAY,
  GYM_POSTS_PAGE,
  GYM_POST_MAX_PINNED,
  GYM_POST_REACTIONS,
  GYM_POST_REACTORS_SHOWN,
  GYM_POST_REPORTS_SHOWN,
  GYM_POST_REPORT_NOTES_SHOWN,
  GYM_POST_REPORT_REASONS,
  GYM_POST_STOPS_SHOWN,
  GYM_POST_WORDS,
  gymPostReactionResponseSchema,
  gymPostReactorsResponseSchema,
  gymPostSchema,
  gymPostsResponseSchema,
  reportedGymPostsResponseSchema,
  staffGymPostSchema,
  staffGymPostsResponseSchema,
  stoppedGymPostersResponseSchema,
  type AddGymPostRequest,
  type GymMemberPosting,
  type GymPost,
  type GymPostReaction,
  type GymPostReactionCounts,
  type GymPostReactionResponse,
  type GymPostReactorsResponse,
  type GymPostReasonCounts,
  type GymPostReportReason,
  type GymPostsCursor,
  type GymPostsResponse,
  type ReportedGymPostsResponse,
  type StaffGymPost,
  type StaffGymPostsResponse,
  type StoppedGymPostersResponse,
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
const DAY_MS = 24 * 60 * 60 * 1000;

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

/** Posts as a member reads them: a first name and last initial, the reader's own reaction
 *  beside the counts, and whether the post is theirs or one they reported. */
async function shaped(deps: Pick<PostsDeps, "sql">, gymId: string, rows: readonly repo.PostRow[], viewerId: string): Promise<GymPost[]> {
  const ids = rows.map((r) => r.id);
  const [photos, counts, mine, reported] = await Promise.all([
    repo.photosOf(deps.sql, gymId, ids),
    repo.reactionCounts(deps.sql, gymId, ids),
    repo.reactionsOf(deps.sql, gymId, ids, viewerId),
    repo.reportedBy(deps.sql, gymId, ids, viewerId),
  ]);
  return rows.map((r) => {
    // An automatic app name (the email's first part) is never shown: the gym's record of
    // the person names them, and with neither the screen says whose post it is in words.
    const named = shownName({ displayName: r.authorName ?? "", email: r.authorEmail, recordName: r.authorRecordName });
    return gymPostSchema.parse({
      id: r.id,
      author: { name: named?.name ?? null, initials: named?.name == null ? "" : named.initials },
      body: r.body,
      photos: photos.filter((p) => p.postId === r.id).map((p) => ({ id: p.id, width: p.width, height: p.height })),
      pinned: r.pinnedAt !== null,
      createdAt: r.createdAt.toISOString(),
      reactions: countsOf(counts, r.id),
      mine: GYM_POST_REACTIONS.find((reaction) => reaction === mine.get(r.id)) ?? null,
      fromMember: r.byMember,
      own: r.byMember && r.authorId === viewerId,
      wrote: r.authorId === viewerId,
      reported: reported.has(r.id),
    });
  });
}

/** Posts as staff holding the tick read them: the whole name, and for a member's post
 *  whose it is and whether that person has been stopped from posting. */
async function staffShaped(deps: Pick<PostsDeps, "sql">, gymId: string, rows: readonly repo.PostRow[], staffId: string): Promise<StaffGymPost[]> {
  const ids = rows.map((r) => r.id);
  const members = rows.flatMap((r) => (r.byMember && r.authorId !== null ? [r.authorId] : []));
  const [photos, counts, mine, stopped] = await Promise.all([
    repo.photosOf(deps.sql, gymId, ids),
    repo.reactionCounts(deps.sql, gymId, ids),
    repo.reactionsOf(deps.sql, gymId, ids, staffId),
    repo.stoppedAmong(deps.sql, gymId, members),
  ]);
  return rows.map((r) => {
    const named = fullName({ displayName: r.authorName ?? "", email: r.authorEmail, recordName: r.authorRecordName });
    const authorId = r.byMember ? r.authorId : null;
    return staffGymPostSchema.parse({
      id: r.id,
      author: { name: named.name, initials: named.name === null ? "" : named.initials },
      body: r.body,
      photos: photos.filter((p) => p.postId === r.id).map((p) => ({ id: p.id, width: p.width, height: p.height })),
      pinned: r.pinnedAt !== null,
      createdAt: r.createdAt.toISOString(),
      reactions: countsOf(counts, r.id),
      mine: GYM_POST_REACTIONS.find((reaction) => reaction === mine.get(r.id)) ?? null,
      fromMember: r.byMember,
      own: false,
      wrote: false,
      reported: false,
      authorId,
      authorStopped: authorId !== null && stopped.has(authorId),
    });
  });
}

const cursorOf = (row: repo.PostRow): string => `${row.createdAt.toISOString()}_${row.id}`;

/** One page: the pinned posts on the first, then the rest newest first. */
async function page<P>(
  deps: Pick<PostsDeps, "sql">,
  gymId: string,
  before: GymPostsCursor | undefined,
  shape: (rows: readonly repo.PostRow[]) => Promise<P[]>,
): Promise<{ pinned: P[]; posts: P[]; next: string | null }> {
  const from = before ?? null;
  const [pinned, rows] = await Promise.all([
    from === null ? repo.pinnedPosts(deps.sql, gymId) : Promise.resolve([]),
    repo.postsPage(deps.sql, gymId, from, GYM_POSTS_PAGE + 1),
  ]);
  const shown = rows.slice(0, GYM_POSTS_PAGE);
  const last = shown[shown.length - 1];
  const all = await shape([...pinned, ...shown]);
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

/** Whether this member may post: the gym's switch, then a stop on the person. */
async function postingOf(sql: Sql | TransactionSql, gymId: string, userId: string): Promise<GymMemberPosting> {
  if (!(await repo.membersCanPost(sql, gymId))) return "off";
  return (await repo.isStopped(sql, gymId, userId)) ? "stopped" : "on";
}

/** The gym's posts for a live app member of it; 404 for everybody else. */
export async function getPosts(deps: Pick<PostsDeps, "sql">, userId: string, gymId: string, before: GymPostsCursor | undefined): Promise<GymPostsResponse> {
  const org = await getOrgById(deps.sql, gymId);
  if (org === null || !(await repo.isLiveMember(deps.sql, gymId, userId))) throw notFound();
  if (!(await gymIsLive(deps.sql, gymId, org.status))) {
    return gymPostsResponseSchema.parse({ gymId, gymName: org.name, status: "paused", posting: "off", pinned: [], posts: [], next: null });
  }
  const [feed, posting] = await Promise.all([
    page(deps, gymId, before, (rows) => shaped(deps, gymId, rows, userId)),
    postingOf(deps.sql, gymId, userId),
  ]);
  return gymPostsResponseSchema.parse({ gymId, gymName: org.name, status: "shown", posting, ...feed });
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
  const [feed, membersCanPost, reportedCount] = await Promise.all([
    page(deps, gymId, before, (rows) => staffShaped(deps, gymId, rows, staffId)),
    repo.membersCanPost(deps.sql, gymId),
    repo.countReported(deps.sql, gymId),
  ]);
  return staffGymPostsResponseSchema.parse({ gymId, gymName: org.name, membersCanPost, reportedCount, ...feed });
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

async function staffPost(deps: Pick<PostsDeps, "sql">, gymId: string, postId: string, staffId: string): Promise<StaffGymPost> {
  const row = await repo.postById(deps.sql, gymId, postId);
  if (row === null) throw postNotFound();
  const [post] = await staffShaped(deps, gymId, [row], staffId);
  if (post === undefined) throw postNotFound();
  return post;
}

async function memberPost(deps: Pick<PostsDeps, "sql">, gymId: string, postId: string, userId: string): Promise<GymPost> {
  const row = await repo.postById(deps.sql, gymId, postId);
  if (row === null) throw postNotFound();
  const [post] = await shaped(deps, gymId, [row], userId);
  if (post === undefined) throw postNotFound();
  return post;
}

/** Staff who may post at a gym that can be changed; anybody else is refused as every
 *  staff write here refuses them. The route asks it before it reads a post's body. */
export async function requirePoster(deps: Pick<PostsDeps, "sql">, staffId: string, gymId: string): Promise<void> {
  await requireWritablePrivilege(deps, gymId, staffId, TICK);
}

/** A live app member of a gym on a live plan; 404 for everybody else. The gym's name. */
async function requireMember(deps: Pick<PostsDeps, "sql">, gymId: string, userId: string): Promise<string> {
  const org = await getOrgById(deps.sql, gymId);
  if (org === null || !(await repo.isLiveMember(deps.sql, gymId, userId))) throw notFound();
  if (!(await gymIsLive(deps.sql, gymId, org.status))) throw notFound();
  return org.name;
}

function refusePosting(posting: GymMemberPosting, gymName: string): void {
  if (posting === "off") throw new OrgsError(403, "posting_off", GYM_POST_WORDS.posting_off);
  if (posting === "stopped") throw new OrgsError(403, "posting_stopped", GYM_POST_WORDS.posting_stopped(gymName));
}

/** Refuses a member who has made the day's posts already. */
async function refuseFullDay(sql: Sql | TransactionSql, gymId: string, userId: string, at: Date): Promise<void> {
  if ((await repo.countMemberPostsSince(sql, gymId, userId, new Date(at.getTime() - DAY_MS))) >= GYM_MEMBER_POSTS_A_DAY) {
    throw new OrgsError(429, "posts_day_full", GYM_POST_WORDS.day_full);
  }
}

/** A member who may post: the gym's switch is on, staff have not stopped them, and the
 *  day's posts are not used up. The route asks it before it reads a post's body, so a
 *  person who may not post costs the server no photos; the count that decides is the one
 *  made again with their membership held, when the post is kept. The gym's name. */
export async function requireMemberPoster(deps: Pick<PostsDeps, "sql" | "now">, userId: string, gymId: string): Promise<string> {
  const gymName = await requireMember(deps, gymId, userId);
  refusePosting(await postingOf(deps.sql, gymId, userId), gymName);
  await refuseFullDay(deps.sql, gymId, userId, deps.now());
  return gymName;
}

/** Keeps a new post and its photos. `guard` runs first inside the same step and refuses by
 *  throwing. False when the gym already keeps a post under this key. */
async function keepPost(
  deps: PostsDeps,
  gymId: string,
  authorId: string,
  body: AddGymPostRequest,
  byMember: boolean,
  guard: (tx: TransactionSql, at: Date) => Promise<void>,
): Promise<{ id: string; made: boolean }> {
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
      await guard(tx, at);
      // The same key sent twice at once: the second finds the first's row and keeps nothing.
      if (!(await repo.insertPost(tx, gymId, { id, postKey: body.postKey, body: body.body.trim(), byMember }, authorId, at))) return false;
      await repo.insertPhotos(tx, gymId, id, photos, at);
      await insertAudit(tx, {
        actorUserId: authorId,
        gymId,
        action: byMember ? "org.member_post_added" : "org.post_added",
        targetType: "post",
        targetId: id,
        meta: { photos: String(photos.length) },
      });
      return true;
    });
  } catch (err) {
    await removeFiles(deps, keys);
    throw err;
  }
  if (!made) await removeFiles(deps, keys);
  return { id, made };
}

/** A new post by staff. Sent twice under one key (a reply lost on the way back), it is one post. */
export async function addPost(deps: PostsDeps, staffId: string, gymId: string, body: AddGymPostRequest): Promise<StaffGymPost> {
  await requirePoster(deps, staffId, gymId);
  const kept = await repo.postByKey(deps.sql, gymId, body.postKey);
  if (kept !== null) return await staffPost(deps, gymId, kept.id, staffId);
  const post = await keepPost(deps, gymId, staffId, body, false, () => Promise.resolve());
  if (post.made) return await staffPost(deps, gymId, post.id, staffId);
  const first = await repo.postByKey(deps.sql, gymId, body.postKey);
  if (first === null) throw postNotFound();
  return await staffPost(deps, gymId, first.id, staffId);
}

/** The post a member already made under this key, or null. A key somebody else used is
 *  not theirs to read back. */
async function ownByKey(deps: Pick<PostsDeps, "sql">, gymId: string, userId: string, postKey: string): Promise<GymPost | null> {
  const kept = await repo.postByKey(deps.sql, gymId, postKey);
  if (kept === null) return null;
  if (!kept.byMember || kept.authorId !== userId) throw new OrgsError(409, "post_key_taken", "Please try posting again.");
  return await memberPost(deps, gymId, kept.id, userId);
}

/** A new post by a member, where the gym lets its members post. Ten in any 24 hours,
 *  counted with the person's membership held so two sent at once are counted in turn. */
export async function addMemberPost(deps: PostsDeps, userId: string, gymId: string, body: AddGymPostRequest): Promise<GymPost> {
  // A post sent again under its key is answered with the post kept, whatever has changed since.
  await requireMember(deps, gymId, userId);
  const kept = await ownByKey(deps, gymId, userId, body.postKey);
  if (kept !== null) return kept;
  const gymName = await requireMemberPoster(deps, userId, gymId);
  const post = await keepPost(deps, gymId, userId, body, true, async (tx, at) => {
    if (!(await repo.lockMember(tx, gymId, userId, true))) throw notFound();
    refusePosting(await postingOf(tx, gymId, userId), gymName);
    await refuseFullDay(tx, gymId, userId, at);
  });
  if (post.made) return await memberPost(deps, gymId, post.id, userId);
  const first = await ownByKey(deps, gymId, userId, body.postKey);
  if (first === null) throw postNotFound();
  return first;
}

/** Pin a post to the top, or unpin it. At most three are pinned, counted under the gym's lock. */
export async function setPinned(deps: Pick<PostsDeps, "sql" | "now">, staffId: string, gymId: string, postId: string, pinned: boolean, limit: Limit): Promise<StaffGymPost | null> {
  await requireWritablePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  await deps.sql.begin(async (tx) => {
    await lockGym(tx, gymId);
    // A pinned member's post whose writer has left is seen by nobody: its pin is given back.
    await repo.unpinHidden(tx, gymId);
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

/** What goes with a removed post, in the removal's own step: its photos' rows, its
 *  reactions, and its open reports, answered. The photos' store keys. */
async function removeRest(tx: TransactionSql, gymId: string, postId: string, at: Date): Promise<string[]> {
  const files = await repo.deletePhotos(tx, gymId, postId);
  await repo.deleteReactions(tx, gymId, postId);
  await repo.closeReports(tx, gymId, postId, "removed", at);
  return files;
}

/** Staff remove a post, the gym's or a member's: gone for everyone, its photos and
 *  reactions deleted, its reports answered. */
export async function removePost(deps: PostsDeps, staffId: string, gymId: string, postId: string, limit: Limit): Promise<true | null> {
  await requireWritablePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  const keys = await deps.sql.begin(async (tx) => {
    const at = deps.now();
    if (!(await repo.markRemoved(tx, gymId, postId, staffId, at))) throw postNotFound();
    const files = await removeRest(tx, gymId, postId, at);
    await insertAudit(tx, { actorUserId: staffId, gymId, action: "org.post_removed", targetType: "post", targetId: postId, meta: {} });
    return files;
  });
  await removeFiles(deps, keys);
  return true;
}

/** A member removes their own post. Anybody else's is "not found" to them. */
export async function removeOwnPost(deps: PostsDeps, userId: string, gymId: string, postId: string, limit: Limit): Promise<true | null> {
  await requireMember(deps, gymId, userId);
  if (!(await limit())) return null;
  const keys = await deps.sql.begin(async (tx) => {
    const at = deps.now();
    if (!(await repo.markRemovedOwn(tx, gymId, postId, userId, at))) throw postNotFound();
    const files = await removeRest(tx, gymId, postId, at);
    await insertAudit(tx, { actorUserId: userId, gymId, action: "org.member_post_removed", targetType: "post", targetId: postId, meta: {} });
    return files;
  });
  await removeFiles(deps, keys);
  return true;
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
  if ((await repo.postById(deps.sql, gymId, postId)) === null) throw postNotFound();
  if (reaction === null) {
    await repo.clearReaction(deps.sql, gymId, postId, userId);
  } else if (!(await repo.setReaction(deps.sql, gymId, postId, userId, reaction, deps.now()))) {
    throw postNotFound();
  }
  const counts = await repo.reactionCounts(deps.sql, gymId, [postId]);
  return gymPostReactionResponseSchema.parse({ reactions: countsOf(counts, postId), mine: reaction });
}

/** A member reports a post, once, with a reason and anything they typed beside it. Nothing
 *  is written about who reported except the report itself, and staff are never sent it. */
export async function report(
  deps: Pick<PostsDeps, "sql" | "now">,
  userId: string,
  gymId: string,
  postId: string,
  reason: GymPostReportReason,
  note: string | undefined,
  limit: Limit,
): Promise<true | null> {
  await requireMember(deps, gymId, userId);
  if (!(await limit())) return null;
  const post = await repo.postById(deps.sql, gymId, postId);
  if (post === null) throw postNotFound();
  if (post.authorId === userId) throw new OrgsError(400, "own_post", GYM_POST_WORDS.own_report);
  const typed = note === undefined || note === "" ? null : note;
  if (!(await repo.insertReport(deps.sql, gymId, postId, userId, reason, typed, deps.now()))) throw postNotFound();
  return true;
}

const noReasons = (): GymPostReasonCounts => ({ unkind: 0, photo_of_someone: 0, nudity: 0, spam: 0, other: 0 });

/** The reported posts nobody has answered, for staff holding the tick. */
export async function getReported(deps: Pick<PostsDeps, "sql">, staffId: string, gymId: string, limit: Limit): Promise<ReportedGymPostsResponse | null> {
  const { org } = await requirePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  const rows = await repo.reportedPosts(deps.sql, gymId, GYM_POST_REPORTS_SHOWN);
  const ids = rows.map((r) => r.post.id);
  const [posts, reasons, notes] = await Promise.all([
    staffShaped(deps, gymId, rows.map((r) => r.post), staffId),
    repo.openReportReasons(deps.sql, gymId, ids),
    repo.openReportNotes(deps.sql, gymId, ids, GYM_POST_REPORT_NOTES_SHOWN),
  ]);
  return reportedGymPostsResponseSchema.parse({
    gymId,
    gymName: org.name,
    total: rows[0]?.total ?? 0,
    items: rows.flatMap((row, i) => {
      const post = posts[i];
      if (post === undefined) return [];
      const counts = noReasons();
      for (const r of reasons) {
        const reason = GYM_POST_REPORT_REASONS.find((known) => known === r.reason);
        if (r.postId === row.post.id && reason !== undefined) counts[reason] = r.count;
      }
      const typed = notes.filter((n) => n.postId === row.post.id).map((n) => n.note);
      return [{ post, reports: row.reports, reasons: counts, notes: typed, firstReportedAt: row.firstAt.toISOString(), lastReportedAt: row.lastAt.toISOString() }];
    }),
  });
}

/** Staff keep a reported post: the reports they were shown (those made up to `upTo`) are
 *  answered. A report that arrived after it was never read, so it stays open and the post
 *  stays on the list; how many such are waiting. */
export async function keepReported(
  deps: Pick<PostsDeps, "sql" | "now">,
  staffId: string,
  gymId: string,
  postId: string,
  upTo: string,
  limit: Limit,
): Promise<{ waiting: number } | null> {
  await requireWritablePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  return await deps.sql.begin(async (tx) => {
    if ((await repo.postById(tx, gymId, postId)) === null) throw postNotFound();
    const closed = await repo.closeReports(tx, gymId, postId, "kept", deps.now(), upTo);
    if (closed > 0) {
      await insertAudit(tx, { actorUserId: staffId, gymId, action: "org.post_kept", targetType: "post", targetId: postId, meta: { reports: String(closed) } });
    }
    return { waiting: await repo.countOpenReports(tx, gymId, postId) };
  });
}

/** The gym's switch: whether its members may post. Posts already made stay either way. */
export async function setMembersCanPost(deps: Pick<PostsDeps, "sql">, staffId: string, gymId: string, on: boolean, limit: Limit): Promise<{ membersCanPost: boolean } | null> {
  await requireWritablePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  await deps.sql.begin(async (tx) => {
    if (!(await repo.setMembersCanPost(tx, gymId, on))) return;
    await insertAudit(tx, { actorUserId: staffId, gymId, action: on ? "org.member_posts_on" : "org.member_posts_off", targetType: "gyms", targetId: gymId, meta: {} });
  });
  return { membersCanPost: on };
}

/** Stop one of the gym's people posting, or let them post again. Their posts stay until
 *  removed. Somebody who was never a member of this gym is "not found". */
export async function setStopped(deps: Pick<PostsDeps, "sql" | "now">, staffId: string, gymId: string, userId: string, stopped: boolean, limit: Limit): Promise<{ stopped: boolean } | null> {
  await requireWritablePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  await deps.sql.begin(async (tx) => {
    // Held with the person's own posting, so a post sent at this moment lands before the
    // stop or is refused by it.
    if (!(await repo.lockMember(tx, gymId, userId, false))) throw new OrgsError(404, "person_not_found", GYM_POST_WORDS.person_not_found);
    const changed = stopped ? await repo.insertStop(tx, gymId, userId, deps.now()) : await repo.deleteStop(tx, gymId, userId);
    if (!changed) return;
    await insertAudit(tx, { actorUserId: staffId, gymId, action: stopped ? "org.posting_stopped" : "org.posting_allowed", targetType: "user", targetId: userId, meta: {} });
  });
  return { stopped };
}

/** The people this gym has stopped posting, by whole name. */
export async function getStopped(deps: Pick<PostsDeps, "sql">, staffId: string, gymId: string, limit: Limit): Promise<StoppedGymPostersResponse | null> {
  await requirePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  const people = await repo.stoppedPeople(deps.sql, gymId, GYM_POST_STOPS_SHOWN);
  return stoppedGymPostersResponseSchema.parse({
    people: people.map((p) => {
      const named = fullName(p);
      return { userId: p.userId, name: named.name, initials: named.name === null ? "" : named.initials, stoppedAt: p.stoppedAt.toISOString() };
    }),
  });
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
