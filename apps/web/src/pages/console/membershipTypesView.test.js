// Settings → Memberships: its words and its form's rules (spec Part 3 §13.1; ROADMAP 17a-i).
import { describe, expect, it } from 'vitest';
import { saveGymMembershipTypeRequestSchema } from '@app/shared';
import {
  archivedNote,
  canAddType,
  canManageMemberships,
  classOptions,
  draftBody,
  draftFromType,
  draftProblems,
  emptyDraft,
  firstProblem,
  includesLine,
  kindChoice,
  kindTag,
  priceExample,
  termLine,
  termUnitOptions,
  typesSummary,
  wholeNumber,
  withChoice,
} from './membershipTypesView';

const YOGA = { id: '33333333-3333-4333-8333-000000000001', name: 'Yoga' };
const SPIN = { id: '33333333-3333-4333-8333-000000000002', name: 'Spin' };

const type = (over = {}) => ({
  id: '22222222-2222-4222-8222-000000000001',
  name: 'Gold Monthly',
  description: null,
  kind: 'recurring',
  priceMinor: 4999,
  currency: 'USD',
  termCount: 1,
  termUnit: 'month',
  packClasses: null,
  packDays: null,
  access: 'all_classes',
  bookingsLimit: null,
  bookingsPeriod: null,
  classTypes: null,
  archivedAt: null,
  updatedAt: '2026-10-04T09:00:00.000Z',
  ...over,
});
const packType = (over = {}) => type({ kind: 'pack', termCount: null, termUnit: null, packClasses: 10, packDays: 60, ...over });

describe('the price a gym typed is the price that is sent and shown', () => {
  // The worst thing this screen could do: send or show a price a hundred times off.
  it.each([
    ['49.99', 'USD', 4999, '$49.99 every month'],
    ['49.9', 'USD', 4990, '$49.90 every month'],
    ['49', 'GBP', 4900, '£49.00 every month'],
    ['4.35', 'EUR', 435, '€4.35 every month'],
    ['1500', 'INR', 150000, '₹1,500.00 every month'],
    ['5000', 'JPY', 5000, '¥5,000 every month'],
    ['0', 'USD', 0, 'Free · renews every month'],
  ])('%s in %s is %i minor units, shown as "%s"', (typed, currency, minor, shown) => {
    const draft = { ...emptyDraft(), name: 'Gold', price: typed };
    expect(draftProblems(draft, currency)).toBeNull();
    const body = draftBody(draft, currency);
    expect(body.priceMinor).toBe(minor);
    expect(termLine(type({ priceMinor: body.priceMinor, currency }))).toBe(shown);
    // And the form opens again on the same number.
    expect(draftBody(draftFromType(type({ priceMinor: minor, currency })), currency).priceMinor).toBe(minor);
  });

  it.each(['49,99', '1,500', '$49.99', '49.999', '', ' ', '-5', 'free', '1e3'])(
    'refuses "%s" and says how to type a price, and never sends it',
    (typed) => {
      const problems = draftProblems({ ...emptyDraft(), name: 'Gold', price: typed }, 'USD');
      expect(problems?.price).toBe('Type the price as a number, like 49.99. Type 0 for free.');
    },
  );

  it('gives a yen example without decimals', () => {
    expect(priceExample('JPY')).toBe('5000');
    expect(draftProblems({ ...emptyDraft(), name: 'Gold', price: '5000.5' }, 'JPY')?.price).toBe(
      'Type the price as a number, like 5000. Type 0 for free.',
    );
  });
});

describe('what each type says on the list', () => {
  it('names its kind, and a pack of 1 for 1 day is a day pass', () => {
    expect(kindTag(type())).toBe('Recurring');
    expect(kindTag(type({ kind: 'one_time' }))).toBe('One time');
    expect(kindTag(type({ kind: 'trial' }))).toBe('Trial');
    expect(kindTag(packType())).toBe('Class pack');
    expect(kindTag(packType({ packClasses: 1, packDays: 1 }))).toBe('Day pass');
    expect(kindChoice(packType({ packClasses: 1, packDays: 2 }))).toBe('pack');
  });

  it('says what it costs and how long it lasts', () => {
    expect(termLine(type())).toBe('$49.99 every month');
    expect(termLine(type({ termCount: 3 }))).toBe('$49.99 every 3 months');
    expect(termLine(type({ termUnit: 'year' }))).toBe('$49.99 every year');
    expect(termLine(type({ priceMinor: 0, termCount: 3 }))).toBe('Free · renews every 3 months');
    expect(termLine(type({ kind: 'one_time', termCount: 90, termUnit: 'day' }))).toBe('$49.99 once · lasts 90 days');
    expect(termLine(type({ kind: 'one_time', termCount: 1, termUnit: 'year' }))).toBe('$49.99 once · lasts 1 year');
    expect(termLine(type({ kind: 'trial', priceMinor: 0, termCount: 7, termUnit: 'day' }))).toBe('Free · lasts 7 days');
    expect(termLine(packType())).toBe('$49.99 · 10 classes, used within 60 days');
    expect(termLine(packType({ packClasses: 1, packDays: 30 }))).toBe('$49.99 · 1 class, used within 30 days');
    expect(termLine(packType({ packClasses: 1, packDays: 1, priceMinor: 1500, currency: 'GBP' }))).toBe('£15.00 · 1 visit, on the day');
  });

  it('says what it includes', () => {
    expect(includesLine(type())).toBe('Unlimited classes');
    expect(includesLine(type({ access: 'gym_only' }))).toBe('No classes, gym only');
    expect(includesLine(type({ access: 'limited', bookingsLimit: 3, bookingsPeriod: 'week' }))).toBe('3 classes a week');
    expect(includesLine(type({ access: 'limited', bookingsLimit: 8, bookingsPeriod: 'month' }))).toBe('8 classes a month');
    expect(includesLine(type({ access: 'limited', bookingsLimit: 1, bookingsPeriod: 'week' }))).toBe('1 class a week');
    expect(includesLine(type({ classTypes: [YOGA, SPIN] }))).toBe('Only Yoga, Spin');
    expect(includesLine(type({ access: 'limited', bookingsLimit: 2, bookingsPeriod: 'week', classTypes: [YOGA] }))).toBe('2 classes a week · only Yoga');
    expect(includesLine(packType())).toBe('Any class');
    // A day pass says what the visit is for, not "Any class" under "1 visit".
    expect(includesLine(packType({ packClasses: 1, packDays: 1 }))).toBe('The gym or any class');
    expect(includesLine(packType({ packClasses: 1, packDays: 1, classTypes: [YOGA] }))).toBe('Only Yoga');
    expect(includesLine(packType({ classTypes: [YOGA] }))).toBe('Only Yoga');
    const five = ['A', 'B', 'C', 'D', 'E'].map((name, i) => ({ id: `33333333-3333-4333-8333-00000000001${String(i)}`, name }));
    expect(includesLine(type({ classTypes: five }))).toBe('Only A, B, C and 2 more');
    expect(includesLine(type({ classTypes: [] }))).toBe('No classes ticked');
  });

  it('sums the list up while its box is closed', () => {
    expect(typesSummary(null)).toBeUndefined();
    expect(typesSummary({ types: [] })).toBe('Nothing for sale yet');
    expect(typesSummary({ types: [type()] })).toBe('1 membership type');
    expect(typesSummary({ types: [type(), type()] })).toBe('2 membership types');
  });

  it('says when the archived list is only its newest page', () => {
    expect(archivedNote({ archived: [type()], archivedTotal: 1 })).toBeNull();
    expect(archivedNote({ archived: [type(), type()], archivedTotal: 5 })).toBe('Showing the newest 2 of 5.');
  });

  it('has room for a new type until the list is full', () => {
    expect(canAddType({ types: [] })).toBe(true);
    expect(canAddType({ types: Array.from({ length: 60 }, () => type()) })).toBe(false);
    expect(canAddType(null)).toBe(false);
  });
});

describe('who may change the list', () => {
  it('is whoever holds the tick, whatever their role', () => {
    expect(canManageMemberships(['members.read', 'memberships.manage'])).toBe(true);
    expect(canManageMemberships(['members.read', 'org.manage', 'staff.manage'])).toBe(false);
    expect(canManageMemberships(undefined)).toBe(false);
    expect(canManageMemberships('memberships.manage')).toBe(false);
  });
});

describe('the form', () => {
  const named = (over = {}) => ({ ...emptyDraft(), name: ' Gold ', price: '49.99', ...over });
  const valid = (body) => saveGymMembershipTypeRequestSchema.safeParse(body).success;

  it('sends each kind in the shape the server takes', () => {
    expect(draftBody(named(), 'USD')).toEqual({
      name: 'Gold',
      description: null,
      kind: 'recurring',
      priceMinor: 4999,
      termCount: 1,
      termUnit: 'month',
      packClasses: null,
      packDays: null,
      access: 'all_classes',
      bookingsLimit: null,
      bookingsPeriod: null,
      classTypeIds: null,
    });
    expect(draftBody(named({ description: '  All classes and open gym  ' }), 'USD').description).toBe('All classes and open gym');
    expect(draftBody(named({ choice: 'pack' }), 'USD')).toMatchObject({ kind: 'pack', packClasses: 10, packDays: 60, termCount: null, termUnit: null, access: 'all_classes' });
    expect(draftBody(named({ choice: 'day_pass', packClasses: '25', packDays: '90' }), 'USD')).toMatchObject({ kind: 'pack', packClasses: 1, packDays: 1 });
    expect(draftBody(named({ choice: 'trial', termCount: '7', termUnit: 'day' }), 'USD')).toMatchObject({ kind: 'trial', termCount: 7, termUnit: 'day' });
    expect(draftBody(named({ access: 'limited', bookingsLimit: '2', bookingsPeriod: 'week' }), 'USD')).toMatchObject({ access: 'limited', bookingsLimit: 2, bookingsPeriod: 'week' });
    expect(draftBody(named({ access: 'limited' }), 'USD')).toMatchObject({ access: 'limited', bookingsLimit: 8, bookingsPeriod: 'month' });
    expect(draftBody(named({ classScope: 'some', classIds: [YOGA.id] }), 'USD').classTypeIds).toEqual([YOGA.id]);
    // What does not apply to the kind is never sent, whatever the form still holds.
    expect(draftBody(named({ access: 'gym_only', classScope: 'some', classIds: [YOGA.id] }), 'USD')).toMatchObject({ access: 'gym_only', classTypeIds: null });
    expect(draftBody(named({ choice: 'pack', access: 'limited', bookingsLimit: '4' }), 'USD')).toMatchObject({ access: 'all_classes', bookingsLimit: null, bookingsPeriod: null });

    for (const draft of [
      named(),
      named({ choice: 'one_time', termCount: '90', termUnit: 'day' }),
      named({ choice: 'pack' }),
      named({ choice: 'day_pass' }),
      named({ choice: 'trial', price: '0', termCount: '7', termUnit: 'day' }),
      named({ access: 'limited' }),
      named({ description: 'Open gym' }),
      named({ access: 'gym_only', classScope: 'some' }),
      named({ choice: 'pack', classScope: 'some', classIds: [YOGA.id, SPIN.id] }),
    ]) {
      expect(draftProblems(draft, 'USD'), JSON.stringify(draft)).toBeNull();
      expect(valid(draftBody(draft, 'USD')), JSON.stringify(draft)).toBe(true);
    }
  });

  it('says what is wrong, one sentence a box', () => {
    expect(draftProblems(named({ name: '  ' }), 'USD')).toEqual({ name: 'Give it a name, like Gold Monthly.' });
    expect(draftProblems(named({ termCount: '0' }), 'USD')).toEqual({ termCount: 'Type a whole number from 1 to 365.' });
    expect(draftProblems(named({ termCount: '1.5' }), 'USD')?.termCount).toBeTruthy();
    expect(draftProblems(named({ choice: 'pack', packClasses: '', packDays: '900' }), 'USD')).toEqual({
      packClasses: 'Type how many classes, from 1 to 500.',
      packDays: 'Type how many days, from 1 to 730.',
    });
    expect(draftProblems(named({ access: 'limited', bookingsLimit: '201' }), 'USD')).toEqual({
      bookingsLimit: 'Type how many classes, from 1 to 200.',
    });
    expect(draftProblems(named({ description: 'x'.repeat(301) }), 'USD')).toEqual({ description: 'Keep the description to 300 letters.' });
    expect(draftProblems(named({ classScope: 'some' }), 'USD')).toEqual({ classes: 'Tick at least one class, or choose Every class.' });
    // A pack of 1 class for 1 day would be saved as a day pass and open as one.
    expect(draftProblems(named({ choice: 'pack', packClasses: '1', packDays: '1' }), 'USD')).toEqual({
      packDays: '1 class used within 1 day is a day pass. Add it as a Day pass, or change a number.',
    });
    expect(draftProblems(named({ choice: 'pack', packClasses: '1', packDays: '2' }), 'USD')).toBeNull();
    // A box the kind does not use is not checked.
    expect(draftProblems(named({ choice: 'day_pass', termCount: '', packClasses: '', bookingsLimit: '' }), 'USD')).toBeNull();
    expect(draftProblems(named({ choice: 'pack', termCount: '' }), 'USD')).toBeNull();
  });

  it('names the first wrong box from the top, for a refused save to show', () => {
    expect(firstProblem(null)).toBeNull();
    expect(firstProblem(draftProblems(named({ price: '49,99', termCount: '0' }), 'USD'))).toBe('price');
    expect(firstProblem(draftProblems(named({ name: '', price: '' }), 'USD'))).toBe('name');
    expect(firstProblem(draftProblems(named({ classScope: 'some' }), 'USD'))).toBe('classes');
  });

  it('opens a saved type as it was saved', () => {
    const saved = type({ access: 'limited', bookingsLimit: 3, bookingsPeriod: 'week', classTypes: [YOGA], termCount: 3, description: 'Small groups' });
    expect(draftBody(draftFromType(saved), 'USD')).toEqual({
      name: 'Gold Monthly',
      description: 'Small groups',
      kind: 'recurring',
      priceMinor: 4999,
      termCount: 3,
      termUnit: 'month',
      packClasses: null,
      packDays: null,
      access: 'limited',
      bookingsLimit: 3,
      bookingsPeriod: 'week',
      classTypeIds: [YOGA.id],
      // A change carries the stamp the list gave; a new type has none.
      updatedAt: '2026-10-04T09:00:00.000Z',
    });
    expect('updatedAt' in draftBody(named(), 'USD')).toBe(false);
    expect(draftFromType(packType({ packClasses: 1, packDays: 1 })).choice).toBe('day_pass');
    expect(draftBody(draftFromType(packType({ packClasses: 5, packDays: 30 })), 'USD')).toMatchObject({ kind: 'pack', packClasses: 5, packDays: 30 });
  });

  it('offers the live classes, and keeps one the type already covers', () => {
    const list = { classChoices: [SPIN] };
    expect(classOptions(list, undefined)).toEqual([SPIN]);
    expect(classOptions(list, type({ classTypes: [YOGA, SPIN] }))).toEqual([SPIN, YOGA]);
  });

  it('never charges a repeating type by the day', () => {
    expect(termUnitOptions('recurring').map((u) => u.value)).toEqual(['week', 'month', 'year']);
    expect(termUnitOptions('trial').map((u) => u.value)).toEqual(['day', 'week', 'month', 'year']);
    expect(withChoice({ ...emptyDraft(), choice: 'trial', termUnit: 'day' }, 'recurring').termUnit).toBe('month');
    expect(withChoice({ ...emptyDraft(), choice: 'trial', termUnit: 'week' }, 'recurring').termUnit).toBe('week');
  });

  it('reads whole numbers only', () => {
    expect(wholeNumber('12', 1, 365)).toBe(12);
    expect(wholeNumber(' 12 ', 1, 365)).toBe(12);
    for (const bad of ['', '0', '366', '1.5', '1e2', '-3', 'ten', '12345']) expect(wholeNumber(bad, 1, 365), bad).toBeNull();
  });
});
