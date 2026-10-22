// BILLING EVERYONE ON ONE DAY OF THE MONTH (ROADMAP 18y): the Add form's part month and total,
// the Change box's, the bill's words, the receipt's and the setting's. Every amount here was
// worked out by hand from a calendar: the price × the days used ÷ the days of the month.
import { describe, expect, it } from 'vitest';
import { firstBillPart, giveBody } from './heldMembershipsView';
import { changeSummary, membershipSummary } from './sellDiscountsView';
import { changeBody, changeChoice } from './membershipChangeView';
import { billDayChoices, billDayExample, billRow } from './memberBillsView';
import { receiptLines } from './receiptView';

const GOLD = { id: 't-gold', name: 'Gold Monthly', kind: 'recurring', priceMinor: 5000, currency: 'USD', termCount: 1, termUnit: 'month', packClasses: null, packDays: null, tax: null, joiningFeeMinor: 0, billDay: 1 };
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

describe('the part month the desk is shown is the one the first bill charges', () => {
  // The worst thing: a whole month charged for a part month, or the days paid twice.
  it('joins on 15 October at a gym that bills on the 1st: 15 to 31 October, $27.41, then $50.00 from 1 November', () => {
    const part = firstBillPart(GOLD, '2026-10-15', '2026-10-15');
    expect(part).toEqual({ days: 17, fullDays: 31, from: '2026-10-15', to: '2026-10-31', fullFrom: '2026-11-01' });
    const summary = membershipSummary(GOLD, null, false, null, 0, part);
    expect(summary.lines).toEqual([
      { label: 'Part month, 15 Oct – 31 Oct 2026', value: '$27.41' },
      { label: 'Total', value: '$27.41', strong: true },
    ]);
    expect(summary.later).toBe('This pays for 15 Oct – 31 Oct 2026. From 1 Nov 2026, each payment is $50.00.');
    // Add member draws its total box for a part month as it does for a joining fee.
    expect([summary.shows, summary.part]).toEqual([true, true]);
    expect(membershipSummary({ ...GOLD, billDay: null }, null).part).toBe(false);
    const body = giveBody('k-1', GOLD, { typeId: GOLD.id, startsOn: '2026-10-15', paid: true, method: 'cash' }, null, summary, null, 0);
    expect(body).toMatchObject({ totalMinor: 2741, fullFrom: '2026-11-01', priceMinor: 5000 });
  });

  it('a first-month discount and a joining fee: the discount is for the same days, the fee is whole', () => {
    // 20% off is $40.00 for a month; for 17 of 31 days, $21.93. The days at the full price are
    // $27.41, so $5.48 comes off. The $25.00 fee is added whole: $46.93.
    const part = firstBillPart(GOLD, '2026-10-15', '2026-10-15');
    const summary = membershipSummary({ ...GOLD, joiningFeeMinor: 2500 }, firstMonth, false, null, 2500, part);
    expect(summary.lines).toEqual([
      { label: 'Part month, 15 Oct – 31 Oct 2026', value: '$27.41' },
      { label: 'Discount (First month)', value: '-$5.48' },
      { label: 'Joining fee', value: '$25.00' },
      { label: 'Total', value: '$46.93', strong: true },
    ]);
    expect(summary.offMinor).toBe(1000);
  });

  it('no part month where the gym has no day, a start on the day, a weekly one, or a start whose part month is over', () => {
    expect(firstBillPart({ ...GOLD, billDay: null }, '2026-10-15', '2026-10-15')).toBeNull();
    expect(firstBillPart(GOLD, '2026-11-01', '2026-10-15')).toBeNull();
    expect(firstBillPart({ ...GOLD, termUnit: 'week' }, '2026-10-15', '2026-10-15')).toBeNull();
    expect(firstBillPart(GOLD, '2026-08-15', '2026-10-22')).toBeNull();
    // Still to start: its first bill is the part month.
    expect(firstBillPart(GOLD, '2026-10-20', '2026-10-01')).toMatchObject({ days: 12, from: '2026-10-20', to: '2026-10-31' });
    // The day the server is sent stands even where today's bill is a whole month.
    expect(giveBody('k-2', GOLD, { typeId: GOLD.id, startsOn: '2026-08-15', paid: false }, null, null, null, 0).fullFrom).toBe('2026-09-01');
    expect(giveBody('k-3', { ...GOLD, billDay: null }, { typeId: GOLD.id, startsOn: '2026-10-15', paid: false }, null, null, null, 0).fullFrom).toBeNull();
  });
});

describe('a change today at a gym that bills on the 1st', () => {
  const m = {
    id: 'h-basic',
    typeId: 't-basic',
    typeName: 'Basic Monthly',
    kind: 'recurring',
    currency: 'USD',
    billing: { change: { ok: true, creditMinor: 1161, daysLeft: 12, nextOn: '2026-11-01', byPeriod: [] } },
  };

  it('the new one for 20 to 31 October, less the unused days of the old one', () => {
    // $50.00 × 12 / 31 = $19.35, less $11.61: $7.74.
    const choice = changeChoice(m, [GOLD], { requestKey: 'k-4', typeId: GOLD.id, when: 'today', paid: false, method: '' }, false, '2026-10-20', 'Maya');
    expect(choice.summary.lines).toEqual([
      { label: 'Part month, 20 Oct – 31 Oct 2026', value: '$19.35' },
      { label: 'Unused days of Basic Monthly', value: '-$11.61' },
      { label: 'Total', value: '$7.74', strong: true },
    ]);
    expect(changeBody({ requestKey: 'k-4', paid: false }, choice)).toMatchObject({ startsOn: '2026-10-20', fullFrom: '2026-11-01', creditMinor: 1161, totalMinor: 774 });
    // On the next payment date, the 1st itself: the whole price, no part month.
    const later = changeChoice(m, [GOLD], { requestKey: 'k-5', typeId: GOLD.id, when: 'next_payment', paid: false, method: '' }, false, '2026-10-20', 'Maya');
    expect(changeBody({ requestKey: 'k-5', paid: false }, later)).toMatchObject({ startsOn: '2026-11-01', fullFrom: null, totalMinor: 5000 });
  });

  it('with no day, as before', () => {
    expect(changeSummary(GOLD, 1161, 'Basic Monthly').totalMinor).toBe(3839);
  });
});

describe('the bill, the receipt and the setting', () => {
  const bill = (over = {}) => ({
    id: 'b-1',
    periodIndex: 0,
    covers: { from: '2026-10-15', to: '2026-10-31' },
    part: true,
    amountMinor: 2741,
    tax: null,
    joiningFeeMinor: 0,
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

  it('the part month says so beside its days; a whole month does not', () => {
    expect(billRow(bill(), 'USD', '2026-10-15').days).toBe('15 Oct – 31 Oct 2026 · Part month');
    expect(billRow(bill({ part: false, periodIndex: 1, covers: { from: '2026-11-01', to: '2026-11-30' } }), 'USD', '2026-11-01').days).toBe('1 Nov – 30 Nov 2026');
  });

  it('the receipt names the days and that they are the part month', () => {
    const receipt = {
      number: 3,
      gym: { name: 'Iron Works', address: null },
      on: '2026-10-15',
      person: 'Maya Rao',
      personDeleted: false,
      by: 'Sam',
      currency: 'USD',
      cancelled: false,
      kind: 'payment',
      item: { name: 'Gold Monthly', covers: { from: '2026-10-15', to: '2026-10-31' }, part: true },
      amounts: { listedMinor: 2741, discount: null, tax: null, totalMinor: 2741 },
      joiningFeeMinor: 0,
      paidMinor: 2741,
      method: 'cash',
      balance: null,
      refunds: [],
    };
    expect(receiptLines(receipt)[0]).toMatchObject({ label: 'Gold Monthly, 15 Oct – 31 Oct 2026 (part month)', amount: '$27.41' });
  });

  it('the setting: off, or the 1st to the 28th, said with a real date', () => {
    const choices = billDayChoices();
    expect(choices).toHaveLength(29);
    expect(choices[0]).toEqual({ value: '', label: 'The day each membership starts' });
    expect(choices[1]).toEqual({ value: '1', label: 'The 1st of each month' });
    expect(choices[28]).toEqual({ value: '28', label: 'The 28th of each month' });
    expect(billDayExample(null)).toBe('Each membership is billed on the day of the month it started.');
    expect(billDayExample(1)).toBe(
      'Somebody who joins on 20 Mar pays for 20 Mar to 31 Mar first, then the full price on the 1st: each month for a monthly membership, each year for a yearly one. Members who already have a membership keep their own billing day.',
    );
    expect(billDayExample(25)).toMatch(/^Somebody who joins on 5 Mar pays for 5 Mar to 24 Mar first, then the full price on the 25th: each month/);
  });
});
