// A PERSONAL TRAINING SESSION'S FEE ON A PERSON'S PAGE (ROADMAP 18h-ii): the same box as a
// class's, in words that never name a class it was not for.
import { describe, expect, it } from 'vitest';
import { feeRow, voidFeePaymentWords } from './memberBillsView';

const PAY_ID = '66666666-6666-4666-8666-666666666666';
const fee = (over = {}) => ({
  id: '77777777-7777-4777-8777-777777777777',
  fee: 'no_show',
  of: 'pt',
  forName: 'Personal training with Sam Trainer',
  on: '2026-10-09',
  amountMinor: 800,
  tax: null,
  dueOn: '2026-10-09',
  state: 'due',
  waived: null,
  stillOwed: true,
  payments: [],
  voidedPayments: [],
  can: { pay: true, waive: true, voidPaymentId: null },
  ...over,
});

describe("a session's fee on the person's page", () => {
  it('says what it was for and when, as one-time', () => {
    const row = feeRow(fee(), 'GBP', '2026-10-09');
    expect(row.title).toBe('No-show fee');
    expect(row.about).toBe('One-time fee · Personal training with Sam Trainer, 9 October 2026');
    expect(row.when).toBe('Due today');
  });

  it('once they are marked Came, it never says a class was cancelled', () => {
    const paid = fee({ state: 'paid', stillOwed: false, payments: [{ id: PAY_ID, amountMinor: 800, method: 'cash', paidOn: '2026-10-09', by: 'Sam Owner', receiptNumber: 41 }] });
    expect(feeRow(paid, 'GBP', '2026-10-10').waived).toBe('No longer owed: they were marked Came. If you gave the money back, void the payment.');
    expect(feeRow(fee({ state: 'removed', stillOwed: false }), 'GBP', '2026-10-10').waived).toBe('No longer owed: they were marked Came.');
    expect(voidFeePaymentWords(paid, 'GBP', 'Kim Page').detail).toMatch(/^Kim Page no longer owes this fee: they were marked Came\. Voiding/);
    // Paid on the Terminal (18d-vi-b-i): Square holds the money, so it goes back through Square (18d-iv-b-i).
    const onTerminal = { ...paid, payments: [{ ...paid.payments[0], method: 'terminal' }], can: { pay: false, waive: false, voidPaymentId: null } };
    expect(feeRow(onTerminal, 'GBP', '2026-10-10').waived).toBe('No longer owed: they were marked Came. To give the money back, press ⋯ on the payment, then Refund to card.');
    // A class's fee keeps its own words.
    expect(feeRow({ ...fee({ state: 'removed', stillOwed: false }), of: 'class' }, 'GBP', '2026-10-10').waived).toBe(
      'No longer owed: they were marked Came, or the class was cancelled.',
    );
  });
});
