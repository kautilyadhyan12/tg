// The words of Settings' Waiver box and of a person's page (ROADMAP 3e-i).
import { describe, expect, it } from 'vitest';
import { WAIVER_MAX_CHARS } from '@app/shared';
import {
  signedCount,
  waiverAsksLine,
  waiverDraftState,
  waiverLine,
  waiverLineParts,
  waiverNotInAppLine,
  waiverSaveLabel,
  waiverSavedLine,
  waiverStopWords,
  waiverSummary,
} from './waiverView';

const WORDS = 'I take part at my own risk.';
const waiver = { id: '7d3f5a10-2b4c-4e6d-8f9a-0b1c2d3e4f5a', version: 1, text: WORDS, savedAt: '2026-10-13T09:00:00.000Z' };
const NONE = { waiver: null, inUse: false, people: 4, signed: 0 };
const IN_USE = { waiver, inUse: true, people: 12, signed: 3 };
const STOPPED = { waiver, inUse: false, people: 12, signed: 3 };

describe('the folded box', () => {
  it.each([
    [null, ''],
    [NONE, 'Not set up'],
    [STOPPED, 'Not in use'],
    [IN_USE, 'In use · signed by 3 of 12 people in the app'],
    [{ ...IN_USE, people: 1, signed: 1 }, 'In use · signed by 1 of 1 person in the app'],
    [{ ...IN_USE, people: 1, signed: 0 }, 'In use · signed by 0 of 1 person in the app'],
    [{ ...IN_USE, people: 0, signed: 0 }, 'In use · nobody is in the app yet'],
  ])('%#', (data, line) => {
    expect(waiverSummary(data)).toBe(line);
  });

  it('counts people, never a false zero of nobody', () => {
    expect(signedCount({ ...IN_USE, signed: 0 })).toBe('signed by 0 of 12 people in the app');
  });
});

describe('Save', () => {
  it('waits for words, and for words that differ from the ones in use', () => {
    expect(waiverDraftState(NONE, '   ')).toEqual({ canSave: false, problem: null });
    expect(waiverDraftState(NONE, WORDS).canSave).toBe(true);
    expect(waiverDraftState(IN_USE, `${WORDS}\r\n`).canSave).toBe(false);
    expect(waiverDraftState(IN_USE, `${WORDS} More.`).canSave).toBe(true);
    // Not in use: the same words can be saved, which starts it again.
    expect(waiverDraftState(STOPPED, WORDS).canSave).toBe(true);
  });

  it('says how far over the longest waiver the words are', () => {
    const state = waiverDraftState(NONE, 'x'.repeat(WAIVER_MAX_CHARS + 25));
    expect(state.canSave).toBe(false);
    expect(state.problem).toBe('Your waiver is 25 characters too long. The most we can keep is 30,000.');
  });

  it('is named for what it does', () => {
    expect(waiverSaveLabel(NONE)).toBe('Save waiver');
    expect(waiverSaveLabel(IN_USE)).toBe('Save changes');
    expect(waiverSaveLabel(STOPPED)).toBe('Use this waiver');
  });

  it('says before the press who will be asked', () => {
    expect(waiverAsksLine(NONE, WORDS)).toBe('All 4 people in the app will be asked to sign it.');
    expect(waiverAsksLine(IN_USE, `${WORDS} More.`)).toBe('All 12 people in the app will be asked to sign again, because the words have changed.');
    expect(waiverAsksLine(IN_USE, WORDS)).toBeNull();
  });

  it.each([
    [{ ...IN_USE, people: 0, signed: 0 }, 'Saved. People will read and sign it when they join in the app.'],
    [{ ...IN_USE, signed: 0 }, 'Saved. 12 people in the app are now asked to sign it.'],
    [{ ...IN_USE, people: 4, signed: 3 }, 'Saved. 1 person in the app is now asked to sign it.'],
    [{ ...IN_USE, signed: 12 }, 'Saved. All 12 people in the app have already signed these words.'],
    [{ ...IN_USE, people: 1, signed: 1 }, 'Saved. The 1 person in the app has already signed these words.'],
  ])('says afterwards what happened %#', (after, line) => {
    expect(waiverSavedLine(after)).toBe(line);
  });
});

describe('Stop asks first, naming who changes and what is kept', () => {
  it('with signatures', () => {
    expect(waiverStopWords(IN_USE)).toEqual({
      question: 'Stop using this waiver?',
      changes: 'Nobody will be asked to sign it: not people who join, and not people already in the app.',
      kept: 'Its words and the 3 signatures you have are kept, so you can start using it again.',
    });
    expect(waiverStopWords({ ...IN_USE, signed: 1 }).kept).toContain('the 1 signature you have');
  });

  it('with none', () => {
    expect(waiverStopWords({ ...IN_USE, signed: 0 }).kept).toBe('Its words are kept here, so you can start using it again.');
  });
});

describe("a person's page", () => {
  const when = () => '13 October 2026';

  it('says who signed, and when, in the name they typed', () => {
    expect(waiverLine({ waiverSigned: { name: 'Luis Reyes', at: '2026-10-13T09:00:00.000Z' } }, when)).toBe('Waiver signed on 13 October 2026 as Luis Reyes');
    expect(waiverLine({ waiverSigned: { name: 'Luis Reyes', at: 'nonsense' } }, () => '')).toBe('Waiver signed as Luis Reyes');
  });

  it('says so when they have not, and never guesses', () => {
    expect(waiverLine({ waiverSigned: null }, when)).toBe('Waiver not signed');
    expect(waiverLine({}, when)).toBe('Waiver not signed');
  });

  it('gives the page the state as a label of its own, and the same sentence in all', () => {
    const signed = { waiverSigned: { name: 'Luis Reyes', at: '2026-10-13T09:00:00.000Z' } };
    expect(waiverLineParts(signed, when)).toEqual({ signed: true, label: 'Waiver signed', rest: ' on 13 October 2026 as Luis Reyes' });
    expect(waiverLineParts({ waiverSigned: null }, when)).toEqual({ signed: false, label: 'Waiver not signed', rest: '' });
    for (const member of [signed, { waiverSigned: null }, {}]) {
      const parts = waiverLineParts(member, when);
      expect(parts.label + parts.rest).toBe(waiverLine(member, when));
    }
  });

  it('says why somebody with no app has not signed', () => {
    expect(waiverNotInAppLine('Ben Stone')).toBe('Not signed. Ben Stone signs your waiver when they join in the app.');
    expect(waiverNotInAppLine('')).toBe('Not signed. This person signs your waiver when they join in the app.');
  });
});
