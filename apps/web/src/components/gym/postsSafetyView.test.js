// BLOCK AND THE HELP LINE, IN WORDS (spec Part 3 §15.3; ROADMAP 19b-ii-b).
import { describe, expect, it } from 'vitest';
import { blockBox, blockedButton, canBlock, helpLine, unblockedNote } from './postsView';

const post = (over = {}) => ({ author: { name: 'Barry B.', initials: 'BB' }, photos: [], fromMember: true, own: false, wrote: false, ...over });

describe('Block', () => {
  it.each([
    [{}, true],
    // The gym's own post and the reader's own: no Block.
    [{ fromMember: false }, false],
    [{ own: true, wrote: true }, false],
    [{ fromMember: false, wrote: true }, false],
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

describe('the help line', () => {
  it('is drawn only once an address is set', () => {
    expect(helpLine({ supportEmail: null })).toBeNull();
    expect(helpLine({ supportEmail: 'help@example.com' })).toEqual({ text: 'Need help with the app? Email', email: 'help@example.com' });
  });
});
