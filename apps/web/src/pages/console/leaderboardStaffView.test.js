import { describe, expect, it } from 'vitest';
import { orgWords } from '@app/shared';
import {
  HIDDEN_TAG,
  boardSwitch,
  canSeeLeaderboard,
  countLine,
  emptyLine,
  flamesNote,
  hiddenLine,
  notInAppLine,
  pageLine,
  panelPlace,
  rowTag,
  staffVisitNotCountedText,
  addVisitBox,
  addVisitWindow,
  canFixVisits,
  removeVisitBox,
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
    ['Workout days needs no check-in', 'workout_days', { checkingIn: false, memberStatus: 'no_checkins' }, true, 'Members see this board when 3 or more people are on it.', false],
    ['too few this period', 'gym_days', { memberStatus: 'too_few' }, true, 'Not showing to members yet: fewer than 3 people have a gym day in this period.', false],
    ['another board, not read', 'streak', {}, true, 'Members see this board when 3 or more people are on it.', false],
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
  const onBoard = { name: 'Chen Wu', hiddenWithoutTakeOff: null, boards: [{ place: 1, value: 3, memberStatus: 'shown' }] };
  const noPlace = { name: 'Chen Wu', hiddenWithoutTakeOff: null, boards: [{ place: null, value: 3, memberStatus: 'too_few' }] };
  const hidAnyway = { name: 'Hema Hidden', hiddenWithoutTakeOff: 'hide_me', boards: [{ place: null, value: 4, memberStatus: 'shown' }] };

  it('somebody members see: names them, says who stops seeing them, what is kept, and that people below move up', () => {
    const box = takeOffBox(onBoard, true, 'Iron House', words);
    expect(box.title).toBe('Take Chen Wu off the board?');
    expect(box.button).toBe('Take off the board');
    expect(box.changes).toEqual([
      'Chen Wu — members will not see them on any board at Iron House.',
      'In their app, their own row will say "Iron House took you off the board".',
    ]);
    expect(box.keeps).toEqual(['Their visits and workouts are kept.', 'Nobody else is removed. People below them move up.']);
    expect(box.done).toBe('Chen Wu is off the board.');
  });

  it('somebody with no place now: nobody is said to move up', () => {
    const box = takeOffBox(noPlace, true, 'Iron House', words);
    expect(box.keeps).toEqual(['Their visits and workouts are kept.', 'Nobody else is removed.']);
    expect(JSON.stringify(box)).not.toMatch(/move up/);
  });

  it('somebody already hidden for another reason: the box says so, and promises no change members would see', () => {
    const box = takeOffBox(hidAnyway, true, 'Iron House', words);
    expect(box.changes[0]).toBe('Hema Hidden is already hidden from members (Chose Hide me). Taking them off keeps them hidden even if that changes.');
    expect(box.keeps).toEqual(['Their visits and workouts are kept.', "Nobody else's place changes."]);
    expect(JSON.stringify(box)).not.toMatch(/will not see them|move up/);
  });

  it('putting back somebody members will see again', () => {
    const box = takeOffBox(noPlace, false, 'Iron House', words);
    expect(box.title).toBe('Put Chen Wu back on the board?');
    expect(box.changes).toEqual(['Chen Wu — members will see them again, on every board that is showing where they have a number.']);
    expect(box.done).toBe('Chen Wu is back on the board.');
  });

  it('putting back somebody who is hidden anyway: never "members will see them again" or "back on the board"', () => {
    for (const reason of ['hide_me', 'under_18', 'no_name']) {
      const box = takeOffBox({ ...hidAnyway, hiddenWithoutTakeOff: reason }, false, 'Iron House', words);
      expect(box.changes[0]).toBe('Hema Hidden will no longer be taken off by your staff.');
      expect(box.changes[1]).toMatch(/^Members still won't see them\. /);
      expect(box.done).toMatch(/^Hema Hidden is no longer taken off, and is still hidden \(/);
      expect(JSON.stringify(box)).not.toMatch(/see them again|is back on the board/);
    }
  });

  it('a person with no name is still named as something', () => {
    expect(takeOffBox({ ...onBoard, name: null }, true, 'Iron House', words).title).toBe('Take No name yet off the board?');
  });
});

describe('a place is only ever the place members see', () => {
  it('the row says "On the board" only while members see the board', () => {
    const row = { hidden: null };
    expect(rowTag(row, board())).toEqual({ tag: false, text: 'On the board' });
    for (const memberStatus of ['too_few', 'no_checkins', 'paused', 'switched_off']) {
      expect(rowTag(row, board({ memberStatus }))).toEqual({ tag: false, text: 'Board not showing' });
    }
    expect(rowTag({ hidden: 'hide_me' }, board({ memberStatus: 'too_few' }))).toEqual({ tag: true, text: 'Chose Hide me' });
  });

  it('the panel says why somebody with a number has no place', () => {
    expect(panelPlace({ place: 2, value: 3, memberStatus: 'shown' }, null)).toBeNull();
    expect(panelPlace({ place: null, value: 3, memberStatus: 'too_few' }, null)).toBe("No place — members don't see this board now");
    expect(panelPlace({ place: null, value: 3, memberStatus: 'switched_off' }, null)).toBe("No place — members don't see this board now");
    expect(panelPlace({ place: null, value: 0, memberStatus: 'too_few' }, null)).toBe('No place');
    expect(panelPlace({ place: null, value: 3, memberStatus: 'shown' }, 'hide_me')).toBe('No place');
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
    expect(staffVisitNotCountedText({ why: 'removed', by: 'Sam Desk', removedOn: '2026-10-07' })).toBe('Visit removed by Sam Desk (staff) on 7 Oct');
  });
});

describe('fixing a visit: the boxes', () => {
  const COUNTED = {
    timezone: 'Asia/Kolkata',
    period: 'this_week',
    from: '2026-10-05',
    to: '2026-10-11',
    value: 2,
    days: [
      { day: '2026-10-06', visits: [{ id: 'v2', at: '2026-10-06T06:30:00.000Z', how: 'desk', by: 'Front desk', addedOn: null }] },
      {
        day: '2026-10-05',
        visits: [
          { id: 'v1', at: '2026-10-05T12:30:00.000Z', how: 'desk', by: 'Front desk', addedOn: null },
          { id: 'v0', at: '2026-10-05T02:30:00.000Z', how: 'staff', by: 'Sam Desk', addedOn: '2026-10-07' },
        ],
      },
    ],
  };

  it('only staff who check people in fix a visit', () => {
    expect(canFixVisits(['attendance.read', 'attendance.mark'])).toBe(true);
    expect(canFixVisits(['attendance.read', 'leaderboard.manage'])).toBe(false);
    expect(canFixVisits(undefined)).toBe(false);
  });

  it('a visit can be added from yesterday back to 62 days', () => {
    expect(addVisitWindow('2026-10-07')).toEqual({ min: '2026-08-06', max: '2026-10-06' });
    expect(addVisitWindow('2026-03-01')).toEqual({ min: '2025-12-29', max: '2026-02-28' });
  });

  it('removing the only visit of a day names the person, the visit and the number it leaves', () => {
    const day = COUNTED.days[0];
    const box = removeVisitBox('Chen Wu', day.visits[0], day, COUNTED);
    expect(box.title).toBe('Remove this visit of Chen Wu?');
    expect(box.button).toBe('Remove visit');
    expect(box.changes).toEqual([
      'Chen Wu — the 12:00 pm visit on Tue 6 Oct is removed.',
      'Their Gym days, this week, go from 2 to 1. Their streak is worked out again without that day.',
    ]);
    expect(box.keeps).toEqual([
      'In their app, Chen Wu still sees it under "Didn\'t count", with who removed it and today\'s date.',
      "Nobody else's visits change.",
    ]);
  });

  it('removing one of two visits on a day says the number stays; an added visit is named as added', () => {
    const day = COUNTED.days[1];
    expect(removeVisitBox('Chen Wu', day.visits[0], day, COUNTED).changes).toEqual([
      'Chen Wu — the 6:00 pm visit on Mon 5 Oct is removed.',
      'They have another visit that day, so their Gym days, this week, stay at 2.',
    ]);
    expect(removeVisitBox('Chen Wu', day.visits[1], day, COUNTED).changes[0]).toBe('Chen Wu — the visit added for Mon 5 Oct is removed.');
  });

  it('adding: nothing to press until a day is picked, or on a day that already counts', () => {
    expect(addVisitBox('Chen Wu', '', COUNTED)).toMatchObject({ ready: false, changes: ['Pick the day they came.'] });
    expect(addVisitBox('Chen Wu', '2026-10-06', COUNTED)).toMatchObject({
      ready: false,
      changes: ['Chen Wu already has a visit that counts on Tue 6 Oct. Nothing will be added.'],
    });
  });

  it('adding a day inside the period says the new number; a day outside it says the number here stays', () => {
    const inside = addVisitBox('Chen Wu', '2026-10-07', COUNTED);
    expect(inside.ready).toBe(true);
    expect(inside.title).toBe('Add a visit for Chen Wu');
    expect(inside.changes).toEqual([
      'Chen Wu — a visit is added for Wed 7 Oct.',
      'Their Gym days, this week, go from 2 to 3. Their streak is worked out again with that day.',
    ]);
    expect(inside.keeps).toEqual(["In their app, Chen Wu sees who added it and today's date.", "Nobody else's visits change."]);
    expect(inside.done).toBe('Visit added for Chen Wu on Wed 7 Oct.');
    const outside = addVisitBox('Chen Wu', '2026-09-30', COUNTED);
    expect(outside.changes[1]).toBe(
      'Wed 30 Sep is outside this week, so the number here stays at 2. It counts wherever that day does. Their streak is worked out again with that day.',
    );
    // All time has no start: every earlier day is inside it.
    expect(addVisitBox('Chen Wu', '2026-09-30', { ...COUNTED, period: 'all_time', from: null }).changes[1]).toMatch(
      /^Their Gym days, all time, go from 2 to 3\./,
    );
  });
});

describe('which week the flames are', () => {
  it.each([
    ['this_week', 'gym_days', null],
    ['last_week', 'workout_days', null],
    ['this_month', 'gym_days', 'the flames are this week'],
    ['last_month', 'gym_days', 'the flames are this week'],
    ['all_time', 'workout_days', 'the flames are this week'],
    [null, 'streak', 'the flames are the last 7 weeks'],
  ])('%s on %s: %s', (period, id, note) => {
    expect(flamesNote(board({ board: id, period }))).toBe(note);
  });
});