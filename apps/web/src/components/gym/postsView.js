// A GYM'S UPDATES, IN WORDS (spec Part 3 §15.2, §15.3; ROADMAP 19b-i, 19b-ii-a). Pure, so
// every sentence is tested without a browser. Shared by the member's Updates tab and the
// console's page.
import {
  GYM_MEMBER_PHOTO_POSTS_A_DAY,
  GYM_MEMBER_POSTS_A_DAY,
  GYM_POST_MAX_CHARS,
  GYM_POST_MAX_PHOTOS,
  GYM_POST_MAX_PINNED,
  GYM_POST_REACTIONS,
  GYM_POST_REACTION_WORDS,
  GYM_POST_REPORT_NOTE_MAX,
  GYM_POST_REPORT_REASONS,
  GYM_POST_REPORT_REASON_WORDS,
  GYM_POST_REPORTS_TO_HIDE,
  GYM_POST_WORDS,
  postLength,
} from '@app/shared';

export function canManagePosts(privileges) {
  return Array.isArray(privileges) && privileges.includes('posts.manage');
}

/** Who posted: the person's name. With none, a member's post says "A member" and a staff
 *  post the gym's own name. */
export function authorName(post, gymName) {
  return post.author.name ?? (post.fromMember ? 'A member' : gymName);
}

/** The letters in the round mark beside the name. */
export function authorInitials(post, gymName) {
  if (post.author.name !== null && post.author.initials !== '') return post.author.initials;
  if (post.fromMember) return 'M';
  return Array.from(gymName.trim())[0]?.toUpperCase() ?? '';
}

/** The small word beside the name on the member's page: staff posts are marked, so a
 *  member's post is never taken for the gym's word. */
export function authorTag(post) {
  return !post.fromMember && post.author.name !== null ? 'Staff' : null;
}

/** "7 Oct, 12:05 pm", with the year when it is not this one. In the reader's own time zone
 *  unless one is given. */
export function postedText(createdAt, now = new Date(), timeZone = undefined) {
  const at = new Date(createdAt);
  const zone = timeZone === undefined ? {} : { timeZone };
  const year = (d) => new Intl.DateTimeFormat('en-GB', { year: 'numeric', ...zone }).format(d);
  const day = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(year(at) === year(now) ? {} : { year: 'numeric' }),
    ...zone,
  }).format(at);
  const time = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, ...zone })
    .format(at)
    .replace(/\s?([ap])m$/i, (_, p) => ` ${p.toLowerCase()}m`);
  return `${day}, ${time}`;
}

/** The reaction buttons of one post, in drawing order. */
export function reactionButtons(post) {
  return GYM_POST_REACTIONS.map((id) => {
    const count = post.reactions[id];
    const word = GYM_POST_REACTION_WORDS[id];
    return {
      id,
      word,
      count,
      mine: post.mine === id,
      // What a screen reader says: the word, how many, and whether it is the reader's own.
      label: `${word}, ${count === 1 ? '1 person' : `${count.toLocaleString('en')} people`}${post.mine === id ? ', including you' : ''}`,
    };
  });
}

/** The heading over the names staff see for one reaction: "Fire · 2 people". */
export function reactorsTitle(reaction) {
  return `${reaction.word} · ${reaction.count === 1 ? '1 person' : `${reaction.count.toLocaleString('en')} people`}`;
}

/** What follows the names when there are more than the list carries, or people whose
 *  account is gone: "and 12 more". Null when every one is named. */
export function reactorsMore(who) {
  const left = who.total - who.people.length;
  return left > 0 ? `and ${left.toLocaleString('en')} more` : null;
}

/** The post after the reader taps a reaction: tapping their own takes it off. Shown at
 *  once, and put right by the server's answer. */
export function withReaction(post, tapped) {
  const next = post.mine === tapped ? null : tapped;
  const reactions = { ...post.reactions };
  if (post.mine !== null) reactions[post.mine] = Math.max(0, reactions[post.mine] - 1);
  if (next !== null) reactions[next] += 1;
  return { ...post, reactions, mine: next };
}

/** What the member reads where the posts would be, or null when there are posts. */
export function emptyLine(feed) {
  if (feed.status === 'paused') return `${feed.gymName}'s updates aren't showing at the moment.`;
  if (feed.pinned.length > 0 || feed.posts.length > 0) return null;
  return feed.posting === 'on' ? 'No posts yet. Write the first one.' : `${feed.gymName} hasn't posted anything yet.`;
}

// ── A MEMBER POSTS, REMOVES THEIR OWN, AND REPORTS (19b-ii-a) ──

/** Whether the member is shown the box to write a post in. */
export function memberCanPost(feed) {
  return feed.status === 'shown' && feed.posting === 'on';
}

/** What a member the staff have stopped reads in place of the box, or null. */
export function stoppedNote(feed) {
  if (feed.status !== 'shown' || feed.posting !== 'stopped') return null;
  // The sentence the server refuses a post with: written once.
  return GYM_POST_WORDS.posting_stopped(feed.gymName);
}

/** Under the member's box: who sees a post, and the day's limit. */
export function memberPostHint(gymName) {
  return `Everyone at ${gymName} in the app sees it straight away. You can post ${GYM_MEMBER_POSTS_A_DAY} times in any 24 hours, ${GYM_MEMBER_PHOTO_POSTS_A_DAY} of them with photos. Where a photo was taken is never kept.`;
}

/** The list with the member's new post at the top of the unpinned ones; never twice. */
export function withNewPost(feed, post) {
  return { ...feed, posts: [post, ...feed.posts.filter((p) => p.id !== post.id)] };
}

/** The box before a member removes their own post. */
export function ownRemoveBox(post, gymName) {
  const photos = post.photos.length === 0 ? '' : post.photos.length === 1 ? ' and its photo' : ` and its ${post.photos.length} photos`;
  return {
    title: 'Remove your post?',
    line: `Your post${photos} will disappear for everyone at ${gymName}. This can't be undone.`,
    confirm: 'Remove post',
    cancel: 'Keep post',
  };
}

/** The reasons a post is reported for, in drawing order. */
export const REPORT_REASONS = GYM_POST_REPORT_REASONS.map((id) => ({ id, word: GYM_POST_REPORT_REASON_WORDS[id] }));

/** Under the box a member may type more in: how much room is left, or how far over. */
export function reportNoteLine(note) {
  const left = GYM_POST_REPORT_NOTE_MAX - postLength(note.trim());
  const chars = (n) => (n === 1 ? '1 character' : `${n.toLocaleString('en')} characters`);
  if (left >= 0) return { over: false, text: `${chars(left)} left` };
  return { over: true, text: `${chars(-left)} too many` };
}

/** The box a member reports a post in. */
export function reportBox(gymName) {
  return {
    title: 'Report this post',
    line: `The staff at ${gymName} will look at it. The person who posted isn't told who reported it.`,
    noteLabel: 'Tell the staff more (you can leave this empty)',
    notePlaceholder: 'What is wrong with this post?',
    confirm: 'Send report',
    cancel: 'Cancel',
    done: `Reported. The staff at ${gymName} will look at it.`,
  };
}

// ── THE CONSOLE: MEMBERS' POSTS, THE REPORTED LIST, STOPPING A PERSON (19b-ii-a) ──

/** The switch that lets members post: its name and the line under it. */
export function memberPostsSwitch(on, words) {
  return {
    label: `${words.peopleCap} can post`,
    line: on
      ? `Your ${words.people} can post words and photos here. You can remove any post, and stop a person posting.`
      : `Only your staff can post. Switch this on to let your ${words.people} post too.`,
    off: `${words.peopleCap} can no longer post. The posts they already made stay until you remove them.`,
    on: `Your ${words.people} can post now.`,
  };
}

/** "Reported by 2 people: Bullying or unkind (1) · Spam or selling (1)". */
export function reportedLine(item) {
  const who = item.reports === 1 ? '1 person' : `${item.reports.toLocaleString('en')} people`;
  const reasons = REPORT_REASONS.filter((r) => item.reasons[r.id] > 0).map((r) => (item.reports === 1 ? r.word : `${r.word} (${item.reasons[r.id].toLocaleString('en')})`));
  return `Reported by ${who}: ${reasons.join(' · ')}`;
}

/** Over what reporters typed about a post, or null when nobody typed anything. */
export function reportNotesTitle(item) {
  if (item.notes.length === 0) return null;
  return item.notes.length === 1 ? 'What the person who reported it wrote:' : 'What people who reported it wrote:';
}

/** The heading over the reported posts, with how many are waiting. */
export function reportedTitle(total) {
  return total === 1 ? '1 reported post to look at' : `${total.toLocaleString('en')} reported posts to look at`;
}

/** Under the heading when more are waiting than the list carries, or null. */
export function reportedMore(reported) {
  const left = reported.total - reported.items.length;
  return left > 0 ? `Showing the ${reported.items.length.toLocaleString('en')} that have waited longest. ${left.toLocaleString('en')} more will show as you answer these.` : null;
}

/** What Keep did, from its answer. A report that arrived while staff were looking was not
 *  answered: the post is still on the list, with that report to read. */
export function keepNote(answer, post = null, words = null) {
  if (answer.waiting === 0 && post !== null && post.hidden && words !== null) return `Kept. Your ${words.people} can see the post again, and it has left this list.`;
  if (answer.waiting === 0) return 'Kept. The post stays on Updates and has left this list.';
  const more = answer.waiting === 1 ? '1 more person reported this post' : `${answer.waiting.toLocaleString('en')} more people reported this post`;
  return `${more} while you were looking, so it is still on this list. Read what is new, then choose again.`;
}

// ── HIDDEN WHILE STAFF DECIDE (19b-vi) ──

/** Under the reported list's heading: what each button does, and when a post is hidden. */
export function reportedHelp(words) {
  return `Remove a post and it's gone for everyone. Keep it and it stays on Updates. A post ${GYM_POST_REPORTS_TO_HIDE} people have reported is hidden from your ${words.people} until you choose. Your ${words.people} are never told who reported a post, and neither are you.`;
}

/** What the member who wrote a hidden post reads on it, or null. Nobody else is sent one. */
export function hiddenOwnNote(post, gymName) {
  return post.hidden ? GYM_POST_WORDS.hidden_own(gymName) : null;
}

/** What staff read on a hidden post, or null. `onList`: on the reported list, where Keep
 *  and Remove are; elsewhere it says where they are. */
export function hiddenStaffNote(post, words, onList) {
  if (!post.hidden) return null;
  const why = `Hidden from your ${words.people}: ${GYM_POST_REPORTS_TO_HIDE} or more people reported it.`;
  return onList ? `${why} Keep post shows it to them again.` : `${why} It is in the reported posts at the top of Updates, where you can keep or remove it.`;
}

/** The posts drawn under the reported list in the console: what members read. A hidden
 *  post is drawn once, on the reported list; one that list does not carry stays here. */
export function postsBelow(feed, reported) {
  const listed = new Set((reported?.items ?? []).map((item) => item.post.id));
  return [...feed.pinned, ...feed.posts].filter((p) => !(p.hidden && listed.has(p.id)));
}

/** The list after staff keep a post: it is no longer hidden. */
export function withKept(feed, id) {
  const mark = (p) => (p.id === id ? { ...p, hidden: false } : p);
  return { ...feed, pinned: feed.pinned.map(mark), posts: feed.posts.map(mark) };
}

/** What a member may press on a post: Remove on their own member post, Report on a post
 *  somebody else wrote and they have not reported, "Reported" on one they have. A post
 *  they wrote for the gym as staff offers none of these here. */
export function memberPostAction(post) {
  if (post.own) return 'remove';
  if (post.wrote) return null;
  return post.reported ? 'reported' : 'report';
}

/** The person's name in a sentence, or "this person" with none. */
function personName(name) {
  return name ?? 'this person';
}

/** The box before a person is stopped from posting: who changes, who does not, and how. */
export function stopBox(name) {
  const who = personName(name);
  return {
    title: `Stop ${who} posting?`,
    line: `${name ?? 'They'} won't be able to post on Updates until you let them again. They can still read and react. Their posts stay until you remove them. They aren't emailed, and nobody else changes.`,
    confirm: name === null ? 'Stop them posting' : `Stop ${name} posting`,
    cancel: 'Cancel',
    done: `${name ?? 'They'} can no longer post.`,
    undone: `${name ?? 'They'} can post again.`,
  };
}

/** The list after a person is stopped or let back: every post of theirs says so. */
export function withStopped(feed, userId, stopped) {
  const mark = (p) => (p.authorId === userId ? { ...p, authorStopped: stopped } : p);
  return { ...feed, pinned: feed.pinned.map(mark), posts: feed.posts.map(mark) };
}

// ── BLOCK AND THE HELP LINE (19b-ii-b) ──

/** Whether a member is offered Block on a post: another member's post. One the gym's
 *  staff wrote cannot be blocked, and nobody blocks themselves. */
export function canBlock(post) {
  return post.fromMember && !post.wrote;
}

/** The box before a member blocks whoever wrote a post: who changes, and who does not. */
export function blockBox(post, gymName) {
  const name = post.author.name;
  const who = name ?? 'this member';
  return {
    title: `Block ${who}?`,
    // Posts the same person writes for the gym as staff are the gym's and still show: said here.
    line: `You won't see the posts ${who} writes as a member, or their reactions, at ${gymName} any more. Any reaction you gave those posts is taken off. Posts they write for ${gymName} as staff still show. They aren't told, and nothing changes for anyone else. You can unblock them at the bottom of Updates.`,
    confirm: `Block ${who}`,
    cancel: 'Cancel',
    done: `Blocked. You won't see the posts ${who} writes as a member, or their reactions, any more.`,
  };
}

/** The button at the bottom of Updates that opens the member's blocked list, or null with nobody blocked. */
export function blockedButton(feed) {
  if (feed.blockedCount === 0) return null;
  return feed.blockedCount === 1 ? "People you've blocked (1)" : `People you've blocked (${feed.blockedCount.toLocaleString('en')})`;
}

/** Under the blocked list when the member has blocked more people than it carries, or null. */
export function blockedMore(feed, shown) {
  if (shown === 0 || feed.blockedCount <= shown) return null;
  return `Showing the ${shown.toLocaleString('en')} you blocked most recently. ${(feed.blockedCount - shown).toLocaleString('en')} more will show as you unblock these.`;
}

/** What a member reads after Unblock. */
export function unblockedNote(name) {
  return name === null ? "Unblocked. You'll see their posts and reactions again." : `Unblocked. You'll see ${name}'s posts and reactions again.`;
}

/** The help line under a member's Updates: null until an address is set. */
export function helpLine(feed) {
  return feed.supportEmail === null ? null : { text: 'Need help with the app? Email', email: feed.supportEmail };
}

// ── A PERSON'S POSTS, ON THEIR PROFILE (19b-ii-c) ──

/** Whether a post's name opens its writer's posts: a member's own post. One the staff
 *  wrote for the gym is the gym's, and opens nobody. */
export function canOpenPerson(post) {
  return post.fromMember && typeof post.authorId === 'string';
}

/** What a screen reader says for the name that opens a person's posts. */
export function personLink(post) {
  return `See what ${post.author.name ?? 'this member'} has posted`;
}

/** The person a post's name opens, as the profile names them. */
export function personOf(post) {
  return { userId: post.authorId, name: post.author.name ?? 'A member', initials: post.author.name === null || post.author.initials === '' ? 'M' : post.author.initials };
}

/** What a member reads on a profile with no posts to show. */
export function personPostsEmpty(name, blocked) {
  if (blocked) return `You've blocked ${name}, so their posts aren't shown. You can unblock them at the bottom of Updates.`;
  return `${name} hasn't posted anything.`;
}

/** The number over "Posts" on a profile: "1 post" reads as "1" over "Post". */
export function postsCount(total) {
  return { number: total.toLocaleString('en'), label: total === 1 ? 'Post' : 'Posts' };
}

/** The heading over one person's posts in the console, and the line with none. */
export function staffPersonPosts(name, words) {
  const who = name ?? `This ${words.person}`;
  return { title: name === null ? 'Their posts' : `${name}'s posts`, empty: `${who} hasn't posted anything.` };
}

// ── THE CONSOLE'S FORM ──

export const POST_LIMITS = { chars: GYM_POST_MAX_CHARS, photos: GYM_POST_MAX_PHOTOS, pinned: GYM_POST_MAX_PINNED };

/** "1,988 characters left", or how far over. */
export function charsLine(body) {
  // Counted as the server counts it (`postLength`): an emoji is one character.
  const left = GYM_POST_MAX_CHARS - postLength(body);
  const chars = (n) => (n === 1 ? '1 character' : `${n.toLocaleString('en')} characters`);
  if (left >= 0) return { over: false, text: `${chars(left)} left` };
  return { over: true, text: `${chars(-left)} too many` };
}

/** Whether Post can be pressed: something to post, and not too long. */
export function canPost(body, photos) {
  return (body.trim() !== '' || photos.length > 0) && !charsLine(body).over;
}

/** Photos picked, added to the ones already on the post: at most four, and how many
 *  were left out. */
export function addPostPhotos(current, picked) {
  const room = Math.max(0, GYM_POST_MAX_PHOTOS - current.length);
  return { photos: [...current, ...picked.slice(0, room)], left: Math.max(0, picked.length - room) };
}

function namesOf(names) {
  const shown = names.slice(0, 3).map((name) => `“${name}”`);
  const more = names.length - shown.length;
  if (more > 0) return `${shown.join(', ')} and ${more} more`;
  return shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`;
}

/** What staff read about photos that could not be added, by name. */
export function photoProblem({ unreadable, tooBig, left }) {
  const lines = [];
  if (unreadable.length > 0) lines.push(`We couldn't open ${namesOf(unreadable)}. Choose a JPEG, PNG or WebP photo.`);
  if (tooBig.length > 0) lines.push(`${namesOf(tooBig)} ${tooBig.length === 1 ? 'is' : 'are'} too large even made smaller. Choose a smaller photo.`);
  if (left > 0) lines.push(`A post holds up to ${GYM_POST_MAX_PHOTOS} photos, so ${left === 1 ? '1 photo was' : `${left} photos were`} not added.`);
  return lines.length === 0 ? null : lines.join(' ');
}

/** The box before a post is removed: what goes, for whom, and that it cannot be undone. */
export function removeBox(post, words) {
  const photos = post.photos.length === 0 ? '' : post.photos.length === 1 ? ' and its photo' : ` and its ${post.photos.length} photos`;
  return {
    title: 'Remove this post?',
    line: `The post${photos} will disappear for every one of your ${words.people} and for your staff. This can't be undone.`,
    confirm: 'Remove post',
    cancel: 'Keep post',
  };
}

/** Why Pin is not offered, or null when it is. */
export function pinNote(post, pinnedCount) {
  if (post.pinned || pinnedCount < GYM_POST_MAX_PINNED) return null;
  return `You can pin up to ${GYM_POST_MAX_PINNED} posts. Unpin one to pin this.`;
}

/** The posts list after one more page arrives: a post never twice. */
export function withPage(feed, page) {
  const seen = new Set([...feed.pinned, ...feed.posts].map((p) => p.id));
  return { ...feed, posts: [...feed.posts, ...page.posts.filter((p) => !seen.has(p.id))], next: page.next };
}

/** The list with one post taken out: it was removed. */
export function withoutPost(feed, id) {
  return { ...feed, pinned: feed.pinned.filter((p) => p.id !== id), posts: feed.posts.filter((p) => p.id !== id) };
}

/** The list after a post is pinned or unpinned, as the server's answer has it. Pinned, it
 *  goes to the top. Unpinned, it goes back among the others by when it was posted; one
 *  older than every post loaded so far, with more still to come, arrives with its own page. */
export function withPinChange(feed, post) {
  const rest = withoutPost(feed, post.id);
  if (post.pinned) return { ...rest, pinned: [post, ...rest.pinned] };
  const at = rest.posts.findIndex((p) => p.createdAt < post.createdAt || (p.createdAt === post.createdAt && p.id < post.id));
  if (at === -1) return rest.next === null ? { ...rest, posts: [...rest.posts, post] } : rest;
  return { ...rest, posts: [...rest.posts.slice(0, at), post, ...rest.posts.slice(at)] };
}

/** The list with one post changed in place (a reaction, a pin's own answer). */
export function withPost(feed, post) {
  const swap = (p) => (p.id === post.id ? post : p);
  return { ...feed, pinned: feed.pinned.map(swap), posts: feed.posts.map(swap) };
}
