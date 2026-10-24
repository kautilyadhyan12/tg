import { describe, expect, it } from 'vitest';
import { owedItems, payerLine, newestReceipt } from './memberPayerView';

// WHO PAYS, ITS WORDS (ROADMAP 18i): every state of the box's line, and what a payer's page
// lists as owed now, from what the server sends.

const TODAY = '2026-10-20';
const pay = (over = {}) => ({ periodIndex: 0, covers: { from: '2026-10-20', to: '2026-11-19' }, leftMinor: 150_000, dueOn: TODAY, state: 'due', ...over });
const fee = (over = {}) => ({ id: 'f1', fee: 'no_show', forName: 'Spin', on: '2026-10-18', amountMinor: 20_000, state: 'due', payments: [], ...over });
const membership = (billing, over = {}) => ({ id: 'm1', typeName: 'Gold Monthly', currency: 'INR', billing: { bills: [], fees: [], pay: null, ...billing }, ...over });
const listed = (memberships) => owedItems({ memberships }, TODAY).map((i) => [i.kind, i.title, i.amount, i.tag]);

describe("the box's line", () => {
  const person = (entryId, name) => ({ entryId, name, past: false });
  it.each([
    ['paid for', { paidBy: person('p', 'Priya Sharma'), paysFor: [] }, 'Aarav Sharma', 'Priya Sharma pays for Aarav Sharma.'],
    ['pays for one', { paidBy: null, paysFor: [person('a', 'Aarav')] }, 'Priya Sharma', 'Priya Sharma pays their own bills and for 1 other person.'],
    ['pays for three', { paidBy: null, paysFor: [person('a', 'A'), person('b', 'B'), person('c', 'C')] }, 'Priya Sharma', 'Priya Sharma pays their own bills and for 3 other people.'],
    ['neither', { paidBy: null, paysFor: [] }, 'Ravi Kumar', 'Ravi Kumar pays their own bills.'],
    ['no name typed', { paidBy: person('p', ''), paysFor: [] }, '', 'No name on their record pays for No name on their record.'],
  ])('%s', (_what, answer, name, line) => expect(payerLine(answer, name)).toBe(line));
});

describe('what a payer reads as owed now for somebody they pay for', () => {
  it.each([
    ['a bill due today', [membership({ pay: pay() })], [['bill', 'Gold Monthly · 20 Oct – 19 Nov 2026', '₹1,500.00 left', 'Payment due']]],
    ['an overdue bill, part paid', [membership({ pay: pay({ state: 'overdue', leftMinor: 50_000, dueOn: '2026-09-20', covers: { from: '2026-09-20', to: '2026-10-19' } }) })], [['bill', 'Gold Monthly · 20 Sep – 19 Oct 2026', '₹500.00 left', 'Overdue']]],
    ['a membership of one period', [membership({ pay: pay({ covers: null }) })], [['bill', 'Gold Monthly', '₹1,500.00 left', 'Payment due']]],
    ['a bill not due yet is left to their own page', [membership({ pay: pay({ dueOn: '2026-10-21' }) })], []],
    ['a fee still owed', [membership({ fees: [fee()] })], [['fee', 'No-show fee · Spin · 18 Oct', '₹200.00', 'Payment due']]],
    ['a fee paid or waived is not owed', [membership({ fees: [fee({ state: 'paid' }), fee({ id: 'f2', state: 'waived' })] })], []],
    ['nothing at all, for a reader without the payments tick', [{ id: 'm1', typeName: 'Gold Monthly', currency: 'INR', billing: null }], []],
    ['nothing held', [], []],
  ])('%s', (_what, memberships, items) => expect(listed(memberships)).toEqual(items));

  it('the receipt said after a payment is the newest on that membership', () => {
    const paid = (n) => ({ receiptNumber: n });
    expect(newestReceipt(membership({ bills: [{ payments: [paid(3), paid(9)] }], fees: [{ payments: [paid(7)] }] }))).toBe(9);
    expect(newestReceipt(membership({}))).toBeNull();
  });
});
