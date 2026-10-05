// BLOCK, THE BAD-WORDS HOLD AND THE HELP LINE, IN WORDS (spec Part 3 §15.3; ROADMAP 19b-ii-b).
import { describe, expect, it } from 'vitest';
import {
  allowedNote,
  blockBox,
  blockedButton,
  canBlock,
  heldIntro,
  heldLine,
  heldMore,
  heldNote,
  heldRemoveBox,
  heldTitle,
  helpLine,
  postedNote,
  unblockedNote,
} from './postsView';

const post = (over = {}) => ({ author: { name: 'Barry B.', initials: 'BB' }, photos: [], fromMember: true, own: false, wrote: false, held: false, ...over });
const WORDS = { people: 'members', peopleCap: 'Members' };

describe('Block', () => {
  it.each([
    [{}, true],
    // The gym's own post, the reader's own, and one waiting for staff: no Block.
    [{ fromMember: false }, false],
    [{ own: true, wrote: true }, false],
    [{ fromMember: false, wrote: true }, false],
    [{ own: true, wrote: true, held: true }, false],
  ])('is offered on another member\'s post only: %o', (over, offered) => {
    expect(canBlock(post(over))).toBe(offered);
  });

  it('the box names who changes, who is not told, and where to undo it', () => {
    expect(blockBox(post(), 'Iron House')).toEqual({
      title: 'Block Barry B.?',
      line: "You won't see Barry B.'s posts or reactions at Iron House any more. They aren't told, and nothing changes for anyone else. You can unblock them at the bottom of Updates.",
      confirm: 'Block Barry B.',
      cancel: 'Cancel',
      done: "Blocked. You won't see Barry B.'s posts or reactions any more.",
    });
    const nameless = blockBox(post({ author: { name: null, initials: '' } }), 'Iron House');
    expect(nameless.title).toBe('Block this member?');
    expect(nameless.confirm).toBe('Block this member');
    expect(nameless.line).toContain("this member's posts or reactions");
  });

  it('the list button says how many, and is not there with nobody blocked', () => {
    expect(blockedButton({ blockedCount: 0 })).toBeNull();
    expect(blockedButton({ blockedCount: 1 })).toBe("People you've blocked (1)");
    expect(blockedButton({ blockedCount: 12 })).toBe("People you've blocked (12)");
  });

  it('says what Unblock did', () => {
    expect(unblockedNote('Barry B.')).toBe("Unblocked. You'll see Barry B.'s posts and reactions again.");
    expect(unblockedNote(null)).toBe("Unblocked. You'll see their posts and reactions again.");
  });
});

describe('a post waiting for staff', () => {
  it('its writer is told who sees it, on the post and after posting', () => {
    expect(heldNote('Iron House')).toBe('Waiting for the staff at Iron House to check it. Only you can see it until they do.');
    expect(postedNote(post({ held: true }), 'Iron House')).toBe('Your post is waiting for the staff at Iron House to check it. Only you can see it until they do.');
    expect(postedNote(post(), 'Iron House')).toBe('Posted. Everyone at Iron House can see it now.');
  });

  it('staff read how many wait, why each waits, and what each button does', () => {
    expect(heldTitle(1)).toBe('1 post waiting for you to check');
    expect(heldTitle(1200)).toBe('1,200 posts waiting for you to check');
    expect(heldIntro(WORDS)).toBe(
      'A post by one of your members with a word on the bad-words list waits here. Only you and the person who wrote it can see it. Allow it and every one of your members sees it; remove it and it is deleted.',
    );
    expect(heldLine({ words: ['tosser'] })).toBe('Held for the word: tosser');
    expect(heldLine({ words: ['tosser', 'paki'] })).toBe('Held for the words: tosser, paki');
    expect(heldLine({ words: [] })).toBe('Held by the bad-words check.');
    expect(heldMore({ total: 2, items: [1, 2] })).toBeNull();
    expect(heldMore({ total: 53, items: Array.from({ length: 50 }) })).toBe('Showing the 50 that have waited longest. 3 more will show as you answer these.');
    expect(allowedNote(WORDS)).toBe('Allowed. Your members can see the post now.');
  });

  it('the remove box says nobody else saw it', () => {
    expect(heldRemoveBox(post())).toEqual({
      title: 'Remove this post?',
      line: "The post will be deleted. Only the person who wrote it could see it. They aren't emailed. This can't be undone.",
      confirm: 'Remove post',
      cancel: 'Keep it waiting',
    });
    expect(heldRemoveBox(post({ photos: [1, 2] })).line).toContain('The post and its 2 photos will be deleted.');
  });
});

describe('the help line', () => {
  it('is drawn only once an address is set', () => {
    expect(helpLine({ supportEmail: null })).toBeNull();
    expect(helpLine({ supportEmail: 'help@example.com' })).toEqual({ text: 'Need help with the app? Email', email: 'help@example.com' });
  });
});
