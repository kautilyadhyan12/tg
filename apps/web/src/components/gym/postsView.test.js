import { describe, expect, it } from 'vitest';
import { GYM_POST_MAX_CHARS, ROLE_PRIVILEGES } from '@app/shared';
import {
  addPostPhotos,
  authorInitials,
  authorName,
  canManagePosts,
  canPost,
  charsLine,
  emptyLine,
  photoProblem,
  pinNote,
  postedText,
  reactionButtons,
  reactionSummary,
  removeBox,
  withPage,
  withPost,
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
  ...over,
});
const feed = (over = {}) => ({ gymId: 'g1', gymName: 'Iron House', status: 'shown', pinned: [], posts: [], next: null, ...over });
const WORDS = { people: 'members' };

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

  it('are summed up for staff in words', () => {
    expect(reactionSummary(post())).toBe('No reactions yet');
    expect(reactionSummary(post({ reactions: { like: 3, love: 0, strong: 1, fire: 0 } }))).toBe('Like 3 · Strong 1');
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

  it('changes one post in place, pinned or not', () => {
    const given = feed({ pinned: [post({ id: 'pin' })], posts: [post({ id: 'a' }), post({ id: 'b' })] });
    const next = withPost(given, post({ id: 'pin', mine: 'fire' }));
    expect(next.pinned[0].mine).toBe('fire');
    expect(withPost(given, post({ id: 'b', body: 'changed' })).posts.map((p) => p.body)).toEqual(['New squat racks arrive Monday', 'changed']);
  });
});
