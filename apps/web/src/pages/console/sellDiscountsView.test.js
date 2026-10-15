// THE SELL PAGE'S WORDS ABOUT DISCOUNTS (ROADMAP 18b-ii-a; spec Part 3 §14.3).
import { describe, expect, it } from 'vitest';
import {
  applyPromoCode,
  discountAmountWords,
  discountBody,
  discountDatesWords,
  discountInOldMoney,
  discountOption,
  discountProblems,
  discountProductsWords,
  discountRow,
  discountStatusTag,
  discountUsesWords,
  discountWhyNot,
  discountsFor,
  draftFromDiscount,
  emptyDiscountDraft,
  oldMoneyLine,
  oldMoneySaleLine,
  promoCodeNote,
} from './sellDiscountsView';
import { purchaseLine, saleProblem, saleSummary, soldWords, takingsNotes, takingsRows } from './sellView';

const WATER = { id: '11111111-1111-4111-8111-111111111111', name: 'Water', priceMinor: 199, currency: 'USD', taxRateId: 'r1', stock: null };
const TOWEL = { id: '22222222-2222-4222-8222-222222222222', name: 'Towel', priceMinor: 500, currency: 'USD', taxRateId: 'r1', stock: null };
const MAT = { id: '33333333-3333-4333-8333-333333333333', name: 'Mat', priceMinor: 900, currency: 'USD', taxRateId: 'r1', stock: null };
const discount = (over = {}) => ({
  id: 'd-summer',
  name: 'Summer sale',
  code: 'SUMMER20',
  kind: 'percent',
  percentBp: 2000,
  amountMinor: null,
  currency: null,
  startsOn: null,
  endsOn: null,
  maxUses: null,
  uses: 0,
  forProducts: true,
  allProducts: true,
  productIds: [],
  forMemberships: false,
  allMembershipTypes: true,
  membershipTypeIds: [],
  membershipPayments: null,
  archivedAt: null,
  updatedAt: '2026-10-13T10:00:00.000Z',
  ...over,
});
const FIVE = discount({ id: 'd-five', name: 'Five off', code: null, kind: 'amount', percentBp: null, amountMinor: 500, currency: 'USD' });
const TAX = { included: false, rates: [{ id: 'r1', name: 'Sales tax', bp: 825, products: 1, membershipTypes: 0, memberships: 0 }] };
const page = (discounts) => ({ today: '2026-10-13', currency: 'USD', products: [WATER, TOWEL, MAT], discounts });

describe('how a discount reads', () => {
  it('says what it takes off', () => {
    expect(discountAmountWords(discount())).toBe('20% off');
    expect(discountAmountWords(discount({ percentBp: 1250 }))).toBe('12.5% off');
    expect(discountAmountWords(FIVE)).toBe('$5.00 off');
    expect(discountAmountWords({ ...FIVE, currency: 'JPY', amountMinor: 500 })).toBe('¥500 off');
  });

  it.each([
    [{}, 'Active', 'c-tag-good'],
    [{ startsOn: '2026-10-14' }, 'Scheduled', 'c-tag-soft'],
    [{ endsOn: '2026-10-12' }, 'Expired', 'c-tag-plain'],
    [{ endsOn: '2026-10-13' }, 'Active', 'c-tag-good'],
    [{ maxUses: 5, uses: 5 }, 'Used up', 'c-tag-warn'],
    [{ archivedAt: '2026-10-01T00:00:00.000Z' }, 'Archived', 'c-tag-plain'],
  ])('%j reads %s', (over, words, tag) => {
    expect(discountStatusTag(discount(over), '2026-10-13')).toMatchObject({ words, tag });
  });

  it('names the products it is for', () => {
    const products = [WATER, TOWEL, MAT];
    expect(discountProductsWords(discount(), products)).toBe('All products');
    expect(discountProductsWords(discount({ allProducts: false, productIds: [WATER.id] }), products)).toBe('Water');
    expect(discountProductsWords(discount({ allProducts: false, productIds: [WATER.id, TOWEL.id] }), products)).toBe('Water and Towel');
    expect(discountProductsWords(discount({ allProducts: false, productIds: [WATER.id, TOWEL.id, MAT.id] }), products)).toBe('Water, Towel and 1 more');
    // A product archived since is not for sale, so it is not in the list sent.
    expect(discountProductsWords(discount({ allProducts: false, productIds: [WATER.id, 'gone'] }), products)).toBe('Water and 1 more');
    expect(discountProductsWords(discount({ allProducts: false, productIds: ['gone'] }), products)).toBe('1 archived product');
    expect(discountProductsWords(discount({ allProducts: false, productIds: ['gone', 'gone-2'] }), products)).toBe('2 archived products');
  });

  it('says when it can be used and how often it has been', () => {
    expect(discountDatesWords(discount())).toBeNull();
    expect(discountDatesWords(discount({ startsOn: '2026-06-01' }))).toBe('From 1 Jun 2026');
    expect(discountDatesWords(discount({ endsOn: '2026-08-31' }))).toBe('Until 31 Aug 2026');
    expect(discountDatesWords(discount({ startsOn: '2026-06-01', endsOn: '2026-08-31' }))).toBe('1 Jun 2026 to 31 Aug 2026');
    expect(discountDatesWords(discount({ startsOn: '2026-12-25', endsOn: '2026-12-25' }))).toBe('25 Dec 2026 only');
    expect(discountUsesWords(discount())).toBe('Not used yet');
    expect(discountUsesWords(discount({ uses: 1 }))).toBe('Used once');
    expect(discountUsesWords(discount({ uses: 1234 }))).toBe('Used 1,234 times');
    expect(discountUsesWords(discount({ uses: 3, maxUses: 100 }))).toBe('Used 3 of 100');
    expect(discountUsesWords(discount({ uses: 0, maxUses: 1 }))).toBe('Used 0 of 1');
  });

  it('is one line in the list and one option in the picker', () => {
    expect(discountRow(discount({ startsOn: '2026-06-01', endsOn: '2026-08-31', maxUses: 100, uses: 3 }), [WATER])).toBe('20% off · Promo code SUMMER20 · All products · 1 Jun 2026 to 31 Aug 2026 · Used 3 of 100');
    expect(discountRow(FIVE, [WATER])).toBe('$5.00 off · No promo code · All products · Not used yet');
    expect(discountOption(discount())).toBe('Summer sale · 20% off · code SUMMER20');
    expect(discountOption(FIVE)).toBe('Five off · $5.00 off');
  });
});

describe('which discounts the sale form offers', () => {
  const towels = discount({ id: 'd-towels', name: 'Towels', code: 'TOWEL', allProducts: false, productIds: [TOWEL.id] });
  const later = discount({ id: 'd-later', name: 'Black Friday', code: 'BF26', startsOn: '2026-11-27' });
  const over = discount({ id: 'd-over', name: 'Spring', code: 'SPRING', endsOn: '2026-04-30' });
  const spent = discount({ id: 'd-spent', name: 'First ten', code: 'FIRST10', maxUses: 10, uses: 10 });
  const pounds = { ...FIVE, id: 'd-pounds', name: 'Five pounds off', code: 'FIVER', currency: 'GBP' };
  const all = page([discount(), towels, later, over, spent, pounds, FIVE]);

  it('offers only what can be used on this product today', () => {
    expect(discountsFor(all, WATER).map((d) => d.name)).toEqual(['Summer sale', 'Five off']);
    expect(discountsFor(all, TOWEL).map((d) => d.name)).toEqual(['Summer sale', 'Towels', 'Five off']);
    expect(discountsFor(all, null)).toEqual([]);
  });

  it('says why another cannot be used', () => {
    expect(discountWhyNot(discount(), WATER, '2026-10-13')).toBeNull();
    expect(discountWhyNot(towels, WATER, '2026-10-13')).toBe('Towels does not apply to Water.');
    expect(discountWhyNot(later, WATER, '2026-10-13')).toBe('Black Friday starts on 27 Nov 2026.');
    expect(discountWhyNot(over, WATER, '2026-10-13')).toBe('Spring expired on 30 Apr 2026.');
    expect(discountWhyNot(spent, WATER, '2026-10-13')).toBe('First ten has reached its usage limit.');
    expect(discountWhyNot(pounds, WATER, '2026-10-13')).toBe('Five pounds off is a fixed amount in GBP. Open it under Discounts and save its amount again.');
  });

  it('a promo code typed finds its discount, however it is typed, or says why not', () => {
    expect(applyPromoCode(all, WATER, ' summer20 ')).toEqual({ discount: all.discounts[0], appliedId: 'd-summer', note: 'SUMMER20 applied: 20% off.' });
    expect(applyPromoCode(all, TOWEL, 'Towel')).toMatchObject({ discount: towels, note: 'TOWEL applied: 20% off.' });
    expect(applyPromoCode(all, WATER, 'towel')).toEqual({ discount: null, note: 'Towels does not apply to Water.' });
    expect(applyPromoCode(all, WATER, 'bf26')).toEqual({ discount: null, note: 'Black Friday starts on 27 Nov 2026.' });
    expect(applyPromoCode(all, WATER, 'first10')).toEqual({ discount: null, note: 'First ten has reached its usage limit.' });
    expect(applyPromoCode(all, WATER, 'summer2')).toEqual({ discount: null, note: 'There is no promo code SUMMER2. Check the spelling with the customer.' });
    expect(applyPromoCode(all, WATER, 'summer 20')).toEqual({ discount: null, note: 'There is no promo code SUMMER 20. Check the spelling with the customer.' });
    expect(applyPromoCode(all, WATER, '   ')).toEqual({ discount: null, note: 'Type the promo code, then press Apply.' });
    expect(applyPromoCode(all, null, 'summer20')).toEqual({ discount: null, note: 'Pick a product first, then apply the promo code.' });
  });
});

describe('what the line under the promo code says', () => {
  const towels = discount({ id: 'd-towels', name: 'Towels', code: 'TOWEL', allProducts: false, productIds: [TOWEL.id] });
  const applied = { text: 'towel', note: 'TOWEL applied: 20% off.', appliedId: 'd-towels' };

  it('says applied only while the applied discount is the one on the sale', () => {
    expect(promoCodeNote(page([towels]), TOWEL, towels, applied)).toBe('TOWEL applied: 20% off.');
    // Changed to 50% while the form was open: the line says what it takes off now.
    const half = { ...towels, percentBp: 5000 };
    expect(promoCodeNote(page([half]), TOWEL, half, applied)).toBe('TOWEL applied: 50% off.');
    // The product is changed to one the code is not for: the discount is off the sale.
    expect(promoCodeNote(page([towels]), WATER, null, applied)).toBe('Towels does not apply to Water. No discount is on this sale.');
    // The page is read again and it has been used up, or archived.
    const spent = { ...towels, maxUses: 3, uses: 3 };
    expect(promoCodeNote(page([spent]), TOWEL, null, applied)).toBe('Towels has reached its usage limit. No discount is on this sale.');
    expect(promoCodeNote(page([]), TOWEL, null, applied)).toBe('That promo code is no longer offered. No discount is on this sale.');
    expect(promoCodeNote(page([towels]), null, null, applied)).toBeNull();
  });

  it('a code that was never applied keeps its own sentence, and no sentence is none', () => {
    const wrong = { text: 'x', note: 'There is no promo code X. Check the spelling with the customer.', appliedId: null };
    expect(promoCodeNote(page([towels]), WATER, null, wrong)).toBe(wrong.note);
    expect(promoCodeNote(page([towels]), WATER, null, { text: '', note: null, appliedId: null })).toBeNull();
  });
});

describe('a fixed amount in the money the gym used before it changed country', () => {
  const pounds = { ...page([FIVE, discount()]), currency: 'GBP' };

  it('reads Needs saving, with what to do, and the sale form says the same', () => {
    expect(discountInOldMoney(FIVE, 'GBP')).toBe(true);
    expect(discountInOldMoney(FIVE, 'USD')).toBe(false);
    expect(discountInOldMoney(discount(), 'GBP')).toBe(false);
    expect(discountInOldMoney(FIVE, null)).toBe(false);
    expect(discountStatusTag(FIVE, '2026-10-13', 'GBP')).toMatchObject({ words: 'Needs saving', tag: 'c-tag-warn' });
    expect(discountStatusTag(FIVE, '2026-10-13', 'USD')).toMatchObject({ words: 'Active' });
    expect(discountStatusTag(discount(), '2026-10-13', 'GBP')).toMatchObject({ words: 'Active' });
    // What it already is comes first: an expired one is expired.
    expect(discountStatusTag({ ...FIVE, endsOn: '2026-01-01' }, '2026-10-13', 'GBP')).toMatchObject({ words: 'Expired' });
    expect(oldMoneyLine(FIVE, 'GBP')).toBe('This amount is in USD. Press Change and save it again to use it in GBP.');
    expect(oldMoneySaleLine(pounds)).toBe('Five off cannot be used until its amount is saved again in GBP. Open it under Discounts below and press Change.');
    expect(oldMoneySaleLine({ ...pounds, discounts: [FIVE, { ...FIVE, id: 'd-2', name: 'Staff' }] })).toBe('Five off and Staff cannot be used until their amounts are saved again in GBP. Open them under Discounts below and press Change.');
    expect(oldMoneySaleLine(page([FIVE, discount()]))).toBeNull();
    // Desk staff have no Change button: they are told who can.
    expect(oldMoneySaleLine({ ...pounds, canManage: false })).toBe('Five off cannot be used until its amount is saved again in GBP. The owner, or staff who can change membership types and prices, can save it again under Discounts.');
    // One that could not be used anyway is not named: expired, used up, not yet started.
    for (const over of [{ endsOn: '2026-01-01' }, { maxUses: 2, uses: 2 }, { startsOn: '2026-12-01' }, { archivedAt: '2026-10-01T00:00:00.000Z' }]) {
      expect(oldMoneySaleLine({ ...pounds, discounts: [{ ...FIVE, ...over }] }), JSON.stringify(over)).toBeNull();
    }
  });
});

describe('what a sale with a discount shows', () => {
  it('tax on top: the price, the discount, the tax on what is left, and the total', () => {
    // Two at 1.99 is 3.98; 20% is 0.80; 3.18; 8.25% of it is 0.26; 3.44.
    const summary = saleSummary(WATER, 2, TAX, discount());
    expect(summary.lines).toEqual([
      { label: 'Price', value: '$3.98' },
      { label: 'Discount (Summer sale)', value: '-$0.80' },
      { label: 'Sales tax 8.25%', value: '$0.26' },
      { label: 'Total', value: '$3.44', strong: true },
    ]);
    expect(summary.totalMinor).toBe(344);
  });

  it('tax in the price, and no tax', () => {
    expect(saleSummary({ ...TOWEL, priceMinor: 1000, currency: 'GBP' }, 1, { included: true, rates: [{ id: 'r1', name: 'VAT', bp: 2000, products: 1, membershipTypes: 0, memberships: 0 }] }, { ...FIVE, amountMinor: 200, currency: 'GBP' }).lines).toEqual([
      { label: 'Price', value: '£10.00' },
      { label: 'Discount (Five off)', value: '-£2.00' },
      { label: 'Total', value: '£8.00', strong: true },
      { label: 'Includes VAT 20%', value: '£1.33' },
    ]);
    expect(saleSummary({ ...WATER, taxRateId: null }, 1, TAX, discount()).lines).toEqual([
      { label: 'Price', value: '$1.99' },
      { label: 'Discount (Summer sale)', value: '-$0.40' },
      { label: 'Total', value: '$1.59', strong: true },
    ]);
  });

  it('without a discount it is as it was', () => {
    expect(saleSummary(WATER, 2, TAX).lines.map((l) => l.label)).toEqual(['Price', 'Sales tax 8.25%', 'Total']);
    expect(saleSummary(WATER, 2, TAX, null).totalMinor).toBe(431);
    expect(saleSummary({ ...WATER, taxRateId: null }, 1, TAX).lines).toEqual([{ label: 'Total', value: '$1.99', strong: true }]);
  });

  it('a discount that takes the whole price cannot be sold, and the form says why', () => {
    expect(saleSummary(WATER, 1, TAX, FIVE)).toBeNull();
    const base = { product: WATER, quantity: 1, who: 'walkin', person: null, currency: 'USD' };
    expect(saleProblem({ ...base, discount: FIVE })).toBe('Five off takes off the whole price, so there is nothing to pay. Choose No discount, or another one.');
    expect(saleProblem({ ...base, discount: discount({ percentBp: 9999 }) })).toBe('Summer sale takes off the whole price, so there is nothing to pay. Choose No discount, or another one.');
    // Three at 1.99 is 5.97: five off leaves something.
    expect(saleProblem({ ...base, quantity: 3, discount: FIVE })).toBeNull();
    expect(saleProblem({ ...base, discount: discount() })).toBeNull();
    // 0.01% of 1.99 rounds to nothing: the server spends no use on it, so the form does not send it.
    expect(saleProblem({ ...base, discount: discount({ name: 'Tiny', percentBp: 1 }) })).toBe('Tiny takes nothing off this price. Choose No discount, or another one.');
    expect(saleProblem(base)).toBeNull();
  });

  const sold = { id: 's1', itemName: 'Water', quantity: 2, unitPriceMinor: 199, netMinor: 318, taxMinor: 26, totalMinor: 344, taxBp: 825, taxName: 'Sales tax', taxIncluded: false, discountName: 'Summer sale', discountMinor: 80, currency: 'USD', method: 'cash', soldOn: '2026-10-13', soldAt: '2026-10-13T15:00:00.000Z', by: 'Sam Desk', person: null, undone: false, canUndo: true };
  const plain = { ...sold, id: 's2', discountName: null, discountMinor: 0, netMinor: 398, taxMinor: 33, totalMinor: 431 };

  it('says the discount where the sale is said: in the box, in the day and on the person', () => {
    expect(soldWords(sold)).toBe('Sold: 2 × Water to a walk-in. $3.44, cash. Summer sale: $0.80 off.');
    expect(soldWords(plain)).toBe('Sold: 2 × Water to a walk-in. $4.31, cash.');
    const rows = takingsRows({ sales: [sold, plain], payments: [] }, 'America/Chicago', '12h');
    expect(rows.find((r) => r.key === 'sale-s1').facts).toContain('Cash · Summer sale: $0.80 off · ');
    expect(rows.find((r) => r.key === 'sale-s2').facts).not.toContain('off');
    expect(purchaseLine(sold).facts).toBe('13 Oct 2026 · Cash · Summer sale: $0.80 off · $0.26 Sales tax');
    expect(purchaseLine(plain).facts).toBe('13 Oct 2026 · Cash · $0.33 Sales tax');
  });

  it('the day says what discounts took off, only where they took something', () => {
    const totals = { count: 2, payments: 0, totalMinor: 775, taxMinor: 0, cash: 775, card_at_desk: 0, bank_transfer: 0, link: 0, company: 0, refundedMinor: 0, discountMinor: 80, otherCurrency: 0 };
    const day = { totals, currency: 'USD', salesNotShown: 0, paymentsNotShown: 0 };
    expect(takingsNotes(day)).toEqual(["Discounts took $0.80 off today's product sales. The total above is what was paid."]);
    expect(takingsNotes({ ...day, totals: { ...totals, discountMinor: 0 } })).toEqual([]);
  });
});

describe('the discount form', () => {
  const products = [WATER, TOWEL];

  it('starts as a percentage on all products with no code, no dates and no limit', () => {
    expect(emptyDiscountDraft()).toMatchObject({ id: null, kind: 'percent', scope: 'all', limited: false, code: '', startsOn: '', endsOn: '' });
  });

  it('says what is missing, box by box', () => {
    expect(discountProblems(emptyDiscountDraft(), 'USD', products)).toEqual({
      name: 'Give the discount a name.',
      value: 'Enter the percentage as a number above 0 and under 100, like 10.',
    });
    const bad = { ...emptyDiscountDraft(), name: 'x'.repeat(61), kind: 'amount', amount: '0', code: 'no spaces', scope: 'some', productIds: [], startsOn: '2026-08-31', endsOn: '2026-06-01', limited: true, maxUses: '0' };
    expect(discountProblems(bad, 'USD', products)).toEqual({
      name: 'Keep the name to 60 characters.',
      value: 'Enter the amount as a number above 0, like 5.00.',
      code: 'Use 3 to 20 letters and numbers with no spaces, like SUMMER20.',
      products: 'Tick at least one product.',
      endsOn: 'The end date is before the start date. Pick a later end date.',
      maxUses: 'Enter how many times it can be used, from 1 to 100,000.',
    });
    expect(discountProblems({ ...emptyDiscountDraft(), name: 'Sum​mer', percent: '10' }, 'USD', products).name).toBe('Something hidden was pasted in with this. Delete it and type it again.');
    expect(discountProblems({ ...emptyDiscountDraft(), name: 'Staff', kind: 'amount', amount: '5' }, null, products).value).toBe('Set your country in Settings before adding a fixed-amount discount.');
    for (const percent of ['0', '100', '101', '12.555', 'ten', '']) expect(discountProblems({ ...emptyDiscountDraft(), name: 'A', percent }, 'USD', products).value, percent).toBeTruthy();
    for (const maxUses of ['', '0', '100001', '1.5', '-3']) expect(discountProblems({ ...emptyDiscountDraft(), name: 'A', percent: '10', limited: true, maxUses }, 'USD', products).maxUses, maxUses).toBeTruthy();
  });

  it('sends what was typed, as the server takes it', () => {
    const draft = { ...emptyDiscountDraft(), name: '  Summer sale ', percent: '12.5', code: ' summer20 ', scope: 'some', productIds: [TOWEL.id, 'archived-since'], startsOn: '2026-06-01', endsOn: '2026-08-31', limited: true, maxUses: '100' };
    expect(discountProblems(draft, 'USD', products)).toEqual({});
    expect(discountBody(draft, 'USD', products)).toEqual({
      name: 'Summer sale',
      code: 'SUMMER20',
      kind: 'percent',
      percentBp: 1250,
      amountMinor: null,
      startsOn: '2026-06-01',
      endsOn: '2026-08-31',
      maxUses: 100,
      forProducts: true,
      allProducts: false,
      productIds: [TOWEL.id],
      forMemberships: false,
      allMembershipTypes: true,
      membershipTypeIds: [],
      membershipPayments: null,
    });
    const flat = { ...emptyDiscountDraft(), name: 'Staff', kind: 'amount', amount: '5', percent: '99', productIds: [TOWEL.id], maxUses: '7' };
    expect(discountBody(flat, 'USD', products)).toEqual({ name: 'Staff', code: null, kind: 'amount', percentBp: null, amountMinor: 500, startsOn: null, endsOn: null, maxUses: null, forProducts: true, allProducts: true, productIds: [], forMemberships: false, allMembershipTypes: true, membershipTypeIds: [], membershipPayments: null });
  });

  it('opens a discount as it is, and sends back the moment it was read', () => {
    const d = discount({ startsOn: '2026-06-01', maxUses: 40, uses: 3, allProducts: false, productIds: [WATER.id] });
    const draft = draftFromDiscount(d);
    expect(draft).toMatchObject({ id: 'd-summer', name: 'Summer sale', kind: 'percent', percent: '20', code: 'SUMMER20', scope: 'some', productIds: [WATER.id], startsOn: '2026-06-01', endsOn: '', limited: true, maxUses: '40' });
    expect(discountBody(draft, 'USD', products)).toMatchObject({ percentBp: 2000, maxUses: 40, updatedAt: '2026-10-13T10:00:00.000Z' });
    expect(draftFromDiscount(FIVE)).toMatchObject({ kind: 'amount', amount: '5.00', code: '', scope: 'all', limited: false });
  });
});
