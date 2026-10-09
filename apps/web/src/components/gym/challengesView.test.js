// A member's Challenges, in words (spec Part 3 §15.6; ROADMAP 19d-i). Every sentence a
// member reads, written out here from what the screen should say.
import { describe, expect, it } from 'vitest';
import {
  boardNote,
  challengeChip,
  challengeDates,
  countText,
  dayMarks,
  howToWin,
  joinNote,
  leaveBox,
  markLabel,
  noChallenges,
  notCountingNote,
  oneOf,
  placeLine,
  progress,
  resultOf,
  whatCounts,
  whoLine,
} from './challengesView';

const TODAY = '2026-10-07'; // a Wednesday

const me = (over = {}) => ({ value: 0, place: null, hidden: null, toNextPlace: null, nextPlace: null, reached: false, days: [], ...over });
const row = (name, place, value, over = {}) => ({ userId: `u-${name}`, name, initials: name.slice(0, 1), place, value, reached: false, isMe: false, ...over });
const board = (over = {}) => ({ status: 'shown', ranked: 24, top: [], leaders: 1, reached: null, ...over });
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
  joined: false,
  can: { join: false, leave: false },
  joinedCount: null,
  board: board(),
  me: me(),
  ...over,
});

describe("one of the gym's own word", () => {
  // Words gyms count by, from real challenge boards: what is one of each?
  it.each([
    ['push-ups', 'push-up'],
    ['Push-Ups', 'Push-Up'],
    ['reps', 'rep'],
    ['seconds', 'second'],
    ['minutes', 'minute'],
    ['kilometres', 'kilometre'],
    ['laps', 'lap'],
    ['lunges', 'lunge'],
    ['burpees', 'burpee'],
    ['boxes', 'box'],
    ['crunches', 'crunch'],
    ['passes', 'pass'],
    ['presses', 'press'],
    // Left as typed: not a plain plural, or not a plural at all.
    ['press', 'press'],
    ['calories', 'calorie'],
    ['abs', 'abs'],
    ['series', 'series'],
    ['kg lifted', 'kg lifted'],
    ['5 km time', '5 km time'],
    ['km', 'km'],
    ['bonus', 'bonus'],
    ['tennis', 'tennis'],
    ['kg', 'kg'],
    ['公里', '公里'],
    ['x2s', 'x2s'],
  ])('%s → %s', (typed, one) => {
    expect(oneOf(typed)).toBe(one);
    expect(countText(1, 'own', typed)).toBe(`1 ${one}`);
    expect(countText(2, 'own', typed)).toBe(`2 ${typed}`);
  });
});

describe('the mark beside the name', () => {
  it.each([
    ['its last day', { endsOn: TODAY }, { text: 'Last day', tone: 'hot' }],
    ['three days to go, today counted', { endsOn: '2026-10-09' }, { text: '3 days left', tone: 'hot' }],
    ['five days to go', {}, { text: '5 days left', tone: 'good' }],
    ['starting tomorrow', { state: 'coming', startsOn: '2026-10-08' }, { text: 'Starts tomorrow', tone: 'plain' }],
    ['starting next week', { state: 'coming', startsOn: '2026-10-12' }, { text: 'Starts in 5 days', tone: 'plain' }],
    ['ended', { state: 'ended', endsOn: '2026-10-06' }, { text: 'Ended', tone: 'plain' }],
    ['cancelled, whatever its dates', { cancelled: true }, { text: 'Cancelled', tone: 'bad' }],
  ])('%s', (_what, over, chip) => {
    expect(challengeChip(challenge(over), TODAY)).toEqual(chip);
  });
});

describe('its dates and how it is won', () => {
  it('prints the gym\'s own days, and a year only where it is not this one', () => {
    expect(challengeDates(challenge(), TODAY)).toBe('Mon 5 Oct – Sun 11 Oct');
    expect(challengeDates(challenge({ startsOn: TODAY, endsOn: TODAY }), TODAY)).toBe('Wed 7 Oct');
    expect(challengeDates(challenge({ startsOn: '2026-12-21', endsOn: '2027-01-03' }), TODAY)).toBe('Mon 21 Dec – Sun 3 Jan 2027');
  });

  it('says how it is won', () => {
    expect(howToWin(challenge())).toBe('Most gym days wins');
    expect(howToWin(challenge({ counts: 'workout_days' }))).toBe('Most workout days wins');
    expect(howToWin(challenge({ target: 12 }))).toBe('Reach 12 gym days');
    expect(howToWin(challenge({ target: 1, counts: 'workout_days' }))).toBe('Reach 1 workout day');
  });

  it('says what is counted, in words for somebody new', () => {
    expect(whatCounts(challenge(), 'Iron House')).toBe(
      "A gym day is a day you're checked in at Iron House: a scan at the front desk, or a check-in by staff. Two visits on one day are one. It is the same count as the Leaderboard.",
    );
    expect(whatCounts(challenge({ counts: 'workout_days' }), 'Iron House')).toBe(
      'A workout day is a day you finish a workout in the app, at the gym or at home. Two on one day are one. It is the same count as the Leaderboard.',
    );
  });

  it('says who is in it', () => {
    expect(whoLine(challenge(), 'Iron House')).toBe('Everyone at Iron House is in');
    expect(whoLine(challenge({ who: 'joined', joinedCount: 0 }), 'Iron House')).toBe('Nobody has joined yet');
    expect(whoLine(challenge({ who: 'joined', joinedCount: 1 }), 'Iron House')).toBe('1 person has joined');
    expect(whoLine(challenge({ who: 'joined', joinedCount: 1240 }), 'Iron House')).toBe('1,240 people have joined');
  });
});

describe("the member's own number", () => {
  it('with a target: the bar, what is left, and Done at the target', () => {
    expect(progress(challenge({ target: 12, me: me({ value: 8 }) }))).toEqual({ big: 8, of: 12, unit: 'gym days', percent: 67, note: '4 to go', done: false });
    expect(progress(challenge({ target: 12, me: me({ value: 0 }) }))).toEqual({ big: 0, of: 12, unit: 'gym days', percent: 0, note: '12 to go', done: false });
    expect(progress(challenge({ target: 12, me: me({ value: 12, reached: true }) }))).toEqual({ big: 12, of: 12, unit: 'gym days', percent: 100, note: 'Done. You reached 12 gym days.', done: true });
    // Past the target the bar stays full.
    expect(progress(challenge({ target: 12, me: me({ value: 15, reached: true }) })).percent).toBe(100);
  });

  it('with no target: the number and its word, no bar', () => {
    expect(progress(challenge({ me: me({ value: 1 }) }))).toEqual({ big: 1, of: null, unit: 'gym day', percent: null, note: null, done: false });
    expect(progress(challenge({ counts: 'workout_days', me: me({ value: 5 }) }))).toMatchObject({ big: 5, unit: 'workout days', percent: null });
  });

  it('an ended challenge says nothing is "to go", and somebody not in it has no number', () => {
    expect(progress(challenge({ state: 'ended', target: 12, me: me({ value: 8 }) })).note).toBeNull();
    expect(progress(challenge({ me: null }))).toBeNull();
  });

  it('their place, and what it takes to move up', () => {
    expect(placeLine(challenge({ me: me({ value: 5, place: 3, toNextPlace: 2, nextPlace: 2 }) }))).toBe('3rd of 24 · 2 more gym days to reach 2nd');
    expect(placeLine(challenge({ me: me({ value: 5, place: 4, toNextPlace: 1, nextPlace: 1 }), counts: 'workout_days' }))).toBe('4th of 24 · 1 more workout day to reach 1st');
    expect(placeLine(challenge({ me: me({ value: 9, place: 1 }) }))).toBe('1st of 24');
    expect(placeLine(challenge({ state: 'ended', me: me({ value: 5, place: 3, toNextPlace: 2, nextPlace: 2 }) }))).toBe('3rd of 24');
    // No place yet, hidden, or not in it: nothing is said of a place.
    expect(placeLine(challenge({ me: me({ value: 0 }) }))).toBeNull();
    expect(placeLine(challenge({ me: me({ value: 9, place: 1, hidden: 'hide_me' }) }))).toBeNull();
    expect(placeLine(challenge({ me: null }))).toBeNull();
  });
});

describe('when there is nothing to show', () => {
  it('says why there are no places yet', () => {
    expect(boardNote(challenge({ board: board({ status: 'too_few', ranked: 0 }) }))).toBe('The places show once 3 people have a gym day in this challenge.');
    expect(boardNote(challenge({ counts: 'workout_days', board: board({ status: 'too_few', ranked: 0 }) }))).toBe('The places show once 3 people have a workout day in this challenge.');
    expect(boardNote(challenge())).toBeNull();
    expect(boardNote(challenge({ state: 'coming', board: board({ status: 'not_started' }) }))).toBeNull();
  });

  it('a gym that checks nobody in: a gym-days challenge says nothing is being counted, never a bare 0', () => {
    const list = { gymName: 'Iron House', checkingIn: false };
    expect(notCountingNote(challenge(), list)).toBe("Iron House hasn't checked anyone in at the front desk in the last 30 days, so no gym days are being counted.");
    expect(notCountingNote(challenge(), { ...list, checkingIn: true })).toBeNull();
    expect(notCountingNote(challenge({ counts: 'workout_days' }), list)).toBeNull();
    expect(notCountingNote(challenge({ state: 'ended' }), list)).toBeNull();
    expect(notCountingNote(challenge({ state: 'coming' }), list)).toBeNull();
  });

  it('says so when a gym has no challenge', () => {
    expect(noChallenges('Iron House')).toBe('Iron House has no challenges on right now.');
  });
});

describe('how it finished', () => {
  const ended = (over = {}) => challenge({ state: 'ended', endsOn: '2026-10-06', ...over });
  const top = [row('Maya K.', 1, 14), row('Tom B.', 2, 13), row('Priya S.', 3, 11)];

  it('is nothing until it has ended, and nothing for a cancelled one', () => {
    expect(resultOf(challenge())).toBeNull();
    expect(resultOf(ended({ cancelled: true }))).toBeNull();
  });

  it('most wins: the winner by name, and the member\'s own finish', () => {
    expect(resultOf(ended({ board: board({ top }), me: me({ value: 9, place: 5 }) }))).toEqual({
      headline: 'Winner: Maya K., with 14 gym days.',
      mine: 'You finished 5th, with 9 gym days.',
    });
    expect(resultOf(ended({ board: board({ top: [row('Maya K.', 1, 14, { isMe: true }), top[1], top[2]] }), me: me({ value: 14, place: 1 }) }))).toEqual({
      headline: 'You won, with 14 gym days.',
      mine: null,
    });
    expect(resultOf(ended({ board: board({ top }), me: me({ value: 0 }) })).mine).toBe('You had no gym days in it.');
    expect(resultOf(ended({ board: board({ top }), me: null })).mine).toBeNull();
    // A hidden member is told their number, never a place.
    expect(resultOf(ended({ board: board({ top }), me: me({ value: 20, place: 1, hidden: 'hide_me' }) })).mine).toBe('You had 20 gym days.');
  });

  it.each([
    ['two share first', [row('Maya K.', 1, 14), row('Tom B.', 1, 14), row('Priya S.', 3, 11)], 2, 'Joint winners: Maya K. and Tom B., with 14 gym days each.'],
    ['three share first', [row('Maya K.', 1, 14), row('Tom B.', 1, 14), row('Priya S.', 1, 14)], 3, 'Joint winners: Maya K., Tom B. and Priya S., with 14 gym days each.'],
    ['five share first, three named', [row('Maya K.', 1, 14), row('Tom B.', 1, 14), row('Priya S.', 1, 14)], 5, 'Joint winners: Maya K., Tom B., Priya S. and 2 more, with 14 gym days each.'],
    ['the member is one of two', [row('Maya K.', 1, 1), row('Tom B.', 1, 1, { isMe: true }), row('Priya S.', 3, 11)], 2, 'Joint winners: Maya K. and You, with 1 gym day each.'],
  ])('%s', (_what, rows, leaders, headline) => {
    expect(resultOf(ended({ board: board({ top: rows, leaders }), me: null })).headline).toBe(headline);
  });

  it('a target: how many reached it, and whether the member did', () => {
    expect(resultOf(ended({ target: 12, board: board({ top, reached: 7 }), me: me({ value: 12, reached: true, place: 3 }) }))).toEqual({
      headline: '7 people reached 12 gym days.',
      mine: 'You reached it: 12 gym days.',
    });
    expect(resultOf(ended({ target: 12, board: board({ top, reached: 1 }), me: me({ value: 8, place: 9 }) }))).toEqual({
      headline: '1 person reached 12 gym days.',
      mine: 'You got to 8 of 12.',
    });
    expect(resultOf(ended({ target: 12, board: board({ top, reached: 0 }), me: null })).headline).toBe('Nobody reached 12 gym days.');
  });

  it('fewer than three people in it: says so, and still the member\'s own number', () => {
    expect(resultOf(ended({ board: board({ status: 'too_few', ranked: 0, leaders: 0 }), me: me({ value: 3 }) }))).toEqual({
      headline: 'It finished with fewer than 3 people in it, so there are no places.',
      mine: 'You had 3 gym days.',
    });
  });
});

describe('the days as flames', () => {
  const states = (weeks) => weeks.map((week) => week.map((cell) => (cell === null ? '-' : cell.state[0])).join(''));

  it('a week: counted, missed, today still open, and the days ahead', () => {
    const marks = dayMarks(challenge({ me: me({ value: 1, days: ['2026-10-05'] }) }), TODAY);
    expect(marks.whole).toBe(true);
    expect(states(marks.weeks)).toEqual(['ynoaaaa']);
    expect(marks.weeks[0][0]).toEqual({ day: '2026-10-05', state: 'yes' });
  });

  it('a month that starts on a Thursday: weeks Monday first, blank outside it', () => {
    const marks = dayMarks(challenge({ startsOn: '2026-10-01', endsOn: '2026-10-31', me: me({ value: 3, days: ['2026-10-01', '2026-10-03', '2026-10-07'] }) }), TODAY);
    expect(states(marks.weeks)).toEqual(['---ynyn', 'nnyaaaa', 'aaaaaaa', 'aaaaaaa', 'aaaaaa-']);
  });

  it('longer than five weeks: only the week it is in', () => {
    const marks = dayMarks(challenge({ startsOn: '2026-09-07', endsOn: '2026-12-31', me: me({ value: 2, days: ['2026-09-08', '2026-10-06'] }) }), TODAY);
    expect(marks.whole).toBe(false);
    expect(states(marks.weeks)).toEqual(['nyoaaaa']);
  });

  it('an ended one shows its last week; one not started, cancelled or not theirs shows none', () => {
    const ended = dayMarks(challenge({ state: 'ended', startsOn: '2026-07-01', endsOn: '2026-09-30', me: me({ value: 1, days: ['2026-09-29'] }) }), TODAY);
    expect(states(ended.weeks)).toEqual(['nyn----']);
    expect(dayMarks(challenge({ state: 'coming' }), TODAY)).toBeNull();
    expect(dayMarks(challenge({ cancelled: true }), TODAY)).toBeNull();
    expect(dayMarks(challenge({ me: null }), TODAY)).toBeNull();
  });

  it('names each flame for a screen reader', () => {
    expect(markLabel({ day: '2026-10-05', state: 'yes' }, 'gym_days')).toBe('Mon 5 Oct: gym day');
    expect(markLabel({ day: '2026-10-06', state: 'no' }, 'workout_days')).toBe('Tue 6 Oct: no workout day');
    expect(markLabel({ day: '2026-10-07', state: 'open' }, 'gym_days')).toBe('Wed 7 Oct: today, not counted yet');
    expect(markLabel({ day: '2026-10-08', state: 'ahead' }, 'gym_days')).toBe('Thu 8 Oct: still to come');
  });
});

describe('joining and leaving', () => {
  it('says what joining does', () => {
    const open = { join: true, leave: false };
    expect(joinNote(challenge({ who: 'joined', can: open }))).toBe('Your gym days since Mon 5 Oct count as soon as you join.');
    expect(joinNote(challenge({ who: 'joined', can: open, state: 'coming', startsOn: '2026-10-12', counts: 'workout_days' }))).toBe("Join now and you're in from Mon 12 Oct.");
    expect(joinNote(challenge())).toBeNull();
  });

  it('asks before leaving, and says what is kept', () => {
    expect(leaveBox(challenge({ counts: 'workout_days' }))).toEqual({
      title: 'Leave October Challenge?',
      line: 'You come off its board. Your workout days stay yours, and you can join again until it ends.',
      yes: 'Leave',
      no: 'Stay in',
    });
  });

  it('counts in words', () => {
    expect([countText(1, 'gym_days'), countText(2, 'workout_days'), countText(1200, 'gym_days')]).toEqual(['1 gym day', '2 workout days', '1,200 gym days']);
  });
});

describe("the gym's own count, in the gym's own word", () => {
  const own = (over = {}) => challenge({ counts: 'own', unit: 'push-ups', lowestWins: false, ...over });

  it('says how it is won and what is counted', () => {
    expect(howToWin(own())).toBe('Most push-ups wins');
    expect(howToWin(own({ target: 50 }))).toBe('Reach 50 push-ups');
    expect(howToWin(own({ unit: 'seconds', lowestWins: true }))).toBe('Lowest seconds wins');
    expect(whatCounts(own(), 'Iron House')).toBe("The staff at Iron House count the push-ups and add each person's number. If yours is missing or wrong, ask at the front desk.");
  });

  it("the member's number, and that staff have not added one yet", () => {
    expect(progress(own({ target: 50, me: me({ value: 20 }) }))).toEqual({ big: 20, of: 50, unit: 'push-ups', percent: 40, note: '30 to go', done: false });
    expect(progress(own({ me: me({ value: 0 }) }))).toEqual({ big: 0, of: null, unit: 'push-ups', percent: null, note: "The staff haven't added your number yet.", done: false });
    expect(progress(own({ target: 50, me: me({ value: 0 }) })).note).toBe("The staff haven't added your number yet.");
    expect(progress(own({ state: 'ended', me: me({ value: 0 }) })).note).toBeNull();
  });

  it('what it takes to move up: more, or fewer where the lowest wins', () => {
    expect(placeLine(own({ me: me({ value: 10, place: 4, toNextPlace: 30, nextPlace: 2 }) }))).toBe('4th of 24 · 30 more push-ups to reach 2nd');
    expect(placeLine(own({ unit: 'seconds', lowestWins: true, me: me({ value: 130, place: 4, toNextPlace: 20, nextPlace: 2 }) }))).toBe('4th of 24 · 20 fewer seconds to reach 2nd');
  });

  it('has no flames, and its result and its notes use its word', () => {
    expect(dayMarks(own({ me: me({ value: 20 }) }), TODAY)).toBeNull();
    expect(boardNote(own({ board: board({ status: 'too_few', ranked: 0 }) }))).toBe('The places show once 3 people have a number in this challenge.');
    const ended = own({ state: 'ended', board: board({ top: [row('Maya K.', 1, 80), row('Tom B.', 2, 70), row('Priya S.', 3, 60)] }), me: me({ value: 40, place: 6 }) });
    expect(resultOf(ended)).toEqual({ headline: 'Winner: Maya K., with 80 push-ups.', mine: 'You finished 6th, with 40 push-ups.' });
    expect(resultOf({ ...ended, me: me({ value: 0 }) }).mine).toBe('No number was added for you.');
    expect(joinNote(own({ who: 'joined', can: { join: true, leave: false } }))).toBe('Join, and the staff can add your number.');
    expect(leaveBox(own()).line).toBe('You come off its board. You can join again until it ends.');
    expect(countText(40, 'own', 'push-ups')).toBe('40 push-ups');
  });
});
