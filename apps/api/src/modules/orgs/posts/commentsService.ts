// COMMENTS ON A GYM'S UPDATES (ROADMAP Stage 5 17e; spec Part 3 §15.2).
//
// The worst thing this could do to a real person: put on their screen a comment by somebody they
// blocked, or one hidden after reports, or show a gym's comments to somebody outside it. So one rule
// (`commentsRepo.seenBy`) decides every read and every press, a reply also needing the comment it
// sits under to be seen, and a post the reader may not read has no comments for them.
import { randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import {
  GYM_MEMBER_COMMENTS_A_DAY,
  GYM_POST_COMMENTS_PAGE,
  DISGUISED_WORDS,
  GYM_POST_COMMENT_WORDS,
  GYM_POST_REACTIONS,
  GYM_POST_WORDS,
  gymPostCommentSchema,
  gymPostCommentsResponseSchema,
  reactToGymPostCommentResponseSchema,
  type AddGymPostCommentRequest,
  type GymMemberPosting,
  type GymPostComment,
  type GymPostCommentReportReason,
  type GymPostCommentsCursor,
  type GymPostCommentsResponse,
  type GymPostReaction,
  type GymPostReactionCounts,
} from "@app/shared";
import { getOrgById, gymHasLivePlan, insertAudit } from "../repo.js";
import { OrgsError } from "../service.js";
import { shownName } from "../leaderboard/rank.js";
import { badWordsIn, hasDisguisedWords } from "./badWords.js";
import * as repo from "./commentsRepo.js";
import * as postsRepo from "./repo.js";

export interface CommentsDeps {
  sql: Sql;
  now: () => Date;
}

/** The route's rate limit, asked after who is asking: false when it has already answered 429. */
export type Limit = () => Promise<boolean>;

const DAY_MS = 24 * 60 * 60 * 1000;

const notFound = (): OrgsError => new OrgsError(404, "org_not_found", "Organisation not found.");
const postNotFound = (): OrgsError => new OrgsError(404, "post_not_found", GYM_POST_WORDS.not_found);
const commentNotFound = (): OrgsError => new OrgsError(404, "comment_not_found", GYM_POST_COMMENT_WORDS.not_found);

/** A live app member of a gym on a live plan; 404 for everybody else. The gym's name. */
async function requireMember(deps: CommentsDeps, gymId: string, userId: string): Promise<string> {
  const org = await getOrgById(deps.sql, gymId);
  if (org === null || !(await postsRepo.isLiveMember(deps.sql, gymId, userId))) throw notFound();
  if (org.status !== "active" || !(await gymHasLivePlan(deps.sql, gymId))) throw notFound();
  return org.name;
}

/** A live member here, asked before the limit so a stranger's 404 is never a 429. A comment sent again
 *  under its key is answered with the one kept, so the switch and the stop are asked by `addComment`. */
export async function requireCommenter(deps: CommentsDeps, userId: string, gymId: string): Promise<void> {
  await requireMember(deps, gymId, userId);
}

function refuseCommenting(commenting: GymMemberPosting, gymName: string): void {
  if (commenting === "off") throw new OrgsError(403, "commenting_off", GYM_POST_COMMENT_WORDS.commenting_off);
  if (commenting === "stopped") throw new OrgsError(403, "commenting_stopped", GYM_POST_COMMENT_WORDS.commenting_stopped(gymName));
}

const noReactions = (): GymPostReactionCounts => ({ like: 0, strong: 0, fire: 0, love: 0 });

function countsOf(rows: readonly { commentId: string; reaction: string; count: number }[], commentId: string): GymPostReactionCounts {
  const counts = noReactions();
  for (const row of rows) {
    if (row.commentId !== commentId) continue;
    const reaction = GYM_POST_REACTIONS.find((r) => r === row.reaction);
    if (reaction !== undefined) counts[reaction] = row.count;
  }
  return counts;
}

/** Comments as a member reads them: named as on a post, the reader's own reaction beside the counts.
 *  A reply to a reply names who it answers only while the reader is sent that reply. */
async function shaped(deps: CommentsDeps, gymId: string, rows: readonly repo.CommentRow[], viewerId: string): Promise<GymPostComment[]> {
  const ids = rows.map((r) => r.id);
  const answered = [...new Set(rows.flatMap((r) => (r.replyToId === null ? [] : [r.replyToId])))];
  const [counts, mine, reported, replies, targets] = await Promise.all([
    repo.reactionCounts(deps.sql, gymId, ids, viewerId),
    repo.reactionsOf(deps.sql, gymId, ids, viewerId),
    repo.reportedBy(deps.sql, gymId, ids, viewerId),
    repo.replyCounts(deps.sql, gymId, rows.flatMap((r) => (r.parentId === null ? [r.id] : [])), { member: viewerId }),
    repo.commentsByIds(deps.sql, gymId, answered, { member: viewerId }),
  ]);
  const nameOf = (r: Pick<repo.CommentRow, "authorName" | "authorEmail" | "authorRecordName">) =>
    shownName({ displayName: r.authorName ?? "", email: r.authorEmail, recordName: r.authorRecordName });
  const targetNames = new Map(targets.map((t) => [t.id, nameOf(t)?.name ?? (t.byMember ? "A member" : "Staff")] as const));
  return rows.map((r) => {
    const named = nameOf(r);
    return gymPostCommentSchema.parse({
      id: r.id,
      postId: r.postId,
      parentId: r.parentId,
      replyingTo: r.replyToId === null ? null : (targetNames.get(r.replyToId) ?? null),
      author: { name: named?.name ?? null, initials: named?.name == null ? "" : named.initials },
      body: r.body,
      createdAt: r.createdAt.toISOString(),
      reactions: countsOf(counts, r.id),
      mine: GYM_POST_REACTIONS.find((reaction) => reaction === mine.get(r.id)) ?? null,
      fromMember: r.byMember,
      authorId: r.byMember ? r.authorId : null,
      own: r.byMember && r.authorId === viewerId,
      wrote: r.authorId === viewerId,
      reported: reported.has(r.id),
      hidden: r.hidden,
      replyCount: replies.get(r.id) ?? 0,
    });
  });
}

const cursorOf = (row: repo.CommentRow): string => `${row.createdAt.toISOString()}_${row.id}`;

async function pageOf(deps: CommentsDeps, gymId: string, userId: string, rows: readonly repo.CommentRow[]): Promise<GymPostCommentsResponse> {
  const listed = rows.slice(0, GYM_POST_COMMENTS_PAGE);
  const last = listed[listed.length - 1];
  const [comments, commenting] = await Promise.all([shaped(deps, gymId, listed, userId), repo.commentingOf(deps.sql, gymId, userId)]);
  return gymPostCommentsResponseSchema.parse({ comments, commenting, next: rows.length > GYM_POST_COMMENTS_PAGE && last !== undefined ? cursorOf(last) : null });
}

/** A post's comments, for a member who may read the post; anybody else is told it is not there. */
export async function getComments(deps: CommentsDeps, userId: string, gymId: string, postId: string, after: GymPostCommentsCursor | undefined, limit: Limit): Promise<GymPostCommentsResponse | null> {
  await requireMember(deps, gymId, userId);
  if (!(await limit())) return null;
  if ((await postsRepo.postById(deps.sql, gymId, postId, { member: userId })) === null) throw postNotFound();
  const rows = await repo.commentsPage(deps.sql, gymId, postId, { member: userId }, after ?? null, GYM_POST_COMMENTS_PAGE + 1);
  return await pageOf(deps, gymId, userId, rows);
}

/** The comment or reply, with the post it is on still readable by this member; 404 otherwise. */
async function seenComment(deps: CommentsDeps, gymId: string, commentId: string, userId: string): Promise<repo.CommentRow | null> {
  const row = await repo.commentById(deps.sql, gymId, commentId, { member: userId });
  if (row === null) return null;
  return (await postsRepo.postById(deps.sql, gymId, row.postId, { member: userId })) === null ? null : row;
}

/** A comment's replies. */
export async function getReplies(deps: CommentsDeps, userId: string, gymId: string, commentId: string, after: GymPostCommentsCursor | undefined, limit: Limit): Promise<GymPostCommentsResponse | null> {
  await requireMember(deps, gymId, userId);
  if (!(await limit())) return null;
  if ((await seenComment(deps, gymId, commentId, userId)) === null) throw commentNotFound();
  const rows = await repo.repliesPage(deps.sql, gymId, commentId, { member: userId }, after ?? null, GYM_POST_COMMENTS_PAGE + 1);
  return await pageOf(deps, gymId, userId, rows);
}

const hoursUntilDayOld = (from: Date, at: Date): number => Math.max(0, Math.round((from.getTime() + DAY_MS - at.getTime()) / (60 * 60 * 1000)));

async function refuseFullDay(sql: Sql | TransactionSql, gymId: string, userId: string, at: Date): Promise<void> {
  const made = await repo.countMemberCommentsSince(sql, gymId, userId, new Date(at.getTime() - DAY_MS));
  if (made.n >= GYM_MEMBER_COMMENTS_A_DAY) throw new OrgsError(429, "comments_day_full", GYM_POST_COMMENT_WORDS.day_full(made.oldest === null ? 0 : hoursUntilDayOld(made.oldest, at)));
}

const keyTaken = (): OrgsError => new OrgsError(409, "comment_key_taken", "Please try sending your comment again.");

/** The comment this member already made under this key on this post, or null. Somebody else's key, or
 *  one spent on another post, is not theirs to read back, and one removed since says so. */
async function ownByKey(deps: CommentsDeps, gymId: string, userId: string, postId: string, commentKey: string): Promise<GymPostComment | null> {
  const kept = await repo.commentByKey(deps.sql, gymId, commentKey);
  if (kept === null) return null;
  if (!kept.byMember || kept.authorId !== userId || kept.postId !== postId) throw keyTaken();
  const row = kept.removed ? null : await repo.ownComment(deps.sql, gymId, kept.id, userId);
  if (row === null) throw commentNotFound();
  const [comment] = await shaped(deps, gymId, [row], userId);
  if (comment === undefined) throw commentNotFound();
  return comment;
}

/** Where a new comment goes: on the post, or under the comment it answers. A reply to a reply goes
 *  under the same comment and remembers which it answers. */
async function placeOf(deps: CommentsDeps, gymId: string, postId: string, userId: string, replyTo: string | undefined): Promise<{ parentId: string | null; replyToId: string | null }> {
  if ((await postsRepo.postById(deps.sql, gymId, postId, { member: userId })) === null) throw postNotFound();
  if (replyTo === undefined) return { parentId: null, replyToId: null };
  const target = await repo.commentById(deps.sql, gymId, replyTo, { member: userId });
  if (target === null || target.postId !== postId) throw commentNotFound();
  return target.parentId === null ? { parentId: target.id, replyToId: null } : { parentId: target.parentId, replyToId: target.id };
}

/** A new comment or reply by a member. Sent twice under one key it is one comment; 100 in any 24
 *  hours, counted with the person's membership held so two sent at once are counted in turn. */
export async function addComment(deps: CommentsDeps, userId: string, gymId: string, postId: string, body: AddGymPostCommentRequest): Promise<{ comment: GymPostComment; firstKept: boolean }> {
  const gymName = await requireMember(deps, gymId, userId);
  const kept = await ownByKey(deps, gymId, userId, postId, body.commentKey);
  if (kept !== null) return { comment: kept, firstKept: false };
  refuseCommenting(await repo.commentingOf(deps.sql, gymId, userId), gymName);
  if (hasDisguisedWords(body.body)) throw new OrgsError(400, "comment_disguised", DISGUISED_WORDS);
  const words = badWordsIn(body.body);
  if (words.length > 0) throw new OrgsError(400, "comment_bad_words", GYM_POST_COMMENT_WORDS.bad_words(words));
  const at = deps.now();
  await refuseFullDay(deps.sql, gymId, userId, at);
  const place = await placeOf(deps, gymId, postId, userId, body.replyTo);
  const id = randomUUID();
  const made = await deps.sql.begin(async (tx) => {
    if (!(await postsRepo.lockMember(tx, gymId, userId, true))) throw notFound();
    refuseCommenting(await repo.commentingOf(tx, gymId, userId), gymName);
    if ((await repo.commentByKey(tx, gymId, body.commentKey)) !== null) return "taken";
    await refuseFullDay(tx, gymId, userId, at);
    return await repo.insertComment(tx, gymId, { id, postId, ...place, commentKey: body.commentKey, body: body.body.trim(), byMember: true }, userId, at);
  });
  if (made === "gone") throw place.parentId === null ? postNotFound() : commentNotFound();
  if (made === "taken") {
    const first = await ownByKey(deps, gymId, userId, postId, body.commentKey);
    if (first === null) throw commentNotFound();
    return { comment: first, firstKept: false };
  }
  const row = await repo.ownComment(deps.sql, gymId, id, userId);
  if (row === null) throw commentNotFound();
  const [comment] = await shaped(deps, gymId, [row], userId);
  if (comment === undefined) throw commentNotFound();
  return { comment, firstKept: true };
}

/** A member removes their own comment or reply; a comment's replies go with it. */
export async function removeOwnComment(deps: CommentsDeps, userId: string, gymId: string, commentId: string, limit: Limit): Promise<true | null> {
  await requireMember(deps, gymId, userId);
  if (!(await limit())) return null;
  await deps.sql.begin(async (tx) => {
    if (!(await repo.removeOwn(tx, gymId, commentId, userId, deps.now()))) throw commentNotFound();
    await insertAudit(tx, { actorUserId: userId, gymId, action: "org.member_comment_removed", targetType: "post_comment", targetId: commentId, meta: {} });
  });
  return true;
}

/** The member's one reaction: set, changed, or taken off with null. */
export async function reactToComment(deps: CommentsDeps, userId: string, gymId: string, commentId: string, reaction: GymPostReaction | null, limit: Limit): Promise<{ reactions: GymPostReactionCounts; mine: GymPostReaction | null } | null> {
  await requireMember(deps, gymId, userId);
  if (!(await limit())) return null;
  if ((await seenComment(deps, gymId, commentId, userId)) === null) throw commentNotFound();
  if (reaction === null) {
    await repo.clearReaction(deps.sql, gymId, commentId, userId);
  } else if (!(await repo.setReaction(deps.sql, gymId, commentId, userId, reaction, deps.now()))) throw commentNotFound();
  // Both from one moment: with several changes at once, what was asked may not be what the server holds.
  const [counts, mine] = await deps.sql.begin("isolation level repeatable read read only", async (tx) => [await repo.reactionCounts(tx, gymId, [commentId], userId), await repo.reactionsOf(tx, gymId, [commentId], userId)] as const);
  return reactToGymPostCommentResponseSchema.parse({ reactions: countsOf(counts, commentId), mine: mine.get(commentId) ?? null });
}

/** A member reports a comment, once. Nothing is written about who reported except the report itself. */
export async function reportComment(deps: CommentsDeps, userId: string, gymId: string, commentId: string, reason: GymPostCommentReportReason, note: string | undefined, limit: Limit): Promise<true | null> {
  await requireMember(deps, gymId, userId);
  if (!(await limit())) return null;
  const comment = await seenComment(deps, gymId, commentId, userId);
  if (comment === null) {
    if (await repo.reportedHidden(deps.sql, gymId, commentId, userId)) return true;
    throw commentNotFound();
  }
  if (comment.authorId === userId) throw new OrgsError(400, "own_comment", GYM_POST_COMMENT_WORDS.own_report);
  const typed = note === undefined || note === "" ? null : note;
  const made = await deps.sql.begin(async (tx) => await repo.insertReport(tx, gymId, commentId, userId, reason, typed, deps.now()));
  if (!made) throw commentNotFound();
  return true;
}

/** A member blocks whoever wrote this comment: from then on they are sent nothing of that person's
 *  as a member here, posts and comments alike. A comment by staff cannot be blocked. */
export async function blockCommenter(deps: CommentsDeps, userId: string, gymId: string, commentId: string, limit: Limit): Promise<true | null> {
  await requireMember(deps, gymId, userId);
  if (!(await limit())) return null;
  const comment = await seenComment(deps, gymId, commentId, userId);
  if (comment === null) {
    if (await repo.hiddenByOwnBlock(deps.sql, gymId, commentId, userId)) return true;
    throw commentNotFound();
  }
  if (comment.authorId === userId) throw new OrgsError(400, "own_comment", GYM_POST_COMMENT_WORDS.own_block);
  const blockedId = comment.authorId;
  if (!comment.byMember || blockedId === null) throw new OrgsError(400, "gym_comment", GYM_POST_COMMENT_WORDS.gym_block);
  await deps.sql.begin(async (tx) => {
    await postsRepo.insertBlock(tx, gymId, userId, blockedId, deps.now());
    await postsRepo.deleteReactionsToMember(tx, gymId, userId, blockedId);
    await repo.deleteReactionsToMember(tx, gymId, userId, blockedId);
  });
  return true;
}
