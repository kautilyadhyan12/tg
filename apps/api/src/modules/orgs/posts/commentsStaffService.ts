// COMMENTS ON A GYM'S UPDATES, FOR STAFF HOLDING `posts.manage` (ROADMAP Stage 5 17e-ii; spec Part 3 §15.2).
//
// The worst thing this could do to a real person: tell staff who reported a comment, or show one gym's
// comments to another gym's staff. So no read here touches a reporter's id, and every read and press
// names the gym and asks for the tick first.
import { randomUUID } from "node:crypto";
import {
  GYM_POST_COMMENT_REPORT_REASONS,
  GYM_POST_COMMENT_WORDS,
  GYM_POST_COMMENTS_PAGE,
  GYM_POST_REACTIONS,
  GYM_POST_REACTORS_SHOWN,
  GYM_POST_REPORTS_SHOWN,
  GYM_POST_REPORT_NOTES_SHOWN,
  GYM_POST_WORDS,
  addedStaffGymPostCommentResponseSchema,
  gymPostReactorsResponseSchema,
  reportedGymPostCommentsResponseSchema,
  staffGymPostCommentSchema,
  staffGymPostCommentsResponseSchema,
  type AddGymPostCommentRequest,
  type GymPostCommentReasonCounts,
  type GymPostCommentsCursor,
  type GymPostReaction,
  type GymPostReactionCounts,
  type GymPostReactorsResponse,
  type ReportedGymPostCommentsResponse,
  type StaffGymPostComment,
  type StaffGymPostCommentsResponse,
} from "@app/shared";
import { insertAudit } from "../repo.js";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import { fullName } from "../leaderboard/rank.js";
import * as repo from "./commentsRepo.js";
import type { CommentsDeps, Limit } from "./commentsService.js";
import * as postsRepo from "./repo.js";

const TICK = "posts.manage";

const postNotFound = (): OrgsError => new OrgsError(404, "post_not_found", GYM_POST_WORDS.not_found);
const commentNotFound = (): OrgsError => new OrgsError(404, "comment_not_found", GYM_POST_COMMENT_WORDS.not_found);

const nameOf = (r: { authorName: string | null; authorEmail: string | null; authorRecordName: string | null }) =>
  fullName({ displayName: r.authorName ?? "", email: r.authorEmail, recordName: r.authorRecordName });

function countsOf(rows: readonly { commentId: string; reaction: string; count: number }[], commentId: string): GymPostReactionCounts {
  const counts: GymPostReactionCounts = { like: 0, strong: 0, fire: 0, love: 0 };
  for (const row of rows) {
    if (row.commentId !== commentId) continue;
    const reaction = GYM_POST_REACTIONS.find((r) => r === row.reaction);
    if (reaction !== undefined) counts[reaction] = row.count;
  }
  return counts;
}

/** Comments as staff read them: whole names and every reaction counted. */
async function shaped(deps: CommentsDeps, gymId: string, rows: readonly repo.CommentRow[]): Promise<StaffGymPostComment[]> {
  const ids = rows.map((r) => r.id);
  const answered = [...new Set(rows.flatMap((r) => (r.replyToId === null ? [] : [r.replyToId])))];
  const members = rows.flatMap((r) => (r.byMember && r.authorId !== null ? [r.authorId] : []));
  const [counts, replies, targets, stopped] = await Promise.all([
    repo.reactionCounts(deps.sql, gymId, ids, null),
    repo.replyCounts(deps.sql, gymId, rows.flatMap((r) => (r.parentId === null ? [r.id] : [])), "staff"),
    repo.commentsByIds(deps.sql, gymId, answered, "staff"),
    postsRepo.stoppedAmong(deps.sql, gymId, members),
  ]);
  const targetNames = new Map(targets.map((t) => [t.id, nameOf(t).name ?? (t.byMember ? "A member" : "Staff")] as const));
  return rows.map((r) => {
    const named = nameOf(r);
    const authorId = r.byMember ? r.authorId : null;
    return staffGymPostCommentSchema.parse({
      id: r.id,
      postId: r.postId,
      parentId: r.parentId,
      replyingTo: r.replyToId === null ? null : (targetNames.get(r.replyToId) ?? null),
      author: { name: named.name, initials: named.name === null ? "" : named.initials },
      body: r.body,
      createdAt: r.createdAt.toISOString(),
      reactions: countsOf(counts, r.id),
      fromMember: r.byMember,
      authorId,
      authorStopped: authorId !== null && stopped.has(authorId),
      hidden: r.hidden,
      replyCount: replies.get(r.id) ?? 0,
    });
  });
}

const cursorOf = (row: repo.CommentRow): string => `${row.createdAt.toISOString()}_${row.id}`;

async function pageOf(deps: CommentsDeps, gymId: string, rows: readonly repo.CommentRow[]): Promise<StaffGymPostCommentsResponse> {
  const listed = rows.slice(0, GYM_POST_COMMENTS_PAGE);
  const last = listed[listed.length - 1];
  return staffGymPostCommentsResponseSchema.parse({ comments: await shaped(deps, gymId, listed), next: rows.length > GYM_POST_COMMENTS_PAGE && last !== undefined ? cursorOf(last) : null });
}

/** The comment or reply, on a post staff can still read; null otherwise. */
async function seenComment(deps: CommentsDeps, gymId: string, commentId: string): Promise<repo.CommentRow | null> {
  const row = await repo.commentById(deps.sql, gymId, commentId, "staff");
  if (row === null) return null;
  return (await postsRepo.postById(deps.sql, gymId, row.postId, "staff")) === null ? null : row;
}

/** A post's comments, hidden ones too. */
export async function getComments(deps: CommentsDeps, staffId: string, gymId: string, postId: string, after: GymPostCommentsCursor | undefined, limit: Limit): Promise<StaffGymPostCommentsResponse | null> {
  await requirePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  if ((await postsRepo.postById(deps.sql, gymId, postId, "staff")) === null) throw postNotFound();
  return await pageOf(deps, gymId, await repo.commentsPage(deps.sql, gymId, postId, "staff", after ?? null, GYM_POST_COMMENTS_PAGE + 1));
}

/** A comment's replies. */
export async function getReplies(deps: CommentsDeps, staffId: string, gymId: string, commentId: string, after: GymPostCommentsCursor | undefined, limit: Limit): Promise<StaffGymPostCommentsResponse | null> {
  await requirePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  if ((await seenComment(deps, gymId, commentId)) === null) throw commentNotFound();
  return await pageOf(deps, gymId, await repo.repliesPage(deps.sql, gymId, commentId, "staff", after ?? null, GYM_POST_COMMENTS_PAGE + 1));
}

/** A comment by staff, for the gym: no daily limit and the gym's switch does not bind it, as for a post.
 *  Sent twice under one key it is one comment. */
export async function addComment(deps: CommentsDeps, staffId: string, gymId: string, postId: string, body: AddGymPostCommentRequest, limit: Limit): Promise<{ comment: StaffGymPostComment; firstKept: boolean } | null> {
  await requireWritablePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  const answer = async (id: string, firstKept: boolean) => {
    const row = await repo.commentById(deps.sql, gymId, id, "staff");
    if (row === null) throw commentNotFound();
    const [comment] = await shaped(deps, gymId, [row]);
    if (comment === undefined) throw commentNotFound();
    return addedStaffGymPostCommentResponseSchema.parse({ comment, firstKept });
  };
  const keptAnswer = async () => {
    const kept = await repo.commentByKey(deps.sql, gymId, body.commentKey);
    if (kept === null) return null;
    if (kept.byMember || kept.authorId !== staffId || kept.postId !== postId) throw new OrgsError(409, "comment_key_taken", "Please try sending your comment again.");
    if (kept.removed) throw commentNotFound();
    return await answer(kept.id, false);
  };
  const first = await keptAnswer();
  if (first !== null) return first;
  if ((await postsRepo.postById(deps.sql, gymId, postId, "staff")) === null) throw postNotFound();
  let place: { parentId: string | null; replyToId: string | null } = { parentId: null, replyToId: null };
  if (body.replyTo !== undefined) {
    const target = await repo.commentById(deps.sql, gymId, body.replyTo, "staff");
    if (target === null || target.postId !== postId) throw commentNotFound();
    // Under a hidden comment a reply reaches no member, and Keep is staff's answer there.
    const under = target.parentId === null ? null : await repo.commentById(deps.sql, gymId, target.parentId, "staff");
    if (target.hidden || under?.hidden === true) throw new OrgsError(409, "comment_hidden", GYM_POST_COMMENT_WORDS.hidden_reply);
    place = target.parentId === null ? { parentId: target.id, replyToId: null } : { parentId: target.parentId, replyToId: target.id };
  }
  const id = randomUUID();
  const made = await deps.sql.begin(async (tx) => {
    const done = await repo.insertComment(tx, gymId, { id, postId, ...place, commentKey: body.commentKey, body: body.body.trim(), byMember: false }, staffId, deps.now());
    if (done === "made") await insertAudit(tx, { actorUserId: staffId, gymId, action: "org.comment_added", targetType: "post_comment", targetId: id, meta: {} });
    return done;
  });
  if (made === "gone") throw place.parentId === null ? postNotFound() : commentNotFound();
  if (made === "taken") {
    const second = await keptAnswer();
    if (second === null) throw commentNotFound();
    return second;
  }
  return await answer(id, true);
}

/** Staff remove anybody's comment or reply: gone for everyone, a comment's replies with it, reports answered. */
export async function removeComment(deps: CommentsDeps, staffId: string, gymId: string, commentId: string, limit: Limit): Promise<true | null> {
  await requireWritablePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  if ((await seenComment(deps, gymId, commentId)) === null) throw commentNotFound();
  await deps.sql.begin(async (tx) => {
    if (!(await repo.removeByStaff(tx, gymId, commentId, staffId, deps.now()))) throw commentNotFound();
    await insertAudit(tx, { actorUserId: staffId, gymId, action: "org.comment_removed", targetType: "post_comment", targetId: commentId, meta: {} });
  });
  return true;
}

/** Who gave one reaction to a comment, by whole name; members are never told. */
export async function getReactors(deps: CommentsDeps, staffId: string, gymId: string, commentId: string, reaction: GymPostReaction, limit: Limit): Promise<GymPostReactorsResponse | null> {
  await requirePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  if ((await seenComment(deps, gymId, commentId)) === null) throw commentNotFound();
  const [people, counts] = await Promise.all([repo.reactorsOf(deps.sql, gymId, commentId, reaction, GYM_POST_REACTORS_SHOWN), repo.reactionCounts(deps.sql, gymId, [commentId], null)]);
  return gymPostReactorsResponseSchema.parse({
    reaction,
    total: countsOf(counts, commentId)[reaction],
    people: people.map((p) => {
      const named = fullName(p);
      return { name: named.name, initials: named.name === null ? "" : named.initials };
    }),
  });
}

/** The reported comments nobody has answered. How many and why, never who. */
export async function getReported(deps: CommentsDeps, staffId: string, gymId: string, limit: Limit): Promise<ReportedGymPostCommentsResponse | null> {
  await requirePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  const rows = await repo.reportedComments(deps.sql, gymId, GYM_POST_REPORTS_SHOWN);
  const ids = rows.map((r) => r.comment.id);
  const [comments, reasons, notes] = await Promise.all([
    shaped(deps, gymId, rows.map((r) => r.comment)),
    repo.openReportReasons(deps.sql, gymId, ids),
    repo.openReportNotes(deps.sql, gymId, ids, GYM_POST_REPORT_NOTES_SHOWN),
  ]);
  return reportedGymPostCommentsResponseSchema.parse({
    total: rows[0]?.total ?? 0,
    items: rows.flatMap((row, i) => {
      const comment = comments[i];
      if (comment === undefined) return [];
      const counts: GymPostCommentReasonCounts = { unkind: 0, nudity: 0, spam: 0, other: 0 };
      for (const r of reasons) {
        const reason = GYM_POST_COMMENT_REPORT_REASONS.find((known) => known === r.reason);
        if (r.commentId === row.comment.id && reason !== undefined) counts[reason] = r.count;
      }
      const postName = nameOf(row.post);
      return [
        {
          comment,
          post: { id: row.post.id, body: row.post.body, fromMember: row.post.byMember, hidden: row.post.hidden, author: { name: postName.name, initials: postName.name === null ? "" : postName.initials } },
          reports: row.reports,
          allReports: row.allReports,
          reportsMark: row.reportsMark,
          reasons: counts,
          notes: notes.filter((n) => n.commentId === row.comment.id).map((n) => n.note),
        },
      ];
    }),
  });
}

/** Staff keep a reported comment: its reports are answered, but only while they are exactly the ones
 *  staff were shown, as for a post. One that arrived since was never read, so none is answered. */
export async function keepReported(deps: CommentsDeps, staffId: string, gymId: string, commentId: string, shown: { allReports: number; reportsMark: string }, limit: Limit): Promise<{ kept: boolean; waiting: number } | null> {
  await requireWritablePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  return await deps.sql.begin(async (tx) => {
    await repo.holdComment(tx, gymId, commentId);
    const row = await repo.commentById(tx, gymId, commentId, "staff");
    if (row === null || (await postsRepo.postById(tx, gymId, row.postId, "staff")) === null) throw commentNotFound();
    const closed = await repo.keepReports(tx, gymId, commentId, deps.now(), shown.reportsMark);
    const now = await repo.countReports(tx, gymId, commentId);
    if (closed > 0) {
      await repo.showAgain(tx, gymId, commentId);
      await insertAudit(tx, { actorUserId: staffId, gymId, action: "org.comment_kept", targetType: "post_comment", targetId: commentId, meta: { reports: String(closed) } });
      return { kept: true, waiting: now.open };
    }
    if (now.open === 0) return { kept: true, waiting: 0 };
    if (now.all <= shown.allReports) throw new OrgsError(409, "reports_changed", GYM_POST_COMMENT_WORDS.reports_changed);
    return { kept: false, waiting: Math.min(now.open, now.all - shown.allReports) };
  });
}

/** The gym's switch: whether its members may comment. Comments already made stay either way. */
export async function setMembersCanComment(deps: CommentsDeps, staffId: string, gymId: string, on: boolean, limit: Limit): Promise<{ membersCanComment: boolean } | null> {
  await requireWritablePrivilege(deps, gymId, staffId, TICK);
  if (!(await limit())) return null;
  await deps.sql.begin(async (tx) => {
    if (!(await repo.setMembersCanComment(tx, gymId, on))) return;
    await insertAudit(tx, { actorUserId: staffId, gymId, action: on ? "org.member_comments_on" : "org.member_comments_off", targetType: "gyms", targetId: gymId, meta: {} });
  });
  return { membersCanComment: on };
}
