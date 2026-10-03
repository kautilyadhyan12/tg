import { describe, expect, it } from 'vitest';
import { orgWords } from '@app/shared';
import {
  HIDDEN_TAG,
  boardSwitch,
  boardsOffAfter,
  canSeeLeaderboard,
  countLine,
  emptyLine,
  hiddenLine,
  notInAppLine,
  pageLine,
  staffVisitNotCountedText,
  staffWorkoutNotCountedText,
  takeOffBox,
} from './leaderboardStaffView';

const words = orgWords('gym');
const board = (over = {}) => ({
  board: 'gym_days',
  period: 'this_week',
  memberStatus: 'shown',
  live: true,
  checkingIn: true,
  boardsOff: [],
  ranked: 4,
  total: 9,
  page: 1,
  pages: 1,
  notInApp: 0,
  ...over,
});

describe('who sees the page', () => {
  it.each([
    [['leaderboard.manage'], true],
    [['members.read', 'attendance.read'], false],
    [[], false],
    [undefined, false],
  ])('%j: %s', (privileges, sees) => {
    expect(canSeeLeaderboard(privileges)).toBe(sees);
  });
});

describe('each board’s switch says whether members see it, and why not', () => {
  // Every reason a board is not showing, for the board on screen and for the other two.
  it.each([
    ['on and showing', 'gym_days', {}, true, 'Members see this board.', true],
    ['switched off', 'gym_days', { boardsOff: ['gym_days'], memberStatus: 'switched_off' }, false, "Switched off. Members don't see this board.", false],
    ['switched off wins over a lapsed plan', 'streak', { boardsOff: ['streak'], live: false }, false, "Switched off. Members don't see this board.", false],
    ['the plan lapsed', 'gym_days', { live: false, memberStatus: 'paused' }, true, 'Not showing to members: this gym has no plan right now.', false],
    ['the plan lapsed, another board', 'workout_days', { live: false, memberStatus: 'paused' }, true, 'Not showing to members: this gym has no plan right now.', false],
    [
      'nobody checked in',
      'gym_days',
      { checkingIn: false, memberStatus: 'no_checkins' },
      true,
      'Not showing to members: nobody has been checked in at the front desk in the last 30 days.',
      false,
    ],
    [
      'nobody checked in, the Streak',
      'streak',
      { checkingIn: false, memberStatus: 'no_checkins' },
      true,
      'Not showing to members: nobody has been checked in at the front desk in the last 30 days.',
      false,
    ],
    ['Workout days needs no check-in', 'workout_days', { checkingIn: false, memberStatus: 'no_checkins' }, true, 'Members see this board once 3 people are on it.', false],
    ['too few this period', 'gym_days', { memberStatus: 'too_few' }, true, 'Not showing to members yet: fewer than 3 people have a gym day in this period.', false],
    ['another board, not read', 'streak', {}, true, 'Members see this board once 3 people are on it.', false],
  ])('%s', (_name, id, over, on, line, showing) => {
    expect(boardSwitch(id, board(over), words)).toMatchObject({ on, line, showing });
  });

  it('too few on the Streak and on Workout days, each in its own words', () => {
    expect(boardSwitch('streak', board({ board: 'streak', period: null, memberStatus: 'too_few' }), words).line).toBe(
      'Not showing to members yet: fewer than 3 people have a streak.',
    );
    expect(boardSwitch('workout_days', board({ board: 'workout_days', memberStatus: 'too_few' }), words).line).toBe(
      'Not showing to members yet: fewer than 3 people have a workout day in this period.',
    );
  });

  it('a studio reads its own word for its people', () => {
    expect(boardSwitch('gym_days', board(), orgWords('studio')).line).toBe('Clients see this board.');
  });

  it('pressing a switch gives the next list, in the boards’ order, whatever order it was pressed in', () => {
    expect(boardsOffAfter([], 'streak', false)).toEqual(['streak']);
    expect(boardsOffAfter(['streak'], 'gym_days', false)).toEqual(['gym_days', 'streak']);
    expect(boardsOffAfter(['gym_days', 'streak'], 'gym_days', true)).toEqual(['streak']);
    expect(boardsOffAfter(['streak'], 'streak', false)).toEqual(['streak']);
    expect(boardsOffAfter([], 'gym_days', true)).toEqual([]);
  });
});

describe('the lines above and under the table', () => {
  it('how many people, and how many members do not see', () => {
    expect(countLine(board(), words)).toBe('9 people have a gym day · 5 are hidden from members');
    expect(countLine(board({ total: 1, ranked: 1 }), words)).toBe('1 person has a gym day');
    expect(countLine(board({ total: 2, ranked: 1 }), words)).toBe('2 people have a gym day · 1 is hidden from members');
    expect(countLine(board({ board: 'streak', total: 1200, ranked: 1200 }), words)).toBe('1,200 people have a streak');
    expect(countLine(board({ total: 0, ranked: 0 }), words)).toBeNull();
  });

  it('an empty board says what would put somebody on it', () => {
    expect(emptyLine(board())).toBe('Nobody was checked in during this period.');
    expect(emptyLine(board({ board: 'workout_days' }))).toBe('Nobody finished a workout in the app during this period.');
    expect(emptyLine(board({ board: 'streak' }))).toMatch(/^Nobody has a streak yet/);
    expect(emptyLine(board({ board: 'streak', checkingIn: false }))).toMatch(/no one has been checked in at the front desk in the last 30 days/);
  });

  it('people without the app', () => {
    expect(notInAppLine(0, words)).toBeNull();
    expect(notInAppLine(1, words)).toBe("1 member on your list doesn't have the app yet, so they aren't on any board.");
    expect(notInAppLine(1840, words)).toBe("1,840 members on your list don't have the app yet, so they aren't on any board.");
  });

  it('pages only when there is more than one', () => {
    expect(pageLine(board())).toBeNull();
    expect(pageLine(board({ page: 2, pages: 21 }))).toBe('Page 2 of 21');
  });
});

describe('a hidden person', () => {
  it('every reason has a tag and a sentence', () => {
    for (const reason of ['staff', 'taken_off', 'hide_me', 'under_18', 'no_name']) {
      expect(HIDDEN_TAG[reason]).toBeTruthy();
      expect(hiddenLine(reason, words)).toBeTruthy();
    }
    expect(hiddenLine(null, words)).toBeNull();
  });
});

describe('the box before taking somebody off, or putting them back', () => {
  it('names the person, says who stops seeing them, and what is kept', () => {
    const box = takeOffBox({ name: 'Chen Wu' }, true, 'Iron House', words);
    expect(box.title).toBe('Take Chen Wu off the board?');
    expect(box.button).toBe('Take off the board');
    expect(box.changes).toEqual([
      'Chen Wu — members will stop seeing them on every board at Iron House.',
      'In their app, their own row will say "Iron House took you off the board".',
    ]);
    expect(box.keeps).toEqual(['Their visits and workouts are kept.', 'Nobody else is removed. Everyone below them moves up a place.']);
    expect(box.done).toBe('Chen Wu is off the board.');
  });

  it('putting back', () => {
    const box = takeOffBox({ name: 'Chen Wu' }, false, 'Iron House', words);
    expect(box.title).toBe('Put Chen Wu back on the board?');
    expect(box.changes).toEqual(['Chen Wu — members will see them again, in the place their numbers give.']);
    expect(box.done).toBe('Chen Wu is back on the board.');
  });

  it('a person with no name is still named as something', () => {
    expect(takeOffBox({ name: null }, true, 'Iron House', words).title).toBe('Take No name yet off the board?');
  });
});

describe('what did not count, said about somebody else', () => {
  it.each([
    [{ why: 'saved_late', daysLate: 9 }, 'Saved more than 9 days after the workout — a workout counts when it is saved within 7 days'],
    [{ why: 'saved_early', daysLate: null }, 'Saved before its own start time'],
    [{ why: 'before_joining', daysLate: null }, 'Before they joined Iron House'],
    [{ why: 'no_sets', daysLate: null }, 'No reps or holds saved'],
    [{ why: 'future', daysLate: null }, 'Its time is still ahead — it counts once that time has passed'],
    [{ why: 'something_new', daysLate: null }, "Didn't count"],
  ])('%j', (item, text) => {
    expect(staffWorkoutNotCountedText(item, 'Iron House')).toBe(text);
  });

  it('a visit', () => {
    expect(staffVisitNotCountedText({ why: 'own_tap' })).toMatch(/^Their own "I'm here" tap/);
    expect(staffVisitNotCountedText({ why: 'app_code' })).toMatch(/^Checked in with the app's code/);
  });
});
