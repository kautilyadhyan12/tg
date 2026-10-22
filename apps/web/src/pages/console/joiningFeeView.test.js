// A JOINING FEE ON A MEMBERSHIP TYPE (ROADMAP 18t): the price list's box, the Add form's tick
// and total, the bill's line and the receipt's. Every amount here was worked out by hand.
import { describe, expect, it } from 'vitest';
import { draftBody, draftFromType, draftProblems, emptyDraft, joiningFeeLine, usesJoiningFee } from './membershipTypesView';
import { giveBody, joiningFeeFor } from './heldMembershipsView';
import { membershipSummary } from './sellDiscountsView';
import { billRow } from './memberBillsView';
import { receiptLines } from './receiptView';

const GOLD = { id: 't-gold', name: 'Gold Monthly', kind: 'recurring', priceMinor: 5000, currency: 'USD', termCount: 1, termUnit: 'month', packClasses: null, packDays: null, tax: null, joiningFeeMinor: 2500 };
const listType = (over = {}) => ({
  id: '22222222-2222-4222-8222-000000000001',
  name: 'Gold Monthly',
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
  joiningFeeMinor: 2500,
  archivedAt: null,
  updatedAt: '2026-10-04T09:00:00.000Z',
  ...over,
});
const firstMonth = {
  id: 'd-first',
  name: 'First month',
  code: null,
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
};

describe('the joining fee the desk is shown is the one the first bill charges', () => {
  // The worst thing: a fee charged that the desk was never shown, or charged twice.
  it('the Add form sends the fee it shows, and the total it shows has it in, once', () => {
    const fee = joiningFeeFor(GOLD, 'auto', true, false);
    const summary = membershipSummary(GOLD, null, false, null, fee.feeMinor);
    expect(summary.lines).toEqual([
      { label: 'Price', value: '$50.00' },
      { label: 'Joining fee', value: '$25.00' },
      { label: 'Total', value: '$75.00', strong: true },
    ]);
    expect(summary.later).toBe('This is the first payment. Every payment after it is $50.00.');
    const value = { typeId: GOLD.id, startsOn: '2026-10-15', paid: true, method: 'cash' };
    expect(giveBody('k-1', GOLD, value, null, summary, null, fee.feeMinor)).toEqual({
      requestKey: 'k-1',
      typeId: GOLD.id,
      startsOn: '2026-10-15',
      paid: true,
      method: 'cash',
      priceMinor: 5000,
      joiningFeeMinor: 2500,
      totalMinor: 7500,
    });
  });

  it('waived, nothing of it is shown, and the server is told it was left off', () => {
    const fee = joiningFeeFor(GOLD, 'waive', true, false);
    const summary = membershipSummary(GOLD, null, false, null, fee.feeMinor);
    expect(summary.shows).toBe(false);
    expect(summary.totalMinor).toBe(5000);
    const body = giveBody('k-2', GOLD, { typeId: GOLD.id, startsOn: '2026-10-15', paid: false }, null, summary, null, fee.feeMinor);
    expect(body.joiningFeeMinor).toBe(0);
    expect(body.totalMinor).toBe(5000);
    // A type with no fee says nothing of one.
    const plain = { ...GOLD, joiningFeeMinor: 0 };
    expect(giveBody('k-3', plain, { typeId: plain.id, startsOn: '2026-10-15', paid: false }, null, membershipSummary(plain, null), null, 0)).not.toHaveProperty('joiningFeeMinor');
  });

  it("the person's own Refer a friend gift comes off the price, never the fee", () => {
    const half = { id: 'g-1', kind: 'percent', percentBp: 5000, amountMinor: null, currency: null };
    const summary = membershipSummary(GOLD, null, false, half, 2500);
    // 50% of $50.00 is $25.00; the $25.00 fee stays: $50.00.
    expect(summary.giftOffMinor).toBe(2500);
    expect(summary.totalMinor).toBe(5000);
    expect(summary.lines.find((l) => l.label === 'Joining fee')).toEqual({ label: 'Joining fee', value: '$25.00' });
  });

  it('with tax added on top and a first-month discount: the tax is on the fee too, the discount is off the membership alone', () => {
    const taxed = { ...GOLD, tax: { name: 'GST', bp: 1800 } };
    const summary = membershipSummary(taxed, firstMonth, false, null, 2500);
    // ($50.00 − $10.00 + $25.00) plus 18% is $76.70; every later payment $59.00.
    expect(summary.lines).toEqual([
      { label: 'Price', value: '$50.00' },
      { label: 'Discount (First month)', value: '-$10.00' },
      { label: 'Joining fee', value: '$25.00' },
      { label: 'GST 18%', value: '$11.70' },
      { label: 'Total', value: '$76.70', strong: true },
    ]);
    expect(summary.offMinor).toBe(1000);
    expect(summary.later).toBe('This is the first payment. Every payment after it is $59.00.');
  });

  it('a paid-once membership has no later payment to speak of', () => {
    const once = { ...GOLD, kind: 'one_time', termCount: 3 };
    expect(membershipSummary(once, null, false, null, 2500).later).toBeNull();
  });
});

describe('who charges it', () => {
  it.each([
    // [what the type charges, the tick, takes payments, already has a membership] → [charged, tick shown, note]
    [2500, 'auto', true, false, 2500, true, null],
    [2500, 'auto', true, true, 0, true, 'Left unticked because they already have a membership here.'],
    [2500, 'charge', true, true, 2500, true, null],
    [2500, 'waive', true, false, 0, true, null],
    // Staff who take no payments cannot leave it off: the server sends them back.
    [2500, 'waive', false, true, 2500, false, null],
    [0, 'auto', true, false, 0, false, null],
  ])('a fee of %i, %s, payments %s, a member %s', (typeFee, choice, canBill, member, charged, tick, note) => {
    expect(joiningFeeFor({ ...GOLD, joiningFeeMinor: typeFee }, choice, canBill, member)).toEqual({ feeMinor: charged, tick, note });
  });

  it('no type picked yet charges nothing', () => {
    expect(joiningFeeFor(null, 'auto', true, false)).toEqual({ feeMinor: 0, tick: false, note: null });
  });
});

describe('the price list', () => {
  it('a fee typed is sent in whole cents, and an empty box is none', () => {
    const draft = { ...emptyDraft(), name: 'Gold', price: '50', joiningFee: '25' };
    expect(draftProblems(draft, 'USD')).toBeNull();
    expect(draftBody(draft, 'USD').joiningFeeMinor).toBe(2500);
    expect(draftBody({ ...draft, joiningFee: ' ' }, 'USD').joiningFeeMinor).toBe(0);
    expect(draftBody({ ...draft, joiningFee: '2500' }, 'INR').joiningFeeMinor).toBe(250000);
  });

  it('a saved fee opens in the form as it was typed, and none as an empty box', () => {
    expect(draftFromType(listType()).joiningFee).toBe('25.00');
    expect(draftFromType(listType({ joiningFeeMinor: 0 })).joiningFee).toBe('');
  });

  it('only a repeating or a paid-once membership has the box, and another kind sends none', () => {
    expect(['recurring', 'one_time', 'pack', 'day_pass', 'trial'].map(usesJoiningFee)).toEqual([true, true, false, false, false]);
    const pack = { ...emptyDraft(), name: 'Ten classes', price: '80', choice: 'pack', joiningFee: '25' };
    expect(draftProblems(pack, 'USD')).toBeNull();
    expect(draftBody(pack, 'USD').joiningFeeMinor).toBe(0);
  });

  it.each([
    ['25 dollars', '50', 'Type the joining fee as a number, like 25.00, or leave it empty.'],
    ['-5', '50', 'Type the joining fee as a number, like 25.00, or leave it empty.'],
    ['25', '0', 'A free membership has no joining fee. Leave it empty.'],
    ['1', '999999.99', 'The price and joining fee together can be at most $999,999.99.'],
  ])('%s on a price of %s is refused', (typed, price, words) => {
    expect(draftProblems({ ...emptyDraft(), name: 'Gold', price, joiningFee: typed }, 'USD')?.joiningFee).toBe(words);
  });

  it('the card says it under the price', () => {
    expect(joiningFeeLine(listType())).toBe('Joining fee $25.00, on the first bill');
    expect(joiningFeeLine(listType({ joiningFeeMinor: 0 }))).toBeNull();
  });
});

describe('the bill and the receipt', () => {
  const bill = (over = {}) => ({
    id: 'b-1',
    periodIndex: 0,
    covers: { from: '2026-10-15', to: '2026-11-14' },
    amountMinor: 7500,
    tax: null,
    joiningFeeMinor: 2500,
    paidMinor: 0,
    dueOn: '2026-10-15',
    state: 'due',
    refundedMinor: 0,
    cancelled: null,
    gift: null,
    payments: [],
    voidedPayments: [],
    ...over,
  });

  it('the first bill says the fee is in it; the next says nothing of it', () => {
    expect(billRow(bill(), 'USD', '2026-10-15').joiningFee).toBe('Includes the joining fee of $25.00');
    expect(billRow(bill({ joiningFeeMinor: 0, amountMinor: 5000 }), 'USD', '2026-10-15').joiningFee).toBeNull();
  });

  it('the receipt prints the fee as a line of its own under the membership', () => {
    const receipt = {
      number: 3,
      gym: { name: 'Iron Works', address: null },
      on: '2026-10-15',
      person: 'Ruby Green',
      personDeleted: false,
      by: 'Sam',
      currency: 'USD',
      cancelled: false,
      kind: 'payment',
      item: { name: 'Gold Monthly', covers: { from: '2026-10-15', to: '2026-11-14' } },
      amounts: { listedMinor: 7500, discount: { name: 'First month', minor: 1000 }, tax: { name: 'GST', bp: 1800, included: false, minor: 1170 }, totalMinor: 7670 },
      joiningFeeMinor: 2500,
      paidMinor: 7670,
      method: 'cash',
      balance: null,
      refunds: [],
    };
    expect(receiptLines(receipt).map((l) => `${l.label} | ${l.amount}`)).toEqual([
      'Gold Monthly, 15 Oct – 14 Nov 2026 | $50.00',
      'Discount: First month | −$10.00',
      'Joining fee | $25.00',
      'GST 18% | $11.70',
      'Total | $76.70',
      'Paid by cash | $76.70',
    ]);
  });
});
