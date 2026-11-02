import {
  GYM_POST_COMMENT_COUNT_MOST,
  GYM_POST_COMMENT_DRAFTS_MOST,
  GYM_POST_COMMENT_MAX_CHARS,
  GYM_POST_COMMENT_REPORT_REASONS,
  GYM_POST_COMMENT_WORDS,
  GYM_POST_REPORT_REASON_WORDS,
  gymPostCommentDraftsFileSchema,
  hasCommentWords,
  postLength,
  type GymMemberPosting,
  type GymPostComment,
  type GymPostCommentReportReason,
} from "@app/shared";

// Comments and replies on Updates (ROADMAP Stage 5 17e; spec Part 3 §15.2): their words, the lists changed in place,
// and comments kept on the phone until the server has them. Pure: the server decides what a member is sent.

const orgPath = (gymId: string) => `/v1/orgs/${encodeURIComponent(gymId)}`;
const onePath = (gymId: string, commentId: string) => `${orgPath(gymId)}/post-comments/${encodeURIComponent(commentId)}`;
const withAfter = (path: string, after: string | null) => (after === null ? path : `${path}?after=${encodeURIComponent(after)}`);

export const commentsPath = (gymId: string, postId: string, after: string | null = null) => withAfter(`${orgPath(gymId)}/posts/${encodeURIComponent(postId)}/comments`, after);
export const repliesPath = (gymId: string, commentId: string, after: string | null = null) => withAfter(`${onePath(gymId, commentId)}/replies`, after);
export const commentReactionPath = (gymId: string, commentId: string) => `${onePath(gymId, commentId)}/reaction`;
export const commentReportPath = (gymId: string, commentId: string) => `${onePath(gymId, commentId)}/report`;
export const commentBlockPath = (gymId: string, commentId: string) => `${onePath(gymId, commentId)}/block`;
export const commentRemovePath = onePath;

/** A post's count after a comment is added or removed: at the most, the server stopped counting, so the real number is not known. */
export const countAfter = (count: number, by: number): number => (count >= GYM_POST_COMMENT_COUNT_MOST ? count : Math.max(0, count + by));

/** What the button on a post says. */
export function commentButton(count: number, kept: boolean): { label: string; say: string } {
  if (kept) return { label: "Finish your comment", say: "Finish your comment" };
  if (count === 0) return { label: "Comment", say: "Comment on this post" };
  if (count >= GYM_POST_COMMENT_COUNT_MOST) return { label: `${String(GYM_POST_COMMENT_COUNT_MOST - 1)}+`, say: `More than ${String(GYM_POST_COMMENT_COUNT_MOST - 1)} comments. Read or write a comment` };
  return { label: count.toLocaleString("en"), say: count === 1 ? "1 comment. Read or write a comment" : `${count.toLocaleString("en")} comments. Read or write a comment` };
}

/** Whether a post offers the button at all: with comments off and none written there is nothing to open. */
export const offersComments = (commenting: GymMemberPosting, count: number, kept: boolean): boolean => commenting !== "off" || count > 0 || kept;

/** The line under a comment that opens its replies. */
export function repliesButton(count: number, open: boolean): string {
  if (open) return "Hide replies";
  return count === 1 ? "See 1 reply" : `See ${count.toLocaleString("en")} replies`;
}

/** Said where the box to write in would be, when this person may not comment. */
export function cannotComment(commenting: GymMemberPosting, gymName: string): string | null {
  if (commenting === "off") return GYM_POST_COMMENT_WORDS.commenting_off;
  if (commenting === "stopped") return GYM_POST_COMMENT_WORDS.commenting_stopped(gymName);
  return null;
}

/** Room left: said only when it is near, and over the limit said plainly. Counted as the server counts it. */
export function commentRoom(body: string): { over: boolean; text: string | null } {
  const left = GYM_POST_COMMENT_MAX_CHARS - postLength(body.trim());
  const chars = (n: number) => (n === 1 ? "1 character" : `${n.toLocaleString("en")} characters`);
  if (left < 0) return { over: true, text: `${chars(-left)} too many` };
  return { over: false, text: left <= 50 ? `${chars(left)} left` : null };
}

export const canSendComment = (body: string): boolean => hasCommentWords(body) && !commentRoom(body).over;

export const COMMENT_REPORT_REASONS: readonly { id: GymPostCommentReportReason; word: string }[] = GYM_POST_COMMENT_REPORT_REASONS.map((id) => ({
  id,
  word: GYM_POST_REPORT_REASON_WORDS[id],
}));

export function commentReportBox(gymName: string) {
  return {
    title: "Report this comment",
    line: `The staff at ${gymName} will look at it. The person who wrote it isn't told who reported it.`,
    noteLabel: "Tell the staff more (you can leave this empty)",
    notePlaceholder: "What is wrong with this comment?",
    confirm: "Send report",
    cancel: "Cancel",
    done: `Reported. The staff at ${gymName} will look at it.`,
  };
}

export function commentRemoveBox(comment: Pick<GymPostComment, "parentId" | "replyCount">) {
  const thing = comment.parentId === null ? "comment" : "reply";
  const under = comment.replyCount === 0 ? "" : comment.replyCount === 1 ? " and the reply under it" : ` and the ${comment.replyCount.toLocaleString("en")} replies under it`;
  return {
    title: `Remove your ${thing}?`,
    line: `Your ${thing}${under} will disappear for everyone. This can't be undone.`,
    confirm: `Remove ${thing}`,
    cancel: `Keep ${thing}`,
    done: `Your ${thing} has been removed.`,
  };
}

// The lists, changed in place.

const inOrder = (a: GymPostComment, b: GymPostComment): number => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/** One list, oldest first, none twice: what was read last counts. */
export function merged(had: readonly GymPostComment[], read: readonly GymPostComment[]): GymPostComment[] {
  const byId = new Map(had.map((c) => [c.id, c]));
  for (const c of read) byId.set(c.id, c);
  return [...byId.values()].sort(inOrder);
}

/** The list when its first page is read again: what the page covers is as it says now, so one gone since goes, and pages
 *  read further on stay. */
export function withFirstPage(had: { comments: readonly GymPostComment[]; next: string | null }, page: { comments: readonly GymPostComment[]; next: string | null }): { comments: GymPostComment[]; next: string | null } {
  const last = page.comments[page.comments.length - 1];
  if (page.next === null || last === undefined) return { comments: [...page.comments], next: null };
  const beyond = had.comments.filter((c) => inOrder(c, last) > 0);
  return { comments: [...page.comments, ...beyond], next: beyond.length > 0 && had.next !== null ? had.next : page.next };
}

export const withComment = (list: readonly GymPostComment[], comment: GymPostComment): GymPostComment[] => list.map((c) => (c.id === comment.id ? comment : c));

/** How many stop being shown when this is removed: itself and whatever is under it. */
export const goneWith = (comment: Pick<GymPostComment, "replyCount">): number => 1 + comment.replyCount;

// Comments kept on the phone: at most one a post, until the server has it.

export interface KeptComment {
  commentKey: string;
  body: string;
  /** The comment or reply it answers, and that person's name. */
  replyTo: { id: string; name: string } | null;
  sent?: boolean;
  changed?: boolean;
  /** The post it is on has gone. */
  postGone?: boolean;
  /** What it answers has been changed since a send. */
  replyMoved?: boolean;
}
export type KeptComments = Readonly<Record<string, KeptComment | undefined>>;

export const commentDraftsText = (drafts: KeptComments): string => JSON.stringify({ version: 1, drafts });

/** The kept comments, where they can be read; anything else is none. */
export function readCommentDrafts(text: string | null): KeptComments {
  if (text === null || text === "") return {};
  let raw: unknown = null;
  try {
    raw = JSON.parse(text);
  } catch {
    return {};
  }
  const parsed = gymPostCommentDraftsFileSchema.safeParse(raw);
  if (!parsed.success) return {};
  const kept: Record<string, KeptComment> = {};
  for (const [postId, d] of Object.entries(parsed.data.drafts)) {
    kept[postId] = { commentKey: d.commentKey, body: d.body, replyTo: d.replyTo, ...(d.sent === undefined ? {} : { sent: d.sent }), ...(d.changed === undefined ? {} : { changed: d.changed }), ...(d.postGone === undefined ? {} : { postGone: d.postGone }), ...(d.replyMoved === undefined ? {} : { replyMoved: d.replyMoved }) };
  }
  return kept;
}

/** The kept comments with one changed: one with no words and nobody to answer is not kept. When there are too many, those
 *  on posts that have gone leave first, then the oldest. */
export function withKept(drafts: KeptComments, postId: string, next: KeptComment | null): KeptComments {
  const rest = Object.entries(drafts).filter(([id, d]) => id !== postId && d !== undefined);
  if (next === null || (next.body === "" && next.replyTo === null)) return Object.fromEntries(rest);
  const over = rest.length - (GYM_POST_COMMENT_DRAFTS_MOST - 1);
  const goneFirst = [...rest.filter(([, d]) => d?.postGone === true), ...rest.filter(([, d]) => d?.postGone !== true)];
  const leaving = new Set(goneFirst.slice(0, Math.max(0, over)).map(([id]) => id));
  return Object.fromEntries([...rest.filter(([id]) => !leaving.has(id)), [postId, next]]);
}

/** Whether a new kept comment on this post pushes out one that could still be sent. */
export function dropsAKeptComment(drafts: KeptComments, postId: string): boolean {
  const rest = Object.entries(drafts).filter(([id, d]) => id !== postId && d !== undefined);
  return rest.length >= GYM_POST_COMMENT_DRAFTS_MOST && !rest.some(([, d]) => d?.postGone === true);
}

/** Whether what is in the box is other than the comment the server kept: other words, or another place to be. */
export function differsFromKept(draft: Pick<KeptComment, "body" | "replyTo" | "replyMoved">, comment: Pick<GymPostComment, "body" | "parentId" | "replyingTo">): boolean {
  if (draft.body.trim() !== comment.body || draft.replyMoved === true) return true;
  if (draft.replyTo === null) return comment.parentId !== null;
  return comment.parentId !== draft.replyTo.id && comment.replyingTo !== draft.replyTo.name;
}

/** Said over a comment kept after a send whose answer never came, when comments have closed since. */
export const COMMENT_MAY_BE_UP = "This comment may already be up. You can discard this copy.";

/** Said when a reply is up but the comment it answers is not on this person's screen. */
export const REPLY_UP_ABOVE_GONE = "Your reply is up, but the comment it answers is no longer showing.";

export const KEPT_COMMENTS_FULL = `The phone keeps ${String(GYM_POST_COMMENT_DRAFTS_MOST)} unsent comments, so your oldest one was dropped.`;

/** Whether a post has words waiting to be sent. Pressing Reply and typing nothing is not one. */
export const hasKeptWords = (draft: KeptComment | undefined): boolean => draft !== undefined && draft.body !== "";

/** Said when a send whose answer was lost turns out to have made the comment, and they have changed it since: those words are still theirs. */
export const FIRST_COMMENT_UP = "Your first version is up. Press Send to post this one as well.";

/** What a comment reads when what it answered has gone: its key is spent only if it was kept, so it gets a new one. */
export const REPLY_TARGET_GONE = "The comment you were replying to has been removed. Your words are kept: press Send to post them as a new comment.";
