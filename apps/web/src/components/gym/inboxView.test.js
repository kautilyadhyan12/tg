// What the member's inbox says (spec Part 3 §16.1; ROADMAP 20a), without a browser.
import { describe, expect, it } from 'vitest';
import { GYM_NUDGE_PRESETS } from '@app/shared';
import { INBOX_NOTE, contactButton, contactSetUp, contactView, emptyInbox, gymButtonName, hasNewMessages, inboxTabName, messageRow, pausedInbox, pinnedNote, unreadBadge } from './inboxView';

const NOW = Date.parse('2026-10-09T12:00:00.000Z');
const ago = (hours) => new Date(NOW - hours * 3_600_000).toISOString();

describe('the Inbox tab', () => {
  it('shows a count only when something is new', () => {
    expect([0, -1, 1.5, null, undefined, 'two'].map(unreadBadge)).toEqual([null, null, null, null, null, null]);
    expect([1, 9, 99, 100, 250].map(unreadBadge)).toEqual(['1', '9', '99', '99+', '99+']);
  });

  it('is named for a screen reader with how many are new', () => {
    expect([0, 1, 2, 120].map(inboxTabName)).toEqual(['Inbox', 'Inbox, 1 new message', 'Inbox, 2 new messages', 'Inbox, 99+ new messages']);
  });
});

describe("the menu's dot and a gym's button (20a-ii)", () => {
  it('the dot is lit when any gym has a new message, and by nothing else', () => {
    expect(hasNewMessages([{ id: 'g1', newMessages: 0 }, { id: 'g2', newMessages: 3 }])).toBe(true);
    expect(hasNewMessages([{ id: 'g1', newMessages: 0 }, { id: 'g2' }])).toBe(false);
    // A server too old to send the count, a count that is not one, and no list at all.
    for (const gyms of [[], null, undefined, 'g1', [null], [{ id: 'g1', newMessages: '2' }], [{ id: 'g1', newMessages: -1 }]]) {
      expect(hasNewMessages(gyms)).toBe(false);
    }
  });

  it("a gym's button is named with how many are new", () => {
    expect([undefined, 0, 1, 2, 120].map((n) => gymButtonName('Iron House', n))).toEqual([
      'Iron House',
      'Iron House',
      'Iron House, 1 new message',
      'Iron House, 2 new messages',
      'Iron House, 99+ new messages',
    ]);
  });
});

describe('the pinned note', () => {
  const cheer = (hours, preset = 'on_a_roll') => ({ preset, sentAt: ago(hours) });
  const comeBack = (hours, preset = 'miss_you') => ({ preset, sentAt: ago(hours) });

  it('is nothing for a gym that sent neither', () => {
    expect(pinnedNote({ latestCheer: null, latestNudge: null }, NOW)).toBeNull();
    expect(pinnedNote({}, NOW)).toBeNull();
    expect(pinnedNote(null, NOW)).toBeNull();
  });

  it('is the newer of the cheer and the come-back line: a new one replaces the old', () => {
    expect(pinnedNote({ latestCheer: cheer(2), latestNudge: comeBack(30) }, NOW)).toEqual({ text: "You're on a roll.", when: '2 hours ago' });
    expect(pinnedNote({ latestCheer: cheer(50), latestNudge: comeBack(3) }, NOW)).toEqual({ text: 'We miss you — hope to see you soon.', when: '3 hours ago' });
    expect(pinnedNote({ latestCheer: cheer(5), latestNudge: null }, NOW)?.text).toBe("You're on a roll.");
    expect(pinnedNote({ latestCheer: null, latestNudge: comeBack(5, 'door_open') }, NOW)?.text).toBe("The door's always open when you're ready.");
  });

  it('is gone after seven days, and an older one does not come back in its place', () => {
    expect(pinnedNote({ latestCheer: cheer(7 * 24 - 1), latestNudge: null }, NOW)?.when).toBe('6 days ago');
    expect(pinnedNote({ latestCheer: cheer(7 * 24), latestNudge: null }, NOW)).toBeNull();
    expect(pinnedNote({ latestCheer: cheer(7 * 24), latestNudge: comeBack(9 * 24) }, NOW)).toBeNull();
  });

  it('has words for every come-back line a gym can send, and draws nothing for one it has no words for', () => {
    for (const preset of GYM_NUDGE_PRESETS) expect(pinnedNote({ latestNudge: comeBack(1, preset) }, NOW)?.text, preset).toMatch(/\S/);
    expect(pinnedNote({ latestCheer: cheer(1, 'not_a_line'), latestNudge: comeBack(1, 'toString') }, NOW)).toBeNull();
    expect(pinnedNote({ latestCheer: { preset: 'on_a_roll', sentAt: 'soon' }, latestNudge: { preset: 'miss_you', sentAt: ago(-5) } }, NOW)).toBeNull();
  });
});

describe('a message, and the lines around the list', () => {
  it('is new until it has been read, with how long ago it came', () => {
    const message = { id: 'm1', kind: 'welcome', body: 'Welcome to Iron House, Maya.', sentAt: ago(26), read: false };
    expect(messageRow(message, NOW)).toEqual({ id: 'm1', body: 'Welcome to Iron House, Maya.', when: '1 day ago', isNew: true });
    expect(messageRow({ ...message, read: true, sentAt: ago(0) }, NOW)).toMatchObject({ when: 'just now', isNew: false });
    expect(messageRow({ ...message, sentAt: 'x' }, NOW).when).toBeNull();
  });

  it('says what an empty or a paused inbox is, how long messages stay and that they cannot be answered', () => {
    expect(emptyInbox('Iron House')).toBe('No messages from Iron House yet. When they send you one, it shows up here.');
    expect(pausedInbox('Iron House')).toBe("Iron House isn't sending messages in the app right now.");
    expect(INBOX_NOTE).toBe("Messages stay here for 30 days. You can't reply to them here.");
  });
});

describe('Contact the gym', () => {
  it("is named in the organisation's own word", () => {
    expect(['gym', 'studio', 'personal_trainer', undefined].map(contactButton)).toEqual(['Contact the gym', 'Contact the studio', 'Contact the trainer', 'Contact the gym']);
  });

  it('is a link that calls and a link that writes, each only if the gym added it', () => {
    expect(contactView({ phone: '+44 20 7946 0958', email: 'desk@ironhouse.com' }, 'Iron House')).toEqual({
      ways: [
        { kind: 'phone', label: 'Call +44 20 7946 0958', href: 'tel:+442079460958' },
        { kind: 'email', label: 'Email desk@ironhouse.com', href: 'mailto:desk@ironhouse.com' },
      ],
      none: null,
    });
    expect(contactView({ phone: '(212) 555-0123', email: null }, 'Iron House').ways).toEqual([{ kind: 'phone', label: 'Call (212) 555-0123', href: 'tel:2125550123' }]);
    expect(contactView({ phone: null, email: 'desk@ironhouse.com' }, 'Iron House').ways.map((w) => w.kind)).toEqual(['email']);
    // Written the British way: the label is as typed, and the link drops the zero in brackets.
    expect(contactView({ phone: '+44 (0)20 7946 0958', email: null }, 'Iron House').ways).toEqual([{ kind: 'phone', label: 'Call +44 (0)20 7946 0958', href: 'tel:+442079460958' }]);
  });

  it('whoever may change the gym\'s details is given the place to add them, and nobody else is', () => {
    const gym = { slug: 'iron-house', staffRole: 'owner', privileges: ['org.manage'] };
    expect(contactSetUp(gym)).toBe('/console/iron-house/settings#member-contact');
    expect(contactSetUp({ ...gym, staffRole: 'trainer', privileges: ['members.read'] })).toBeNull();
    expect(contactSetUp({ slug: 'iron-house', staffRole: null, privileges: null })).toBeNull();
    expect(contactSetUp({ slug: 'iron-house' })).toBeNull();
  });

  it('is one plain line, and no way to press, for a gym that added neither or an answer with none', () => {
    const none = { ways: [], none: "Iron House hasn't added a phone number or email yet." };
    for (const contact of [{ phone: null, email: null }, { phone: '  ', email: '' }, {}, null, undefined, { phone: 5 }]) {
      expect(contactView(contact, 'Iron House')).toEqual(none);
    }
  });
});
