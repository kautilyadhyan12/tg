// The unsaved scan kept for the person who took it (RULINGS 2026-09-16): it comes
// back only to that person, only while the server can still save it, and the close
// question never promises more time than is left.
import { afterEach, describe, expect, it } from 'vitest';
import { MEAL_SCAN_TTL_SECONDS } from '@app/shared';
import {
  UNSAVED_SCAN_KEPT_MS,
  forgetUnsavedScan,
  keepUnsavedScan,
  timeLeftText,
  unsavedScanFor,
  unsavedScanMsLeft,
} from './unsavedScan';

const at = 1_800_000_000_000;
const sheet = { analysis: { mealName: 'Dal plate' } };

afterEach(() => forgetUnsavedScan());

describe('how long an unsaved scan is kept', () => {
  it('is the scan’s life on the server less half a minute', () => {
    expect(UNSAVED_SCAN_KEPT_MS).toBe((MEAL_SCAN_TTL_SECONDS - 30) * 1000);
  });

  it.each([
    ['just scanned', 0, true],
    ['one ms before the half-minute margin', UNSAVED_SCAN_KEPT_MS - 1, true],
    ['at the margin', UNSAVED_SCAN_KEPT_MS, false],
    ['inside the margin, the server could still save it', UNSAVED_SCAN_KEPT_MS + 1000, false],
    ['past the scan’s life', MEAL_SCAN_TTL_SECONDS * 1000, false],
  ])('%s (%i ms after the scan): kept is %s', (_, elapsed, kept) => {
    keepUnsavedScan('u1', at, sheet);
    expect(unsavedScanFor('u1', at + elapsed)).toEqual(kept ? { userId: 'u1', scannedAt: at, sheet } : null);
  });

  it('comes back only to the person who took it, and not once forgotten', () => {
    keepUnsavedScan('u1', at, sheet);
    expect(unsavedScanFor('u2', at)).toBeNull();
    expect(unsavedScanFor('guest', at)).toBeNull();
    expect(unsavedScanFor('u1', at)?.sheet).toBe(sheet);
    forgetUnsavedScan();
    expect(unsavedScanFor('u1', at)).toBeNull();
  });

  it('keeps one sheet: the newest', () => {
    keepUnsavedScan('u1', at, sheet);
    keepUnsavedScan('u1', at + 5000, { analysis: { mealName: 'Oats' } });
    expect(unsavedScanFor('u1', at + 5000)?.sheet.analysis.mealName).toBe('Oats');
  });
});

describe('what the close question says is left', () => {
  it.each([
    [0, UNSAVED_SCAN_KEPT_MS],
    [30_000, UNSAVED_SCAN_KEPT_MS - 30_000],
    [UNSAVED_SCAN_KEPT_MS, 0],
    [MEAL_SCAN_TTL_SECONDS * 1000, 0],
  ])('%i ms after the scan, %i ms are left', (elapsed, left) => {
    expect(unsavedScanMsLeft(at, at + elapsed)).toBe(left);
  });

  it.each([
    [570_000, 'Open Photo Log again within 9 minutes to pick up where you left off.'],
    [540_000, 'Open Photo Log again within 9 minutes to pick up where you left off.'],
    [539_999, 'Open Photo Log again within 8 minutes to pick up where you left off.'],
    [120_000, 'Open Photo Log again within 2 minutes to pick up where you left off.'],
    [119_999, 'Open Photo Log again within 1 minute to pick up where you left off.'],
    [60_000, 'Open Photo Log again within 1 minute to pick up where you left off.'],
    [59_999, 'Less than a minute is left to open Photo Log again and pick up where you left off.'],
    [1, 'Less than a minute is left to open Photo Log again and pick up where you left off.'],
    [0, null],
  ])('%i ms left reads %j', (msLeft, text) => {
    expect(timeLeftText(msLeft)).toBe(text);
  });
});
