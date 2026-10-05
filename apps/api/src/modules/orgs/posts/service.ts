// A GYM'S UPDATES (spec Part 3 §15.2, §15.3; ROADMAP 19b-i, 19b-ii-a, 19b-ii-c).
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
  GYM_MEMBER_PHOTO_POSTS_A_DAY,
  GYM_MEMBER_POSTS_A_DAY,
  GYM_POSTS_PAGE,
  GYM_POST_BLOCKS_SHOWN,
  GYM_POST_MAX_PINNED,
  GYM_POST_PHOTO_MAX_BYTES,
  GYM_POST_REACTIONS,
  GYM_POST_REACTORS_SHOWN,
  GYM_POST_REPORTS_SHOWN,
  GYM_POST_REPORT_NOTES_SHOWN,
  GYM_POST_REPORT_REASONS,
  GYM_POST_STOPS_SHOWN,
  GYM_POST_WORDS,
  blockedGymPostersResponseSchema,
  gymPostReactionResponseSchema,
  gymPostReactorsResponseSchema,
  gymPostSchema,
  gymPostsResponseSchema,
  personGymPostsResponseSchema,
  reportedGymPostsResponseSchema,
  staffGymPostSchema,
  staffGymPostsResponseSchema,
  staffPersonGymPostsResponseSchema,
  stoppedGymPostersResponseSchema,
  type AddGymPostRequest,
  type BlockedGymPostersResponse,
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
  type PersonGymPostsResponse,
  type ReportedGymPostsResponse,
  type StaffGymPost,
  type StaffGymPostsResponse,
  type StaffPersonGymPostsResponse,
  type StoppedGymPostersResponse,
} from "@app/shared";
import { getOrgById, gymHasLivePlan, insertAudit } from "../repo.js";
import { OrgsError, holdsPrivilege, requirePrivilege, requireWritablePrivilege } from "../service.js";
import { cleanPhoto } from "../gymPage/photoBytes.js";
import { postPhotoKey, type PhotoStore } from "../gymPage/photoStore.js";
import { PHOTO_PROBLEM_STATUS, type PhotoFile } from "../gymPage/service.js";
import { fullName, shownName } from "../leaderboard/rank.js";
import { lockGym } from "../memberList/repo.js";
import { badWordsIn } from "./badWords.js";
import { removeListed } from "./photoFiles.js";
import * as repo from "./repo.js";

export interface PostsDeps {
  sql: Sql;
  now: () => Date;
  photos: PhotoStore;
  /** Where members are told to write for help; null until Kd has set one (`SUPPORT_EMAIL`). */
  supportEmail: string | null;
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
    repo.reactionCounts(deps.sql, gymId, ids, viewerId),
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
      authorId: r.byMember ? r.authorId : null,
      own: r.byMember && r.authorId === viewerId,
      wrote: r.authorId === viewerId,
      reported: reported.has(r.id),
      hidden: r.hidden,
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
    repo.reactionCounts(deps.sql, gymId, ids, null),
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
      hidden: r.hidden,
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
  reader: repo.Reader,
  shape: (rows: readonly repo.PostRow[]) => Promise<P[]>,
): Promise<{ pinned: P[]; posts: P[]; next: string | null }> {
  const from = before ?? null;
  const [pinned, rows] = await Promise.all([
    from === null ? repo.pinnedPosts(deps.sql, gymId, reader) : Promise.resolve([]),
    repo.postsPage(deps.sql, gymId, reader, from, GYM_POSTS_PAGE + 1),
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
export async function getPosts(
  deps: Pick<PostsDeps, "sql" | "supportEmail">,
  userId: string,
  gymId: string,
  before: GymPostsCursor | undefined,
  limit: Limit,
): Promise<GymPostsResponse | null> {
  const org = await getOrgById(deps.sql, gymId);
  if (org === null || !(await repo.isLiveMember(deps.sql, gymId, userId))) throw notFound();
  if (!(await limit())) return null;
  const supportEmail = deps.supportEmail;
  if (!(await gymIsLive(deps.sql, gymId, org.status))) {
    return gymPostsResponseSchema.parse({ gymId, gymName: org.name, status: "paused", posting: "off", blockedCount: await repo.countBlocked(deps.sql, gymId, userId), supportEmail, pinned: [], posts: [], next: null });
  }
  const [feed, posting, blockedCount] = await Promise.all([
    page(deps, gymId, before, { member: userId }, (rows) => shaped(deps, gymId, rows, userId)),
    postingOf(deps.sql, gymId, userId),
    repo.countBlocked(deps.sql, gymId, userId),
  ]);
  return gymPostsResponseSchema.parse({ gymId, gymName: org.name, status: "shown", posting, blockedCount, supportEmail, ...feed });
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
    page(deps, gymId, before, "staff", (rows) => staffShaped(deps, gymId, rows, staffId)),
    repo.membersCanPost(deps.sql, gymId),
    repo.countReported(deps.sql, gymId),
  ]);
  return staffGymPostsResponseSchema.parse({ gymId, gymName: org.name, membersCanPost, reportedCount, ...feed });
}

// ── ONE PERSON'S POSTS, ON THEIR PROFILE (19b-ii-c) ──
// The worst thing it could do: send a reader what Updates would not, the posts of somebody
// they blocked or of somebody who has left. Both reads go through the feed's own `seenBy`.

async function personPage<P>(
  deps: Pick<PostsDeps, "sql">,
  gymId: string,
  reader: repo.Reader,
  userId: string,
  before: GymPostsCursor | undefined,
  shape: (rows: readonly repo.PostRow[]) => Promise<P[]>,
): Promise<{ posts: P[]; next: string | null; total: number }> {
  const [rows, total] = await Promise.all([
    repo.memberPostsPage(deps.sql, gymId, reader, userId, before ?? null, GYM_POSTS_PAGE + 1),
    repo.countMemberPosts(deps.sql, gymId, reader, userId),
  ]);
  const shown = rows.slice(0, GYM_POSTS_PAGE);
  const last = shown[shown.length - 1];
  return { posts: await shape(shown), next: rows.length > GYM_POSTS_PAGE && last !== undefined ? cursorOf(last) : null, total };
}

/** The posts one person made as a member, for a live app member of a gym on a live plan;
 *  404 for everybody else. An id that is nobody's here reads as a member with no posts. */
export async function getPersonPosts(
  deps: Pick<PostsDeps, "sql">,
  viewerId: string,
  gymId: string,
  userId: string,
  before: GymPostsCursor | undefined,
  limit: Limit,
): Promise<PersonGymPostsResponse | null> {
  await requireMember(deps, gymId, viewerId);
  if (!(await limit())) return null;
  const [feed, blocked] = await Promise.all([
    personPage(deps, gymId, { member: viewerId }, userId, before, (rows) => shaped(deps, gymId, rows, viewerId)),
    repo.hasBlocked(deps.sql, gymId, viewerId, userId),
  ]);
  return personGymPostsResponseSchema.parse({ ...feed, blocked });
}

/** The same for staff holding the tick, each post as the console's Updates page has it. */
export async function getStaffPersonPosts(
  deps: Pick<PostsDeps, "sql">,
  staffId: string,
  gymId: string,
  userId: string,
  before: GymPostsCursor | undefined,
  limit: Limit,
): Promise<StaffPersonGymPostsResponse | null> {
  await requirePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  return staffPersonGymPostsResponseSchema.parse(await personPage(deps, gymId, "staff", userId, before, (rows) => staffShaped(deps, gymId, rows, staffId)));
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
  if ((await repo.postById(deps.sql, gymId, postId, "staff")) === null) throw postNotFound();
  const [counts, people] = await Promise.all([
    repo.reactionCounts(deps.sql, gymId, [postId], null),
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

/** Removes the files of those of `keys` still listed to remove. One that will not go stays
 *  listed and is tried again by the nightly run; it is said here, never thrown at the person. */
async function removeFiles(deps: Pick<PostsDeps, "sql" | "photos" | "log">, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    const left = await removeListed(deps, keys, true);
    if (left > 0) deps.log.warn({ event: "gym_post.photo_left_behind", count: left }, "a removed photo's file could not be deleted; it will be tried again");
  } catch (err) {
    deps.log.warn({ event: "gym_post.photo_left_behind", err }, "a removed photo's file could not be deleted; it will be tried again");
  }
}

async function staffPost(deps: Pick<PostsDeps, "sql">, gymId: string, postId: string, staffId: string): Promise<StaffGymPost> {
  const row = await repo.postById(deps.sql, gymId, postId, "staff");
  if (row === null) throw postNotFound();
  const [post] = await staffShaped(deps, gymId, [row], staffId);
  if (post === undefined) throw postNotFound();
  return post;
}

async function memberPost(deps: Pick<PostsDeps, "sql">, gymId: string, postId: string, userId: string): Promise<GymPost> {
  const row = await repo.postById(deps.sql, gymId, postId, { member: userId });
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

/** Refuses a member who has made the day's posts already, or, for a post with photos, the
 *  day's posts with photos. */
async function refuseFullDay(sql: Sql | TransactionSql, gymId: string, userId: string, at: Date, post: { photos: boolean; words: boolean }): Promise<void> {
  const since = new Date(at.getTime() - DAY_MS);
  // Whole hours until the oldest counted post is a day old and one more may be made.
  const hoursLeft = (counted: repo.Counted): number =>
    counted.oldest === null ? 0 : Math.max(0, Math.round((counted.oldest.getTime() + DAY_MS - at.getTime()) / (60 * 60 * 1000)));
  const all = await repo.countMemberPostsSince(sql, gymId, userId, since);
  const full = all.n >= GYM_MEMBER_POSTS_A_DAY;
  if (full && !post.photos) throw new OrgsError(429, "posts_day_full", GYM_POST_WORDS.day_full(hoursLeft(all)));
  if (!post.photos) return;
  const photos = await repo.countMemberPhotoPostsSince(sql, gymId, userId, since);
  const photosFull = photos.n >= GYM_MEMBER_PHOTO_POSTS_A_DAY;
  // Both full: this post waits for the later of the two, so that is the hour it is told.
  if (full) throw new OrgsError(429, "posts_day_full", GYM_POST_WORDS.day_full(Math.max(hoursLeft(all), photosFull ? hoursLeft(photos) : 0)));
  if (photosFull) throw new OrgsError(429, "posts_photo_day_full", GYM_POST_WORDS.photo_day_full(hoursLeft(photos), post.words));
}

/** A member who may post: the gym's switch is on and staff have not stopped them. The
 *  route asks it before it reads a post's body. The day's ten are not asked here: a post
 *  sent again under its key must be answered with the post kept, and only the body says
 *  which post it is. The gym's name. */
export async function requireMemberPoster(deps: Pick<PostsDeps, "sql">, userId: string, gymId: string): Promise<string> {
  const gymName = await requireMember(deps, gymId, userId);
  refusePosting(await postingOf(deps.sql, gymId, userId), gymName);
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
    const read = cleanPhoto(new Uint8Array(Buffer.from(base64, "base64")), GYM_POST_PHOTO_MAX_BYTES);
    if (!read.ok) {
      const problem = PHOTO_PROBLEM_STATUS[read.problem];
      const why = read.problem === "too_big" ? GYM_POST_WORDS.photo_too_big : problem.message;
      throw new OrgsError(400, problem.code, GYM_POST_WORDS.photo(i + 1, why));
    }
    const id = randomUUID();
    photos.push({ id, storageKey: postPhotoKey(gymId, id, read.type), contentType: read.type, byteSize: read.bytes.length, width: read.width, height: read.height, bytes: read.bytes });
  }
  const keys = photos.map((p) => p.storageKey);
  const id = randomUUID();
  const at = deps.now();
  let made: boolean;
  // Listed to remove before a file is written, and taken off the list in the step that
  // keeps the post: whatever stops in between, a file with no post is found and removed,
  // and a kept post's file never is.
  await repo.queueFiles(deps.sql, keys);
  try {
    for (const photo of photos) await deps.photos.put(photo.storageKey, photo.bytes);
    made = await deps.sql.begin(async (tx) => {
      await guard(tx, at);
      // The same key sent twice at once: the second finds the first's row and keeps nothing.
      if (!(await repo.insertPost(tx, gymId, { id, postKey: body.postKey, body: body.body.trim(), byMember }, authorId, at))) return false;
      await repo.insertPhotos(tx, gymId, id, photos, at);
      await repo.unqueueFiles(tx, keys);
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
  const kept = await gymsByKey(deps, gymId, body.postKey);
  if (kept !== null) return await staffPost(deps, gymId, kept, staffId);
  const post = await keepPost(deps, gymId, staffId, body, false, () => Promise.resolve());
  if (post.made) return await staffPost(deps, gymId, post.id, staffId);
  const first = await gymsByKey(deps, gymId, body.postKey);
  if (first === null) throw postNotFound();
  return await staffPost(deps, gymId, first, staffId);
}

const keyTaken = (): OrgsError => new OrgsError(409, "post_key_taken", "Please try posting again.");

/** The post staff already made for the gym under this key, or null. A key a member used
 *  for a post of their own is not answered with that post. */
async function gymsByKey(deps: Pick<PostsDeps, "sql">, gymId: string, postKey: string): Promise<string | null> {
  const kept = await repo.postByKey(deps.sql, gymId, postKey);
  if (kept === null) return null;
  if (kept.byMember) throw keyTaken();
  return kept.id;
}

/** The post a member already made under this key, or null. A key somebody else used is
 *  not theirs to read back. */
async function ownByKey(deps: Pick<PostsDeps, "sql">, gymId: string, userId: string, postKey: string): Promise<GymPost | null> {
  const kept = await repo.postByKey(deps.sql, gymId, postKey);
  if (kept === null) return null;
  if (!kept.byMember || kept.authorId !== userId) throw keyTaken();
  return await memberPost(deps, gymId, kept.id, userId);
}

/** A new post by a member, where the gym lets its members post. Ten in any 24 hours, three
 *  of them with photos, counted with the person's membership held so two sent at once are
 *  counted in turn. */
export async function addMemberPost(deps: PostsDeps, userId: string, gymId: string, body: AddGymPostRequest): Promise<GymPost> {
  const gymName = await requireMemberPoster(deps, userId, gymId);
  // A post sent again under its key (a reply lost on the way back) is answered with the
  // post kept, the day's last one too.
  const kept = await ownByKey(deps, gymId, userId, body.postKey);
  if (kept !== null) return kept;
  // The app checks a member's words itself and says which it will not take: nothing is
  // kept, no photo is cleaned, and the day's ten are not touched. Staff's posts are not checked.
  const words = badWordsIn(body.body);
  if (words.length > 0) throw new OrgsError(400, "post_bad_words", GYM_POST_WORDS.bad_words(words));
  // A full day is refused before any photo is cleaned or written; the count that decides
  // is made again below, with the person's membership held.
  const shape = { photos: body.photos.length > 0, words: body.body.trim() !== "" };
  await refuseFullDay(deps.sql, gymId, userId, deps.now(), shape);
  const post = await keepPost(deps, gymId, userId, body, true, async (tx, at) => {
    if (!(await repo.lockMember(tx, gymId, userId, true))) throw notFound();
    refusePosting(await postingOf(tx, gymId, userId), gymName);
    // The same key sent twice at once, the first kept while this one waited for the
    // membership: it is answered below with that post, not counted against the day.
    if ((await repo.postByKey(tx, gymId, body.postKey)) !== null) return;
    await refuseFullDay(tx, gymId, userId, at, shape);
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
    await repo.unpinUnseen(tx, gymId);
    const post = await repo.postById(tx, gymId, postId, "staff");
    if (post === null) throw postNotFound();
    if (pinned === (post.pinnedAt !== null)) return;
    if (pinned && (await repo.countPinned(tx, gymId)) >= GYM_POST_MAX_PINNED) {
      throw new OrgsError(409, "pins_full", GYM_POST_WORDS.pins_full);
    }
    // A removal does not wait for the gym's lock: a post removed since it was read is not pinned.
    if (!(await repo.setPinned(tx, gymId, postId, pinned ? deps.now() : null))) throw postNotFound();
    await insertAudit(tx, { actorUserId: staffId, gymId, action: pinned ? "org.post_pinned" : "org.post_unpinned", targetType: "post", targetId: postId, meta: {} });
  });
  return await staffPost(deps, gymId, postId, staffId);
}

/** What goes with a removed post, in the removal's own step: its photos' rows, their files
 *  listed to remove, its reactions, and its open reports, answered. The photos' store keys. */
async function removeRest(tx: TransactionSql, gymId: string, postId: string, at: Date): Promise<string[]> {
  const files = await repo.deletePhotos(tx, gymId, postId);
  await repo.queueFiles(tx, files);
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
  limit: Limit,
): Promise<GymPostReactionResponse | null> {
  await requireMember(deps, gymId, userId);
  if (!(await limit())) return null;
  if ((await repo.postById(deps.sql, gymId, postId, { member: userId })) === null) throw postNotFound();
  if (reaction === null) {
    await repo.clearReaction(deps.sql, gymId, postId, userId);
  } else if (!(await repo.setReaction(deps.sql, gymId, postId, userId, reaction, deps.now()))) {
    throw postNotFound();
  }
  const counts = await repo.reactionCounts(deps.sql, gymId, [postId], userId);
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
  const post = await repo.postById(deps.sql, gymId, postId, { member: userId });
  if (post === null) {
    // Sent again after a lost reply: their own report helped hide the post from them.
    if (await repo.reportedHidden(deps.sql, gymId, postId, userId)) return true;
    throw postNotFound();
  }
  if (post.authorId === userId) throw new OrgsError(400, "own_post", GYM_POST_WORDS.own_report);
  const typed = note === undefined || note === "" ? null : note;
  const made = await deps.sql.begin(async (tx) => {
    const at = deps.now();
    if (!(await repo.insertReport(tx, gymId, postId, userId, reason, typed, at))) return false;
    await repo.hideIfReported(tx, gymId, postId, at);
    return true;
  });
  if (!made) throw postNotFound();
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
      return [{ post, reports: row.reports, allReports: row.allReports, reportsMark: row.reportsMark, reasons: counts, notes: typed, firstReportedAt: row.firstAt.toISOString(), lastReportedAt: row.lastAt.toISOString() }];
    }),
  });
}

/** Staff keep a reported post: its reports are answered, but only while they are exactly
 *  the ones staff were shown (`reportsMark`; `allReports` is how many those were). One
 *  that arrived since was never read, so none is answered and the post stays on the list;
 *  how many such are waiting. */
export async function keepReported(
  deps: Pick<PostsDeps, "sql" | "now">,
  staffId: string,
  gymId: string,
  postId: string,
  shown: { allReports: number; reportsMark: string },
  limit: Limit,
): Promise<{ kept: boolean; waiting: number } | null> {
  const { allReports } = shown;
  await requireWritablePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  return await deps.sql.begin(async (tx) => {
    if ((await repo.postById(tx, gymId, postId, "staff")) === null) throw postNotFound();
    const closed = await repo.closeReports(tx, gymId, postId, "kept", deps.now(), shown.reportsMark);
    const now = await repo.countReports(tx, gymId, postId);
    if (closed > 0) {
      await repo.showAgain(tx, gymId, postId);
      await insertAudit(tx, { actorUserId: staffId, gymId, action: "org.post_kept", targetType: "post", targetId: postId, meta: { reports: String(closed) } });
      // One that landed after the reports were answered.
      return { kept: true, waiting: now.open };
    }
    // Answered by somebody else already.
    if (now.open === 0) return { kept: true, waiting: 0 };
    // No more than staff were shown, and not the same ones (a reporter's account has
    // gone, with or without a new report): the list is read again.
    if (now.all <= allReports) throw new OrgsError(409, "reports_changed", GYM_POST_WORDS.reports_changed);
    return { kept: false, waiting: Math.min(now.open, now.all - allReports) };
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

/** A live app member of the gym, whatever its plan; 404 for everybody else. */
async function requireOwnMembership(deps: Pick<PostsDeps, "sql">, gymId: string, userId: string): Promise<void> {
  const org = await getOrgById(deps.sql, gymId);
  if (org === null || !(await repo.isLiveMember(deps.sql, gymId, userId))) throw notFound();
}

/** A member blocks whoever wrote this post: from now on they are sent none of that
 *  person's posts, photos or reactions at this gym. Nobody is told, and nothing is written
 *  about it but the block itself. A post by the gym's staff cannot be blocked. */
export async function block(deps: Pick<PostsDeps, "sql" | "now">, userId: string, gymId: string, postId: string, limit: Limit): Promise<true | null> {
  await requireMember(deps, gymId, userId);
  if (!(await limit())) return null;
  const post = await repo.postById(deps.sql, gymId, postId, { member: userId });
  if (post === null) {
    // Sent again after a lost reply: the post is hidden only by this person's own block of
    // its writer, and the answer is the first one's.
    if (await repo.hiddenByOwnBlock(deps.sql, gymId, postId, userId)) return true;
    throw postNotFound();
  }
  if (post.authorId === userId) throw new OrgsError(400, "own_post", GYM_POST_WORDS.own_block);
  const blockedId = post.authorId;
  if (!post.byMember || blockedId === null) throw new OrgsError(400, "gym_post", GYM_POST_WORDS.gym_block);
  await deps.sql.begin(async (tx) => {
    await repo.insertBlock(tx, gymId, userId, blockedId, deps.now());
    // A reaction the blocker gave that person's posts could never be taken off again, and
    // would go on being counted and named for staff: it goes with the block.
    await repo.deleteReactionsToMember(tx, gymId, userId, blockedId);
  });
  return true;
}

/** The people a member has blocked at this gym, named as members see each other. */
export async function getBlocked(deps: Pick<PostsDeps, "sql">, userId: string, gymId: string, limit: Limit): Promise<BlockedGymPostersResponse | null> {
  await requireOwnMembership(deps, gymId, userId);
  if (!(await limit())) return null;
  const people = await repo.blockedPeople(deps.sql, gymId, userId, GYM_POST_BLOCKS_SHOWN);
  return blockedGymPostersResponseSchema.parse({
    people: people.map((p) => {
      const named = shownName(p);
      return { id: p.id, name: named?.name ?? null, initials: named?.name == null ? "" : named.initials, blockedAt: p.blockedAt.toISOString() };
    }),
  });
}

/** A member takes one of their own blocks off. Somebody else's is "not found" to them. */
export async function unblock(deps: Pick<PostsDeps, "sql">, userId: string, gymId: string, blockId: string, limit: Limit): Promise<true | null> {
  await requireOwnMembership(deps, gymId, userId);
  if (!(await limit())) return null;
  if (!(await repo.deleteBlock(deps.sql, gymId, userId, blockId))) throw new OrgsError(404, "block_not_found", GYM_POST_WORDS.block_not_found);
  return true;
}

/** A post's photo, for a member who may read the post or staff holding the tick. With
 *  `wantBytes` false (the reader's browser already holds it) the same checks run and
 *  "same" is the answer: it is still theirs to show. Null when the limit has answered. */
export async function getPhoto(
  deps: Pick<PostsDeps, "sql" | "photos">,
  userId: string,
  gymId: string,
  postId: string,
  photoId: string,
  wantBytes: boolean,
  limit: Limit,
): Promise<PhotoFile | "same" | null> {
  const org = await getOrgById(deps.sql, gymId);
  if (org === null) throw notFound();
  const member = (await repo.isLiveMember(deps.sql, gymId, userId)) && (await gymIsLive(deps.sql, gymId, org.status));
  let staff = member ? null : await holdsPrivilege(deps, gymId, userId, TICK);
  if (!member && staff !== true) throw notFound();
  if (!(await limit())) return null;
  // A member is sent what a member sees: nothing of anybody they blocked. Staff holding
  // the tick are asked second.
  let photo = member ? await repo.photoOf(deps.sql, gymId, postId, photoId, { member: userId }) : null;
  if (photo === null) {
    staff ??= await holdsPrivilege(deps, gymId, userId, TICK);
    if (staff) photo = await repo.photoOf(deps.sql, gymId, postId, photoId, "staff");
  }
  if (photo === null) throw new OrgsError(404, "photo_not_found", GYM_POST_WORDS.photo_not_found);
  if (!wantBytes) return "same";
  const bytes = await deps.photos.get(photo.storageKey);
  if (bytes === null) throw new OrgsError(404, "photo_not_found", GYM_POST_WORDS.photo_not_found);
  return { contentType: photo.contentType, bytes };
}
