// The membership agreement's words (ROADMAP 18u-i).
import { describe, expect, it } from 'vitest';
import { WAIVER_MAX_CHARS } from '@app/shared';
import { agreementAsksLine, agreementDraftState, agreementLineParts, agreementSaveLabel, agreementSavedLine, agreementSignedBy, agreementSummary } from './agreementView';

const agreement = (text = 'Cancel at the desk.', version = 1) => ({ id: 'a', version, text, savedAt: '2026-10-23T09:00:00.000Z' });
const NONE = { agreement: null, inUse: false, signed: 0 };
const IN_USE = { agreement: agreement(), inUse: true, signed: 2 };
const STOPPED = { agreement: agreement(), inUse: false, signed: 2 };
const when = () => '23 October 2026';

describe('Settings', () => {
  it.each([
    [null, ''],
    [NONE, 'Not set up'],
    [STOPPED, 'Not in use'],
    [IN_USE, 'In use · signed for 2 memberships'],
    [{ ...IN_USE, signed: 1 }, 'In use · signed for 1 membership'],
  ])('the folded line', (data, line) => {
    expect(agreementSummary(data)).toBe(line);
  });

  it('Save waits for words, refuses too many, and the same words save only to start it again', () => {
    expect(agreementDraftState(NONE, '   ')).toEqual({ canSave: false, problem: null });
    expect(agreementDraftState(NONE, 'x'.repeat(WAIVER_MAX_CHARS + 3)).problem).toBe('Your agreement is 3 characters too long. The most we can keep is 30,000.');
    expect(agreementDraftState(IN_USE, ' Cancel at the desk. ').canSave).toBe(false);
    expect(agreementDraftState(STOPPED, 'Cancel at the desk.').canSave).toBe(true);
    expect([agreementSaveLabel(NONE), agreementSaveLabel(IN_USE), agreementSaveLabel(STOPPED)]).toEqual(['Save agreement', 'Save changes', 'Use this agreement']);
  });

  it('says that signed memberships keep their words only where changed words would touch some', () => {
    expect(agreementAsksLine(IN_USE, 'New words.')).toMatch(/^The memberships already signed keep the words/);
    expect(agreementAsksLine({ ...IN_USE, signed: 0 }, 'New words.')).toBeNull();
    expect(agreementAsksLine(IN_USE, 'Cancel at the desk.')).toBeNull();
  });

  it('what a save did', () => {
    expect(agreementSavedLine(NONE, IN_USE)).toBe('Saved. Each membership you give from now on is signed with it.');
    expect(agreementSavedLine(IN_USE, { ...IN_USE, agreement: agreement('New', 2) })).toBe('Saved. Memberships you give from now on are signed with these words.');
    expect(agreementSavedLine(STOPPED, IN_USE)).toBe('Saved. It is in use again: each membership you give is signed with it.');
  });
});

describe('under a membership', () => {
  it.each([
    ['signed', { agreement: { at: 'x' } }, true, true, 'Agreement signed'],
    ['signed, though no longer asked for', { agreement: { at: 'x' } }, false, false, 'Agreement signed'],
    ['to sign', { agreement: null }, true, true, 'Agreement not signed'],
    ['nothing asked', { agreement: null }, false, true, null],
    ['over, never signed', { agreement: null }, true, false, null],
  ])('%s', (_case, membership, inUse, signable, label) => {
    expect(agreementLineParts(membership, inUse, signable, when)?.label ?? null).toBe(label);
  });

  it('who signed, a parent or guardian named as one', () => {
    expect(agreementSignedBy({ name: 'Maya Patel', signer: 'person', at: 'x' }, when)).toBe('Signed by Maya Patel on 23 October 2026.');
    expect(agreementSignedBy({ name: 'Rosa Reyes', signer: 'guardian', at: 'x' }, when)).toBe('Signed by Rosa Reyes, parent or guardian, on 23 October 2026.');
  });
});
