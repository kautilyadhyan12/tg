import { GYM_POST_COMMENT_MAX_CHARS, GYM_POST_COMMENT_REPORTS_TO_HIDE, hasCommentWords, postLength } from '@app/shared';

// COMMENTS IN THE CONSOLE, IN WORDS (ROADMAP Stage 5 17e-ii; spec Part 3 §15.2).

/** The button on a post that opens its comments. */
export function commentsButton(count) {
  return count === 0 ? 'Comments' : `Comments (${count.toLocaleString('en')})`;
}

/** Under the box comments are written in: how much room is left, or how far over. */
export function commentCharsLine(body) {
  const left = GYM_POST_COMMENT_MAX_CHARS - postLength(body.trim());
  const chars = (n) => (n === 1 ? '1 character' : `${n.toLocaleString('en')} characters`);
  return left >= 0 ? { over: false, text: `${chars(left)} left` } : { over: true, text: `${chars(-left)} too many` };
}

/** Whether Send can be pressed: something that shows, and not too long. */
export function canSendComment(body) {
  return hasCommentWords(body) && postLength(body.trim()) <= GYM_POST_COMMENT_MAX_CHARS;
}

/** The small word beside a name: staff's are marked, as on the phone. */
export function commentTag(comment, words) {
  return comment.fromMember ? words.personCap : 'Staff';
}

/** "Show 3 replies", or "Hide replies" once open. */
export function repliesButton(comment, open) {
  if (open) return 'Hide replies';
  return comment.replyCount === 1 ? 'Show 1 reply' : `Show ${comment.replyCount.toLocaleString('en')} replies`;
}

/** The box before staff remove a comment or reply: who loses what, and who does not change. */
export function removeCommentBox(comment, words) {
  const whose = comment.fromMember ? `${comment.author.name ?? 'This person'}'s` : "Your staff's";
  if (comment.parentId !== null) {
    return {
      title: 'Remove this reply?',
      line: `${whose} reply will be gone for all your ${words.people}. Nobody is emailed, and nothing else changes.`,
      confirm: 'Remove reply',
      cancel: 'Cancel',
      done: `Reply removed. Your ${words.people} no longer see it.`,
    };
  }
  const replies = comment.replyCount === 0 ? '' : comment.replyCount === 1 ? ', with the 1 reply under it' : `, with the ${comment.replyCount.toLocaleString('en')} replies under it`;
  return {
    title: 'Remove this comment?',
    line: `${whose} comment will be gone for all your ${words.people}${replies}. Nobody is emailed, and nothing else changes.`,
    confirm: 'Remove comment',
    cancel: 'Cancel',
    done: `Comment removed. Your ${words.people} no longer see it.`,
  };
}

/** What staff read on a hidden comment, or null. `where`: 'list' on the reported list, where Keep is;
 *  'above' lower on Updates; 'elsewhere' on another page, beside a button to Updates. A gym that can
 *  change nothing is told only why. */
export function hiddenCommentNote(comment, words, where, readOnly = false) {
  if (!comment.hidden) return null;
  const why = `Hidden from your ${words.people}: ${GYM_POST_COMMENT_REPORTS_TO_HIDE} or more people reported it.`;
  if (readOnly) return why;
  if (where === 'list') return `${why} Keep comment shows it to them again.`;
  return where === 'above' ? `${why} Choose Keep or Remove under Reported comments, at the top of this page.` : `${why} Choose Keep or Remove under Reported comments on Updates.`;
}

/** What staff are told about who will read what they write on a post. */
export function composerReach(post, words) {
  return post.hidden ? `Your ${words.people} can't see this post until you keep it.` : `Your ${words.people} see this as from Staff.`;
}

/** What is said once a comment or reply is sent. */
export function sentNote(made, post, words) {
  const what = made.parentId === null ? 'Comment' : 'Reply';
  return post.hidden ? `${what} sent. Your ${words.people} can't see it until you keep the post.` : `${what} sent. Your ${words.people} can see it now.`;
}

/** A first page read again into what is already loaded: inside that page the server's answer is the
 *  truth, and rows past it stay, as do the pages already opened. */
export function withFirstPage(was, page) {
  const last = page.comments[page.comments.length - 1];
  if (page.next === null || last === undefined) return { items: page.comments, next: page.next };
  const past = (c) => c.createdAt > last.createdAt || (c.createdAt === last.createdAt && c.id > last.id);
  const later = was.items.filter(past);
  return { items: [...page.comments, ...later], next: later.length > 0 ? was.next : page.next };
}

/** The list of posts with the first page's switches and the counts of posts already listed: older pages stay. */
export function withFreshFeed(feed, page) {
  const fresh = new Map([...page.pinned, ...page.posts].map((p) => [p.id, p.commentCount]));
  const mark = (p) => (fresh.has(p.id) ? { ...p, commentCount: fresh.get(p.id) } : p);
  return { ...feed, membersCanPost: page.membersCanPost, membersCanComment: page.membersCanComment, reportedCount: page.reportedCount, pinned: feed.pinned.map(mark), posts: feed.posts.map(mark) };
}

/** The switch that lets members comment: its name and the line under it. */
export function memberCommentsSwitch(on, words) {
  return {
    label: `${words.peopleCap} can comment`,
    line: on
      ? `Your ${words.people} can comment on posts and reply to each other. You can remove any comment, and stop a person posting and commenting.`
      : `Only your staff can comment. Switch this on to let your ${words.people} comment too.`,
    off: `${words.peopleCap} can no longer comment. The comments they already made stay until you remove them.`,
    on: `Your ${words.people} can comment now.`,
  };
}

/** The heading over the reported comments, with how many are waiting. */
export function reportedCommentsTitle(total) {
  return total === 1 ? '1 reported comment to look at' : `${total.toLocaleString('en')} reported comments to look at`;
}

/** Under that heading: what each button does, and when a comment is hidden. */
export function reportedCommentsHelp(words) {
  return `Remove a comment and it's gone for everyone, with any replies under it. Keep it and it stays. A comment ${GYM_POST_COMMENT_REPORTS_TO_HIDE} people have reported is hidden from your ${words.people} until you choose. Your ${words.people} are never told who reported a comment, and neither are you.`;
}

/** Under the heading when more are waiting than the list carries, or null. */
export function reportedCommentsMore(reported) {
  const left = reported.total - reported.items.length;
  return left > 0 ? `Showing the ${reported.items.length.toLocaleString('en')} that have waited longest. ${left.toLocaleString('en')} more will show as you answer these.` : null;
}

/** Which post a reported comment is on: the writer's name, and the post's own words where it has any. */
export function reportedCommentPlace(item, gymName) {
  const what = item.comment.parentId === null ? 'A comment' : 'A reply';
  const whose = item.post.fromMember ? `${item.post.author.name ?? 'a member'}'s post` : `${gymName}'s post`;
  return { line: `${what} on ${whose}`, words: item.post.body.trim() === '' ? null : item.post.body };
}

/** What Keep did, from its answer. A report that arrived while staff were looking was not answered. */
export function keepCommentNote(answer, comment, words) {
  if (answer.waiting === 0 && comment.hidden) return `Kept. Your ${words.people} can see the comment again, and it has left this list.`;
  if (answer.waiting === 0) return 'Kept. The comment stays, and it has left this list.';
  const more = answer.waiting === 1 ? '1 more person reported this comment' : `${answer.waiting.toLocaleString('en')} more people reported this comment`;
  return `${more} while you were looking, so it is still on this list. Read what is new, then choose again.`;
}

/** A list of posts after a change to how many comments one has. */
export function withCommentCount(feed, postId, change) {
  const mark = (p) => (p.id === postId ? { ...p, commentCount: Math.max(0, p.commentCount + change) } : p);
  return { ...feed, ...(feed.pinned === undefined ? {} : { pinned: feed.pinned.map(mark) }), posts: feed.posts.map(mark) };
}
