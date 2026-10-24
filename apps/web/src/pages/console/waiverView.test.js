// The words of Settings' Waiver box and of a person's page (ROADMAP 3e-i).
import { describe, expect, it } from 'vitest';
import { WAIVER_MAX_CHARS } from '@app/shared';
import {
  signedCount,
  waiverAsksLine,
  waiverDraftState,
  waiverLine,
  waiverLineParts,
  deskBoxWords,
  deskSignedLine,
  deskSigner,
  deskWaiverParts,
  signedInApp,
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
    [STOPPED, 'Turned off'],
    [IN_USE, 'In use · signed by 3 of 12 people in the app'],
    [{ ...IN_USE, people: 1, signed: 1 }, 'In use · signed by 1 of 1 person in the app'],
    [{ ...IN_USE, people: 1, signed: 0 }, 'In use · signed by 0 of 1 person in the app'],
    [{ ...IN_USE, people: 0, signed: 0 }, 'In use · nobody is in the app yet'],
    [{ ...IN_USE, atDesk: 2 }, 'In use · signed by 3 of 12 people in the app, and 2 at the desk'],
    [{ ...IN_USE, people: 0, signed: 0, atDesk: 1 }, 'In use · 1 signed at the desk, nobody in the app yet'],
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
    // Nobody has signed the words in use, so nobody is asked "again" (round one, L5).
    expect(waiverAsksLine({ ...IN_USE, signed: 0 }, `${WORDS} More.`)).toBe('All 12 people in the app will be asked to sign it.');
  });

  it.each([
    [{ ...IN_USE, people: 0, signed: 0 }, 'Waiver saved. Members sign it in the app when they join.'],
    [{ ...IN_USE, signed: 0 }, 'Waiver saved. 12 members in the app are now asked to sign it.'],
    [{ ...IN_USE, people: 4, signed: 3 }, 'Waiver saved. 1 member in the app is now asked to sign it.'],
    [{ ...IN_USE, signed: 12 }, 'Waiver saved. All 12 members in the app have already signed it.'],
    [{ ...IN_USE, people: 1, signed: 1 }, 'Waiver saved. The 1 member in the app has already signed it.'],
  ])('says afterwards what happened %#', (after, line) => {
    expect(waiverSavedLine(after)).toBe(line);
  });
});

describe('Stop asks first, naming who changes and what is kept', () => {
  it('with signatures', () => {
    expect(waiverStopWords(IN_USE)).toEqual({
      question: 'Turn off this waiver?',
      changes: 'Members will not be asked to sign it, including members already in the app.',
      kept: 'Signed waivers are kept. You can turn it back on at any time.',
    });
  });

  it('with none', () => {
    expect(waiverStopWords({ ...IN_USE, signed: 0 }).kept).toBe('Signed waivers are kept. You can turn it back on at any time.');
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
    expect(waiverLineParts(signed, when)).toEqual({ tone: 'good', label: 'Waiver signed', rest: ' on 13 October 2026 as Luis Reyes' });
    expect(waiverLineParts({ waiverSigned: null }, when)).toEqual({ tone: 'warn', label: 'Waiver not signed', rest: '' });
    for (const member of [signed, { waiverSigned: null }, {}, { ...signed, sharedEmail: true }]) {
      const parts = waiverLineParts(member, when);
      expect(parts.label + parts.rest).toBe(waiverLine(member, when));
    }
  });

  // Round one, High-1: on an email a family shares, the record's own person may not be the
  // one who signed, so the page never says this record signed.
  it('never says a record on a shared email has signed: it names who typed the signature', () => {
    const shared = { sharedEmail: true, waiverSigned: { name: 'Luis Reyes', at: '2026-10-13T09:00:00.000Z' } };
    expect(waiverLineParts(shared, when)).toEqual({
      tone: 'plain',
      label: 'Signed as Luis Reyes',
      rest: " on 13 October 2026. This email address is shared, so we can't tell which of them signed.",
    });
    expect(waiverLine(shared, when)).toBe("Signed as Luis Reyes on 13 October 2026. This email address is shared, so we can't tell which of them signed.");
    expect(waiverLineParts({ sharedEmail: true, waiverSigned: null }, when)).toEqual({ tone: 'warn', label: 'Waiver not signed', rest: '' });
  });

  it('says on the Waiver card whether this record signed at the desk, and who can sign where', () => {
    const when = () => '14 October 2026';
    expect(deskWaiverParts({ fullName: 'Ben Stone', members: [], waiverDesk: null }, when)).toEqual({
      tone: 'warn',
      label: 'Waiver not signed',
      rest: 'Ben Stone can sign it here at the desk, or in the app when they join.',
    });
    expect(deskWaiverParts({ fullName: '', members: [{ userId: 'u' }], waiverDesk: null }, when).rest).toBe('This person can sign it here at the desk, or in the app.');
    expect(deskWaiverParts({ fullName: 'Ben Stone', members: [], waiverDesk: { name: 'Ben Stone', signer: 'person', at: 'x', by: null } }, when)).toEqual({
      tone: 'good',
      label: 'Waiver signed',
      rest: 'at the desk on 14 October 2026 as Ben Stone',
    });
    expect(deskWaiverParts({ fullName: 'Mia Reyes', members: [], waiverDesk: { name: 'Ana Reyes', signer: 'guardian', at: 'x', by: null } }, when).rest).toBe(
      'at the desk on 14 October 2026 by Ana Reyes, parent or guardian',
    );
  });

  it('never says not signed in the app line of somebody who signed at the desk (round one, High-1)', () => {
    const desk = { name: 'Ben Stone', signer: 'person', at: 'x', by: null };
    expect(waiverLineParts({ waiverSigned: null, sharedEmail: false }, () => '', desk)).toEqual({ tone: 'plain', label: 'Signed at the desk', rest: ' · not signed in the app yet' });
    // A relative on an email the family shares is never shown as signed by the record's
    // desk signature: it is somebody else's (re-check, High-A).
    expect(waiverLineParts({ waiverSigned: null, sharedEmail: true }, () => '', desk)).toEqual({ tone: 'warn', label: 'Waiver not signed', rest: '' });
    // Their own signature in the app still reads as theirs.
    expect(waiverLineParts({ waiverSigned: { name: 'Ben Stone', at: 'x' }, sharedEmail: false }, () => '14 October 2026', desk).label).toBe('Waiver signed');
  });

  it('says only the desk where the one person in the app is on an email a family shares (round one, High-2)', () => {
    const entry = { fullName: 'Ana Reyes', members: [{ userId: 'u', sharedEmail: true }], waiverDesk: null };
    expect(deskWaiverParts(entry, () => '').rest).toBe('Ana Reyes can sign it here at the desk.');
    const both = { ...entry, members: [{ userId: 'u', sharedEmail: true }, { userId: 'v', sharedEmail: false }] };
    expect(deskWaiverParts(both, () => '').rest).toBe('Ana Reyes can sign it here at the desk, or in the app.');
  });

  it("reads a signature in the app as this record's only where it is not on an email a family shares", () => {
    expect(signedInApp({ members: [{ waiverSigned: { name: 'Leo', at: 'x' }, sharedEmail: false }] })).toBe(true);
    expect(signedInApp({ members: [{ waiverSigned: { name: 'Luis', at: 'x' }, sharedEmail: true }] })).toBe(false);
    expect(signedInApp({ members: [{ waiverSigned: null, sharedEmail: false }] })).toBe(false);
    expect(signedInApp({ members: [] })).toBe(false);
  });

  it('asks a parent or guardian to sign for somebody under 18, and asks who signs only where the record cannot say', () => {
    expect(deskSigner(true, 'person')).toBe('guardian');
    expect(deskSigner(false, 'guardian')).toBe('person');
    expect(deskSigner(null, null)).toBeNull();
    expect(deskSigner(null, 'guardian')).toBe('guardian');
    expect(deskBoxWords('Mia Reyes', 'guardian', true)).toEqual({
      handOver: 'Mia Reyes is under 18. Hand this screen to their parent or guardian, who reads the waiver and signs it for them.',
      nameLabel: "Parent or guardian's full name",
      agree: "I am Mia Reyes's parent or guardian. I have read this waiver and I agree to it for them.",
    });
    expect(deskBoxWords('Ben Stone', 'person', false)).toEqual({
      handOver: 'Hand this screen to Ben Stone. They read the waiver and sign it themselves.',
      nameLabel: 'Your full name',
      agree: 'I have read this waiver and I agree to it.',
    });
    expect(deskSignedLine('Ben Stone')).toBe("Signed. Ben Stone's waiver is kept with their record.");
  });
});
