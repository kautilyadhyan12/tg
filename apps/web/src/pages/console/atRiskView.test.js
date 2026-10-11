import { describe, expect, it } from 'vitest';
import { GYM_COME_BACK_LINES, GYM_NUDGE_PRESETS } from '@app/shared';
import {
  MESSAGE_CHOICES,
  QUIET_CHOICES,
  WEEKS_CHOICES,
  atRiskHeadline,
  atRiskIntro,
  atRiskMore,
  canSeeAtRisk,
  canWriteOwn,
  messageBoxNote,
  ownWordsLeft,
  quoted,
  checkinNote,
  dayAt,
  rowAction,
  rowFacts,
  shortDay,
  shownName,
} from './atRiskView';

const SETTINGS = { quietDays: 14, weeksCame: 2 };
const list = (over = {}) => ({ settings: SETTINGS, today: '2026-10-12', checkin: 'in_use', firstCheckinOn: '2026-06-01', lastCheckinOn: '2026-10-12', total: 0, people: [], ...over });
const person = (over = {}) => ({
  entryId: 'e1',
  userId: 'u1',
  app: 'one',
  name: 'Stan Stopped',
  lastVisitOn: '2026-09-22',
  daysAway: 20,
  weeksCame: 3,
  lastMessage: null,
  messageableAt: null,
  ...over,
});
const NOW = Date.parse('2026-10-12T10:00:00Z');
const opts = { orgType: 'gym', timezone: 'Europe/London', now: NOW };

describe('who may open the page', () => {
  it('whoever may see the gym’s people, and nobody else', () => {
    expect(canSeeAtRisk(['members.read'])).toBe(true);
    expect(canSeeAtRisk(['reports.read', 'org.manage'])).toBe(false);
    expect(canSeeAtRisk(null)).toBe(false);
  });
});

describe('the sentences above the list', () => {
  it('the intro says the gym’s own two numbers, in the gym’s own word for its people', () => {
    expect(atRiskIntro(SETTINGS, 'gym')).toBe('Members who used to come and have stopped: they have not come in for 14 days or more, after coming in at least 2 of their last 4 weeks.');
    expect(atRiskIntro({ quietDays: 7, weeksCame: 1 }, 'studio')).toBe('Clients who used to come and have stopped: they have not come in for 7 days or more, after coming in at least 1 of their last 4 weeks.');
  });

  it('the pickers offer exactly the numbers the server takes', () => {
    expect(QUIET_CHOICES.map((c) => c.label)).toEqual(['7 days', '10 days', '14 days', '21 days', '30 days']);
    expect(WEEKS_CHOICES.map((c) => c.label)).toEqual(['1 of their last 4 weeks', '2 of their last 4 weeks', '3 of their last 4 weeks', '4 of their last 4 weeks']);
  });

  it('the count, one or many, and a whole sentence for nobody', () => {
    expect(atRiskHeadline(list({ total: 1 }), 'gym')).toBe('1 member has stopped coming.');
    expect(atRiskHeadline(list({ total: 1204 }), 'gym')).toBe('1,204 members have stopped coming.');
    expect(atRiskHeadline(list({ total: 3 }), 'studio')).toBe('3 clients have stopped coming.');
    // It says nothing about anybody the list holds back.
    expect(atRiskHeadline(list(), 'gym')).toBe('Nobody has stopped coming.');
  });

  it('a list cut short says so', () => {
    expect(atRiskMore(list({ total: 2, people: [person(), person()] }))).toBeNull();
    expect(atRiskMore(list({ total: 312, people: Array.from({ length: 200 }, () => person()) }))).toBe('Showing the first 200 of 312, the most regular first.');
  });
});

describe('what the gym’s own check-ins allow the list to say', () => {
  it('a gym in the habit of checking people in has no note', () => {
    expect(checkinNote(list(), 'Iron House')).toBeNull();
  });

  it('nobody was ever checked in: the reason, and no list', () => {
    const note = checkinNote(list({ checkin: 'none', firstCheckinOn: null, lastCheckinOn: null }), 'Iron House');
    expect(note).toMatchObject({ kind: 'none', showList: false });
    expect(note.line).toBe('This list is worked out from who comes in, and nobody has been checked in at Iron House yet. Once people are checked in at the front desk or by staff, anybody who stops coming is listed here.');
  });

  it('check-in has only just begun: the day the list can start, by the gym’s own number', () => {
    const note = checkinNote(list({ checkin: 'new', firstCheckinOn: '2026-10-07' }), 'Iron House');
    expect(note).toMatchObject({ kind: 'new', showList: false });
    expect(note.line).toBe('Check-in started on 7 Oct. This list can show who has stopped coming from 21 Oct, once there are 14 days of check-ins.');
  });

  it('check-in has stopped: said in days against the gym’s own usual, above a list that has somebody on it', () => {
    const note = checkinNote(list({ checkin: 'stopped', lastCheckinOn: '2026-10-11', checkinDaysLately: 2, total: 1, people: [person()] }), 'Iron House');
    expect(note).toMatchObject({ kind: 'stopped', showList: true });
    expect(note.line).toBe('People came in on only 2 of the last 14 days, far fewer than is usual at Iron House. The last day anybody came in was 11 Oct. Anybody who stopped coming in that time is not listed, because the list cannot tell them from everybody else.');
  });

  it('check-in has stopped and nobody is listed: the note is the whole answer, and no list is drawn', () => {
    const note = checkinNote(list({ checkin: 'stopped', lastCheckinOn: '2026-09-22', checkinDaysLately: 0 }), 'Iron House');
    expect(note).toMatchObject({ kind: 'stopped', showList: false });
    expect(note.line).toBe('Nobody came in over the last 14 days. The last day anybody came in was 22 Sep. Anybody who stopped coming in that time is not listed, because the list cannot tell them from everybody else.');
  });
});

describe('one row', () => {
  it('its two facts', () => {
    expect(rowFacts(person())).toEqual({ last: 'Last came in 22 Sep, 20 days ago', regular: 'Came in 3 of their last 4 weeks' });
  });

  it('a record with no name is still a row', () => {
    expect(shownName(person(), 'gym')).toEqual({ full: 'Stan Stopped', first: 'Stan' });
    expect(shownName(person({ name: '  ' }), 'gym')).toEqual({ full: 'Member with no name', first: 'this member' });
  });

  it('somebody in the app who was never messaged can be', () => {
    expect(rowAction(person(), opts)).toEqual({ kind: 'send', disabled: false, earlier: null });
  });

  it('at a gym on no plan the button is drawn and cannot be pressed', () => {
    expect(rowAction(person(), { ...opts, readOnly: true })).toMatchObject({ kind: 'send', disabled: true });
  });

  it('a message sent in the last 7 days is said with its words, and the day another may go', () => {
    const sent = person({ lastMessage: { preset: 'miss_you', sentAt: '2026-10-10T09:00:00Z' }, messageableAt: '2026-10-17T09:00:00Z' });
    expect(rowAction(sent, opts)).toEqual({ kind: 'sent', line: 'Sent “We miss you — hope to see you soon.” on 10 Oct. You can send another from 17 Oct.' });
    // A line this page has no words for is still said to have gone.
    expect(rowAction({ ...sent, lastMessage: { preset: 'new_line', sentAt: '2026-10-10T09:00:00Z' } }, opts).line).toBe('A message was sent on 10 Oct. You can send another from 17 Oct.');
  });

  it('the gym’s own words are quoted on the row as a ready-made line is, a long message by its start', () => {
    const own = person({ lastMessage: { preset: null, body: 'Hi Stan, we saved your Tuesday spot.', sentAt: '2026-10-10T09:00:00Z' }, messageableAt: '2026-10-13T09:00:00Z' });
    expect(rowAction(own, opts)).toEqual({ kind: 'sent', line: 'Sent “Hi Stan, we saved your Tuesday spot.” on 10 Oct. You can send another from 13 Oct.' });
    const long = 'word '.repeat(60);
    expect(quoted(long).length).toBeLessThanOrEqual(118);
    expect(quoted(long).endsWith('…')).toBe(true);
    expect(quoted('  two\n lines  ')).toBe('two lines');
  });

  it('who may write their own words, what the box says, and how many characters are left', () => {
    expect(canWriteOwn(['members.read', 'members.confirm'])).toBe(true);
    expect(canWriteOwn(['members.read'])).toBe(false);
    expect(messageBoxNote('Stan')).toBe("Pick one message for Stan. They see it in their Inbox in the app. They can't reply to it.");
    expect(messageBoxNote('Stan', true)).toBe("Pick one message for Stan, or write your own. They see it in their Inbox in the app. They can't reply to it.");
    expect(ownWordsLeft('')).toEqual({ left: 500, ok: false, line: '500 characters left' });
    expect(ownWordsLeft('   ')).toMatchObject({ ok: false });
    expect(ownWordsLeft('Hi Stan')).toEqual({ left: 493, ok: true, line: '493 characters left' });
    expect(ownWordsLeft('x'.repeat(503))).toEqual({ left: -3, ok: false, line: '3 characters too many' });
    expect(ownWordsLeft('x'.repeat(499)).line).toBe('1 character left');
    expect(ownWordsLeft('x'.repeat(501)).line).toBe('1 character too many');
  });

  it('once the wait has passed the button is back, with the day of the earlier one', () => {
    const old = person({ lastMessage: { preset: 'door_open', sentAt: '2026-10-01T09:00:00Z' }, messageableAt: null });
    expect(rowAction(old, opts)).toEqual({ kind: 'send', disabled: false, earlier: 'Last message sent on 1 Oct.' });
    const passed = person({ lastMessage: { preset: 'door_open', sentAt: '2026-10-05T09:00:00Z' }, messageableAt: '2026-10-12T09:00:00Z' });
    expect(rowAction(passed, opts).kind).toBe('send');
  });

  it('nobody with no app, and no shared record, is offered a message', () => {
    expect(rowAction(person({ app: 'none', userId: null }), opts)).toEqual({
      kind: 'no_app',
      line: "Not in the app, so Stan can't be messaged here. Their phone and email are on their page.",
    });
    expect(rowAction(person({ app: 'shared', userId: null }), opts)).toEqual({
      kind: 'shared',
      line: 'More than one person uses this record in the app, so a message cannot go to one of them. Their phone and email are on their page.',
    });
    expect(rowAction(person({ app: 'one', userId: null }), opts).kind).toBe('shared');
  });
});

describe('days and messages', () => {
  it('a day reads as a day', () => {
    expect(shortDay('2026-09-02')).toBe('2 Sep');
    expect(shortDay('soon')).toBe('soon');
  });

  it('a moment is a day on the gym’s own calendar', () => {
    expect(dayAt('2026-10-16T20:00:00Z', 'Asia/Kolkata')).toBe('17 Oct');
    expect(dayAt('2026-10-16T20:00:00Z', 'Europe/London')).toBe('16 Oct');
    expect(dayAt('2026-10-16T20:00:00Z', 'Not/AZone')).toBe('16 Oct');
    expect(dayAt('never', 'Europe/London')).toBeNull();
  });

  it('every line the server can send has its words here, in the server’s order', () => {
    expect(MESSAGE_CHOICES.map((c) => c.preset)).toEqual([...GYM_NUDGE_PRESETS]);
    expect(MESSAGE_CHOICES.map((c) => c.text)).toEqual(GYM_NUDGE_PRESETS.map((p) => GYM_COME_BACK_LINES[p]));
  });
});
