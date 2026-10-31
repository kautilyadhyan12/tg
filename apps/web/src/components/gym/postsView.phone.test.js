import { describe, expect, it } from 'vitest';
import { gymPostsResponseSchema } from '@app/shared';
import * as browser from './postsView';
import * as phone from '../../../../mobile/src/screens/gym/updatesView.ts';

// The phone's Updates says a post with its own copy of these sentences (Stage 5 item 17a). The two never differ: every
// kind of post, read through the server's own shape, gives the same words on both.

const GYM = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const ASHA = 'b1111111-1111-4111-8111-111111111111';
const PHOTO = 'c1111111-1111-4111-8111-111111111111';
const post = (n, over = {}) => ({
  id: `a${String(n).padStart(7, '0')}-1111-4111-8111-111111111111`,
  author: { name: 'Sam Coach', initials: 'SC' },
  body: 'News',
  photos: [],
  pinned: false,
  createdAt: '2026-10-28T09:05:00.000Z',
  reactions: { like: 1, love: 0, strong: 1200, fire: 3 },
  mine: 'fire',
  fromMember: false,
  authorId: null,
  own: false,
  wrote: false,
  reported: false,
  hidden: false,
  commentCount: 0,
  challengeResult: null,
  ...over,
});
const photos = (n) => Array.from({ length: n }, (_, i) => ({ id: PHOTO.replace('c1', `c${i + 1}`), width: 1600, height: 1200 }));
const feed = (posts, over = {}) =>
  gymPostsResponseSchema.parse({ gymId: GYM, gymName: 'Iron House', pinned: [], posts, next: null, status: 'shown', posting: 'off', commenting: 'on', blockedCount: 0, supportEmail: null, ...over });

const posts = feed([
  post(1),
  post(2, { author: { name: null, initials: '' } }),
  post(3, { fromMember: true, authorId: ASHA, author: { name: 'Asha W.', initials: 'AW' } }),
  post(4, { fromMember: true, authorId: ASHA, author: { name: null, initials: '' }, reported: true }),
  post(5, { fromMember: true, authorId: ASHA, own: true, wrote: true, hidden: true, photos: photos(1) }),
  post(6, { fromMember: true, authorId: ASHA, own: true, wrote: true, photos: photos(3) }),
  post(7, { wrote: true, mine: null }),
]).posts;

describe("the phone's Updates says what the browser's says", () => {
  it.each(posts.map((p, i) => [i + 1, p]))('post %i', (_, p) => {
    for (const name of ['authorName', 'authorInitials', 'hiddenOwnNote', 'ownRemoveBox']) {
      expect(phone[name](p, 'Iron House'), name).toEqual(browser[name](p, 'Iron House'));
    }
    const { done, ...blockAsk } = browser.blockBox(p, 'Iron House');
    expect(phone.blockBox(p, 'Iron House')).toEqual({ ...blockAsk, done });
    for (const name of ['authorTag', 'memberPostAction', 'canBlock', 'reactionButtons']) {
      expect(phone[name](p), name).toEqual(browser[name](p));
    }
    for (const tapped of ['like', 'love', 'strong', 'fire']) expect(phone.withReaction(p, tapped)).toEqual(browser.withReaction(p, tapped));
  });

  it("posting: who may, the room left, what can be pressed and where the new post goes", () => {
    for (const over of [{ posting: 'on' }, { posting: 'off' }, { posting: 'stopped' }, { posting: 'on', status: 'paused' }, { posting: 'stopped', status: 'paused' }]) {
      const f = feed(posts.slice(0, 2), over);
      expect(phone.memberCanPost(f)).toEqual(browser.memberCanPost(f));
      expect(phone.stoppedNote(f)).toEqual(browser.stoppedNote(f));
      expect(phone.emptyLine(feed([], over), true)).toEqual(browser.emptyLine(feed([], over), true));
    }
    for (const body of ['', '  ', 'x', 'a'.repeat(2000), 'a'.repeat(2001), '🔥'.repeat(2000), '🔥'.repeat(2001)]) {
      expect(phone.charsLine(body)).toEqual(browser.charsLine(body));
      for (const photos of [[], [{}]]) expect(phone.canPost(body, photos)).toEqual(browser.canPost(body, photos));
    }
    const f = feed(posts.slice(0, 3));
    expect(phone.withNewPost(f, posts[1])).toEqual(browser.withNewPost(f, posts[1]));
    expect(phone.withNewPost(f, posts[4])).toEqual(browser.withNewPost(f, posts[4]));
  });

  it('the boxes, the blocked list and the help line', () => {
    expect(phone.reportBox('Iron House')).toEqual(browser.reportBox('Iron House'));
    expect(phone.REPORT_REASONS).toEqual(browser.REPORT_REASONS);
    for (const note of ['', 'x', 'a'.repeat(300), 'a'.repeat(301), ' 🔥 '.repeat(160)]) expect(phone.reportNoteLine(note)).toEqual(browser.reportNoteLine(note));
    for (const name of [null, 'Asha W.']) expect(phone.unblockedNote(name)).toBe(browser.unblockedNote(name));
    for (const count of [0, 1, 2, 1500]) {
      const list = feed([], { blockedCount: count, supportEmail: count === 0 ? null : 'help@example.org' });
      expect(phone.blockedButton(list)).toBe(browser.blockedButton(list));
      expect(phone.helpLine(list)).toEqual(browser.helpLine(list));
      for (const shown of [0, 1, 200]) expect(phone.blockedMore(list, shown)).toBe(browser.blockedMore(list, shown));
    }
  });

  it('an empty list, where the phone has the box to write in', () => {
    for (const over of [{ status: 'paused' }, { posting: 'off' }, { posting: 'on' }, { posting: 'stopped' }]) {
      const list = feed([], over);
      expect(phone.emptyLine(list, true)).toBe(browser.emptyLine(list));
    }
  });
});
