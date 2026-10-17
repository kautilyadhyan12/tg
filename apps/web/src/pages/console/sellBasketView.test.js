import { describe, expect, it } from 'vitest';
import { SALE_LINES_MAX } from '@app/shared';
import { GONE_LINE, addToBasket, applyBasketCode, basketBody, basketView, newLine, onceASale, withFriendGift, withLineDiscount, withoutDiscount } from './sellBasketView';

// A BASKET AT SELL (ROADMAP 18q): every case of where a discount and a gift go, and what the
// basket comes to. The sums are worked out by hand from the prices, not by the code under test.

const product = (over) => ({ currency: 'USD', taxRateId: null, stock: null, archivedAt: null, updatedAt: '2026-10-17T10:00:00.000Z', ...over });
const WATER = product({ id: 'p-water', name: 'Water', priceMinor: 199, taxRateId: 'r1' });
const BAR = product({ id: 'p-bar', name: 'Protein bar', priceMinor: 250, taxRateId: 'r2' });
const TOWEL = product({ id: 'p-towel', name: 'Towel', priceMinor: 500, stock: 2 });
const rate = (id, name, bp) => ({ id, name, bp, products: 1, membershipTypes: 0, memberships: 0 });
const ON_TOP = { included: false, rates: [rate('r1', 'Sales tax', 825), rate('r2', 'County tax', 100)] };
const INSIDE = { ...ON_TOP, included: true };
const discount = (over) => ({
  code: null,
  kind: 'percent',
  percentBp: 1000,
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
  referralGift: false,
  archivedAt: null,
  updatedAt: '2026-10-17T10:00:00.000Z',
  ...over,
});
const TEN = discount({ id: 'd-ten', name: 'Ten off', code: 'TEN' });
const DOLLAR = discount({ id: 'd-dollar', name: 'Dollar off', code: 'DOLLAR', kind: 'amount', percentBp: null, amountMinor: 100, currency: 'USD' });
const TOWELS = discount({ id: 'd-towels', name: 'Towels only', code: 'TOWEL', allProducts: false, productIds: ['p-towel'] });
const FRIEND = discount({ id: 'd-friend', name: "Refer a friend: friend's gift", referralGift: true });
const page = (over = {}) => ({ today: '2026-10-17', currency: 'USD', tax: ON_TOP, products: [WATER, BAR, TOWEL], discounts: [TEN, DOLLAR, TOWELS, FRIEND], ...over });
const line = (productId, quantityText = '1', discountId = '') => ({ productId, quantityText, discountId });
const view = (lines, over = {}) => basketView({ who: 'walkin', person: null, ...over, page: page(over.page), lines });

describe('adding products', () => {
  it('a new product is a line of its own; the same product again is one more on its line, never past its stock', () => {
    let lines = addToBasket([], WATER);
    expect(lines).toEqual([newLine('p-water')]);
    lines = addToBasket(lines, TOWEL);
    lines = addToBasket(lines, WATER);
    expect(lines.map((l) => [l.productId, l.quantityText])).toEqual([
      ['p-water', '2'],
      ['p-towel', '1'],
    ]);
    // Two towels in stock: a third press stays at two.
    lines = addToBasket(addToBasket(lines, TOWEL), TOWEL);
    expect(lines[1].quantityText).toBe('2');
  });

  it(`holds ${String(SALE_LINES_MAX)} products and no more`, () => {
    const many = Array.from({ length: SALE_LINES_MAX }, (_, i) => line(`p-${String(i)}`));
    expect(addToBasket(many, WATER)).toBe(many);
  });
});

describe('where a discount goes', () => {
  it('a percentage stays on every line it is picked on; a set amount and the friend’s gift move to the line picked last', () => {
    const lines = [line('p-water', '1', 'd-ten'), line('p-bar', '1', 'd-dollar'), line('p-towel')];
    expect(onceASale(TEN)).toBe(false);
    expect(onceASale(DOLLAR)).toBe(true);
    expect(onceASale(FRIEND)).toBe(true);
    expect(withLineDiscount(lines, 2, 'd-ten', page()).map((l) => l.discountId)).toEqual(['d-ten', 'd-dollar', 'd-ten']);
    expect(withLineDiscount(lines, 2, 'd-dollar', page()).map((l) => l.discountId)).toEqual(['d-ten', '', 'd-dollar']);
    expect(withLineDiscount(lines, 1, '', page()).map((l) => l.discountId)).toEqual(['d-ten', '', '']);
  });

  it("the friend's gift goes on the dearest line it fits with no discount, once, and never over one staff picked", () => {
    const friendPage = page({ friendGiftId: 'd-friend' });
    // Towel $5.00 is dearer than two waters at $3.98 and a bar at $2.50.
    expect(withFriendGift([line('p-water', '2'), line('p-bar'), line('p-towel')], friendPage, 'd-friend').map((l) => l.discountId)).toEqual(['', '', 'd-friend']);
    // The towel has a discount picked: the gift goes on the next dearest, the waters.
    expect(withFriendGift([line('p-water', '2'), line('p-bar'), line('p-towel', '1', 'd-towels')], friendPage, 'd-friend').map((l) => l.discountId)).toEqual(['d-friend', '', 'd-towels']);
    // Already on a line: left as it is.
    const on = [line('p-water', '1', 'd-friend'), line('p-towel')];
    expect(withFriendGift(on, friendPage, 'd-friend')).toBe(on);
    // Every line has a discount: nowhere to put it.
    const full = [line('p-water', '1', 'd-ten')];
    expect(withFriendGift(full, friendPage, 'd-friend')).toBe(full);
    // Not offered at all for anybody else (no friendGiftId): never filled in.
    expect(withFriendGift([line('p-towel')], page(), 'd-friend').map((l) => l.discountId)).toEqual(['']);
    expect(withoutDiscount([line('p-towel', '1', 'd-friend'), line('p-bar', '1', 'd-ten')], 'd-friend').map((l) => l.discountId)).toEqual(['', 'd-ten']);
  });

  it('a promo code goes on every line it fits; a set amount on the dearest line only; one that fits nothing says why', () => {
    const lines = [line('p-water', '2'), line('p-towel')];
    const ten = applyBasketCode(page(), lines, ' ten');
    expect([ten.discount?.id, ten.lines.map((l) => l.discountId), ten.note]).toEqual(['d-ten', ['d-ten', 'd-ten'], 'TEN applied: 10% off.']);
    const dollar = applyBasketCode(page(), [line('p-water', '2', 'd-dollar'), line('p-towel')], 'dollar');
    expect(dollar.lines.map((l) => l.discountId)).toEqual(['', 'd-dollar']);
    const towel = applyBasketCode(page(), [line('p-water'), line('p-towel')], 'towel');
    expect(towel.lines.map((l) => l.discountId)).toEqual(['', 'd-towels']);
    const none = applyBasketCode(page(), [line('p-water')], 'towel');
    expect([none.discount, none.lines.map((l) => l.discountId), none.note]).toEqual([null, [''], 'Towels only does not apply to Water.']);
    expect(applyBasketCode(page(), [], 'ten').note).toBe('Pick a product first, then apply the promo code.');
    expect(applyBasketCode(page(), lines, 'nope').note).toBe('There is no promo code NOPE. Check the spelling with the customer.');
  });
});

describe('what the basket comes to', () => {
  const summary = (v) => v.summary.lines.map((l) => `${l.label} ${l.value}`);

  it('tax added on top: what the products come to, each rate added, then the total', () => {
    // By hand: 2 × $1.99 = $3.98, 8.25% = $0.32835 → $0.33; $2.50, 1% = $0.025 → $0.03; $5.00 untaxed.
    // $3.98 + $2.50 + $5.00 = $11.48; + $0.36 = $11.84.
    const v = view([line('p-water', '2'), line('p-bar'), line('p-towel')]);
    expect(v.problem).toBeNull();
    expect(summary(v)).toEqual(['Subtotal $11.48', 'Sales tax 8.25% $0.33', 'County tax 1% $0.03', 'Total $11.84']);
    expect(v.rows.map((r) => [r.amount, r.summary.totalMinor])).toEqual([
      ['$3.98', 431],
      ['$2.50', 253],
      ['$5.00', 500],
    ]);
    expect(basketBody(v, { requestKey: 'k', entryId: null, method: 'cash' })).toEqual({
      requestKey: 'k',
      entryId: null,
      method: 'cash',
      totalMinor: 1184,
      lines: [
        { productId: 'p-water', quantity: 2, discountId: null, totalMinor: 431 },
        { productId: 'p-bar', quantity: 1, discountId: null, totalMinor: 253 },
        { productId: 'p-towel', quantity: 1, discountId: null, totalMinor: 500 },
      ],
    });
  });

  it('tax inside the prices: the total, and each rate inside it', () => {
    // By hand: $3.98 holds 8.25%: 3.98 − 3.98 / 1.0825 = $0.3033 → $0.30; $2.50 holds 1%: $0.0248 → $0.02.
    const v = view([line('p-water', '2'), line('p-bar'), line('p-towel')], { page: { tax: INSIDE } });
    expect(summary(v)).toEqual(['Total $11.48', 'Includes Sales tax 8.25% $0.30', 'Includes County tax 1% $0.02']);
  });

  it('one product reads as it always did', () => {
    expect(summary(view([line('p-water', '2')]))).toEqual(['Price $3.98', 'Sales tax 8.25% $0.33', 'Total $4.31']);
  });

  it('a discount on each line comes off that line before its tax', () => {
    // 10% off 2 × $1.99 = $0.398 → $0.40 off; $3.58 + 8.25% ($0.29535 → $0.30) = $3.88.
    // $1.00 off the towel: $4.00. Total $7.88.
    const v = view([line('p-water', '2', 'd-ten'), line('p-towel', '1', 'd-dollar')]);
    expect(v.rows.map((r) => [r.amount, r.offWords])).toEqual([
      ['$3.58', 'Ten off: −$0.40'],
      ['$4.00', 'Dollar off: −$1.00'],
    ]);
    expect(summary(v)).toEqual(['Subtotal $7.58', 'Sales tax 8.25% $0.30', 'Total $7.88']);
  });

  it("the buyer's own gift goes on the dearest line with no discount, and Remove takes it off", () => {
    const gift = { id: 'g-maya', kind: 'percent', percentBp: 1000, amountMinor: null, currency: null, words: '10% off', friendName: 'Tara Shah' };
    const lines = [line('p-water', '2', 'd-ten'), line('p-bar'), line('p-towel')];
    const maya = { entryId: 'e-maya', name: 'Maya Patel' };
    const on = basketView({ page: page(), lines, who: 'member', person: maya, memberGift: gift });
    expect([on.giftAt, on.rows[2].offWords]).toEqual([2, 'Refer a friend gift: −$0.50']);
    expect(basketBody(on, { requestKey: 'k', entryId: 'e-maya', method: 'cash' }).lines[2]).toEqual({ productId: 'p-towel', quantity: 1, discountId: null, totalMinor: 450, memberGift: { id: 'g-maya', offMinor: 50 } });
    const off = basketView({ page: page(), lines, who: 'member', person: maya, memberGift: gift, giftRemoved: true });
    expect([off.giftAt, off.giftFits, off.rows[2].offWords]).toEqual([-1, true, null]);
    // Every line has a discount: the gift has nowhere to go and waits for their next payment.
    const none = basketView({ page: page(), lines: [line('p-water', '1', 'd-ten')], who: 'member', person: maya, memberGift: gift });
    expect([none.giftAt, none.giftFits]).toEqual([-1, false]);
  });

  it('says why it cannot be sold yet: nothing in it, a line out of stock or over what is left, a member not found', () => {
    expect(view([]).problem).toBe('Add a product.');
    const out = page({ products: [WATER, { ...TOWEL, stock: 0 }] });
    expect(basketView({ page: out, lines: [line('p-water'), line('p-towel')], who: 'walkin', person: null }).problem).toBe('Towel is out of stock. Change its stock count under Products if you have more.');
    expect(view([line('p-towel', '3')]).problem).toBe('Only 2 left in stock.');
    expect(view([line('p-towel', '')]).problem).toBe('Enter how many, 1 or more.');
    // A product archived while it was in the basket (round one, L1): its line says so, with its
    // Remove, and Take payment stays off.
    const gone = view([line('p-towel'), line('p-gone')]);
    expect([gone.rows[1].problem, gone.problem, gone.summary]).toEqual([GONE_LINE, GONE_LINE, null]);
    expect(basketView({ page: page(), lines: [line('p-towel')], who: 'member', person: null }).problem).toBe('Find and pick the member, or choose Walk-in.');
    // The total still shows while the member is being found.
    expect(basketView({ page: page(), lines: [line('p-towel')], who: 'member', person: null }).summary?.total).toBe('$5.00');
  });
});
