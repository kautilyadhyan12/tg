// What the member's inbox says (spec Part 3 §16.1; ROADMAP 20a), without a browser.
import { describe, expect, it } from 'vitest';
import { GYM_NUDGE_PRESETS } from '@app/shared';
import { INBOX_NOTE, emptyInbox, inboxTabName, messageRow, pausedInbox, pinnedNote, unreadBadge } from './inboxView';

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
