// Settings → How members reach you (ROADMAP 20a-iii), without a browser.
import { describe, expect, it } from 'vitest';
import { GYM_CONTACT_WORDS } from '@app/shared';
import {
  memberContactChanged,
  memberContactDraft,
  memberContactNote,
  memberContactPatch,
  memberContactProblem,
  memberContactSummary,
  memberContactTitle,
} from './memberContactView';

const KEPT = { phone: '020 7946 0958', email: 'desk@ironhouse.com' };
const NONE = { phone: '', email: '' };

describe('the two boxes', () => {
  it('start with what the gym added, and empty for a gym that added neither', () => {
    expect(memberContactDraft({ contactPhone: '020 7946 0958', contactEmail: 'desk@ironhouse.com' })).toEqual(KEPT);
    expect(memberContactDraft({ contactPhone: null, contactEmail: null })).toEqual(NONE);
  });

  it("are never filled from the owner's mobile for payments or anything else the gym holds", () => {
    expect(memberContactDraft({ billingMobile: '+919876543210', postalAddress: '12 High Street', name: 'Iron House' })).toEqual(NONE);
    expect(memberContactDraft(null)).toEqual(NONE);
  });

  it('count as changed only when what is typed differs, spaces at the ends aside', () => {
    expect(memberContactChanged(KEPT, KEPT)).toBe(false);
    expect(memberContactChanged({ ...KEPT, phone: ' 020 7946 0958 ' }, KEPT)).toBe(false);
    expect(memberContactChanged({ ...KEPT, phone: '020 7946 0959' }, KEPT)).toBe(true);
    expect(memberContactChanged({ ...KEPT, email: '' }, KEPT)).toBe(true);
  });
});

describe('what is wrong with what is typed', () => {
  it('is nothing for an empty box: both are optional', () => {
    expect(memberContactProblem(NONE)).toBeNull();
    expect(memberContactProblem({ phone: '020 7946 0958', email: '' })).toBeNull();
    expect(memberContactProblem({ phone: '  ', email: 'desk@ironhouse.com' })).toBeNull();
  });

  it("is the server's own sentence, the phone number first", () => {
    expect(memberContactProblem({ phone: 'ask at the desk', email: '' })).toBe(GYM_CONTACT_WORDS.bad_contact_phone);
    expect(memberContactProblem({ phone: '', email: 'ironhouse.com' })).toBe(GYM_CONTACT_WORDS.bad_contact_email);
    expect(memberContactProblem({ phone: '12', email: 'x' })).toBe(GYM_CONTACT_WORDS.bad_contact_phone);
    expect(memberContactProblem({ phone: '2345678 / 2345679', email: '' })).toBe('Add one phone number only. Members press it to call you.');
    expect(memberContactProblem({ phone: '+44 (0)20 7946 0958', email: '' })).toBeNull();
  });
});

describe('what Save sends', () => {
  it('is only the box that changed, and null for one that was emptied', () => {
    expect(memberContactPatch(KEPT, KEPT)).toBeNull();
    expect(memberContactPatch({ ...KEPT, phone: ' (212) 555-0123 ' }, KEPT)).toEqual({ contactPhone: '(212) 555-0123' });
    expect(memberContactPatch({ ...KEPT, email: '' }, KEPT)).toEqual({ contactEmail: null });
    expect(memberContactPatch({ phone: '020 7946 0958', email: 'desk@ironhouse.com' }, NONE)).toEqual({ contactPhone: '020 7946 0958', contactEmail: 'desk@ironhouse.com' });
  });
});

describe('the words', () => {
  it("are in the organisation's own words", () => {
    expect(memberContactTitle('gym')).toBe('How members reach you');
    expect(memberContactTitle('studio')).toBe('How clients reach you');
    expect(memberContactNote('gym')).toBe(
      'Your members see these in the app: in their Inbox, under "Contact the gym". They can\'t reply to your messages there, so this is how they call or write to you. Add one or both.',
    );
    expect(memberContactNote('studio')).toMatch(/Your clients see these .* "Contact the studio"/);
    // The button a trainer's clients press says "trainer", so this line does too.
    expect(memberContactNote('personal_trainer')).toMatch(/"Contact the trainer"/);
  });

  it('say what is kept while the section is shut, or that nothing is', () => {
    expect(memberContactSummary(KEPT, 'gym')).toBe('020 7946 0958 · desk@ironhouse.com');
    expect(memberContactSummary({ phone: '', email: 'desk@ironhouse.com' }, 'gym')).toBe('desk@ironhouse.com');
    expect(memberContactSummary(NONE, 'gym')).toBe('Not added yet. Your members have no phone number or email for you in the app.');
  });
});
