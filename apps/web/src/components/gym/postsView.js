// A GYM'S UPDATES, IN WORDS (spec Part 3 §15.2; ROADMAP 19b-i). Pure, so every sentence is
// tested without a browser. Shared by the member's Updates tab and the console's page.
import { GYM_POST_MAX_CHARS, GYM_POST_MAX_PHOTOS, GYM_POST_MAX_PINNED, GYM_POST_REACTIONS, GYM_POST_REACTION_WORDS, postLength } from '@app/shared';

export function canManagePosts(privileges) {
  return Array.isArray(privileges) && privileges.includes('posts.manage');
}

/** Who posted: the person's name, or the gym's when their account is gone. */
export function authorName(post, gymName) {
  return post.author.name ?? gymName;
}

/** The letters in the round mark beside the name. */
export function authorInitials(post, gymName) {
  if (post.author.name !== null && post.author.initials !== '') return post.author.initials;
  return Array.from(gymName.trim())[0]?.toUpperCase() ?? '';
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
  if (feed.pinned.length === 0 && feed.posts.length === 0) return `${feed.gymName} hasn't posted anything yet.`;
  return null;
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
