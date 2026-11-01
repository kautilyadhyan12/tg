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

  it('a board with nothing to show says so on both, and a shown board on neither', () => {
    for (const status of ['shown', 'too_few', 'no_checkins', 'paused', 'switched_off']) {
      for (const board of LEADERBOARD_BOARDS) {
        const b = { status, board, gymName: 'Iron House', boardsOff: [] };
        expect(phone.statusText(b) === null).toBe(browser.statusText(b) === null);
      }
    }
  });

  it('every hidden reason has words on both', () => {
    for (const reason of ['staff', 'taken_off', 'hide_me', 'under_18', 'no_name']) {
      expect(browser.hiddenText(reason, 'Iron House')).toBeTruthy();
      expect(phone.hiddenText(reason, 'Iron House')).toBeTruthy();
    }
  });
});
