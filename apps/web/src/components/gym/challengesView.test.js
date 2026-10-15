// A member's Challenges, in words (spec Part 3 §15.6; ROADMAP 19d-i). Every sentence a
// member reads, written out here from what the screen should say.
import { describe, expect, it } from 'vitest';
import { sentChallenge } from './__fixtures__/sentChallenge';
import {
  aboutLine,
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
  placeLine,
  printed,
  progress,
  resultOf,
  whatCounts,
  whoLine,
} from './challengesView';

const TODAY = '2026-10-07'; // a Wednesday
/** A kind's words, as the server sends them. */
const words = (counts, unit = '') => sentChallenge({ counts, unit }).words;

const me = (over = {}) => ({ value: 0, place: null, hidden: null, toNextPlace: null, nextPlace: null, reached: false, days: [], ...over });
const row = (name, place, value, over = {}) => ({ userId: `u-${name}`, name, initials: name.slice(0, 1), place, value, reached: false, isMe: false, ...over });
const board = (over = {}) => ({ status: 'shown', ranked: 24, top: [], leaders: 1, reached: null, ...over });
const challenge = (over = {}) => sentChallenge({
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
    expect(markLabel({ day: '2026-10-05', state: 'yes' }, words('gym_days'))).toBe('Mon 5 Oct: gym day');
    expect(markLabel({ day: '2026-10-06', state: 'no' }, words('workout_days'))).toBe('Tue 6 Oct: no workout day');
    expect(markLabel({ day: '2026-10-07', state: 'open' }, words('gym_days'))).toBe('Wed 7 Oct: today, not counted yet');
    expect(markLabel({ day: '2026-10-08', state: 'ahead' }, words('gym_days'))).toBe('Thu 8 Oct: still to come');
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
    expect([countText(1, words('gym_days')), countText(2, words('workout_days')), countText(1200, words('gym_days'))]).toEqual(['1 gym day', '2 workout days', '1,200 gym days']);
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
    expect(countText(40, words('own', 'push-ups'))).toBe('40 push-ups');
    expect([countText(1, words('own', 'push-ups')), countText(1, words('own', 'kg lifted'))]).toEqual(['1 push-up', '1 kg lifted']);
  });
});

describe('what it is about, and how it is counted (19d-iii-a-i)', () => {
  it('says each kind a gym can make in one line', () => {
    expect(aboutLine(challenge())).toBe('Gym visits · Checked in at the front desk');
    expect(aboutLine(challenge({ counts: 'workout_days' }))).toBe('Workouts in the app · Counted by the app');
    expect(aboutLine(challenge({ counts: 'own', unit: 'push-ups' }))).toBe('Push-ups · Counted by the staff at Iron House');
  });

  // An old copy of the app is never updated: a kind added after it was built must still read
  // right, from the words the server sends with it, and never as a gym-days challenge.
  const steps = challenge({
    counts: undefined,
    subject: 'steps',
    measure: 'steps',
    countedBy: 'app',
    words: { about: 'Steps', one: 'step', many: 'steps', print: 'whole', how: 'app', howLine: 'Counted by your phone', explain: 'Every step your phone counted between the first and last day.', perDay: false },
    target: null,
    me: me({ value: 9400, place: 2, toNextPlace: 1, nextPlace: 1 }),
  });

  it('a kind this screen has never heard of reads in the words it was sent', () => {
    expect(aboutLine(steps)).toBe('Steps · Counted by your phone');
    expect(howToWin(steps)).toBe('Most steps wins');
    expect(whatCounts(steps)).toBe('Every step your phone counted between the first and last day.');
    expect(placeLine(steps)).toBe('2nd of 24 · 1 more step to reach 1st');
    expect(progress(steps)).toMatchObject({ big: 9400, unit: 'steps' });
    expect(howToWin({ ...steps, target: 10000 })).toBe('Reach 10,000 steps');
    expect(resultOf({ ...steps, state: 'ended', me: me({ value: 0 }), board: board({ top: [row('Maya K.', 1, 12000)] }) })).toEqual({ headline: 'Winner: Maya K., with 12,000 steps.', mine: 'You had no steps in it.' });
    expect(boardNote({ ...steps, board: board({ status: 'too_few', ranked: 0 }) })).toBe('The places show once 3 people have a step in this challenge.');
    expect(joinNote({ ...steps, who: 'joined', can: { join: true, leave: false } })).toBe('Your steps since Mon 5 Oct count as soon as you join.');
  });

  // A distance kept in metres and a time kept in seconds, printed as the words say (§15.10.2).
  const km = { about: 'Running', one: 'km', many: 'km', print: 'km', how: 'gps', howLine: 'Measured by GPS', explain: 'Runs your phone measured.', perDay: false };
  const time = { about: 'Plank', one: 'second', many: 'seconds', print: 'time', how: 'camera', howLine: 'Counted by the camera', explain: 'Time held.', perDay: false };

  it('prints a distance in km cut to a tenth, never rounded up past a target, and a time in minutes and seconds', () => {
    expect([printed(12_480, km), printed(19_990, km), printed(20_000, km), printed(950, km), printed(1_234_560, km)]).toEqual(['12.4 km', '19.9 km', '20.0 km', '0.9 km', '1,234.5 km']);
    expect([printed(45, time), printed(60, time), printed(125, time), printed(3_720, time), printed(0, time)]).toEqual(['45 s', '1 min 00 s', '2 min 05 s', '1 h 02 min', '0 s']);
    expect(printed(1_200, words('gym_days'))).toBe('1,200');
  });

  it('a distance or a time reads in its own units on the card, never as a whole number with a word after it', () => {
    const run = challenge({ counts: undefined, subject: 'running', measure: 'metres', countedBy: 'app', words: km, target: 20_000, me: me({ value: 12_480, place: 2, toNextPlace: 360, nextPlace: 1 }) });
    expect(howToWin(run)).toBe('Reach 20.0 km');
    expect(progress(run)).toMatchObject({ big: 12_480, of: 20_000, unit: '', note: '7.5 km to go' });
    expect(placeLine(run)).toBe('2nd of 24 · 0.3 km more to reach 1st');
    expect(resultOf({ ...run, state: 'ended', target: null, board: board({ top: [row('Maya K.', 1, 21_090)] }) }).headline).toBe('Winner: Maya K., with 21.0 km.');
    expect(resultOf({ ...run, state: 'ended', board: board({ reached: 0 }) })).toEqual({ headline: 'Nobody reached 20.0 km.', mine: 'You got to 12.4 km of 20.0 km.' });
    const plank = challenge({ counts: undefined, subject: 'exercise', measure: 'best_hold', countedBy: 'app', words: time, me: me({ value: 125, place: 1 }) });
    expect(progress(plank)).toMatchObject({ big: 125, unit: '' });
    expect(countText(125, time)).toBe('2 min 05 s');
  });

  it('draws no days for a kind that is not one a day, and says no front desk where none counts it', () => {
    expect(dayMarks(steps, TODAY)).toBeNull();
    expect(notCountingNote(steps, { checkingIn: false, gymName: 'Iron House' })).toBeNull();
    expect(JSON.stringify([howToWin(steps), placeLine(steps), leaveBox(steps).line])).not.toMatch(/gym day|workout day|front desk/u);
  });
});
