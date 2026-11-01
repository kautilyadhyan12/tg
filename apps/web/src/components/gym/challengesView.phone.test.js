import { describe, expect, it } from 'vitest';
import { memberGymChallengeSchema } from '@app/shared';
import * as browser from './challengesView';
import * as phone from '../../../../mobile/src/screens/gym/challengesView.ts';

// The phone's Challenges has its own layout and the browser its own; who won, what place, what number and what a press
// does must be one answer (Stage 5 item 17d). The phone writes a curly apostrophe; that is the only difference allowed.

const straight = (value) => JSON.parse(JSON.stringify(value).replaceAll('’', "'"));

const WHOLE = { about: 'Visits', one: 'visit', many: 'visits', print: 'whole', how: 'desk', howLine: 'Checked in at the front desk', explain: 'A visit counts.', perDay: true };
const OWN = { about: 'Push-ups', one: 'push-up', many: 'push-ups', print: 'whole', how: 'staff', howLine: 'Counted by the staff', explain: 'Staff type it.', perDay: false };
const TIME = { about: 'Time', one: 'second', many: 'seconds', print: 'time', how: 'staff', howLine: 'Timed by the staff', explain: 'Staff type it.', perDay: false };
const KM = { about: 'Distance', one: 'metre', many: 'metres', print: 'km', how: 'staff', howLine: 'Measured by the staff', explain: 'Staff type it.', perDay: false };

const P = (n) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const row = (n, place, value, over = {}) => ({ userId: P(n), name: `Person ${n}`, initials: `P${n}`, place, value, reached: false, isMe: false, ...over });
const board = (over = {}) => ({ status: 'shown', ranked: 24, top: [row(1, 1, 9), row(2, 2, 7), row(3, 3, 5)], leaders: 1, reached: null, ...over });
const me = (over = {}) => ({ value: 4, place: 4, hidden: null, toNextPlace: 2, nextPlace: 3, reached: false, days: ['2026-11-02', '2026-11-04'], ...over });
const team = (n, place, value, over = {}) => ({ id: P(n), name: `Team ${n}`, people: 3, value, place, reached: false, waiting: 0, isMine: false, ...over });
const made = (over = {}) =>
  memberGymChallengeSchema.parse({
    id: P(9),
    name: 'October Six',
    details: '',
    prize: '',
    subject: 'visits',
    measure: null,
    countedBy: 'app',
    exercises: [],
    words: WHOLE,
    startsOn: '2026-11-02',
    endsOn: '2026-11-22',
    target: null,
    who: 'everyone',
    unit: '',
    lowestWins: false,
    teams: 'none',
    cancelled: false,
    state: 'running',
    joined: false,
    can: { join: false, leave: false, pick: false },
    teamBoard: null,
    joinedCount: null,
    board: board(),
    me: me(),
    ...over,
  });

const few = board({ status: 'too_few', ranked: 1, top: [], leaders: 0 });
const notYet = board({ status: 'not_started', ranked: 0, top: [], leaders: 0 });
const teamBoard = (over = {}) => ({ status: 'shown', rows: [team(5, 2, 12), team(6, 1, 20)], mine: null, ...over });
const myTeam = { teamId: P(5), people: [{ userId: P(7), name: 'Me', initials: 'M', value: 4, isMe: true }, { userId: P(1), name: 'Person 1', initials: 'P1', value: 8, isMe: false }], more: 1, counted: true };
const joinTeams = { teams: 'members', who: 'joined', joinedCount: 6, can: { join: false, leave: false, pick: true } };

// Every class of challenge the server sends: alone and in teams; each way to win; each way of printing; each place on the
// calendar; hidden, reached, joint first, nobody in it.
const cases = {
  running: made(),
  'first place': made({ me: me({ place: 1, value: 9, toNextPlace: null, nextPlace: null }) }),
  'one more': made({ me: me({ toNextPlace: 1 }) }),
  hidden: made({ me: me({ hidden: 'hide_me' }) }),
  'under 18': made({ me: me({ hidden: 'under_18' }) }),
  'not in it': made({ who: 'joined', joinedCount: 0, me: null, can: { join: true, leave: false, pick: false } }),
  'one joined': made({ who: 'joined', joinedCount: 1, me: null, can: { join: true, leave: false, pick: false } }),
  'many joined': made({ who: 'joined', joinedCount: 1200, joined: true, can: { join: false, leave: true, pick: false } }),
  'too few': made({ board: few, me: me({ place: null, toNextPlace: null, nextPlace: null }) }),
  target: made({ target: 12, board: board({ reached: 3 }) }),
  reached: made({ target: 12, board: board({ reached: 3 }), me: me({ value: 12, reached: true }) }),
  'over the target, not reached by the server': made({ target: 3, me: me({ value: 3 }) }),
  coming: made({ state: 'coming', startsOn: '2026-11-20', endsOn: '2026-11-30', board: notYet, who: 'joined', joinedCount: 0, me: null, can: { join: true, leave: false, pick: false } }),
  'coming tomorrow': made({ state: 'coming', startsOn: '2026-11-11', endsOn: '2026-11-30', board: notYet, me: me({ value: 0, place: null }) }),
  'last day': made({ endsOn: '2026-11-10' }),
  'three days': made({ endsOn: '2026-11-12' }),
  'next year': made({ endsOn: '2027-02-01' }),
  'one day': made({ startsOn: '2026-11-10', endsOn: '2026-11-10' }),
  'six weeks': made({ startsOn: '2026-10-01', endsOn: '2026-12-20' }),
  cancelled: made({ cancelled: true }),
  own: made({ words: OWN, countedBy: 'staff', unit: 'push-ups' }),
  'own, nothing yet': made({ words: OWN, countedBy: 'staff', me: me({ value: 0, place: null, days: [] }), board: few }),
  'own, joinable': made({ words: OWN, countedBy: 'staff', who: 'joined', joinedCount: 3, me: null, can: { join: true, leave: false, pick: false } }),
  time: made({ words: TIME, countedBy: 'staff', lowestWins: true, me: me({ value: 3725, toNextPlace: 65 }) }),
  'time, short': made({ words: TIME, countedBy: 'staff', lowestWins: true, me: me({ value: 45, toNextPlace: 5 }) }),
  km: made({ words: KM, countedBy: 'staff', target: 12000, me: me({ value: 12449, reached: true }) }),
  'km, short of it': made({ words: KM, countedBy: 'staff', target: 12000, me: me({ value: 11961, toNextPlace: 51 }) }),
  'km, lowest': made({ words: KM, countedBy: 'staff', lowestWins: true, me: me({ value: 5000, toNextPlace: 51 }) }),
  'ended, a winner': made({ state: 'ended', endsOn: '2026-11-09', startsOn: '2026-11-01' }),
  'ended, I won': made({ state: 'ended', endsOn: '2026-11-09', board: board({ top: [row(7, 1, 9, { isMe: true }), row(2, 2, 7)] }), me: me({ place: 1, value: 9 }) }),
  'ended, joint': made({ state: 'ended', endsOn: '2026-11-09', board: board({ leaders: 2, top: [row(1, 1, 9), row(2, 1, 9), row(3, 3, 5)] }) }),
  'ended, joint and more': made({ state: 'ended', endsOn: '2026-11-09', board: board({ leaders: 5, top: [row(1, 1, 9), row(2, 1, 9), row(3, 1, 9)] }) }),
  'ended, hidden': made({ state: 'ended', endsOn: '2026-11-09', me: me({ hidden: 'hide_me' }) }),
  'ended, zero': made({ state: 'ended', endsOn: '2026-11-09', me: me({ value: 0, place: null }) }),
  'ended, staff zero': made({ state: 'ended', endsOn: '2026-11-09', words: OWN, countedBy: 'staff', me: me({ value: 0, place: null }) }),
  'ended, too few': made({ state: 'ended', endsOn: '2026-11-09', board: few }),
  'ended, staff still adding': made({ state: 'ended', endsOn: '2026-11-09', words: OWN, countedBy: 'staff', board: few }),
  'ended, target nobody': made({ state: 'ended', endsOn: '2026-11-09', target: 12, board: board({ reached: 0 }) }),
  'ended, target some': made({ state: 'ended', endsOn: '2026-11-09', target: 12, board: board({ reached: 4 }), me: me({ value: 12, reached: true }) }),
  'ended, target missed': made({ state: 'ended', endsOn: '2026-11-09', target: 12, board: board({ reached: 4 }) }),
  'teams, to pick': made({ ...joinTeams, me: null, teamBoard: teamBoard() }),
  'teams, too few': made({ ...joinTeams, me: null, board: few, teamBoard: teamBoard({ status: 'too_few', rows: [team(5, null, 0), team(6, null, 0, { people: 0 })] }) }),
  'teams, mine': made({ ...joinTeams, joined: true, can: { join: false, leave: true, pick: false }, teamBoard: teamBoard({ rows: [team(5, 2, 12, { isMine: true }), team(6, 1, 20)], mine: myTeam }) }),
  'teams, coming, moving': made({ ...joinTeams, state: 'coming', startsOn: '2026-11-20', joined: true, board: notYet, teamBoard: teamBoard({ status: 'not_started', rows: [team(5, null, 0, { isMine: true }), team(6, null, 0)], mine: myTeam }) }),
  'teams, not counted': made({ ...joinTeams, joined: true, can: { join: false, leave: true, pick: false }, me: me({ hidden: 'hide_me' }), teamBoard: teamBoard({ rows: [team(5, 2, 12, { isMine: true })], mine: { ...myTeam, counted: false } }) }),
  'teams, staff, no team': made({ teams: 'staff', teamBoard: teamBoard() }),
  'teams, lowest, waiting': made({ words: TIME, countedBy: 'staff', lowestWins: true, teams: 'staff', teamBoard: teamBoard({ rows: [team(5, null, 10, { waiting: 1 }), team(6, 1, 90), team(8, null, 7, { waiting: 2 })] }) }),
  'teams, target': made({ teams: 'staff', target: 40, teamBoard: teamBoard({ rows: [team(5, 2, 12), team(6, 1, 45, { reached: true })] }) }),
  'teams, ended, target nobody': made({ state: 'ended', endsOn: '2026-11-09', teams: 'staff', target: 40, teamBoard: teamBoard() }),
  'teams, ended, target mine': made({ state: 'ended', endsOn: '2026-11-09', teams: 'staff', target: 40, teamBoard: teamBoard({ rows: [team(5, 1, 45, { reached: true, isMine: true })], mine: myTeam }) }),
  'teams, ended, target missed': made({ state: 'ended', endsOn: '2026-11-09', teams: 'staff', target: 40, teamBoard: teamBoard({ rows: [team(5, 1, 30, { isMine: true })], mine: myTeam }) }),
  'teams, ended, I won': made({ state: 'ended', endsOn: '2026-11-09', teams: 'staff', teamBoard: teamBoard({ rows: [team(5, 1, 45, { isMine: true }), team(6, 2, 20)], mine: myTeam }) }),
  'teams, ended, joint': made({ state: 'ended', endsOn: '2026-11-09', teams: 'staff', teamBoard: teamBoard({ rows: [team(5, 1, 45, { isMine: true }), team(6, 1, 45)], mine: myTeam }) }),
  'teams, ended, second': made({ state: 'ended', endsOn: '2026-11-09', teams: 'staff', teamBoard: teamBoard({ rows: [team(5, 2, 20, { isMine: true }), team(6, 1, 45)], mine: myTeam }) }),
  'teams, ended, no number': made({ state: 'ended', endsOn: '2026-11-09', teams: 'staff', teamBoard: teamBoard({ rows: [team(5, null, 0, { isMine: true }), team(6, null, 0)], mine: myTeam }) }),
  'teams, ended, lowest, waiting': made({ state: 'ended', endsOn: '2026-11-09', words: TIME, countedBy: 'staff', lowestWins: true, teams: 'staff', teamBoard: teamBoard({ rows: [team(5, null, 10, { waiting: 1, isMine: true }), team(6, null, 7, { waiting: 3 })], mine: myTeam }) }),
  'teams, ended, lowest, some': made({ state: 'ended', endsOn: '2026-11-09', words: TIME, countedBy: 'staff', lowestWins: true, teams: 'staff', teamBoard: teamBoard({ rows: [team(5, null, 10, { waiting: 2, isMine: true }), team(6, null, 7)], mine: myTeam }) }),
  'teams, ended, too few': made({ state: 'ended', endsOn: '2026-11-09', teams: 'staff', teamBoard: teamBoard({ status: 'too_few' }) }),
};
const TODAY = '2026-11-10';
const GYM = 'Iron House';

describe('the phone and the browser give one answer about a challenge', () => {
  it.each(Object.entries(cases))('%s', (_, c) => {
    const pairs = [
      [phone.howToWin(c), browser.howToWin(c)],
      [phone.challengeChip(c, TODAY).text, browser.challengeChip(c, TODAY).text],
      [phone.challengeDates(c, TODAY), browser.challengeDates(c, TODAY)],
      [phone.aboutLine(c), browser.aboutLine(c)],
      [phone.whoLine(c, GYM), browser.whoLine(c, GYM)],
      [phone.placeLine(c), browser.placeLine(c)],
      [phone.boardNote(c), browser.boardNote(c)],
      [phone.notCountingNote(c, false, GYM), browser.notCountingNote(c, { checkingIn: false, gymName: GYM })],
      [phone.notCountingNote(c, true, GYM), browser.notCountingNote(c, { checkingIn: true, gymName: GYM })],
      [phone.resultOf(c, TODAY, GYM), browser.resultOf(c, { today: TODAY, gymName: GYM })],
      [phone.dayMarks(c, TODAY), browser.dayMarks(c, TODAY)],
      [phone.joinNote(c), browser.joinNote(c)],
      [phone.teamsLine(c, GYM), browser.teamsLine(c, GYM)],
      [phone.teamRuleNote(c), browser.teamRuleNote(c)],
      [phone.myTeamNote(c, GYM), browser.myTeamNote(c, GYM)],
      [phone.inTeams(c), browser.inTeams(c)],
      [phone.leaveBox(c).title, browser.leaveBox(c).title],
      [phone.leaveBox(c).line, browser.leaveBox(c).line],
    ];
    for (const [a, b] of pairs) expect(straight(a)).toEqual(straight(b));

    const mine = phone.progress(c);
    const theirs = browser.progress(c);
    expect(mine === null).toBe(theirs === null);
    if (mine !== null) {
      expect(straight({ big: mine.big, of: mine.of, unit: mine.unit, note: mine.note, done: mine.done })).toEqual(straight({ big: theirs.big, of: theirs.of, unit: theirs.unit, note: theirs.note, done: theirs.done }));
      expect(mine.share === null ? null : Math.round(mine.share * 100)).toBe(theirs.percent);
    }

    const rows = phone.teamRows(c);
    expect(straight(rows)).toEqual(straight(browser.teamRows(c)));
    expect(straight(phone.myTeam(c))).toEqual(straight(browser.myTeam(c) === null ? null : { ...browser.myTeam(c) }));
    for (const t of rows) expect(straight(phone.pickBox(c, t.name))).toEqual(straight((({ title, line, yes }) => ({ title, line, yes }))(browser.pickBox(c, { name: t.name }))));

    const result = { today: TODAY, canOpen: true, challenge: c };
    const p = phone.resultPost(result, GYM);
    const w = browser.resultPost(result, GYM);
    expect(p === null).toBe(w === null);
    if (p !== null) {
      const { rowsLabel, ...same } = w;
      expect(rowsLabel).toBeTruthy();
      expect(straight(p)).toEqual(straight(same));
    }
  });

  it('numbers print alike, for every way of printing', () => {
    for (const words of [WHOLE, TIME, KM]) {
      for (const n of [0, 1, 45, 59, 60, 61, 125, 999, 1000, 3599, 3600, 3725, 11951, 12049, 1000000]) {
        expect(phone.printed(n, words)).toBe(browser.printed(n, words));
        expect(phone.printed(n, words, true)).toBe(browser.printed(n, words, true));
        expect(phone.countText(n, words)).toBe(browser.countText(n, words));
      }
    }
  });

  it('a flame reads alike', () => {
    for (const state of ['yes', 'no', 'open', 'ahead']) {
      expect(phone.markLabel({ day: '2026-11-02', state }, WHOLE)).toBe(browser.markLabel({ day: '2026-11-02', state }, WHOLE));
    }
  });

  it('no result post with none to show', () => {
    expect(phone.resultPost(null, GYM)).toBeNull();
    expect(phone.resultPost({ today: TODAY, canOpen: true, challenge: cases.running }, GYM)).toBeNull();
    expect(phone.resultPost({ today: TODAY, canOpen: true, challenge: { ...cases['ended, a winner'], cancelled: true } }, GYM)).toBeNull();
  });
});
