// THE WORDS ABOUT A DISCOUNT ON A MEMBERSHIP (ROADMAP 18b-ii-b; spec Part 3 §14.3): what is
// offered on a type, what it comes to, what the person's page says afterwards, and the
// form's new part. Every amount here was worked out by hand.
import { describe, expect, it } from 'vitest';
import {
  applyPromoCodeToType,
  discountBody,
  discountMembershipsWords,
  discountProblems,
  discountRow,
  discountWhyNotType,
  discountsFor,
  discountsForType,
  draftFromDiscount,
  emptyDiscountDraft,
  heldDiscountLine,
  membershipPromoCodeNote,
  membershipSummary,
  oldMoneySaleLine,
  pickedDiscount,
} from './sellDiscountsView';

const GOLD = { id: 't-gold', name: 'Gold Monthly', kind: 'recurring', priceMinor: 5000, currency: 'USD', termCount: 1, termUnit: 'month', packClasses: null, packDays: null };
const PASS = { id: 't-pass', name: 'Day pass', kind: 'pack', priceMinor: 1500, currency: 'USD', termCount: null, termUnit: null, packClasses: 1, packDays: 1 };
const STAFF = { id: 't-staff', name: 'Staff', kind: 'recurring', priceMinor: 0, currency: 'USD', termCount: 1, termUnit: 'month', packClasses: null, packDays: null };
const WATER = { id: 'p-water', name: 'Water', priceMinor: 199, currency: 'USD', taxed: true, stock: null };
const discount = (over = {}) => ({
  id: 'd-first',
  name: 'First month',
  code: 'FIRST20',
  kind: 'percent',
  percentBp: 2000,
  amountMinor: null,
  currency: null,
  startsOn: null,
  endsOn: null,
  maxUses: null,
  uses: 0,
  forProducts: false,
  allProducts: true,
  productIds: [],
  forMemberships: true,
  allMembershipTypes: true,
  membershipTypeIds: [],
  membershipPayments: 'first',
  archivedAt: null,
  updatedAt: '2026-10-13T10:00:00.000Z',
  ...over,
});
const FIRST = discount();
const FOUNDERS = discount({ id: 'd-founders', name: 'Founders', code: null, kind: 'amount', percentBp: null, amountMinor: 1000, currency: 'USD', membershipPayments: 'every' });
const PASS_ONLY = discount({ id: 'd-pass', name: 'Pass only', code: 'PASS', allMembershipTypes: false, membershipTypeIds: [PASS.id] });
const WATER_ONLY = discount({ id: 'd-water', name: 'Water deal', code: 'WATER', forProducts: true, forMemberships: false, membershipPayments: null });
const page = (discounts) => ({ today: '2026-10-15', currency: 'USD', canManage: true, discounts });

describe('what is offered on a membership', () => {
  const all = page([FIRST, FOUNDERS, PASS_ONLY, WATER_ONLY]);
  it('offers the discounts for this type alone, and none for products alone', () => {
    expect(discountsForType(all, GOLD).map((d) => d.name)).toEqual(['First month', 'Founders']);
    expect(discountsForType(all, PASS).map((d) => d.name)).toEqual(['First month', 'Founders', 'Pass only']);
    expect(discountsForType(all, null)).toEqual([]);
    // And a product is not offered a discount that is for memberships alone.
    expect(discountsFor(all, WATER).map((d) => d.name)).toEqual(['Water deal']);
  });

  it('offers nothing that takes nothing off, or the whole price', () => {
    // $10.00 off a free membership takes nothing; $15.00 off a $15.00 pass takes all of it.
    const fifteen = discount({ id: 'd-15', name: 'Fifteen off', code: null, kind: 'amount', percentBp: null, amountMinor: 1500, currency: 'USD' });
    expect(discountsForType(page([FOUNDERS]), STAFF)).toEqual([]);
    expect(discountsForType(page([fifteen]), PASS)).toEqual([]);
    expect(discountWhyNotType(fifteen, PASS, '2026-10-15')).toBe('Fifteen off would take off the whole price of Day pass.');
    expect(discountWhyNotType(FOUNDERS, STAFF, '2026-10-15')).toBe('Founders takes nothing off Staff.');
  });

  it('says why one cannot be used, naming the membership', () => {
    expect(discountWhyNotType(PASS_ONLY, GOLD, '2026-10-15')).toBe('Pass only does not apply to Gold Monthly.');
    expect(discountWhyNotType(WATER_ONLY, GOLD, '2026-10-15')).toBe('Water deal does not apply to Gold Monthly.');
    expect(discountWhyNotType(discount({ startsOn: '2026-11-01' }), GOLD, '2026-10-15')).toBe('First month starts on 1 Nov 2026.');
    expect(discountWhyNotType(discount({ maxUses: 3, uses: 3 }), GOLD, '2026-10-15')).toBe('First month has reached its usage limit.');
    expect(discountWhyNotType(FIRST, GOLD, '2026-10-15')).toBeNull();
  });

  it('a promo code picks the discount, or says why not, in the membership words', () => {
    expect(applyPromoCodeToType(all, GOLD, ' first20 ')).toEqual({ discount: FIRST, appliedId: 'd-first', note: 'FIRST20 applied: 20% off.' });
    expect(applyPromoCodeToType(all, GOLD, 'pass')).toEqual({ discount: null, note: 'Pass only does not apply to Gold Monthly.' });
    expect(applyPromoCodeToType(all, GOLD, 'water')).toEqual({ discount: null, note: 'Water deal does not apply to Gold Monthly.' });
    expect(applyPromoCodeToType(all, null, 'first20')).toEqual({ discount: null, note: 'Pick a membership first, then apply the promo code.' });
    expect(applyPromoCodeToType(all, GOLD, 'nope')).toEqual({ discount: null, note: 'There is no promo code NOPE. Check the spelling with the customer.' });
  });

  it('says a code is applied only while its discount is on the membership', () => {
    const applied = { text: 'PASS', note: 'PASS applied: 20% off.', appliedId: 'd-pass' };
    expect(membershipPromoCodeNote(all, PASS, PASS_ONLY, applied)).toBe('PASS applied: 20% off.');
    expect(membershipPromoCodeNote(all, GOLD, null, applied)).toBe('Pass only does not apply to Gold Monthly. No discount is on this membership.');
    expect(membershipPromoCodeNote(page([]), GOLD, null, applied)).toBe('That promo code is no longer offered. No discount is on this membership.');
  });

  it('the discount picked is only ever one the type can take', () => {
    expect(pickedDiscount(all, GOLD, 'd-first')).toBe(FIRST);
    expect(pickedDiscount(all, GOLD, 'd-pass')).toBeNull();
    expect(pickedDiscount(all, GOLD, '')).toBeNull();
  });

  it('a fixed amount kept in the old money is said on the membership form, and a product-only one is not', () => {
    const pounds = { ...page([discount({ ...FOUNDERS, currency: 'GBP' }), discount({ ...WATER_ONLY, kind: 'amount', percentBp: null, amountMinor: 100, currency: 'GBP' })]) };
    expect(oldMoneySaleLine(pounds, 'membership')).toBe('Founders cannot be used until its amount is saved again in USD. Open it under Discounts below and press Change.');
    expect(oldMoneySaleLine(pounds)).toBe('Water deal cannot be used until its amount is saved again in USD. Open it under Discounts below and press Change.');
  });
});

describe('what a membership with a discount comes to', () => {
  it.each([
    // [what, type, discount, the lines, what is said of later payments, what the server is sent as coming off]
    [
      '20% off the first month of $50.00',
      GOLD,
      FIRST,
      [['Price', '$50.00'], ['Discount (First month)', '-$10.00'], ['Total', '$40.00']],
      'This is the first payment. Every payment after it is $50.00.',
      1000,
    ],
    ['$10.00 off every month', GOLD, FOUNDERS, [['Price', '$50.00'], ['Discount (Founders)', '-$10.00'], ['Total', '$40.00']], 'Every payment is $40.00 while the membership lasts.', 1000],
    ['20% off a $15.00 day pass, paid once', PASS, PASS_ONLY, [['Price', '$15.00'], ['Discount (Pass only)', '-$3.00'], ['Total', '$12.00']], null, 300],
    ['no discount', GOLD, null, [['Total', '$50.00']], null, null],
  ])('%s', (_what, type, d, lines, later, offMinor) => {
    const summary = membershipSummary(type, d);
    expect(summary.lines.map((l) => [l.label, l.value])).toEqual(lines);
    expect(summary.later).toBe(later);
    expect(summary.offMinor).toBe(offMinor);
  });

  it('nothing to show for no type, or a discount that would take the whole price', () => {
    expect(membershipSummary(null, FIRST)).toBeNull();
    expect(membershipSummary(PASS, discount({ kind: 'amount', percentBp: null, amountMinor: 1500, currency: 'USD' }))).toBeNull();
  });

});

describe('what a person page says of a membership sold with a discount', () => {
  const held = (over) => ({ kind: 'recurring', priceMinor: 5000, currency: 'USD', discount: null, ...over });
  it.each([
    ['first payment only', held({ discount: { name: 'First month', offMinor: 1000, payments: 'first' } }), 'Sold with First month: $10.00 off the first payment. Every payment after it is $50.00.'],
    ['every payment, whose price is already the price after it', held({ priceMinor: 4000, discount: { name: 'Founders', offMinor: 1000, payments: 'every' } }), 'Sold with Founders: $10.00 off every payment.'],
    ['a pack, paid once', held({ kind: 'pack', priceMinor: 1200, discount: { name: 'Pass only', offMinor: 300, payments: 'every' } }), 'Sold with Pass only: $3.00 off.'],
    ['none', held({}), null],
  ])('%s', (_what, m, line) => {
    expect(heldDiscountLine(m)).toBe(line);
  });
});

describe("the form's part for memberships", () => {
  const types = [GOLD, PASS];
  const base = { ...emptyDiscountDraft(), name: 'First month', percent: '20' };

  it('starts on products alone, as a discount always did', () => {
    expect(emptyDiscountDraft()).toMatchObject({ forProducts: true, forMemberships: false, typeScope: 'all', typeIds: [], payments: '' });
  });

  it('asks for something to apply to, a ticked membership, and how often', () => {
    expect(discountProblems({ ...base, forProducts: false }, 'USD', [], types)).toEqual({ appliesTo: 'Tick products, memberships, or both.' });
    expect(discountProblems({ ...base, forMemberships: true }, 'USD', [], types)).toEqual({ payments: 'Choose whether it comes off the first payment only or every payment.' });
    expect(discountProblems({ ...base, forMemberships: true, payments: 'first', typeScope: 'some' }, 'USD', [], types)).toEqual({ types: 'Tick at least one membership.' });
    // A type ticked and archived since is not counted.
    expect(discountProblems({ ...base, forMemberships: true, payments: 'first', typeScope: 'some', typeIds: ['gone'] }, 'USD', [], types)).toEqual({ types: 'Tick at least one membership.' });
    expect(discountProblems({ ...base, forProducts: false, forMemberships: true, payments: 'every' }, 'USD', [], types)).toEqual({});
  });

  it('sends memberships alone, both, and picked types as the server takes them', () => {
    const memberships = { ...base, forProducts: false, forMemberships: true, payments: 'first', typeScope: 'some', typeIds: [PASS.id, 'gone'], scope: 'some', productIds: [WATER.id] };
    expect(discountBody(memberships, 'USD', [WATER], types)).toMatchObject({
      forProducts: false,
      allProducts: true,
      productIds: [],
      forMemberships: true,
      allMembershipTypes: false,
      membershipTypeIds: [PASS.id],
      membershipPayments: 'first',
    });
    expect(discountBody({ ...base, forMemberships: true, payments: 'every' }, 'USD', [WATER], types)).toMatchObject({
      forProducts: true,
      allProducts: true,
      forMemberships: true,
      allMembershipTypes: true,
      membershipTypeIds: [],
      membershipPayments: 'every',
    });
    expect(discountBody(base, 'USD', [WATER], types)).toMatchObject({ forMemberships: false, allMembershipTypes: true, membershipTypeIds: [], membershipPayments: null });
  });

  it('opens a discount for memberships as it is', () => {
    expect(draftFromDiscount(PASS_ONLY)).toMatchObject({ forProducts: false, forMemberships: true, typeScope: 'some', typeIds: [PASS.id], payments: 'first' });
  });

  it('its row says what it is for, by name, and how often', () => {
    expect(discountMembershipsWords(FIRST, types)).toBe('All memberships, first payment only');
    expect(discountMembershipsWords(FOUNDERS, types)).toBe('All memberships, every payment');
    expect(discountMembershipsWords(PASS_ONLY, types)).toBe('Day pass, first payment only');
    expect(discountMembershipsWords(discount({ allMembershipTypes: false, membershipTypeIds: ['gone'] }), types)).toBe('1 archived membership, first payment only');
    expect(discountRow(FIRST, [WATER], types)).toBe('20% off · Promo code FIRST20 · All memberships, first payment only · Not used yet');
    expect(discountRow({ ...FIRST, forProducts: true }, [WATER], types)).toBe('20% off · Promo code FIRST20 · All products · All memberships, first payment only · Not used yet');
    expect(discountRow(WATER_ONLY, [WATER], types)).toBe('20% off · Promo code WATER · All products · Not used yet');
  });
});
