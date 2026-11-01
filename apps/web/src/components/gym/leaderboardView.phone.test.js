import { describe, expect, it } from 'vitest';
import { LEADERBOARD_BOARDS } from '@app/shared';
import * as browser from './leaderboardView';
import * as phone from '../../../../mobile/src/screens/gym/leaderboardView.ts';

// The phone's Leaderboard has its own short words; the browser keeps its own. What each decides must still agree
// (Stage 5 item 17c-ii-a): the same boards, periods, tabs, numbers and places.

describe('the phone and the browser agree on the leaderboard', () => {
  it('the same tabs in the same order, and the same periods', () => {
    expect(phone.BOARD_TABS).toEqual(browser.BOARD_TABS);
    expect(phone.PERIODS.map((p) => [p.value, p.label])).toEqual(browser.PERIODS.map((p) => [p.id, p.label]));
    for (const off of [[], ['gym_days'], ['streak', 'workout_days'], [...LEADERBOARD_BOARDS]]) {
      expect(phone.boardTabs(off)).toEqual(browser.boardTabs(off));
    }
  });

  it('the same place words, numbers and next place', () => {
    for (const n of [1, 2, 3, 4, 10, 11, 12, 13, 21, 22, 23, 100, 101, 111, 112]) expect(phone.ordinal(n)).toBe(browser.ordinal(n));
    for (const board of LEADERBOARD_BOARDS) {
      for (const value of [0, 1, 2, 7]) expect(phone.valueText(value, board)).toBe(browser.valueText(value, board));
      for (const me of [{ toNextPlace: 1, nextPlace: 1 }, { toNextPlace: 3, nextPlace: 2 }, { toNextPlace: null, nextPlace: null }]) {
        expect(phone.nextPlaceText(me, board)).toBe(browser.nextPlaceText(me, board));
      }
    }
  });

  const same = (words) => words?.replaceAll('’', "'") ?? null;

  it('a board with nothing to show says so on both, and a shown board on neither', () => {
    for (const status of ['shown', 'too_few', 'no_checkins', 'paused', 'switched_off']) {
      for (const board of LEADERBOARD_BOARDS) {
        const b = { status, board, gymName: 'Iron House', boardsOff: [...LEADERBOARD_BOARDS] };
        expect(phone.statusText(b) === null).toBe(browser.statusText(b) === null);
        // The phone's own line for nobody checked in is shorter, and its tabs say the rest.
        if (status !== 'no_checkins') expect(same(phone.statusText(b))).toBe(same(browser.statusText(b)));
      }
    }
  });

  it('why a person is greyed reads the same, but for the two lines the phone says its own way', () => {
    for (const reason of ['taken_off', 'hide_me', 'under_18']) {
      expect(same(phone.hiddenText(reason, 'Iron House'))).toBe(same(browser.hiddenText(reason, 'Iron House')));
    }
  });

  it('the same count beside a day', () => {
    for (const n of [1, 2, 3]) {
      expect(phone.dayCountText(n)).toBe(browser.dayCountText(n));
      expect(phone.workoutCountText(n)).toBe(browser.workoutCountText(n));
    }
  });
});
