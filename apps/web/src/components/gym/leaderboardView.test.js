import { describe, expect, it } from 'vitest';
import {
  circleLabel,
  datesLine,
  dayCountText,
  hiddenText,
  nextPlaceText,
  ordinal,
  pickedGym,
  statusText,
  updatedText,
  valueText,
  visitText,
  weekText,
  whatCounts,
  workoutCountText,
  workoutNotCountedText,
  workoutText,
} from './leaderboardView';

const board = (over = {}) => ({
  gymName: 'Iron House',
  board: 'gym_days',
  from: '2026-10-05',
  to: '2026-10-11',
  status: 'shown',
  ...over,
});

describe('the leaderboard in words', () => {
  it('prints the board’s dates in the gym’s calendar', () => {
    expect(datesLine(board())).toBe("Mon 5 Oct – Sun 11 Oct · Iron House's time");
    expect(datesLine(board({ from: null, to: '2026-10-07' }))).toBe("Every gym day up to Wed 7 Oct · Iron House's time");
    expect(datesLine(board({ board: 'workout_days', from: null, to: '2026-10-07' }))).toBe("Every workout day up to Wed 7 Oct · Iron House's time");
    expect(datesLine(board({ board: 'streak', from: null }))).toBe("Weeks in a row, up to this week · Iron House's time");
    // 29 February is printed as itself, never moved by the reader's zone.
    expect(datesLine(board({ from: '2028-02-28', to: '2028-03-05' }))).toBe("Mon 28 Feb – Sun 5 Mar · Iron House's time");
  });

  it('says why there is no board, and nothing when there is one', () => {
    expect(statusText(board())).toBeNull();
    expect(statusText(board({ status: 'too_few' }))).toBe('The board shows once 3 people have a gym day in this period.');
    expect(statusText(board({ status: 'too_few', board: 'workout_days' }))).toBe('The board shows once 3 people have a workout day in this period.');
    expect(statusText(board({ status: 'too_few', board: 'streak' }))).toBe('The board shows once 3 people have a streak.');
    expect(statusText(board({ status: 'no_checkins' }))).toBe(
      "Iron House hasn't checked anyone in at the front desk in the last 30 days, so Gym days and Streak aren't showing. Workout days doesn't need the front desk — see that tab.",
    );
    expect(statusText(board({ status: 'paused' }))).toBe("The leaderboard isn't available at Iron House right now.");
  });

  it('tells the hidden person why only they see their row', () => {
    expect(hiddenText('hide_me', 'Iron House')).toBe('Hide me is on. Only you see this row.');
    expect(hiddenText('under_18', 'Iron House')).toMatch(/under 18/);
    expect(hiddenText('no_name', 'Iron House')).toBe('Add your full name in Settings → Profile to be on the board.');
    expect(hiddenText('taken_off', 'Iron House')).toBe('Iron House took you off the board. Only you see this row.');
    expect(hiddenText('staff', 'Iron House')).toBe('Staff, not ranked.');
    expect(hiddenText(null, 'Iron House')).toBeNull();
  });

  it('says what each board counts, and that the old tap does not', () => {
    expect(whatCounts('gym_days', 'Iron House').join(' ')).toMatch(/front desk/);
    expect(whatCounts('gym_days', 'Iron House').join(' ')).toMatch(/Nothing you tap or type yourself counts/);
    expect(whatCounts('streak', 'Iron House').join(' ')).toMatch(/checked nobody in doesn't count and doesn't break it/);
    expect(whatCounts('workout_days', 'Iron House')).toEqual([
      'One workout day for each day you finished a workout in the app since you joined Iron House, at the gym or at home.',
      'Two workouts on one day are one workout day. A workout counts however its reps were counted, by the camera or by you.',
      'It needs at least one set with a rep or a hold, and to be saved within 7 days.',
      'Equal numbers share a place. Staff, under-18s and anyone who chose Hide me are not shown.',
    ]);
  });

  it('places, numbers and the next place up', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st', '111th']);
    expect(valueText(1, 'gym_days')).toBe('1 gym day');
    expect(valueText(4, 'streak')).toBe('4 weeks');
    expect(valueText(1, 'workout_days')).toBe('1 workout day');
    expect(valueText(0, 'workout_days')).toBe('0 workout days');
    expect(nextPlaceText({ place: 4, toNextPlace: 2, nextPlace: 3 }, 'workout_days')).toBe('2 more workout days to reach 3rd');
    expect(nextPlaceText({ place: 2, toNextPlace: 1, nextPlace: 1 }, 'workout_days')).toBe('1 more workout day to reach 1st');
    expect(nextPlaceText({ place: 4, toNextPlace: 2, nextPlace: 3 }, 'gym_days')).toBe('2 more gym days to reach 3rd');
    // 4th behind two people tied 2nd: the next place is 2nd, never a 3rd nobody holds.
    expect(nextPlaceText({ place: 4, toNextPlace: 1, nextPlace: 2 }, 'gym_days')).toBe('1 more gym day to reach 2nd');
    expect(nextPlaceText({ place: 2, toNextPlace: 1, nextPlace: 1 }, 'streak')).toBe('1 more week to reach 1st');
    expect(nextPlaceText({ place: 1, toNextPlace: null, nextPlace: null }, 'gym_days')).toBeNull();
    expect(nextPlaceText({ place: null, toNextPlace: null, nextPlace: null }, 'gym_days')).toBeNull();
  });

  it('prints times in the gym’s zone', () => {
    expect(updatedText('2026-10-07T05:12:00.000Z', 'Asia/Kolkata')).toBe('Updated 10:42 am');
    expect(visitText({ at: '2026-10-07T08:30:00.000Z', how: 'staff', by: 'Maya Coach' }, 'Asia/Kolkata')).toBe('2:00 pm · checked in by Maya Coach');
    expect(visitText({ at: '2026-10-07T06:30:00.000Z', how: 'desk', by: 'Front desk' }, 'Asia/Kolkata')).toBe('12:00 pm · scanned at Front desk');
    expect(dayCountText(1)).toBe('1 visit');
    expect(dayCountText(2)).toBe('2 visits, 1 day');
  });

  it('a workout says when it was and who counted it, and one that did not count says why', () => {
    const at = '2026-10-06T02:00:00.000Z';
    expect(workoutText({ at, countedBy: 'camera' }, 'Asia/Kolkata')).toBe('7:30 am · counted by the camera');
    expect(workoutText({ at, countedBy: 'you' }, 'Asia/Kolkata')).toBe('7:30 am · counted by you');
    expect(workoutText({ at, countedBy: 'both' }, 'Asia/Kolkata')).toBe('7:30 am · counted by the camera and by you');
    expect(workoutText({ at, countedBy: null }, 'Asia/Kolkata')).toBe('7:30 am');
    // The same instant is the evening before in New York: the gym's clock, not the reader's.
    expect(workoutText({ at, countedBy: 'you' }, 'America/New_York')).toBe('10:00 pm · counted by you');
    expect(workoutCountText(1)).toBe('1 workout');
    expect(workoutCountText(2)).toBe('2 workouts, 1 day');
    expect(workoutNotCountedText({ why: 'saved_late', daysLate: 7 }, 'Iron House')).toBe(
      'Saved more than 7 days after the workout — a workout counts when it is saved within 7 days',
    );
    expect(workoutNotCountedText({ why: 'saved_early', daysLate: null }, 'Iron House')).toBe(
      'Saved before its own start time — check the date and time on your phone',
    );
    // A reason this screen has never heard of is never given another reason's words.
    expect(workoutNotCountedText({ why: 'something_new', daysLate: null }, 'Iron House')).toBe("Didn't count");
    expect(workoutNotCountedText({ why: 'before_joining', daysLate: null }, 'Iron House')).toBe('Before you joined Iron House');
    expect(workoutNotCountedText({ why: 'no_sets', daysLate: null }, 'Iron House')).toBe('No reps or holds saved');
    expect(workoutNotCountedText({ why: 'future', daysLate: null }, 'Iron House')).toBe('Its time is still ahead — it counts once that time has passed');
    expect(circleLabel('yes', '2026-10-05', 'workout_days')).toBe('Mon 5 Oct: workout day');
    expect(circleLabel('no', '2026-10-06', 'workout_days')).toBe('Tue 6 Oct: no workout day');
  });

  it('a Streak week says what happened to it', () => {
    expect(weekText({ weekStart: '2026-09-21', state: 'skipped', gymDays: 0 }, 'Iron House').text).toMatch(/checked nobody in — skipped/);
    expect(weekText({ weekStart: '2026-09-28', state: 'counted', gymDays: 2 }, 'Iron House')).toEqual({ label: 'Week of 28 Sep', text: '2 gym days — counted' });
    expect(circleLabel('open', '2026-10-05', 'streak')).toBe('Week of 5 Oct: this week, still open');
    expect(circleLabel('yes', '2026-10-05', 'gym_days')).toBe('Mon 5 Oct: gym day');
    expect(circleLabel('no', '2026-10-06', 'gym_days')).toBe('Tue 6 Oct: no gym day');
  });

  it('the gym picker remembers a gym only while the person is still in it', () => {
    const gyms = [{ id: 'a' }, { id: 'b' }];
    expect(pickedGym(gyms, 'b')).toBe('b');
    expect(pickedGym(gyms, 'gone')).toBe('a');
    expect(pickedGym(gyms, null)).toBe('a');
    expect(pickedGym([], 'b')).toBeNull();
  });
});

describe('boards the gym switched off (19a-iii)', () => {
  it('the tabs offered are the boards still on, in their usual order', async () => {
    const { boardTabs } = await import('./leaderboardView');
    expect(boardTabs([]).map((t) => t.id)).toEqual(['gym_days', 'workout_days', 'streak']);
    expect(boardTabs(['streak', 'gym_days']).map((t) => t.id)).toEqual(['workout_days']);
    expect(boardTabs(['gym_days', 'workout_days', 'streak'])).toEqual([]);
    expect(boardTabs(undefined).length).toBe(3);
  });

  it('says one board is off, or the whole leaderboard', async () => {
    const { statusText } = await import('./leaderboardView');
    const board = { status: 'switched_off', board: 'gym_days', gymName: 'Iron House' };
    expect(statusText({ ...board, boardsOff: ['gym_days'] })).toBe('Iron House has switched this board off.');
    expect(statusText({ ...board, boardsOff: ['gym_days', 'workout_days', 'streak'] })).toBe('Iron House has switched its leaderboard off.');
  });
});