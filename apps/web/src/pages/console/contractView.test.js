// A CONTRACT ON A REPEATING MEMBERSHIP (ROADMAP 18v-i): the price list's boxes and line, and the
// person's page's lines and Cancel box words. Every date here was read off a calendar.
import { describe, expect, it } from 'vitest';
import { contractHint, contractLine, draftBody, draftFromType, draftProblems, emptyDraft, withChoice } from './membershipTypesView';
import { askWords, contractShownLine, doneWords, releaseShownLine } from './heldMembershipsView';

const listType = (over = {}) => ({
  id: '22222222-2222-4222-8222-000000000001',
  name: 'Gold 12 months',
  description: null,
  kind: 'recurring',
  priceMinor: 5000,
  currency: 'USD',
  termCount: 1,
  termUnit: 'month',
  packClasses: null,
  packDays: null,
  access: 'all_classes',
  bookingsLimit: null,
  bookingsPeriod: null,
  classTypes: null,
  includesPt: false,
  ptLimit: null,
  ptPeriod: null,
  taxRateId: null,
  joiningFeeMinor: 0,
  contractPeriods: 12,
  contractThen: 'renews',
  archivedAt: null,
  updatedAt: '2026-11-03T10:00:00.000Z',
  ...over,
});
const draft = (over = {}) => ({ ...emptyDraft(), name: 'Gold 12 months', price: '50.00', ...over });

describe('the price list', () => {
  it('sends no contract unless one is chosen, and the number and what follows when it is', () => {
    expect(draftBody(draft(), 'USD')).toMatchObject({ contractPeriods: null, contractThen: null });
    expect(draftBody(draft({ contract: 'fixed', contractPeriods: '12', contractThen: 'ends' }), 'USD')).toMatchObject({ contractPeriods: 12, contractThen: 'ends' });
  });

  it('sends none for a kind that is not repeating, whatever the form held before the kind changed', () => {
    const paidOnce = withChoice(draft({ contract: 'fixed' }), 'one_time');
    expect(draftBody(paidOnce, 'USD')).toMatchObject({ contractPeriods: null, contractThen: null });
    expect(draftProblems(paidOnce, 'USD')).toBeNull();
  });

  it('marks a number out of range and a free contract, and nothing else', () => {
    expect(draftProblems(draft({ contract: 'fixed', contractPeriods: '0' }), 'USD')).toEqual({ contractPeriods: 'Type how many payments, from 1 to 156.' });
    expect(draftProblems(draft({ contract: 'fixed', contractPeriods: '157' }), 'USD')).toEqual({ contractPeriods: 'Type how many payments, from 1 to 156.' });
    expect(draftProblems(draft({ contract: 'fixed', price: '0' }), 'USD')).toEqual({ contractPeriods: 'A free membership has no contract. Choose No contract.' });
    expect(draftProblems(draft({ contract: 'fixed' }), 'USD')).toBeNull();
  });

  it('opens a saved type with its contract, and one without as No contract', () => {
    expect(draftFromType(listType())).toMatchObject({ contract: 'fixed', contractPeriods: '12', contractThen: 'renews' });
    expect(draftFromType(listType({ contractPeriods: null, contractThen: null }))).toMatchObject({ contract: 'none' });
  });

  it('says how long it runs, in the words of its payments', () => {
    expect(contractHint(draft({ contract: 'fixed' }))).toBe('The contract runs 12 months. After it, it renews until they cancel.');
    expect(contractHint(draft({ contract: 'fixed', contractPeriods: '24', contractThen: 'ends' }))).toBe('The contract runs 2 years. It ends after the last payment.');
    expect(contractHint(draft({ contract: 'fixed', contractPeriods: 'x' }))).toBeNull();
    expect(contractLine(listType())).toBe('Contract: 12 months, then renews until cancelled');
    expect(contractLine(listType({ contractThen: 'ends', termCount: 3, contractPeriods: 4 }))).toBe('Contract: 12 months, then it ends');
    expect(contractLine(listType({ contractPeriods: null, contractThen: null }))).toBeNull();
  });
});

describe("the person's page", () => {
  const held = (over = {}) => ({
    typeName: 'Gold 12 months',
    kind: 'recurring',
    termCount: 1,
    termUnit: 'month',
    contractPeriods: 12,
    release: null,
    view: {
      status: 'active',
      endsOn: null,
      renewsOn: '2026-12-04',
      payment: null,
      contract: { until: '2027-10-03', then: 'renews' },
      can: { freeze: true, unfreeze: false, cancel: true, cancelAtPeriodEnd: '2026-12-03', cancelAtContractEnd: '2027-10-03', releaseNeeded: true, markPaid: null, undoPaid: null },
    },
    ...over,
  });

  it('names the contract and its last day, and a release with its reason', () => {
    expect(contractShownLine(held())).toBe('Contract: 12 months, until 3 October 2027');
    expect(contractShownLine({ ...held(), view: { ...held().view, contract: { until: '2027-10-03', then: 'ends' } } })).toBe('Contract: 12 months, until 3 October 2027, then it ends');
    expect(contractShownLine({ ...held(), view: { ...held().view, contract: null } })).toBeNull();
    expect(releaseShownLine(held({ release: 'medical' }))).toBe('Released from contract: Medical or disability');
    expect(releaseShownLine(held())).toBeNull();
  });

  it('asks End or release inside a contract, and the plain question outside one', () => {
    const words = askWords('cancel', held(), 'Ada', '2026-11-03');
    expect(words).toMatchObject({ endButton: 'End on 3 October 2027', releaseLaterButton: 'Release on 3 December 2026', releaseButton: 'Release today' });
    const ends = held();
    ends.view = { ...ends.view, contract: { until: '2027-10-03', then: 'ends' }, can: { ...ends.view.can, cancelAtContractEnd: null } };
    expect(askWords('cancel', ends, 'Ada', '2026-11-03')).toMatchObject({
      endButton: null,
      detail: 'Ada is in contract until 3 October 2027, when it ends. To stop it sooner, release them from the contract.',
    });
    const free = held();
    free.view = { ...free.view, contract: null, can: { ...free.view.can, releaseNeeded: false } };
    expect(askWords('cancel', free, 'Ada', '2026-11-03')).toMatchObject({ button: 'Cancel today', laterButton: 'Cancel on 3 December 2026' });
    expect(doneWords('cancelContract', held())).toBe('Gold 12 months ends on 3 October 2027, with its contract.');
  });
});
