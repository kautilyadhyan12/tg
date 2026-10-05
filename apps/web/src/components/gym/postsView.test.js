import { describe, expect, it } from 'vitest';
import { GYM_POST_MAX_CHARS, ROLE_PRIVILEGES, addGymPostRequestSchema, gymPostSchema, gymPostsQuerySchema } from '@app/shared';
import {
  REPORT_REASONS,
  addPostPhotos,
  authorInitials,
  authorName,
  authorTag,
  canManagePosts,
  canOpenPerson,
  canPost,
  charsLine,
  emptyLine,
  hiddenOwnNote,
  hiddenStaffNote,
  keepNote,
  memberCanPost,
  memberPostAction,
  memberPostHint,
  memberPostsSwitch,
  ownRemoveBox,
  personLink,
  personOf,
  personPostsEmpty,
  postsCount,
  photoProblem,
  pinNote,
  postedText,
  postsBelow,
  reactionButtons,
  reactorsMore,
  reactorsTitle,
  removeBox,
  reportBox,
  reportNoteLine,
  reportNotesTitle,
  reportedHelp,
  reportedLine,
  reportedMore,
  reportedTitle,
  staffPersonPosts,
  stopBox,
  stoppedNote,
  withKept,
  withNewPost,
  withPage,
  withPinChange,
  withPost,
  withStopped,
  withoutPost,
  withReaction,
} from './postsView';

const post = (over = {}) => ({
  id: 'p1',
  author: { name: 'Maya O.', initials: 'MO' },
  body: 'New squat racks arrive Monday',
  photos: [],
  pinned: false,
  createdAt: '2026-10-07T06:30:00.000Z',
  reactions: { like: 0, love: 0, strong: 0, fire: 0 },
  mine: null,
  fromMember: false,
  authorId: null,
  own: false,
  wrote: false,
  reported: false,
  hidden: false,
  ...over,
});
const feed = (over = {}) => ({ gymId: 'g1', gymName: 'Iron House', status: 'shown', posting: 'off', blockedCount: 0, supportEmail: null, pinned: [], posts: [], next: null, ...over });
const WORDS = { people: 'members', peopleCap: 'Members' };

describe('who may open the console’s Updates page', () => {
  it.each([
    [ROLE_PRIVILEGES.owner, true],
    [ROLE_PRIVILEGES.manager, true],
    [ROLE_PRIVILEGES.trainer, false],
    [[...ROLE_PRIVILEGES.trainer, 'posts.manage'], true],
    [undefined, false],
    [null, false],
  ])('%j: %s', (privileges, may) => {
    expect(canManagePosts(privileges)).toBe(may);
  });
});

describe('who posted', () => {
  it('is the person, or the gym when their account is gone', () => {
    expect(authorName(post(), 'Iron House')).toBe('Maya O.');
    expect(authorInitials(post(), 'Iron House')).toBe('MO');
    const gone = post({ author: { name: null, initials: '' } });
    expect(authorName(gone, 'Iron House')).toBe('Iron House');
    expect(authorInitials(gone, ' iron house')).toBe('I');
    expect(authorInitials(gone, '')).toBe('');
  });
});

describe('when it was posted', () => {
  const now = new Date('2026-10-08T12:00:00.000Z');
  it.each([
    ['2026-10-07T06:30:00.000Z', 'UTC', '7 Oct, 6:30 am'],
    ['2026-10-07T12:05:00.000Z', 'UTC', '7 Oct, 12:05 pm'],
    ['2026-10-07T00:00:00.000Z', 'UTC', '7 Oct, 12:00 am'],
    // The reader's own zone decides the day.
    ['2026-10-07T20:00:00.000Z', 'Asia/Kolkata', '8 Oct, 1:30 am'],
    // Another year is said.
    ['2025-12-31T23:30:00.000Z', 'UTC', '31 Dec 2025, 11:30 pm'],
    // In the reader's zone it is already this year.
    ['2025-12-31T23:30:00.000Z', 'Asia/Kolkata', '1 Jan, 5:00 am'],
  ])('%s in %s reads "%s"', (at, zone, text) => {
    expect(postedText(at, now, zone)).toBe(text);
  });
});

describe('the reactions', () => {
  it('are four buttons in order, each saying how many and whether one is the reader’s', () => {
    const buttons = reactionButtons(post({ reactions: { like: 1, love: 0, strong: 1200, fire: 2 }, mine: 'fire' }));
    expect(buttons.map((b) => [b.id, b.word, b.count, b.mine])).toEqual([
      ['like', 'Like', 1, false],
      ['love', 'Love', 0, false],
      ['strong', 'Strong', 1200, false],
      ['fire', 'Fire', 2, true],
    ]);
    expect(buttons.map((b) => b.label)).toEqual(['Like, 1 person', 'Love, 0 people', 'Strong, 1,200 people', 'Fire, 2 people, including you']);
  });

  it('heads the names staff see, and says how many are not listed', () => {
    const [like, , strong] = reactionButtons(post({ reactions: { like: 1, love: 0, strong: 1200, fire: 0 } }));
    expect(reactorsTitle(like)).toBe('Like · 1 person');
    expect(reactorsTitle(strong)).toBe('Strong · 1,200 people');
    expect(reactorsMore({ total: 2, people: [{}, {}] })).toBeNull();
    expect(reactorsMore({ total: 1200, people: Array.from({ length: 100 }, () => ({})) })).toBe('and 1,100 more');
  });

  it.each([
    // mine before, tapped, mine after, counts after
    [null, 'like', 'like', { like: 3, love: 0, strong: 1, fire: 0 }],
    ['like', 'like', null, { like: 1, love: 0, strong: 1, fire: 0 }],
    ['like', 'fire', 'fire', { like: 1, love: 0, strong: 1, fire: 1 }],
    ['strong', 'love', 'love', { like: 2, love: 1, strong: 0, fire: 0 }],
  ])('mine %s, tapped %s: mine %s', (mine, tapped, after, counts) => {
    const before = post({ reactions: { like: 2, love: 0, strong: 1, fire: 0 }, mine });
    const next = withReaction(before, tapped);
    expect(next.mine).toBe(after);
    expect(next.reactions).toEqual(counts);
    // The post handed in is not changed: a failed tap puts it back.
    expect(before.reactions).toEqual({ like: 2, love: 0, strong: 1, fire: 0 });
  });

  it('never counts below nothing when the server’s number was already behind', () => {
    const next = withReaction(post({ mine: 'like' }), 'like');
    expect(next.reactions.like).toBe(0);
  });
});

describe('what a member reads where the posts would be', () => {
  it.each([
    [feed({ status: 'paused' }), "Iron House's updates aren't showing at the moment."],
    [feed(), "Iron House hasn't posted anything yet."],
    [feed({ posts: [post()] }), null],
    [feed({ pinned: [post()] }), null],
  ])('%#', (given, line) => {
    expect(emptyLine(given)).toBe(line);
  });
});

describe('the post form', () => {
  it('counts the characters left, and how far over', () => {
    expect(charsLine('')).toEqual({ over: false, text: '2,000 characters left' });
    expect(charsLine('a'.repeat(GYM_POST_MAX_CHARS))).toEqual({ over: false, text: '0 characters left' });
    expect(charsLine('a'.repeat(GYM_POST_MAX_CHARS + 12))).toEqual({ over: true, text: '12 characters too many' });
  });

  // An emoji is one character here and on the server, though a string holds it as two units:
  // the server's own schema is asked the same strings.
  it.each([
    [10, { over: false, text: '0 characters left' }, true],
    [11, { over: true, text: '1 character too many' }, false],
  ])('1,990 letters and %i emoji', (emoji, line, taken) => {
    const body = 'a'.repeat(1990) + String.fromCodePoint(0x1f4aa).repeat(emoji);
    expect(body.length).toBe(1990 + emoji * 2);
    expect(charsLine(body)).toEqual(line);
    expect(canPost(body, [])).toBe(taken);
    expect(addGymPostRequestSchema.safeParse({ postKey: '11111111-1111-4111-8111-111111111111', body, photos: [] }).success).toBe(taken);
    expect(gymPostSchema.safeParse(post({ id: '11111111-1111-4111-8111-111111111111', body })).success).toBe(taken);
  });

  it.each([
    ['', [], false],
    ['   \n ', [], false],
    ['Hello', [], true],
    ['', ['photo'], true],
    ['a'.repeat(GYM_POST_MAX_CHARS + 1), [], false],
    ['a'.repeat(GYM_POST_MAX_CHARS + 1), ['photo'], false],
  ])('Post for %j with %j photos: %s', (body, photos, may) => {
    expect(canPost(body, photos)).toBe(may);
  });

  it('takes photos up to four and says how many were left out', () => {
    expect(addPostPhotos(['a'], ['b', 'c'])).toEqual({ photos: ['a', 'b', 'c'], left: 0 });
    expect(addPostPhotos(['a', 'b', 'c'], ['d', 'e', 'f'])).toEqual({ photos: ['a', 'b', 'c', 'd'], left: 2 });
    expect(addPostPhotos(['a', 'b', 'c', 'd'], ['e'])).toEqual({ photos: ['a', 'b', 'c', 'd'], left: 1 });
  });

  it('names the photos that could not be added', () => {
    expect(photoProblem({ unreadable: [], tooBig: [], left: 0 })).toBeNull();
    expect(photoProblem({ unreadable: ['notes.pdf'], tooBig: ['wall.png', 'floor.png'], left: 1 })).toBe(
      "We couldn't open “notes.pdf”. Choose a JPEG, PNG or WebP photo. “wall.png” and “floor.png” are too large even made smaller. Choose a smaller photo. A post holds up to 4 photos, so 1 photo was not added.",
    );
    expect(photoProblem({ unreadable: [], tooBig: [], left: 3 })).toBe('A post holds up to 4 photos, so 3 photos were not added.');
  });
});

describe('the box before a post is removed', () => {
  it.each([
    [0, "The post will disappear for every one of your members and for your staff. This can't be undone."],
    [1, "The post and its photo will disappear for every one of your members and for your staff. This can't be undone."],
    [3, "The post and its 3 photos will disappear for every one of your members and for your staff. This can't be undone."],
  ])('with %i photos', (n, line) => {
    const box = removeBox(post({ photos: Array.from({ length: n }, (_, i) => ({ id: `ph${i}`, width: 1, height: 1 })) }), WORDS);
    expect(box).toEqual({ title: 'Remove this post?', line, confirm: 'Remove post', cancel: 'Keep post' });
  });

  it('uses the organisation’s own word for its people', () => {
    expect(removeBox(post(), { people: 'clients' }).line).toContain('every one of your clients');
  });
});

describe('pinning', () => {
  it('is offered until three are pinned; a pinned post can always be unpinned', () => {
    expect(pinNote(post(), 2)).toBeNull();
    expect(pinNote(post(), 3)).toBe('You can pin up to 3 posts. Unpin one to pin this.');
    expect(pinNote(post({ pinned: true }), 3)).toBeNull();
  });
});

describe('the list as it changes', () => {
  it('adds a page without showing a post twice', () => {
    const first = feed({ pinned: [post({ id: 'pin' })], posts: [post({ id: 'a' }), post({ id: 'b' })], next: 'cursor-1' });
    const next = withPage(first, feed({ posts: [post({ id: 'b' }), post({ id: 'pin' }), post({ id: 'c' })], next: null }));
    expect(next.posts.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(next.pinned.map((p) => p.id)).toEqual(['pin']);
    expect(next.next).toBeNull();
  });

  it('takes a removed post out, pinned or not', () => {
    const given = feed({ pinned: [post({ id: 'pin' })], posts: [post({ id: 'a' }), post({ id: 'b' })], next: 'cursor-1' });
    expect(withoutPost(given, 'a').posts.map((p) => p.id)).toEqual(['b']);
    expect(withoutPost(given, 'pin').pinned).toEqual([]);
    expect(withoutPost(given, 'pin').next).toBe('cursor-1');
  });

  // id, when it was posted
  const at = (id, hour, over = {}) => post({ id, createdAt: `2026-10-07T${hour}:00:00.000Z`, ...over });
  it.each([
    // what the server answered, the pinned ids after, the other ids after
    ['pinning one puts it first among the pinned', at('b', '08', { pinned: true }), ['b', 'p'], ['a', 'c']],
    ['unpinning puts it back by when it was posted', at('p', '08', { pinned: false }), [], ['a', 'p', 'b', 'c']],
    ['unpinning the newest puts it first', at('p', '12', { pinned: false }), [], ['p', 'a', 'b', 'c']],
    ['unpinning one older than every post loaded, with more to come, leaves it for its own page', at('p', '01', { pinned: false }), [], ['a', 'b', 'c']],
  ])('%s', (_what, answer, pinned, others) => {
    const given = feed({ pinned: [at('p', '08', { pinned: true })], posts: [at('a', '09'), at('b', '08'), at('c', '07')], next: 'cursor-1' });
    const next = withPinChange(given, answer);
    expect(next.pinned.map((p) => p.id)).toEqual(pinned);
    expect(next.posts.map((p) => p.id)).toEqual(others);
  });

  it('unpinning the oldest post of a list that is all loaded puts it last', () => {
    const given = feed({ pinned: [at('p', '01', { pinned: true })], posts: [at('a', '09')], next: null });
    expect(withPinChange(given, at('p', '01', { pinned: false })).posts.map((p) => p.id)).toEqual(['a', 'p']);
  });

  // A place in the list is the last answer's `next`, handed back as it came.
  it.each([
    ['2026-10-07T06:30:00.000Z_11111111-1111-4111-8111-111111111111', true],
    ['yesterday', false],
    ['2026-13-45T99:99:99Z_------------------------------------', false],
    ['2026-10-07T::::Z_11111111-1111-4111-8111-111111111111', false],
    ['0000-01-01T00:00:00Z_11111111-1111-4111-8111-111111111111', false],
    ['1970-01-01T00:00:00Z_11111111-1111-4111-8111-111111111111', true],
  ])('the place %s is read: %s', (before, read) => {
    expect(gymPostsQuerySchema.safeParse({ before }).success).toBe(read);
  });

  it('changes one post in place, pinned or not', () => {
    const given = feed({ pinned: [post({ id: 'pin' })], posts: [post({ id: 'a' }), post({ id: 'b' })] });
    const next = withPost(given, post({ id: 'pin', mine: 'fire' }));
    expect(next.pinned[0].mine).toBe('fire');
    expect(withPost(given, post({ id: 'b', body: 'changed' })).posts.map((p) => p.body)).toEqual(['New squat racks arrive Monday', 'changed']);
  });
});

describe('a member’s own post', () => {
  it('is never taken for the gym’s word: staff posts are marked, a member’s is not', () => {
    expect(authorTag(post())).toBe('Staff');
    expect(authorTag(post({ fromMember: true }))).toBeNull();
    // A staff post with no name shows the gym's own name, so it needs no mark.
    expect(authorTag(post({ author: { name: null, initials: '' } }))).toBeNull();
  });

  it('a member with no name to show is "A member", never the gym', () => {
    const nameless = post({ fromMember: true, author: { name: null, initials: '' } });
    expect(authorName(nameless, 'Iron House')).toBe('A member');
    expect(authorInitials(nameless, 'Iron House')).toBe('M');
    expect(authorName(post({ author: { name: null, initials: '' } }), 'Iron House')).toBe('Iron House');
  });

  it.each([
    ['on', 'shown', true, null],
    ['off', 'shown', false, null],
    ['stopped', 'shown', false, 'The staff at Iron House have stopped you posting here. Speak to them at the front desk.'],
    ['on', 'paused', false, null],
  ])('posting %s on a page that is %s: the box is %s', (posting, status, box, note) => {
    const f = feed({ posting, status });
    expect(memberCanPost(f)).toBe(box);
    expect(stoppedNote(f)).toBe(note);
  });

  it('an empty page invites the first post only where a member can write one', () => {
    expect(emptyLine(feed({ posting: 'on' }))).toBe('No posts yet. Write the first one.');
    expect(emptyLine(feed({ posting: 'stopped' }))).toBe("Iron House hasn't posted anything yet.");
    expect(emptyLine(feed({ posting: 'on', posts: [post()] }))).toBeNull();
  });

  it('says who sees a post and the day’s limit', () => {
    expect(memberPostHint('Iron House')).toBe(
      'Everyone at Iron House in the app sees it straight away. You can post 10 times in any 24 hours, 3 of them with photos. Where a photo was taken is never kept.',
    );
  });

  it('a new post goes to the top of the unpinned ones, once', () => {
    const f = feed({ pinned: [post({ id: 'pin', pinned: true })], posts: [post({ id: 'a' })] });
    const made = post({ id: 'new' });
    const once = withNewPost(f, made);
    expect(once.posts.map((p) => p.id)).toEqual(['new', 'a']);
    expect(withNewPost(once, made).posts.map((p) => p.id)).toEqual(['new', 'a']);
    expect(once.pinned.map((p) => p.id)).toEqual(['pin']);
  });

  it('the box before removing one’s own post says it goes for everyone', () => {
    expect(ownRemoveBox(post({ photos: [{ id: 'x' }, { id: 'y' }] }), 'Iron House')).toEqual({
      title: 'Remove your post?',
      line: "Your post and its 2 photos will disappear for everyone at Iron House. This can't be undone.",
      confirm: 'Remove post',
      cancel: 'Keep post',
    });
  });
});

describe('reporting a post', () => {
  it('offers five reasons in plain words, and says the writer is not told who', () => {
    expect(REPORT_REASONS.map((r) => r.word)).toEqual([
      'Bullying or unkind',
      "A photo of someone who didn't agree to it",
      'Nudity or sexual',
      'Spam or selling',
      'Something else',
    ]);
    const box = reportBox('Iron House');
    expect(box.line).toBe("The staff at Iron House will look at it. The person who posted isn't told who reported it.");
    expect(box.done).toBe('Reported. The staff at Iron House will look at it.');
  });

  const none = { unkind: 0, photo_of_someone: 0, nudity: 0, spam: 0, other: 0 };
  it.each([
    [{ reports: 1, reasons: { ...none, spam: 1 } }, 'Reported by 1 person: Spam or selling'],
    [{ reports: 3, reasons: { ...none, unkind: 2, other: 1 } }, 'Reported by 3 people: Bullying or unkind (2) · Something else (1)'],
    [{ reports: 1200, reasons: { ...none, nudity: 1200 } }, 'Reported by 1,200 people: Nudity or sexual (1,200)'],
  ])('staff read how many reported a post and why, never who: %#', (item, line) => {
    expect(reportedLine(item)).toBe(line);
  });

  it.each([
    ['', { over: false, text: '300 characters left' }],
    ['  spaces around do not count  ', { over: false, text: '274 characters left' }],
    ['a'.repeat(299), { over: false, text: '1 character left' }],
    ['a'.repeat(290) + String.fromCodePoint(0x1f4aa).repeat(10), { over: false, text: '0 characters left' }],
    ['a'.repeat(301), { over: true, text: '1 character too many' }],
  ])('what a member types with a report has 300 characters, counted as the server counts: %#', (note, line) => {
    expect(reportNoteLine(note)).toEqual(line);
  });

  it('staff read what reporters typed under a heading that fits how many wrote', () => {
    expect(reportNotesTitle({ notes: [] })).toBeNull();
    expect(reportNotesTitle({ notes: ['x'] })).toBe('What the person who reported it wrote:');
    expect(reportNotesTitle({ notes: ['x', 'y'] })).toBe('What people who reported it wrote:');
  });

  it.each([
    [{ own: true, wrote: true }, 'remove'],
    [{ own: false, wrote: false, reported: false }, 'report'],
    [{ own: false, wrote: false, reported: true }, 'reported'],
    // Staff who also train, reading a post they wrote for the gym: neither.
    [{ own: false, wrote: true }, null],
  ])('what a member may press on a post: %#', (over, action) => {
    expect(memberPostAction(post(over))).toBe(action);
  });

  it('Keep says so when a report arrived while staff were looking', () => {
    expect(keepNote({ kept: true, waiting: 0 })).toBe('Kept. The post stays on Updates and has left this list.');
    expect(keepNote({ kept: false, waiting: 1 })).toBe(
      '1 more person reported this post while you were looking, so it is still on this list. Read what is new, then choose again.',
    );
    expect(keepNote({ kept: false, waiting: 3 })).toContain('3 more people reported this post');
  });

  it('a hidden post says so to its writer and to staff, and to nobody about a post that is not', () => {
    expect(hiddenOwnNote(post({ hidden: true }), 'Iron House')).toBe('Hidden from other members while the staff at Iron House check it.');
    expect(hiddenOwnNote(post(), 'Iron House')).toBeNull();
    expect(hiddenStaffNote(post({ hidden: true }), WORDS, 'list')).toBe('Hidden from your members: 5 or more people reported it. Keep post shows it to them again.');
    expect(hiddenStaffNote(post({ hidden: true }), { people: 'clients' }, 'later')).toBe(
      'Hidden from your clients: 5 or more people reported it. It will show in the reported posts above once you have answered the ones before it.',
    );
    // The reported list could not be read: nothing is said about where the post is.
    expect(hiddenStaffNote(post({ hidden: true }), WORDS, null)).toBe('Hidden from your members: 5 or more people reported it.');
    expect(hiddenStaffNote(post(), WORDS, 'list')).toBeNull();
    expect(reportedHelp(WORDS)).toContain('A post 5 people have reported is hidden from your members until you choose.');
    expect(keepNote({ kept: true, waiting: 0 }, post({ hidden: true }), WORDS)).toBe('Kept. Your members can see the post again, and it has left this list.');
    expect(keepNote({ kept: true, waiting: 0 }, post(), WORDS)).toBe('Kept. The post stays on Updates and has left this list.');
    expect(keepNote({ kept: false, waiting: 1 }, post({ hidden: true }), WORDS)).toContain('1 more person reported this post');
  });

  it('a hidden post is drawn once: the reported list says which, and one it does not carry stays below', () => {
    const list = feed({ pinned: [post({ id: 'a' })], posts: [post({ id: 'b', hidden: true }), post({ id: 'c' }), post({ id: 'd' })] });
    const ids = (reported) => postsBelow(list, reported).map((p) => p.id);
    const item = (id, hidden) => ({ post: post({ id, hidden }) });
    // a: hidden since the page was read, which only the reported list knows.
    expect(ids({ items: [item('a', true), item('c', false)] })).toEqual(['b', 'c', 'd']);
    expect(ids({ items: [item('b', true)] })).toEqual(['a', 'c', 'd']);
    expect(ids({ items: [] })).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(null)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('Keep takes the hidden mark off that post alone', () => {
    const list = feed({ pinned: [post({ id: 'a', hidden: true })], posts: [post({ id: 'b', hidden: true })] });
    const kept = withKept(list, 'a');
    expect(kept.pinned[0].hidden).toBe(false);
    expect(kept.posts[0].hidden).toBe(true);
  });

  it('a post without the hidden mark is not a post the screens accept', () => {
    const old = post({ id: '7f0c6f0e-5a0b-4a52-9f0e-3d1f6f0c2a11' });
    delete old.hidden;
    expect(gymPostSchema.safeParse(old).success).toBe(false);
    expect(gymPostSchema.safeParse({ ...old, hidden: true }).success).toBe(true);
  });

  it('says how many reported posts are waiting, and when the list holds only the oldest', () => {
    expect(reportedTitle(1)).toBe('1 reported post to look at');
    expect(reportedTitle(53)).toBe('53 reported posts to look at');
    expect(reportedMore({ total: 2, items: [1, 2] })).toBeNull();
    expect(reportedMore({ total: 53, items: Array.from({ length: 50 }) })).toBe('Showing the 50 that have waited longest. 3 more will show as you answer these.');
  });
});

describe('the console’s tools for members’ posts', () => {
  it('the switch says what it does in each position', () => {
    expect(memberPostsSwitch(false, WORDS)).toMatchObject({
      label: 'Members can post',
      line: 'Only your staff can post. Switch this on to let your members post too.',
      off: 'Members can no longer post. The posts they already made stay until you remove them.',
    });
    expect(memberPostsSwitch(true, WORDS).line).toBe('Your members can post words and photos here. You can remove any post, and stop a person posting.');
  });

  it('the box before stopping a person names them, what changes, and that nobody else does', () => {
    expect(stopBox('Wendy Writer')).toEqual({
      title: 'Stop Wendy Writer posting?',
      line: "Wendy Writer won't be able to post on Updates until you let them again. They can still read and react. Their posts stay until you remove them. They aren't emailed, and nobody else changes.",
      confirm: 'Stop Wendy Writer posting',
      cancel: 'Cancel',
      done: 'Wendy Writer can no longer post.',
      undone: 'Wendy Writer can post again.',
    });
    expect(stopBox(null)).toMatchObject({ title: 'Stop this person posting?', confirm: 'Stop them posting', done: 'They can no longer post.' });
  });

  it('stopping a person marks every post of theirs and nobody else’s', () => {
    const f = feed({
      pinned: [post({ id: 'pin', authorId: 'u1', authorStopped: false })],
      posts: [post({ id: 'a', authorId: 'u2', authorStopped: false }), post({ id: 'b', authorId: 'u1', authorStopped: false }), post({ id: 'c', authorId: null, authorStopped: false })],
    });
    const after = withStopped(f, 'u1', true);
    expect([...after.pinned, ...after.posts].map((p) => [p.id, p.authorStopped])).toEqual([
      ['pin', true],
      ['a', false],
      ['b', true],
      ['c', false],
    ]);
  });
});

describe('a person’s posts on their profile', () => {
  const U = '22222222-2222-4222-8222-222222222222';

  it('a member’s name opens their posts; a post the staff wrote for the gym opens nobody', () => {
    expect(canOpenPerson(post({ fromMember: true, authorId: U }))).toBe(true);
    expect(canOpenPerson(post({ fromMember: false, authorId: null }))).toBe(false);
    // A staff post never opens a person, whatever id rides on it.
    expect(canOpenPerson(post({ fromMember: false, authorId: U }))).toBe(false);
    expect(canOpenPerson(post({ fromMember: true, authorId: null }))).toBe(false);
    expect(canOpenPerson(post({ fromMember: true }))).toBe(false);
  });

  it('names the person the profile opens for, and one with no name as “A member”', () => {
    expect(personOf(post({ fromMember: true, authorId: U }))).toEqual({ userId: U, name: 'Maya O.', initials: 'MO' });
    expect(personOf(post({ fromMember: true, authorId: U, author: { name: null, initials: '' } }))).toEqual({ userId: U, name: 'A member', initials: 'M' });
    expect(personLink(post({ fromMember: true, authorId: U }))).toBe('See what Maya O. has posted');
    expect(personLink(post({ fromMember: true, authorId: U, author: { name: null, initials: '' } }))).toBe('See what this member has posted');
  });

  it('says why a profile has no posts: none made, or the reader blocked them', () => {
    expect(personPostsEmpty('Maya O.', false)).toBe("Maya O. hasn't posted anything.");
    expect(personPostsEmpty('Maya O.', true)).toBe("You've blocked Maya O., so their posts aren't shown. You can unblock them at the bottom of Updates.");
  });

  it('counts the posts over the word for them', () => {
    expect(postsCount(0)).toEqual({ number: '0', label: 'Posts' });
    expect(postsCount(1)).toEqual({ number: '1', label: 'Post' });
    expect(postsCount(10950)).toEqual({ number: '10,950', label: 'Posts' });
  });

  it('heads a person’s posts in the console by name, in the gym’s own word with none', () => {
    expect(staffPersonPosts('Maya Okafor', { person: 'member' })).toEqual({ title: "Maya Okafor's posts", empty: "Maya Okafor hasn't posted anything." });
    expect(staffPersonPosts(null, { person: 'client' })).toEqual({ title: 'Their posts', empty: "This client hasn't posted anything." });
  });
});
