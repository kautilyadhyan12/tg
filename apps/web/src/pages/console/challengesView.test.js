// The console's Challenges page, in words and rules (spec Part 3 §15.6; ROADMAP 19d-i).
// Every sentence staff read, written out here from what the page should say.
import { describe, expect, it } from 'vitest';
import { GYM_CHALLENGE_WORDS, ROLE_PRIVILEGES } from '@app/shared';
import { howToWin } from '../../components/gym/challengesView';
import {
  CHALLENGE_NOTES,
  COUNTED_BY_CHOICES,
  NUMBER_NOTES,
  amountOf,
  appCountChoices,
  badBox,
  boardButton,
  boardLines,
  canManageChallenges,
  cancelBox,
  cardFacts,
  challengeProblem,
  challengeTag,
  countedBy,
  datesLine,
  daysBar,
  detailsLine,
  draftDays,
  draftOf,
  draftSummary,
  emptyBoard,
  fieldsOf,
  inSaves,
  isLocked,
  leadersLine,
  newChallengeDraft,
  notCheckingInNote,
  numbersToSave,
  pageLine,
  pastTitle,
  rowLeader,
  rowNote,
  rowSummary,
  sameAsSent,
  startHint,
  takesNumbers,
  targetHint,
  targetUnit,
  teamChoices,
  teamLines,
  teamsHeading,
  typedNumber,
  unsavedNote,
  whoChoices,
  winChoices,
  withCountedBy,
  withCounts,
  withNumberLine,
  withStartDay,
  wonLine,
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
  unit: '',
  lowestWins: false,
  cancelled: false,
  state: 'running',
  joinedCount: null,
  ...over,
});
const draft = (over = {}) => ({ ...newChallengeDraft(), name: 'October Challenge', startsOn: '2026-10-08', endsOn: '2026-10-31', ...over });
const board = (over = {}) => ({ memberStatus: 'shown', ranked: 4, total: 4, hidden: 0, reached: null, page: 1, pages: 1, rows: [], ...over });

describe('who may open it', () => {
  it('the staff who run the leaderboard: an owner and a manager, not a trainer', () => {
    expect([canManageChallenges(ROLE_PRIVILEGES.owner), canManageChallenges(ROLE_PRIVILEGES.manager), canManageChallenges(ROLE_PRIVILEGES.trainer), canManageChallenges(undefined)]).toEqual([true, true, false, false]);
  });
});

describe('the form', () => {
  it('starts on the commonest challenge and fills in from one that is kept', () => {
    expect(newChallengeDraft()).toEqual({ name: '', details: '', prize: '', counts: 'gym_days', unit: '', startsOn: '', endsOn: '', win: 'most', target: '', who: 'everyone', teams: 'none', teamList: [{ id: null, name: '' }, { id: null, name: '' }] });
    expect(draftOf(challenge({ target: 12, who: 'joined', prize: 'A shaker' }))).toEqual({
      name: 'October Challenge',
      details: '',
      prize: 'A shaker',
      counts: 'gym_days',
      unit: '',
      startsOn: '2026-10-05',
      endsOn: '2026-10-11',
      win: 'target',
      target: '12',
      who: 'joined',
      teams: 'none',
      teamList: [{ id: null, name: '' }, { id: null, name: '' }],
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
      unit: '',
      counts: 'workout_days',
      startsOn: '2026-10-08',
      endsOn: '2026-10-31',
      target: 12,
      who: 'joined',
      lowestWins: false,
      teams: 'none',
      teamList: [],
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

describe("the gym's own count", () => {
  const own = (over = {}) => draft({ counts: 'own', unit: 'push-ups', ...over });

  it('offers the lowest-wins choice only for it, and drops that choice when the count changes back', () => {
    expect(winChoices('gym_days').map((c) => c.id)).toEqual(['most', 'target']);
    expect(winChoices('own').map((c) => c.id)).toEqual(['most', 'target', 'lowest']);
    expect(withCounts(own({ win: 'lowest' }), 'gym_days')).toMatchObject({ counts: 'gym_days', win: 'most' });
    expect(withCounts(own({ win: 'target' }), 'workout_days').win).toBe('target');
    expect(withCounts(draft({ win: 'most' }), 'own').win).toBe('most');
  });

  it.each([
    ['as filled in', {}, null],
    ['with nothing said to be counted', { unit: ' ' }, 'Say what your staff count, for example push-ups.'],
    ['a word of 31 characters', { unit: 'u'.repeat(31) }, 'Keep what your staff count to 30 characters.'],
    ['a number to reach above its days', { win: 'target', target: '500' }, null],
    ['a number to reach above a million', { win: 'target', target: '1000001' }, 'The target can be 1,000,000 at most.'],
    ['no number to reach typed', { win: 'target', target: '' }, 'Type how many push-ups to reach, as a whole number.'],
    ['the lowest wins', { win: 'lowest' }, null],
  ])('%s', (_what, over, text) => {
    expect(challengeProblem(own(over), TODAY)?.text ?? null).toBe(text);
  });

  it('sends its word and whether the lowest wins; the app\'s counts send neither', () => {
    expect(fieldsOf(own({ unit: ' seconds ', win: 'lowest' }))).toMatchObject({ counts: 'own', unit: 'seconds', lowestWins: true, target: null });
    expect(fieldsOf(own({ win: 'target', target: '500' }))).toMatchObject({ unit: 'push-ups', lowestWins: false, target: 500 });
    expect(fieldsOf(draft({ unit: 'left over', win: 'lowest' }))).toMatchObject({ counts: 'gym_days', unit: '', lowestWins: false });
    expect(draftOf(challenge({ counts: 'own', unit: 'seconds', lowestWins: true }))).toMatchObject({ counts: 'own', unit: 'seconds', win: 'lowest' });
  });

  it('once started, lowest-wins cannot be switched, and its word still can be', () => {
    const running = challenge({ counts: 'own', unit: 'seconds', lowestWins: true });
    const same = draftOf(running);
    expect(challengeProblem({ ...same, win: 'most' }, TODAY, running)?.text).toBe(GYM_CHALLENGE_WORDS.started_locked);
    expect(challengeProblem({ ...same, unit: 'secs' }, TODAY, running)).toBeNull();
  });

  it('the card says what is counted, how it is won and who is in it, each in a few words', () => {
    expect(cardFacts(challenge({ target: 12 }), 143, WORDS)).toEqual([
      { label: 'Counts', value: 'Gym days', note: 'Counted by the app' },
      { label: 'How it is won', value: 'Reach 12 gym days', note: 'Everyone who gets there wins' },
      { label: 'Who is in it', value: 'Everyone in the app', note: '143 people' },
    ]);
    expect(cardFacts(challenge({ counts: 'own', unit: 'seconds', lowestWins: true, who: 'joined', joinedCount: 6 }), 143, WORDS)).toEqual([
      { label: 'Counts', value: 'Seconds', note: 'Counted by your staff' },
      { label: 'How it is won', value: 'Fewest seconds wins', note: 'Equal numbers share a place' },
      { label: 'Who is in it', value: 'Members who join', note: '6 people have joined' },
    ]);
    expect(cardFacts(challenge({ counts: 'workout_days', who: 'joined', joinedCount: 0 }), 143, WORDS).map((f) => [f.value, f.note])).toEqual([
      ['Workout days', 'Counted by the app'],
      ['Most workout days wins', 'Equal numbers share a place'],
      ['Members who join', 'Nobody has joined yet'],
    ]);
  });

  it('numbers are typed once it has started, and never for a cancelled one or the app\'s counts', () => {
    const c = (over) => challenge({ counts: 'own', unit: 'push-ups', ...over });
    expect([takesNumbers(c({}), TODAY), takesNumbers(c({ startsOn: '2026-10-08' }), TODAY), takesNumbers(c({ cancelled: true }), TODAY), takesNumbers(challenge(), TODAY)]).toEqual([true, false, false, false]);
    // After it ends: for the fourteen days members still see its result, and no longer.
    const ended = c({ startsOn: '2026-09-01', endsOn: '2026-09-23' });
    expect([takesNumbers(ended, TODAY), takesNumbers({ ...ended, endsOn: '2026-09-22' }, TODAY)]).toEqual([true, false]);
    expect([boardButton(c({}), false), boardButton(c({ state: 'ended' }), false), boardButton(c({}), true)]).toEqual(['See the board', 'See the board', 'Hide the board']);
  });

  it('reads what is typed in a box', () => {
    expect([typedNumber(''), typedNumber(' 40 '), typedNumber('1000000'), typedNumber('1000001'), typedNumber('4.5'), typedNumber('-3'), typedNumber('forty')]).toEqual([
      { ok: true, value: null },
      { ok: true, value: 40 },
      { ok: true, value: 1000000 },
      { ok: false, value: null },
      { ok: false, value: null },
      { ok: false, value: null },
      { ok: false, value: null },
    ]);
  });

  it('saves only the boxes that changed; an emptied box takes the number off; one bad box stops the save', () => {
    const rows = [{ userId: 'a', value: 60 }, { userId: 'b', value: 40 }, { userId: 'c', value: 0 }, { userId: 'd', value: 5 }];
    expect(numbersToSave(rows, {})).toEqual([]);
    expect(numbersToSave(rows, { a: '60', b: '45', c: '12', d: '' })).toEqual([{ userId: 'b', value: 45 }, { userId: 'c', value: 12 }, { userId: 'd', value: null }]);
    expect(numbersToSave(rows, { c: '', d: '0' })).toEqual([{ userId: 'd', value: null }]);
    expect(numbersToSave(rows, { a: '70', b: 'lots' })).toBeNull();
    // The box that stops it is named, whichever page it is on.
    const named = [{ userId: 'a', value: 60, name: 'Asha Rao' }, { userId: 'b', value: 40, name: 'Bilal Khan' }, { userId: 'n', value: 0, name: null }];
    expect(badBox(named, { a: '70', b: 'lots' })?.name).toBe('Bilal Khan');
    expect(badBox(named, { a: '70' })).toBeNull();
    expect(NUMBER_NOTES.badFor('Bilal Khan')).toBe("Bilal Khan's box isn't a number. Type a whole number up to 1,000,000, or leave it empty.");
    expect(NUMBER_NOTES.badFor(badBox(named, { n: 'x' })?.name ?? null)).toBe("One person's box isn't a number. Type a whole number up to 1,000,000, or leave it empty.");
    expect([NUMBER_NOTES.saved(1), NUMBER_NOTES.saved(120)]).toEqual(['Saved. 1 number changed.', 'Saved. 120 numbers changed.']);
    expect(NUMBER_NOTES.help(challenge({ counts: 'own', unit: 'push-ups' }), WORDS)).toBe("Type each person's push-ups and press Save numbers. An empty box is no number. Your members see a saved number straight away.");
  });

  it('numbers typed on any page are all saved, 200 a save, and the page says some are waiting', () => {
    const scores = Array.from({ length: 450 }, (_, i) => ({ userId: `u${i}`, value: i + 1 }));
    expect(inSaves(scores).map((save) => save.length)).toEqual([200, 200, 50]);
    expect(inSaves([])).toEqual([]);
    expect(unsavedNote({})).toBeNull();
    expect(unsavedNote({ a: '5' })).toBe('1 number is typed and not saved yet. They are kept while you change page; press Save numbers to save them all.');
    expect(unsavedNote({ a: '5', b: '6' })).toMatch(/^2 numbers are typed and not saved yet\./);
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
    expect(rowSummary(challenge(), 143, WORDS)).toBe('Most gym days wins · Everyone in the app · 143 people');
    expect(rowSummary(challenge({ counts: 'workout_days', target: 12, who: 'joined', joinedCount: 0 }), 143, WORDS)).toBe('Reach 12 workout days · Members who join · nobody has joined yet');
    expect(rowSummary(challenge({ who: 'joined', joinedCount: 1 }), 143, WORDS)).toBe('Most gym days wins · Members who join · 1 person has joined');
    expect(rowSummary(challenge({ who: 'joined', joinedCount: 24 }), 143, WORDS)).toBe('Most gym days wins · Members who join · 24 people have joined');
    expect(rowSummary(challenge({ teams: 'staff' }), 1, WORDS)).toBe('The team with the most gym days wins · Everyone in the app · 1 person');
  });

  it('says how far through its days it is', () => {
    expect(daysBar(challenge(), TODAY)).toEqual({ percent: 43, text: 'Day 3 of 7' });
    expect(daysBar(challenge({ startsOn: TODAY, endsOn: TODAY }), TODAY)).toEqual({ percent: 100, text: 'Day 1 of 1' });
    expect(daysBar(challenge({ state: 'ended', endsOn: '2026-10-06' }), TODAY)).toEqual({ percent: 100, text: 'All 2 days done' });
    expect([daysBar(challenge({ state: 'coming', startsOn: '2026-10-12' }), TODAY), daysBar(challenge({ cancelled: true }), TODAY)]).toEqual([null, null]);
  });

  it('says how many have a number, and why there are no first three', () => {
    expect(withNumberLine(challenge({ withNumber: 12 }))).toBe('12 people have a gym day');
    expect(withNumberLine(challenge({ withNumber: 1, counts: 'workout_days' }))).toBe('1 person has a workout day');
    expect(withNumberLine(challenge({ withNumber: 0, counts: 'own', unit: 'push-ups' }))).toBe('Nobody has a number yet');
    expect([withNumberLine(challenge({ withNumber: null })), withNumberLine(challenge())]).toEqual([null, null]);
    const top = [{ userId: 'a', name: 'Asha Rao', initials: 'AR', place: 1, value: 3 }];
    expect(leadersLine(challenge({ withNumber: 5, top }), WORDS)).toBe('In the lead');
    expect(leadersLine(challenge({ withNumber: 2, top: [] }), WORDS)).toBe('Members see no places until 3 people they can see have a gym day.');
    expect([leadersLine(challenge({ withNumber: 0, top: [] }), WORDS), leadersLine(challenge({ withNumber: null, top: [] }), WORDS)]).toEqual([null, null]);
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
    expect(boardLines(board({ total: 9, ranked: 4, hidden: 5 }), challenge(), WORDS)).toEqual(['Members see 4 people on its board; 5 more are listed here and hidden from them.']);
    expect(boardLines(board({ total: 5, ranked: 4, hidden: 1 }), challenge(), WORDS)).toEqual(['Members see 4 people on its board; 1 more is listed here and hidden from them.']);
    // People who joined and have nothing yet are listed and are not hidden: nobody is said to be.
    expect(boardLines(board({ total: 6, ranked: 4, hidden: 0 }), challenge({ who: 'joined' }), WORDS)).toEqual(['Members see 4 people on its board.']);
    expect(boardLines(board(), challenge(), WORDS)).toEqual(['Members see 4 people on its board.']);
    expect(boardLines(board({ memberStatus: 'too_few', ranked: 0, total: 2 }), challenge(), WORDS)).toEqual(['Members see no places yet: fewer than 3 people they can see have a gym day in it.']);
  });

  it('says how many have reached the target', () => {
    expect(boardLines(board({ reached: 0 }), challenge({ target: 12 }), WORDS)[1]).toBe('Nobody has reached 12 gym days yet.');
    expect(boardLines(board({ reached: 1 }), challenge({ target: 12 }), WORDS)[1]).toBe('1 person has reached 12 gym days.');
    expect(boardLines(board({ reached: 6 }), challenge({ counts: 'own', unit: 'push-ups', target: 100 }), WORDS)[1]).toBe('6 people have reached 100 push-ups.');
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

  it("the gym's own count lists everybody in it: a person with no number says so, and nobody is called hidden for it", () => {
    const own = challenge({ counts: 'own', unit: 'push-ups' });
    expect(rowNote({ value: 0, hidden: null }, own)).toBe('No number yet');
    expect(rowNote({ value: 0, hidden: 'hide_me' }, own)).toBe('Chose Hide me');
    expect(boardLines(board({ total: 28, ranked: 4, hidden: 0 }), own, WORDS)).toEqual(['Members see 4 people on its board.']);
    // And a hidden person in it is said to be, as for every other kind.
    expect(boardLines(board({ total: 28, ranked: 4, hidden: 2 }), own, WORDS)).toEqual(['Members see 4 people on its board; 2 more are listed here and hidden from them.']);
  });

  it('says which of its people a page shows', () => {
    expect(pageLine(board())).toBeNull();
    expect(pageLine(board({ pages: 3, page: 2, total: 240, rows: new Array(100).fill(null) }))).toBe('Showing 101–200 of 240');
    expect(pageLine(board({ pages: 3, page: 3, total: 240, rows: new Array(40).fill(null) }))).toBe('Showing 201–240 of 240');
  });
});

// Kd's click-through of 19d-ii-b (RULINGS 2026-10-09): "what are these numbers 4 3 2 1 ?",
// "most win applies to everything be specific", "your own count ... what the fuck", "the
// terms options are stupid same for team". Written out from what the page should say.
describe('every number with its word, and every choice in plain words', () => {
  it('a number is never bare: it carries the word of what it counts', () => {
    expect(amountOf(challenge(), 4)).toBe('4 gym days');
    expect(amountOf(challenge(), 1)).toBe('1 gym day');
    expect(amountOf(challenge(), 0)).toBe('0 gym days');
    expect(amountOf(challenge({ counts: 'workout_days' }), 1234)).toBe('1,234 workout days');
    // The staff's own word is printed as they typed it, whatever the number.
    expect(amountOf(challenge({ counts: 'own', unit: ' push-ups ' }), 55)).toBe('55 push-ups');
  });

  it.each([
    ['the most gym days', {}, 'Most gym days wins'],
    ['the most workout days', { counts: 'workout_days' }, 'Most workout days wins'],
    ['a target', { target: 12 }, 'Reach 12 gym days'],
    ['a target of one', { target: 1 }, 'Reach 1 gym day'],
    ["the most of the staff's own", { counts: 'own', unit: 'push-ups' }, 'Most push-ups wins'],
    ['the fewest, a fastest time', { counts: 'own', unit: 'seconds', lowestWins: true }, 'Fewest seconds wins'],
    ["a target of the staff's own", { counts: 'own', unit: 'push-ups', target: 100 }, 'Reach 100 push-ups'],
    ['teams, the most', { teams: 'staff' }, 'The team with the most gym days wins'],
    ['teams, a target', { teams: 'members', target: 60 }, 'Reach 60 gym days as a team'],
    ['teams, the fewest', { teams: 'staff', counts: 'own', unit: 'seconds', lowestWins: true }, 'The team with the fewest seconds wins'],
  ])('how it is won says what wins, as the member reads it: %s', (_what, over, line) => {
    const staffs = challenge(over);
    expect(wonLine(staffs)).toBe(line);
    // The same challenge as a member is sent it: one sentence on both screens.
    const members = { ...staffs, teamBoard: (staffs.teams ?? 'none') === 'none' ? null : { status: 'shown', rows: [], mine: null } };
    expect(howToWin(members)).toBe(line);
  });

  it('the three facts: what, then one thing worth knowing; a count of people says people', () => {
    expect(cardFacts(challenge(), 143, WORDS)).toEqual([
      { label: 'Counts', value: 'Gym days', note: 'Counted by the app' },
      { label: 'How it is won', value: 'Most gym days wins', note: 'Equal numbers share a place' },
      { label: 'Who is in it', value: 'Everyone in the app', note: '143 people' },
    ]);
    expect(cardFacts(challenge(), 1, WORDS)[2]).toEqual({ label: 'Who is in it', value: 'Everyone in the app', note: '1 person' });
    expect(cardFacts(challenge({ who: 'joined', joinedCount: 1 }), 143, WORDS)[2].note).toBe('1 person has joined');
    expect(cardFacts(challenge({ teams: 'staff' }), 143, WORDS)[1]).toEqual({ label: 'How it is won', value: 'The team with the most gym days wins', note: "A team's number is its people's added together" });
    expect(cardFacts(challenge({ teams: 'members', target: 60 }), 143, WORDS)[1]).toEqual({ label: 'How it is won', value: 'Reach 60 gym days as a team', note: 'Every team that gets there wins' });
    expect(cardFacts(challenge({ counts: 'own', unit: 'push-ups' }), 143, WORDS)[0]).toEqual({ label: 'Counts', value: 'Push-ups', note: 'Counted by your staff' });
  });

  it('who is leading, on a row of the list, with the number\'s word', () => {
    const top = (value) => [{ userId: 'a', name: 'Maya Okafor', initials: 'MO', place: 1, value }, { userId: 'b', name: 'Omar Haddad', initials: 'OH', place: 2, value: 1 }];
    expect(rowLeader(challenge({ top: top(4) }))).toBe('Maya Okafor · 4 gym days');
    expect(rowLeader(challenge({ top: top(1) }))).toBe('Maya Okafor · 1 gym day');
    expect(rowLeader(challenge({ counts: 'own', unit: 'push-ups', top: top(55) }))).toBe('Maya Okafor · 55 push-ups');
    expect([rowLeader(challenge({ top: [] })), rowLeader(challenge())]).toEqual([null, null]);
    const teamList = [
      { id: 't1', name: 'Blue Team', people: 2, value: 4, place: 2 },
      { id: 't2', name: 'Red Team', people: 2, value: 6, place: 1 },
      { id: 't3', name: 'Green Team', people: 0, value: null, place: null },
    ];
    const teamed = challenge({ teams: 'staff', teamList });
    expect(rowLeader(teamed)).toBe('Red Team · 6 gym days');
    expect(teamLines(teamed).map((team) => [team.placeText, team.name, team.people, team.number])).toEqual([
      ['1st', 'Red Team', '2 people', '6 gym days'],
      ['2nd', 'Blue Team', '2 people', '4 gym days'],
      [null, 'Green Team', 'Nobody yet', null],
    ]);
  });

  it('who counts it: the app or the staff, and the form follows the pick', () => {
    expect(COUNTED_BY_CHOICES).toEqual([
      { id: 'app', title: 'The app', sub: 'It counts gym check-ins or workouts by itself. Nothing for your staff to do.' },
      { id: 'staff', title: 'Your staff', sub: "For anything the app can't count: push-ups, a 5 km time, weight lifted. Your staff enter each person's number." },
    ]);
    expect(appCountChoices(WORDS)).toEqual([
      { id: 'gym_days', title: 'Gym days', sub: 'A day a member is checked in, at your front desk or by your staff. Two visits in one day count once.' },
      { id: 'workout_days', title: 'Workout days', sub: 'A day a member finishes a workout in the app. Two in one day count once.' },
    ]);
    expect([countedBy(draft()), countedBy(draft({ counts: 'workout_days' })), countedBy(draft({ counts: 'own' }))]).toEqual(['app', 'app', 'staff']);
    expect(withCountedBy(draft(), 'staff')).toMatchObject({ counts: 'own', win: 'most' });
    // Back to the app: gym days, the lowest-wins choice dropped, the staff's word kept in case they come back.
    expect(withCountedBy(draft({ counts: 'own', unit: 'seconds', win: 'lowest' }), 'app')).toMatchObject({ counts: 'gym_days', win: 'most', unit: 'seconds' });
    // Picking the one already picked changes nothing: workout days stay workout days.
    const workouts = draft({ counts: 'workout_days' });
    expect(withCountedBy(workouts, 'app')).toBe(workouts);
  });

  it('how it is won, as the form offers it: each choice names what is counted', () => {
    expect(winChoices('gym_days')).toEqual([
      { id: 'most', title: 'Most gym days wins', sub: 'The person with the most gym days when it ends comes 1st.' },
      { id: 'target', title: 'Reach a target', sub: 'You set the target, such as 12 gym days. Everyone who reaches it wins.' },
    ]);
    expect(winChoices('workout_days', 'staff')).toEqual([
      { id: 'most', title: 'Most workout days wins', sub: "The team with the most workout days when it ends comes 1st. A team's number is its people's numbers added together." },
      { id: 'target', title: 'Reach a target', sub: 'You set a target for a whole team, such as 60 workout days. Every team that reaches it wins.' },
    ]);
    expect(winChoices('own', 'none', 'push-ups', WORDS)).toEqual([
      { id: 'most', title: 'Most push-ups wins', sub: 'The member with the most push-ups when it ends comes 1st.' },
      { id: 'target', title: 'Reach a target', sub: 'You set the target, such as 100 push-ups. Everyone who reaches it wins.' },
      { id: 'lowest', title: 'Fewest push-ups wins', sub: 'For a fastest time. The member with the fewest push-ups when it ends comes 1st.' },
    ]);
    // Before the staff's own word is typed, the choices still read as sentences.
    expect(winChoices('own', 'none', ' ').map((c) => c.title)).toEqual(['Highest number wins', 'Reach a target', 'Lowest number wins']);
    expect(winChoices('own', 'none', '', WORDS).map((c) => c.sub)).toEqual([
      'The member with the highest number when it ends comes 1st.',
      'You set the target, such as 100. Everyone who reaches it wins.',
      'For a fastest time. The member with the lowest number when it ends comes 1st.',
    ]);
    expect(winChoices('own', 'staff', '')[0].sub).toBe("The team with the highest number when it ends comes 1st. A team's number is its people's numbers added together.");
    const teams = winChoices('own', 'members', ' seconds ');
    expect(teams.map((c) => c.title)).toEqual(['Most seconds wins', 'Reach a target', 'Fewest seconds wins']);
    expect(teams[1].sub).toBe('You set a target for a whole team, such as 500 seconds. Every team that reaches it wins.');
    expect(teams[2].sub).toBe('For a fastest time. The team with the lowest total comes 1st. A team gets its place once everyone in it has a number, so give each team the same number of people.');
  });

  it('individual or teams, and who puts people in the teams, in the words of the kind of place', () => {
    expect(teamChoices(WORDS)).toEqual([
      { id: 'none', title: 'Individual', sub: 'Each member competes on their own.' },
      { id: 'staff', title: 'Teams: you put people in them', sub: 'You name the teams, then put each member in one.' },
      { id: 'members', title: 'Teams: your members pick their own', sub: 'You name the teams. Each member picks their own in the app.' },
    ]);
    expect(teamChoices({ people: 'clients', peopleCap: 'Clients', person: 'client' }).map((c) => c.title)).toEqual(['Individual', 'Teams: you put people in them', 'Teams: your clients pick their own']);
    // The same words as the heading over the teams on the challenge's own page.
    expect(teamChoices(WORDS).slice(1).map((c) => c.title.replace(':', ' ·'))).toEqual([teamsHeading({ teams: 'staff' }, WORDS), teamsHeading({ teams: 'members' }, WORDS)]);
  });

  it('the target box says what its number is a number of', () => {
    expect(targetUnit(draft())).toBe('gym days');
    expect(targetUnit(draft({ counts: 'workout_days' }))).toBe('workout days');
    expect(targetUnit(draft({ counts: 'own', unit: ' push-ups ' }))).toBe('push-ups');
    expect(targetUnit(draft({ counts: 'own', unit: '' }))).toBe('');
    expect(targetUnit(draft({ teams: 'staff' }))).toBe('gym days, for a whole team');
  });

  it('the form says the challenge back in the same words as it is filled in', () => {
    const list = { today: TODAY, inApp: 4 };
    const said = (over) => Object.fromEntries(draftSummary(draft(over), list, WORDS).map((line) => [line.label, line.value]));
    expect(said({})).toEqual({
      Name: 'October Challenge',
      When: 'Thu 8 Oct – Sat 31 Oct · 24 days',
      Counts: 'Gym days · counted by the app',
      'How it is won': 'Most gym days wins',
      'Who is in it': 'Everyone in the app · 4 people',
      Teams: 'Individual, no teams',
      Prize: 'None',
    });
    expect(said({ counts: 'own', unit: 'push-ups', win: 'target', target: '100', who: 'joined' })).toMatchObject({ Counts: 'Push-ups · counted by your staff', 'How it is won': 'Reach 100 push-ups', 'Who is in it': 'Members who join' });
    // Not typed yet: said in general words, never a half sentence.
    expect(said({ counts: 'own', unit: '' })).toMatchObject({ Counts: 'Not said yet · counted by your staff', 'How it is won': 'Highest number wins' });
    expect(said({ counts: 'own', unit: '', win: 'lowest' })['How it is won']).toBe('Lowest number wins');
    expect(said({ counts: 'own', unit: '', win: 'most', teams: 'staff' })['How it is won']).toBe('The team with the highest number wins');
    expect(said({ counts: 'own', unit: '', win: 'target', target: '100' })['How it is won']).toBe('Reach 100');
    expect(said({ win: 'target', target: '' })['How it is won']).toBe('Reach a target');
    expect(said({ win: 'target', target: '60', teams: 'members', teamList: [{ id: null, name: 'Red' }, { id: null, name: ' Blue ' }] })).toMatchObject({ 'How it is won': 'Reach 60 gym days as a team', Teams: 'Red, Blue · your members pick their own' });
    expect(said({ teams: 'staff', teamList: [{ id: null, name: 'Red' }, { id: null, name: '' }] }).Teams).toBe('Red · you put people in them');
    expect(Object.fromEntries(draftSummary(draft(), { today: TODAY, inApp: 1 }, WORDS).map((line) => [line.label, line.value]))['Who is in it']).toBe('Everyone in the app · 1 person');
    // What is missing is marked as missing.
    expect(draftSummary(draft({ counts: 'own', unit: '' }), list, WORDS).find((line) => line.label === 'Counts').empty).toBe(true);
    expect(draftSummary(draft(), list, WORDS).find((line) => line.label === 'Counts').empty).toBe(false);
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
