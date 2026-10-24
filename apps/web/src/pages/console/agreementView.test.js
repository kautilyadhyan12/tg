// The membership agreement's words (ROADMAP 18u-i).
import { describe, expect, it } from 'vitest';
import { WAIVER_MAX_CHARS } from '@app/shared';
import {
  agreementAsksLine,
  agreementDraftState,
  agreementLineParts,
  agreementSaveLabel,
  agreementSavedLine,
  agreementSignedBy,
  agreementSummary,
  mainAgreementLine,
  otherAgreementTo,
  agreementOfSection,
  otherDraftState,
  otherSaveChanges,
  priceAgreementLine,
} from './agreementView';

const agreement = (text = 'Cancel at the desk.', version = 1) => ({ id: 'a', version, text, savedAt: '2026-10-23T09:00:00.000Z' });
const NONE = { agreement: null, inUse: false, signed: 0 };
const IN_USE = { agreement: agreement(), inUse: true, signed: 2 };
const STOPPED = { agreement: agreement(), inUse: false, signed: 2 };
const when = () => '23 October 2026';

describe('Settings', () => {
  it.each([
    [null, ''],
    [NONE, 'Not set up'],
    [STOPPED, 'Default agreement turned off'],
    [IN_USE, 'In use · 2 signed'],
    [{ ...IN_USE, signed: 1 }, 'In use · 1 signed'],
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
    expect(agreementAsksLine(IN_USE, 'New words.')).toBe('Agreements already signed are not changed. New memberships are signed with the new terms.');
    expect(agreementAsksLine({ ...IN_USE, signed: 0 }, 'New words.')).toBeNull();
    expect(agreementAsksLine(IN_USE, 'Cancel at the desk.')).toBeNull();
  });

  it('what a save did', () => {
    expect(agreementSavedLine(NONE, IN_USE)).toBe('Agreement saved. Members sign it when they get a membership.');
    expect(agreementSavedLine(IN_USE, { ...IN_USE, agreement: agreement('New', 2) })).toBe('Changes saved. New memberships are signed with the new terms.');
    expect(agreementSavedLine(STOPPED, IN_USE)).toBe('Agreement turned on. Members sign it when they get a membership.');
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

describe('another agreement for some memberships (18u-ii-a)', () => {
  const PACK = { id: 'p', name: '10-class pack', agreementId: 'a' };
  const TRIAL = { id: 't', name: 'Free week', agreementId: 'b' };
  const GOLD = { id: 'g', name: 'Gold Monthly', agreementId: null };
  const packTerms = { id: 'a', name: 'Class pack terms', agreement: agreement('Pack words'), inUse: true, signed: 2 };
  const trialTerms = { id: 'b', name: 'Trial terms', agreement: agreement('Trial words'), inUse: true, signed: 0 };
  const data = { ...IN_USE, others: [packTerms, trialTerms], prices: [PACK, TRIAL, GOLD] };

  it.each([
    ['nothing typed', null, { name: '', text: '', usedFor: [] }, { canSave: false, problem: null }],
    ['a new one, named and written', null, { name: 'Day pass terms', text: 'Words', usedFor: [] }, { canSave: true, problem: null }],
    ['the main one\'s name, whatever its capitals', null, { name: 'DEFAULT AGREEMENT', text: 'Words', usedFor: [] }, { canSave: false, problem: 'You already have an agreement called Default agreement. Give this one another name.' }],
    ['another one\'s name', null, { name: ' trial terms ', text: 'Words', usedFor: [] }, { canSave: false, problem: 'You already have an agreement called Trial terms. Give this one another name.' }],
    ['its own name kept', packTerms, { name: 'Class pack terms', text: 'Pack words', usedFor: ['p'] }, { canSave: false, problem: null }],
    ['a tick changed', packTerms, { name: 'Class pack terms', text: 'Pack words', usedFor: ['p', 'g'] }, { canSave: true, problem: null }],
    ['stopped, saved as it was', { ...packTerms, inUse: false }, { name: 'Class pack terms', text: 'Pack words', usedFor: ['p'] }, { canSave: true, problem: null }],
  ])('%s', (_, other, draft, want) => {
    expect(otherDraftState(data, other, draft)).toEqual(want);
  });

  it('says before Save which memberships move, which go back to the main agreement, and that signed ones keep theirs', () => {
    expect(otherSaveChanges(data, packTerms, { name: 'Class pack terms', text: 'Pack words', usedFor: ['t'] })).toEqual([
      'Free week will move from Trial terms to this agreement.',
      '10-class pack will use the default agreement.',
      'Agreements already signed are not changed.',
    ]);
    expect(otherSaveChanges(data, trialTerms, { name: 'Trial terms', text: 'New words', usedFor: ['t'] })).toEqual([]);
    expect(otherSaveChanges(data, null, { name: 'New', text: 'Words', usedFor: ['g'] })).toEqual([]);
  });

  it('the price list names a line\'s agreement only once the business has another', () => {
    expect(priceAgreementLine({ agreements: [] }, GOLD)).toBeNull();
    expect(priceAgreementLine({ agreements: [{ id: 'a', name: 'Class pack terms' }] }, PACK)).toBe('Agreement: Class pack terms');
    expect(priceAgreementLine({ agreements: [{ id: 'a', name: 'Class pack terms' }] }, GOLD)).toBe('Agreement: Default agreement');
  });

  it('the main agreement names the memberships it is for', () => {
    expect(mainAgreementLine(data)).toBe('Used for all memberships except: 10-class pack, Free week.');
    expect(mainAgreementLine({ ...data, prices: [PACK] })).toBe('Not used: every membership has its own agreement.');
    expect(mainAgreementLine({ ...data, prices: [GOLD] })).toBe('Used for all memberships.');
  });

  it('a price list line opens its own agreement in Settings', () => {
    expect(otherAgreementTo('/console/x/settings#membership-agreement', 'a')).toBe('/console/x/settings#agreement-a');
    expect(otherAgreementTo('/console/x/settings#membership-agreement', null)).toBe('/console/x/settings#membership-agreement');
    expect(agreementOfSection('agreement-a')).toBe('a');
    expect(agreementOfSection('membership-agreement')).toBeNull();
  });

  it('the folded line counts the other agreements', () => {
    expect(agreementSummary(data)).toBe('In use · 2 signed · 2 other agreements');
    expect(agreementSummary({ ...NONE, others: [packTerms] })).toBe('Default agreement not set up · 1 other agreement');
  });
});
