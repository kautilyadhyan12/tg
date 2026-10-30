import {
  GYM_POST_MAX_CHARS,
  GYM_POST_REACTIONS,
  GYM_POST_REACTION_WORDS,
  GYM_POST_REPORT_NOTE_MAX,
  GYM_POST_REPORT_REASONS,
  GYM_POST_REPORT_REASON_WORDS,
  GYM_POST_WORDS,
  postLength,
  type GymPost,
  type GymPostReaction,
  type GymPostReportReason,
  type GymPostsResponse,
} from "@app/shared";
import type { ClockFormat } from "./visitsView";

// Updates' words (spec Part 3 §15.2, §15.3; ROADMAP Stage 5 item 17a): a gym's posts as a member reads them, and the
// boxes before Remove, Report and Block. The browser's own sentences (apps/web/src/components/gym/postsView.js), so
// the two never differ (apps/web/src/components/gym/postsView.phone.test.js). Pure: the server decides which posts
// a member is sent, and this file only puts them into words.

const postsPath = (gymId: string) => `/v1/orgs/${encodeURIComponent(gymId)}/posts`;
const postPath = (gymId: string, postId: string) => `${postsPath(gymId)}/${encodeURIComponent(postId)}`;

/** A page of the gym's posts; `before` is the last page's `next`. */
export const updatesPath = (gymId: string, before: string | null = null) =>
  before === null ? postsPath(gymId) : `${postsPath(gymId)}?before=${encodeURIComponent(before)}`;
export const reactionPath = (gymId: string, postId: string) => `${postPath(gymId, postId)}/reaction`;
export const reportPath = (gymId: string, postId: string) => `${postPath(gymId, postId)}/report`;
export const blockPath = (gymId: string, postId: string) => `${postPath(gymId, postId)}/block`;
export const blockedPath = (gymId: string) => `${postsPath(gymId)}/blocked`;
export const unblockPath = (gymId: string, blockId: string) => `${blockedPath(gymId)}/${encodeURIComponent(blockId)}`;
export const removeOwnPath = (gymId: string, postId: string) => `${postsPath(gymId)}/mine/${encodeURIComponent(postId)}`;
/** Where a member's own post is sent. */
export const addOwnPath = (gymId: string) => `${postsPath(gymId)}/mine`;
/** Where a post's photo is read from, signed in. */
export const photoPath = (gymId: string, postId: string, photoId: string) => `${postPath(gymId, postId)}/photos/${encodeURIComponent(photoId)}`;

/** Who posted: the person's name. With none, a member's post says "A member" and a staff post the gym's own name. */
export function authorName(post: GymPost, gymName: string): string {
  return post.author.name ?? (post.fromMember ? "A member" : gymName);
}

/** The letters in the round mark beside the name. */
export function authorInitials(post: GymPost, gymName: string): string {
  if (post.author.name !== null && post.author.initials !== "") return post.author.initials;
  if (post.fromMember) return "M";
  return Array.from(gymName.trim())[0]?.toUpperCase() ?? "";
}

/** The small word beside the name: staff posts are marked, so a member's post is never taken for the gym's word. */
export function authorTag(post: GymPost): string | null {
  return !post.fromMember && post.author.name !== null ? "Staff" : null;
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function partsIn(at: Date, zone: string): { year: number; month: number; day: number; hour: number; minute: number } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
    const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const read = { year: part("year"), month: part("month"), day: part("day"), hour: part("hour"), minute: part("minute") };
    return Object.values(read).every(Number.isFinite) ? read : null;
  } catch {
    return null;
  }
}

/** "7 Oct, 12:05 pm" (or "7 Oct, 12:05" on a 24-hour gym), with the year when it is not this one, in the phone's own
 *  time zone. An instant that cannot be read is said as nothing. */
export function postedText(createdAt: string, now: Date, zone: string, clock: ClockFormat): string {
  const at = partsIn(new Date(createdAt), zone);
  const today = partsIn(now, zone);
  if (at === null) return "";
  const month = MONTH_SHORT[at.month - 1] ?? "";
  const day = `${String(at.day)} ${month}${today !== null && today.year === at.year ? "" : ` ${String(at.year)}`}`;
  const minute = String(at.minute).padStart(2, "0");
  if (clock === "24h") return `${day}, ${String(at.hour).padStart(2, "0")}:${minute}`;
  const hour = at.hour % 12 === 0 ? 12 : at.hour % 12;
  return `${day}, ${String(hour)}:${minute} ${at.hour < 12 ? "am" : "pm"}`;
}

export interface ReactionButton {
  id: GymPostReaction;
  word: string;
  count: number;
  mine: boolean;
  /** What a screen reader says: the word, how many, and whether it is the reader's own. */
  label: string;
}

const people = (n: number) => (n === 1 ? "1 person" : `${n.toLocaleString("en")} people`);

/** The reaction buttons of one post, in drawing order. */
export function reactionButtons(post: GymPost): ReactionButton[] {
  return GYM_POST_REACTIONS.map((id) => {
    const count = post.reactions[id];
    const word = GYM_POST_REACTION_WORDS[id];
    return { id, word, count, mine: post.mine === id, label: `${word}, ${people(count)}${post.mine === id ? ", including you" : ""}` };
  });
}

/** What a press's 404 says is missing. The post and the block each have their own word; any other (a gym that has
 *  taken this person off its list, or stopped being live) says nothing about the post, which may well still be up. */
export function missingThing(refusal: { status: number; error: string }): "post" | "block" | "place" | null {
  if (refusal.status !== 404) return null;
  if (refusal.error === "post_not_found") return "post";
  if (refusal.error === "block_not_found") return "block";
  return "place";
}

/** The one reaction button the phone shows until it is tapped (Kd's click-through, 2026-10-30): the kinds given, how
 *  many in all, and what it says to somebody who cannot see it. */
export function reactionSummary(post: GymPost): { given: ReactionButton[]; total: number; label: string } {
  const given = reactionButtons(post).filter((r) => r.count > 0);
  const total = given.reduce((sum, r) => sum + r.count, 0);
  const label = given.length === 0 ? "React to this post" : `Reactions: ${given.map((r) => r.label).join("; ")}. Choose a reaction`;
  return { given, total, label };
}

/** The post after the reader taps a reaction: tapping their own takes it off. Shown at once, and put right by the
 *  server's answer. */
export function withReaction(post: GymPost, tapped: GymPostReaction): GymPost {
  const next = post.mine === tapped ? null : tapped;
  const reactions = { ...post.reactions };
  if (post.mine !== null) reactions[post.mine] = Math.max(0, reactions[post.mine] - 1);
  if (next !== null) reactions[next] += 1;
  return { ...post, reactions, mine: next };
}

/** What the member reads where the posts would be, or null when there are posts. `canWrite`: this screen has the box
 *  to write a post in, so the first one can be theirs. */
export function emptyLine(feed: GymPostsResponse, canWrite: boolean): string | null {
  if (feed.status === "paused") return `${feed.gymName}'s updates aren't showing at the moment.`;
  if (feed.pinned.length > 0 || feed.posts.length > 0) return null;
  if (feed.posting !== "on") return `${feed.gymName} hasn't posted anything yet.`;
  return canWrite ? "No posts yet. Write the first one." : "No posts yet.";
}

/** What a member may press on a post: Remove on their own member post, Report on a post somebody else wrote and they
 *  have not reported, "Reported" on one they have. A post they wrote for the gym as staff offers none of these. */
export function memberPostAction(post: GymPost): "remove" | "reported" | "report" | null {
  if (post.own) return "remove";
  if (post.wrote) return null;
  return post.reported ? "reported" : "report";
}

/** Whether a member is offered Block on a post: another member's post. One the gym's staff wrote cannot be blocked,
 *  and nobody blocks themselves. */
export function canBlock(post: GymPost): boolean {
  return post.fromMember && !post.wrote;
}

/** What the member who wrote a hidden post reads on it, or null. Nobody else is sent one. */
export function hiddenOwnNote(post: GymPost, gymName: string): string | null {
  return post.hidden ? GYM_POST_WORDS.hidden_own(gymName) : null;
}

export interface AskBox {
  title: string;
  line: string;
  confirm: string;
  cancel: string;
}

/** Whether this member may post here now. */
export function memberCanPost(feed: GymPostsResponse): boolean {
  return feed.status === "shown" && feed.posting === "on";
}

/** What a member the staff have stopped reads in place of the button, or null. */
export function stoppedNote(feed: GymPostsResponse): string | null {
  if (feed.status !== "shown" || feed.posting !== "stopped") return null;
  return GYM_POST_WORDS.posting_stopped(feed.gymName);
}

/** Under the box a post is written in: how much room is left, or how far over. Counted as the server counts it. */
export function charsLine(body: string): { over: boolean; text: string } {
  const left = GYM_POST_MAX_CHARS - postLength(body);
  const chars = (n: number) => (n === 1 ? "1 character" : `${n.toLocaleString("en")} characters`);
  if (left >= 0) return { over: false, text: `${chars(left)} left` };
  return { over: true, text: `${chars(-left)} too many` };
}

/** Whether Post can be pressed: something to post, and not too long. */
export function canPost(body: string, photos: readonly unknown[]): boolean {
  return (body.trim() !== "" || photos.length > 0) && !charsLine(body).over;
}

/** The list with the member's new post at the top of the unpinned ones; never twice. */
export function withNewPost(feed: GymPostsResponse, post: GymPost): GymPostsResponse {
  return { ...feed, posts: [post, ...feed.posts.filter((p) => p.id !== post.id)] };
}

/** The box before a member removes their own post. */
export function ownRemoveBox(post: GymPost, gymName: string): AskBox {
  const photos = post.photos.length === 0 ? "" : post.photos.length === 1 ? " and its photo" : ` and its ${String(post.photos.length)} photos`;
  return {
    title: "Remove your post?",
    line: `Your post${photos} will disappear for everyone at ${gymName}. This can't be undone.`,
    confirm: "Remove post",
    cancel: "Keep post",
  };
}

/** The reasons a post is reported for, in drawing order. */
export const REPORT_REASONS: readonly { id: GymPostReportReason; word: string }[] = GYM_POST_REPORT_REASONS.map((id) => ({
  id,
  word: GYM_POST_REPORT_REASON_WORDS[id],
}));

/** Under the box a member may type more in: how much room is left, or how far over. */
export function reportNoteLine(note: string): { over: boolean; text: string } {
  const left = GYM_POST_REPORT_NOTE_MAX - postLength(note.trim());
  const chars = (n: number) => (n === 1 ? "1 character" : `${n.toLocaleString("en")} characters`);
  if (left >= 0) return { over: false, text: `${chars(left)} left` };
  return { over: true, text: `${chars(-left)} too many` };
}

/** The box a member reports a post in. */
export function reportBox(gymName: string) {
  return {
    title: "Report this post",
    line: `The staff at ${gymName} will look at it. The person who posted isn't told who reported it.`,
    noteLabel: "Tell the staff more (you can leave this empty)",
    notePlaceholder: "What is wrong with this post?",
    confirm: "Send report",
    cancel: "Cancel",
    done: `Reported. The staff at ${gymName} will look at it.`,
  };
}

/** The box before a member blocks whoever wrote a post: who changes, and who does not. */
export function blockBox(post: GymPost, gymName: string) {
  const who = post.author.name ?? "this member";
  return {
    title: `Block ${who}?`,
    // Posts the same person writes for the gym as staff are the gym's and still show: said here.
    line: `You won't see the posts ${who} writes as a member, or their reactions, at ${gymName} any more. Any reaction you gave those posts is taken off. Posts they write for ${gymName} as staff still show. They aren't told, and nothing changes for anyone else. You can unblock them at the bottom of Updates.`,
    confirm: `Block ${who}`,
    cancel: "Cancel",
    done: `Blocked. You won't see the posts ${who} writes as a member, or their reactions, any more.`,
  };
}

/** The button at the bottom of Updates that opens the member's blocked list, or null with nobody blocked. */
export function blockedButton(feed: GymPostsResponse): string | null {
  if (feed.blockedCount === 0) return null;
  return feed.blockedCount === 1 ? "People you've blocked (1)" : `People you've blocked (${feed.blockedCount.toLocaleString("en")})`;
}

/** Under the blocked list when the member has blocked more people than it carries, or null. */
export function blockedMore(feed: GymPostsResponse, shown: number): string | null {
  if (shown === 0 || feed.blockedCount <= shown) return null;
  return `Showing the ${shown.toLocaleString("en")} you blocked most recently. ${(feed.blockedCount - shown).toLocaleString("en")} more will show as you unblock these.`;
}

/** What a member reads after Unblock. */
export function unblockedNote(name: string | null): string {
  return name === null ? "Unblocked. You'll see their posts and reactions again." : `Unblocked. You'll see ${name}'s posts and reactions again.`;
}

/** The help line under Updates: null until an address is set. */
export function helpLine(feed: GymPostsResponse): { text: string; email: string } | null {
  return feed.supportEmail === null ? null : { text: "Need help with the app? Email", email: feed.supportEmail };
}

/** What the member reads after removing their own post. */
export const REMOVED_OWN = "Your post has been removed.";

/** Why the posts could not be shown: a place that no longer shows them to this person, or no answer. */
export function couldNotRead(status: number | null, gymName: string): string {
  return status === 404 ? `${gymName}'s updates aren't available right now.` : "Couldn't load the updates.";
}

/** Why a press did not work: the server's own sentence, or no answer. */
export function pressFailed(refusal: string | null): string {
  return refusal ?? "That didn't work. Check your connection and try again.";
}

// The lists, changed in place as the browser's are.

/** The list after one more page arrives: a post never twice. */
export function withPage(feed: GymPostsResponse, page: GymPostsResponse): GymPostsResponse {
  const seen = new Set([...feed.pinned, ...feed.posts].map((p) => p.id));
  return { ...feed, posts: [...feed.posts, ...page.posts.filter((p) => !seen.has(p.id))], next: page.next };
}

/** The list with one post taken out: it was removed. */
export function withoutPost(feed: GymPostsResponse, id: string): GymPostsResponse {
  return { ...feed, pinned: feed.pinned.filter((p) => p.id !== id), posts: feed.posts.filter((p) => p.id !== id) };
}

/** The list after the reader blocks a member: every post that member wrote as a member goes at once, before the
 *  server's next answer says the same. Posts they wrote for the gym as staff stay, as the server keeps them. */
export function withoutAuthor(feed: GymPostsResponse, authorId: string): GymPostsResponse {
  const keep = (p: GymPost) => !(p.fromMember && p.authorId === authorId);
  return { ...feed, pinned: feed.pinned.filter(keep), posts: feed.posts.filter(keep) };
}

/** The list with one post changed in place. */
export function withPost(feed: GymPostsResponse, post: GymPost): GymPostsResponse {
  const swap = (p: GymPost) => (p.id === post.id ? post : p);
  return { ...feed, pinned: feed.pinned.map(swap), posts: feed.posts.map(swap) };
}
