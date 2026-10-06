// The console's Challenges page, in words and rules (spec Part 3 §15.6; ROADMAP 19d-i).
// Every sentence staff read, written out here from what the page should say.
import { describe, expect, it } from 'vitest';
import { GYM_CHALLENGE_WORDS, ROLE_PRIVILEGES } from '@app/shared';
import {
  CHALLENGE_NOTES,
  boardButton,
  boardLines,
  canManageChallenges,
  cancelBox,
  challengeProblem,
  challengeTag,
  datesLine,
  detailsLine,
  draftDays,
  draftOf,
  emptyBoard,
  fieldsOf,
  isLocked,
  newChallengeDraft,
  notCheckingInNote,
  pageLine,
  pastTitle,
  rowNote,
  rulesLine,
  sameAsSent,
  startHint,
  targetHint,
  whoChoices,
  whoText,
  withStartDay,
} from './challengesView';

const TODAY = '2026-10-07';
const WORDS = { people: 'members', peopleCap: 'Members', person: 'member' };

const challenge = (over = {}) => ({
  id: 'c1',
  name: 'October Challenge',
  details: '',
  prize: '',
  counts: 'gym_days',
  startsOn: '2026-10-05',
  endsOn: '2026-10-11',
  target: null,
  who: 'everyone',
  cancelled: false,
  state: 'running',
  joinedCount: null,
  ...over,
});
const draft = (over = {}) => ({ ...newChallengeDraft(), name: 'October Challenge', startsOn: '2026-10-08', endsOn: '2026-10-31', ...over });
const board = (over = {}) => ({ memberStatus: 'shown', ranked: 4, total: 4, reached: null, page: 1, pages: 1, rows: [], ...over });

describe('who may open it', () => {
  it('the staff who run the leaderboard: an owner and a manager, not a trainer', () => {
    expect([canManageChallenges(ROLE_PRIVILEGES.owner), canManageChallenges(ROLE_PRIVILEGES.manager), canManageChallenges(ROLE_PRIVILEGES.trainer), canManageChallenges(undefined)]).toEqual([true, true, false, false]);
  });
});

describe('the form', () => {
  it('starts on the commonest challenge and fills in from one that is kept', () => {
    expect(newChallengeDraft()).toEqual({ name: '', details: '', prize: '', counts: 'gym_days', startsOn: '', endsOn: '', win: 'most', target: '', who: 'everyone' });
    expect(draftOf(challenge({ target: 12, who: 'joined', prize: 'A shaker' }))).toEqual({
      name: 'October Challenge',
      details: '',
      prize: 'A shaker',
      counts: 'gym_days',
      startsOn: '2026-10-05',
      endsOn: '2026-10-11',
      win: 'target',
      target: '12',
      who: 'joined',
    });
  });

  it('a first day moves a last day that is before it, and leaves a later one', () => {
    expect(withStartDay(draft({ endsOn: '' }), '2026-10-12').endsOn).toBe('2026-10-12');
    expect(withStartDay(draft({ endsOn: '2026-10-10' }), '2026-10-12').endsOn).toBe('2026-10-12');
    expect(withStartDay(draft({ endsOn: '2026-10-31' }), '2026-10-12').endsOn).toBe('2026-10-31');
  });

  it('counts both ends of its days', () => {
    expect([draftDays(draft()), draftDays(draft({ endsOn: '2026-10-08' })), draftDays(draft({ endsOn: '2026-10-07' })), draftDays(draft({ endsOn: '' }))]).toEqual([24, 1, null, null]);
  });

  it.each([
    ['as filled in', {}, null],
    ['with no name', { name: '  ' }, 'Give the challenge a name.'],
    ['a name of 81 characters', { name: 'a'.repeat(81) }, 'Keep the name to 80 characters.'],
    ['no first day', { startsOn: '' }, 'Pick its first day.'],
    ['no last day', { endsOn: '' }, 'Pick its last day.'],
    ['a last day before the first', { endsOn: '2026-10-07' }, 'The last day must not be before the first day.'],
    ['367 days', { endsOn: '2027-10-09' }, 'A challenge can run for 366 days at most.'],
    ['a target with nothing typed', { win: 'target', target: '' }, 'Type how many gym days to reach, as a whole number.'],
    ['a target of words', { win: 'target', target: 'twelve' }, 'Type how many gym days to reach, as a whole number.'],
    ['a target of nothing', { win: 'target', target: '0', counts: 'workout_days' }, 'Type how many workout days to reach, as a whole number.'],
    ['a target of every day', { win: 'target', target: '24' }, null],
    [
      'a target above its days',
      { win: 'target', target: '25' },
      'One a day is counted and this challenge is 24 days long, so the most anyone can reach is 24. Type 24 or less, or make it longer.',
    ],
    ['a prize of 121 characters', { prize: 'p'.repeat(121) }, 'Keep the prize to 120 characters.'],
    ['details of 501 characters', { details: 'd'.repeat(501) }, 'Keep the details to 500 characters.'],
    ['a first day 32 days back', { startsOn: '2026-09-05' }, GYM_CHALLENGE_WORDS.starts_too_early],
    ['a first day 31 days back', { startsOn: '2026-09-06' }, null],
    ['a first day more than a year ahead', { startsOn: '2027-10-08', endsOn: '2027-10-31' }, GYM_CHALLENGE_WORDS.starts_too_far],
    ['a last day already passed', { startsOn: '2026-10-01', endsOn: '2026-10-06' }, GYM_CHALLENGE_WORDS.ends_before_today],
  ])('a new challenge %s', (_what, over, text) => {
    expect(challengeProblem(draft(over), TODAY)?.text ?? null).toBe(text);
  });

  it('a target typed while "the most wins" is picked is not sent, and stops nothing', () => {
    const d = draft({ win: 'most', target: '999' });
    expect(challengeProblem(d, TODAY)).toBeNull();
    expect(fieldsOf(d).target).toBeNull();
  });

  it('once it has started, the same four things the server keeps are kept here', () => {
    const running = challenge({ target: 3, who: 'joined' });
    expect(isLocked(running)).toBe(true);
    expect([isLocked(challenge({ state: 'coming' })), isLocked(null)]).toEqual([false, false]);
    const same = draftOf(running);
    expect(challengeProblem({ ...same, name: 'Renamed', prize: 'A towel', endsOn: '2026-10-18' }, TODAY, running)).toBeNull();
    for (const over of [{ counts: 'workout_days' }, { startsOn: '2026-10-06' }, { who: 'everyone' }, { target: '4' }, { win: 'most' }]) {
      expect(challengeProblem({ ...same, ...over }, TODAY, running)).toEqual({ field: 'form', text: GYM_CHALLENGE_WORDS.started_locked });
    }
    expect(challengeProblem({ ...same, endsOn: '2026-10-07' }, TODAY, running)).toBeNull();
    expect(challengeProblem({ ...same, target: '2', endsOn: '2026-10-06' }, TODAY, running)?.text).toBe(GYM_CHALLENGE_WORDS.started_locked);
  });

  it('sends what was typed, trimmed, with the target as a number or nothing', () => {
    expect(fieldsOf(draft({ name: '  October  ', prize: ' A shaker ', details: ' Come often ', win: 'target', target: ' 12 ', who: 'joined', counts: 'workout_days' }))).toEqual({
      name: 'October',
      details: 'Come often',
      prize: 'A shaker',
      counts: 'workout_days',
      startsOn: '2026-10-08',
      endsOn: '2026-10-31',
      target: 12,
      who: 'joined',
    });
  });

  it('knows whether the challenge the server kept is the one the form holds', () => {
    const fields = fieldsOf(draft());
    expect(sameAsSent({ ...fields, id: 'c1' }, fields)).toBe(true);
    expect(sameAsSent({ ...fields, prize: 'Another' }, fields)).toBe(false);
  });

  it('says what the choices mean, to somebody new', () => {
    expect(whoChoices(WORDS, 143)).toEqual([
      { id: 'everyone', title: 'Everyone in the app', sub: 'Everybody using the app is in it: 143 people. Nobody has to do anything.' },
      { id: 'joined', title: 'Only people who join', sub: 'Your members see it and tap Join.' },
    ]);
    expect(whoChoices(WORDS, 1)[0].sub).toBe('Everybody using the app is in it: 1 person. Nobody has to do anything.');
  });

  it('says the most that can be reached, and that a start in the past already counts', () => {
    expect(targetHint(draft())).toBe('One gym day a day is the most anybody can get, and this challenge is 24 days long: 24 is the highest number that can be reached.');
    expect(targetHint(draft({ endsOn: '', counts: 'workout_days' }))).toBe('One workout day a day is the most anybody can get.');
    expect(startHint(draft({ startsOn: '2026-10-01' }), TODAY)).toBe('Gym days since Thu 1 Oct already count.');
    expect(startHint(draft({ startsOn: '2026-10-01', counts: 'workout_days' }), TODAY)).toBe('Workout days since Thu 1 Oct already count.');
    expect([startHint(draft({ startsOn: TODAY }), TODAY), startHint(draft({ startsOn: '' }), TODAY)]).toEqual([null, null]);
  });

  it('warns before a gym-days challenge at a gym that checks nobody in', () => {
    expect(notCheckingInNote('gym_days', { checkingIn: false }, WORDS)).toBe(
      'Nobody has been checked in at your front desk in the last 30 days. Gym days only come from check-ins, so every member would stay at 0. Check people in at the front desk, or count workout days.',
    );
    expect([notCheckingInNote('gym_days', { checkingIn: true }, WORDS), notCheckingInNote('workout_days', { checkingIn: false }, WORDS)]).toEqual([null, null]);
  });

  it('counts the details down', () => {
    expect(detailsLine('')).toEqual({ over: false, text: '500 characters left' });
    expect(detailsLine('d'.repeat(503))).toEqual({ over: true, text: '3 characters too many' });
  });
});

describe('a challenge on the page', () => {
  it.each([
    ['running', {}, { text: 'Running · 5 days left', tone: 'good' }],
    ['on its last day', { endsOn: TODAY }, { text: 'Running · last day', tone: 'good' }],
    ['starting tomorrow', { state: 'coming', startsOn: '2026-10-08' }, { text: 'Starts tomorrow', tone: 'plain' }],
    ['starting later', { state: 'coming', startsOn: '2026-10-20' }, { text: 'Starts in 13 days', tone: 'plain' }],
    ['ended', { state: 'ended', endsOn: '2026-10-04' }, { text: 'Ended Sun 4 Oct', tone: 'plain' }],
    ['cancelled', { cancelled: true }, { text: 'Cancelled', tone: 'bad' }],
  ])('%s', (_what, over, tag) => {
    expect(challengeTag(challenge(over), TODAY)).toEqual(tag);
  });

  it('says its days, how it is won and who is in it', () => {
    expect(datesLine(challenge(), TODAY)).toBe('Mon 5 Oct – Sun 11 Oct · 7 days');
    expect(datesLine(challenge({ startsOn: TODAY, endsOn: TODAY }), TODAY)).toBe('Wed 7 Oct · 1 day');
    expect(datesLine(challenge({ startsOn: '2026-12-21', endsOn: '2027-01-03' }), TODAY)).toBe('Mon 21 Dec – Sun 3 Jan 2027 · 14 days');
    expect(rulesLine(challenge())).toBe('Counts gym days · whoever has the most wins');
    expect(rulesLine(challenge({ counts: 'workout_days', target: 12 }))).toBe('Counts workout days · everyone who reaches 12 wins');
    expect(whoText(challenge(), 143, WORDS)).toBe('Everyone in the app: 143 people');
    expect(whoText(challenge({ who: 'joined', joinedCount: 0 }), 143, WORDS)).toBe('Only members who join · nobody has joined yet');
    expect(whoText(challenge({ who: 'joined', joinedCount: 1 }), 143, WORDS)).toBe('Only members who join · 1 person has joined');
    expect(whoText(challenge({ who: 'joined', joinedCount: 24 }), 143, WORDS)).toBe('Only members who join · 24 people have joined');
  });

  it('names the board button for what it opens', () => {
    expect(boardButton(challenge(), false)).toBe('See the board');
    expect(boardButton(challenge({ state: 'coming', who: 'joined' }), false)).toBe('See who has joined');
    expect(boardButton(challenge(), true)).toBe('Hide the board');
  });

  it('the cancel box says what members see, who has joined, and what is not touched', () => {
    expect(cancelBox(challenge({ who: 'joined', joinedCount: 24 }), WORDS)).toEqual({
      title: 'Cancel October Challenge?',
      lines: [
        'Your members see it marked Cancelled for 7 days, then it leaves their list. Its board stops showing straight away.',
        "24 people have joined. The app doesn't tell them yet, so let them know yourself. They are still in it if you un-cancel.",
        "Nobody is emailed, and nobody's gym days or workouts are touched. You can un-cancel it until Sun 11 Oct.",
      ],
      yes: 'Cancel challenge',
      no: 'Keep it',
    });
    expect(cancelBox(challenge(), WORDS).lines).toHaveLength(2);
    expect(cancelBox(challenge({ who: 'joined', joinedCount: 0 }), WORDS).lines).toHaveLength(2);
  });
});

describe('its board', () => {
  it('says what members see of it', () => {
    expect(boardLines(board({ total: 9, ranked: 4 }), challenge(), WORDS)).toEqual(['Members see 4 people on its board; 5 more are listed here and hidden from them.']);
    expect(boardLines(board({ total: 5, ranked: 4 }), challenge(), WORDS)).toEqual(['Members see 4 people on its board; 1 more is listed here and hidden from them.']);
    expect(boardLines(board(), challenge(), WORDS)).toEqual(['Members see 4 people on its board.']);
    expect(boardLines(board({ memberStatus: 'too_few', ranked: 0, total: 2 }), challenge(), WORDS)).toEqual(['Members see no places yet: fewer than 3 people they can see have a gym day in it.']);
  });

  it('says how many have reached the target', () => {
    expect(boardLines(board({ reached: 0 }), challenge({ target: 12 }), WORDS)[1]).toBe('Nobody has reached 12 yet.');
    expect(boardLines(board({ reached: 1 }), challenge({ target: 12 }), WORDS)[1]).toBe('1 person has reached 12.');
    expect(boardLines(board({ reached: 6 }), challenge({ target: 12 }), WORDS)[1]).toBe('6 people have reached 12.');
  });

  it('before it starts: when it starts, and who has joined so far', () => {
    const coming = challenge({ state: 'coming', startsOn: '2026-10-12', who: 'joined' });
    expect(boardLines(board({ memberStatus: 'not_started', ranked: 0, total: 3 }), coming, WORDS)).toEqual(['It starts Mon 12 Oct. Nothing is counted until then.', '3 people have joined so far.']);
    expect(boardLines(board({ memberStatus: 'not_started', ranked: 0, total: 0 }), { ...coming, who: 'everyone' }, WORDS)).toEqual(['It starts Mon 12 Oct. Nothing is counted until then.']);
    expect(emptyBoard(board({ memberStatus: 'not_started', total: 0 }), coming)).toBe('Nobody has joined yet.');
    expect(emptyBoard(board({ memberStatus: 'not_started', total: 0 }), { ...coming, who: 'everyone' })).toBeNull();
  });

  it('with nobody on it, says so in the words that fit', () => {
    expect(emptyBoard(board({ memberStatus: 'too_few', total: 0 }), challenge())).toBe('Nobody has a gym day in it yet.');
    expect(emptyBoard(board({ memberStatus: 'too_few', total: 0 }), challenge({ counts: 'workout_days' }))).toBe('Nobody has a workout day in it yet.');
    expect(emptyBoard(board({ memberStatus: 'too_few', total: 0 }), challenge({ who: 'joined' }))).toBe('Nobody has joined yet.');
  });

  it('says why members do not see a person, or that nothing of theirs has counted', () => {
    const row = (over) => ({ userId: 'u', name: 'A', initials: 'A', place: null, value: 3, hidden: null, reached: false, ...over });
    expect([rowNote(row({ hidden: 'hide_me' })), rowNote(row({ hidden: 'under_18' })), rowNote(row({ hidden: 'staff' })), rowNote(row({ hidden: 'no_name' })), rowNote(row({ value: 0 })), rowNote(row({}))]).toEqual([
      'Chose Hide me',
      'Under 18',
      'Staff, not ranked',
      'Hidden until they add a name',
      'Nothing counted yet',
      null,
    ]);
  });

  it('says which of its people a page shows', () => {
    expect(pageLine(board())).toBeNull();
    expect(pageLine(board({ pages: 3, page: 2, total: 240, rows: new Array(100).fill(null) }))).toBe('Showing 101–200 of 240');
    expect(pageLine(board({ pages: 3, page: 3, total: 240, rows: new Array(40).fill(null) }))).toBe('Showing 201–240 of 240');
  });
});

describe('what the page says after a press', () => {
  it('in the gym\'s own word for its people', () => {
    expect(CHALLENGE_NOTES.added(WORDS)).toBe('Challenge added. Your members can see it now.');
    expect(CHALLENGE_NOTES.cancelled({ people: 'clients' })).toBe('Challenge cancelled. Your clients see it marked Cancelled.');
  });

  it('counts the past ones', () => {
    expect(pastTitle({ pastTotal: 3, past: [1, 2, 3] })).toBe('Past challenges (3)');
    expect(pastTitle({ pastTotal: 73, past: new Array(50).fill(0) })).toBe('Past challenges (the newest 50 of 73)');
  });
});
