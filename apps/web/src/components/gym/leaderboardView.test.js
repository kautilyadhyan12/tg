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
    expect(datesLine(board({ board: 'streak', from: null }))).toBe("Weeks in a row, up to this week · Iron House's time");
    // 29 February is printed as itself, never moved by the reader's zone.
    expect(datesLine(board({ from: '2028-02-28', to: '2028-03-05' }))).toBe("Mon 28 Feb – Sun 5 Mar · Iron House's time");
  });

  it('says why there is no board, and nothing when there is one', () => {
    expect(statusText(board())).toBeNull();
    expect(statusText(board({ status: 'too_few' }))).toBe('The board shows once 3 people have a gym day in this period.');
    expect(statusText(board({ status: 'too_few', board: 'streak' }))).toBe('The board shows once 3 people have a streak.');
    expect(statusText(board({ status: 'no_checkins' }))).toMatch(/^Iron House hasn't checked anyone in at the front desk in the last 30 days/);
    expect(statusText(board({ status: 'paused' }))).toBe("The leaderboard isn't available at Iron House right now.");
  });

  it('tells the hidden person why only they see their row', () => {
    expect(hiddenText('hide_me', 'Iron House')).toBe('Hide me is on. Only you see this row.');
    expect(hiddenText('under_18', 'Iron House')).toMatch(/under 18/);
    expect(hiddenText('no_name', 'Iron House')).toMatch(/Add your name/);
    expect(hiddenText('taken_off', 'Iron House')).toBe('Iron House took you off the board. Only you see this row.');
    expect(hiddenText('staff', 'Iron House')).toBe('Staff, not ranked.');
    expect(hiddenText(null, 'Iron House')).toBeNull();
  });

  it('says what each board counts, and that the old tap does not', () => {
    expect(whatCounts('gym_days', 'Iron House').join(' ')).toMatch(/front desk/);
    expect(whatCounts('gym_days', 'Iron House').join(' ')).toMatch(/I'm here" in the app doesn't count/);
    expect(whatCounts('streak', 'Iron House').join(' ')).toMatch(/checked nobody in doesn't count and doesn't break it/);
  });

  it('places, numbers and the next place up', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st', '111th']);
    expect(valueText(1, 'gym_days')).toBe('1 gym day');
    expect(valueText(4, 'streak')).toBe('4 weeks');
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

  it('a Streak week says what happened to it', () => {
    expect(weekText({ weekStart: '2026-09-21', state: 'skipped', gymDays: 0 }, 'Iron House').text).toMatch(/checked nobody in — skipped/);
    expect(weekText({ weekStart: '2026-09-28', state: 'counted', gymDays: 2 }, 'Iron House')).toEqual({ label: 'Week of 28 Sep', text: '2 gym days — counted' });
    expect(circleLabel('open', '2026-10-05', 'streak')).toBe('Week of 5 Oct: this week, still open');
    expect(circleLabel('yes', '2026-10-05', 'gym_days')).toBe('Mon 5 Oct: gym day');
  });

  it('the gym picker remembers a gym only while the person is still in it', () => {
    const gyms = [{ id: 'a' }, { id: 'b' }];
    expect(pickedGym(gyms, 'b')).toBe('b');
    expect(pickedGym(gyms, 'gone')).toBe('a');
    expect(pickedGym(gyms, null)).toBe('a');
    expect(pickedGym([], 'b')).toBeNull();
  });
});
