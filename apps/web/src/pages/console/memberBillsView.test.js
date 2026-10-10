// A person's bills and payments, their words (spec Part 3 §14.2; ROADMAP 18a-i).
//
// The worst these words could do: read "Overdue" about a bill that is paid, or send an
// amount the person did not pay. So the first tests: each state the server sends has its
// own word and no other, and the amount typed is the amount sent, to the penny.
import { describe, expect, it } from 'vitest';
import {
  NO_PAYMENTS_LINE,
  PAYMENT_METHODS,
  billRow,
  canRecordPayments,
  graceChoices,
  graceExample,
  paidWords,
  payLabel,
  paymentBody,
  paymentDraft,
  paymentWords,
  undoWords,
} from './memberBillsView';

const TODAY = '2026-10-20';
const bill = (over = {}) => ({
  id: '55555555-5555-4555-8555-000000000001',
  periodIndex: 0,
  covers: { from: '2026-10-04', to: '2026-11-03' },
  amountMinor: 4999,
  paidMinor: 0,
  dueOn: '2026-10-04',
  state: 'due',
  payments: [],
  ...over,
});
const payment = (over = {}) => ({ id: '66666666-6666-4666-8666-000000000001', amountMinor: 4999, method: 'cash', paidOn: '2026-10-04', by: 'Sam Owner', ...over });
const membership = (over = {}, billing = {}) => ({
  id: '44444444-4444-4444-8444-000000000001',
  typeName: 'Gold Monthly',
  currency: 'GBP',
  billing: { bills: [bill()], billsNotShown: 0, pay: { periodIndex: 0, covers: bill().covers, leftMinor: 4999, dueOn: '2026-10-04', state: 'due' }, undo: null, ...billing },
  ...over,
});

describe('each state the server sends has its own word, and no other', () => {
  it('Paid is Paid, with no due day beside it', () => {
    const row = billRow(bill({ state: 'paid', paidMinor: 4999, payments: [payment()] }), 'GBP', TODAY);
    expect(row).toMatchObject({ tag: 'Paid', tone: 'green', when: null, left: null });
    expect(row.title).toBe('4 October 2026 to 3 November 2026 · £49.99');
    expect(row.payments).toEqual([{ id: payment().id, line: '£49.99 · Cash · 4 October 2026 · by Sam Owner' }]);
  });

  it('Due says when, and Overdue says when it was due', () => {
    expect(billRow(bill({ dueOn: '2026-11-04' }), 'GBP', TODAY)).toMatchObject({ tag: 'Due', tone: 'plain', when: 'Due 4 November 2026' });
    expect(billRow(bill({ dueOn: TODAY }), 'GBP', TODAY)).toMatchObject({ tag: 'Due', when: 'Due today' });
    expect(billRow(bill({ state: 'overdue' }), 'GBP', TODAY)).toMatchObject({ tag: 'Overdue', tone: 'orange', when: 'Was due 4 October 2026' });
  });

  it('a part-paid bill says what was paid and what is left, in money', () => {
    const part = billRow(bill({ state: 'overdue', paidMinor: 2000, payments: [payment({ amountMinor: 2000, method: 'card_at_desk', by: null })] }), 'GBP', TODAY);
    expect(part.left).toBe('£20.00 paid · £29.99 left');
    expect(part.payments[0].line).toBe('£20.00 · Card at the desk · 4 October 2026');
  });

  it('a bill for the whole of a membership has no days, and a state from later reads as its word', () => {
    expect(billRow(bill({ covers: null, amountMinor: 9000 }), 'GBP', TODAY).title).toBe('£90.00');
    expect(billRow(bill({ state: 'void' }), 'GBP', TODAY)).toMatchObject({ tag: 'Cancelled', when: null });
    expect(billRow(bill({ state: 'refunded' }), 'GBP', TODAY)).toMatchObject({ tag: 'Refunded', when: null });
  });
});

describe('the amount typed is the amount sent', () => {
  const m = membership();
  const draft = (over = {}) => ({ ...paymentDraft(m, () => 'key-1'), ...over });

  it('starts at what is left, with how they paid not chosen', () => {
    expect(paymentDraft(m, () => 'key-1')).toEqual({ requestKey: 'key-1', amount: '49.99', method: '' });
    expect(paymentWords(m, 'Ada Lovelace', TODAY)).toEqual({
      title: "Record a payment for Ada Lovelace's Gold Monthly",
      detail: '£49.99 is left to pay for 4 October 2026 to 3 November 2026. This only writes it in your records: no money is taken.',
    });
    expect(payLabel(m, TODAY)).toBe('Record payment');
  });

  it('says so, on the button and in the form, where the period is not due yet', () => {
    const next = membership({}, { pay: { periodIndex: 1, covers: { from: '2026-11-04', to: '2026-12-03' }, leftMinor: 4999, dueOn: '2026-11-04', state: 'due' } });
    expect(payLabel(next, TODAY)).toBe('Record payment early');
    expect(paymentWords(next, 'Ada Lovelace', TODAY).detail).toBe(
      '£49.99 is left to pay for 4 November 2026 to 3 December 2026. It is not due until 4 November 2026. This only writes it in your records: no money is taken.',
    );
    // Due today is not early.
    expect(payLabel(next, '2026-11-04')).toBe('Record payment');
  });

  it('sends the period shown, the pennies typed and the way picked', () => {
    expect(paymentBody(m, draft({ method: 'cash' }))).toEqual({ problem: null, body: { requestKey: 'key-1', periodIndex: 0, amountMinor: 4999, method: 'cash' } });
    expect(paymentBody(m, draft({ amount: '20', method: 'bank_transfer' })).body).toMatchObject({ amountMinor: 2000, method: 'bank_transfer' });
    expect(paymentBody(m, draft({ amount: '0.01', method: 'cash' })).body.amountMinor).toBe(1);
  });

  it('sends nothing for an amount that is not one, more than is left, or no way of paying', () => {
    for (const amount of ['', '0', '0.00', 'twenty', '-5', '20.555', '1e3']) {
      expect(paymentBody(m, draft({ amount, method: 'cash' })), amount).toEqual({ problem: 'Type the amount they paid, like 20 or 20.50.', body: null });
    }
    expect(paymentBody(m, draft({ amount: '50', method: 'cash' }))).toEqual({ problem: 'That is more than is left to pay. £49.99 is left.', body: null });
    expect(paymentBody(m, draft())).toEqual({ problem: 'Pick how they paid.', body: null });
  });

  it('asks for a whole number in a currency with no pennies', () => {
    const yen = membership({ currency: 'JPY' }, { pay: { periodIndex: 0, covers: null, leftMinor: 5000, dueOn: '2026-10-04', state: 'due' } });
    expect(paymentDraft(yen, () => 'k').amount).toBe('5000');
    expect(paymentBody(yen, { requestKey: 'k', amount: '50.5', method: 'cash' }).problem).toBe('Type the amount they paid, as a whole number.');
    expect(paymentBody(yen, { requestKey: 'k', amount: '5000', method: 'cash' }).body.amountMinor).toBe(5000);
  });

  it('says back all of it, or what is still left', () => {
    expect(paidWords(m, 4999)).toBe('£49.99 recorded. Gold Monthly is paid.');
    expect(paidWords(m, 2000)).toBe('£20.00 recorded. £29.99 is still left to pay.');
  });
});

describe('taking a payment back', () => {
  it('names the payment by its amount and its day', () => {
    const m = membership({}, { bills: [bill({ state: 'paid', paidMinor: 4999, payments: [payment()] })], pay: null, undo: { kind: 'payment', paymentId: payment().id } });
    expect(undoWords(m, 'Ada Lovelace')).toMatchObject({
      link: 'Undo last payment',
      question: "Take back the £49.99 recorded on 4 October 2026 for Ada Lovelace's Gold Monthly?",
      button: 'Take it back',
    });
    expect(undoWords(m, 'Ada Lovelace').detail).toContain('Nothing is refunded');
  });

  it('an older mark with no payment behind it keeps its own words', () => {
    const m = membership({}, { bills: [], undo: { kind: 'mark', paidPeriods: 1 } });
    expect(undoWords(m, 'Ada Lovelace')).toMatchObject({ link: 'Undo mark paid', question: "Take back the last payment noted for Ada Lovelace's Gold Monthly?" });
  });
});

describe('who may, and the gym\'s own days of grace', () => {
  it('reads the tick, never the job title', () => {
    expect(canRecordPayments(['members.confirm', 'billing.members'])).toBe(true);
    expect(canRecordPayments(['members.confirm', 'billing.manage'])).toBe(false);
    expect(canRecordPayments(undefined)).toBe(false);
    expect(NO_PAYMENTS_LINE).toBe(`You can't record payments. Ask the owner to turn on "Record members' payments" for you.`);
  });

  it('offers the three ways staff record by hand', () => {
    expect(PAYMENT_METHODS).toEqual([
      { value: 'cash', label: 'Cash' },
      { value: 'card_at_desk', label: 'Card at the desk' },
      { value: 'bank_transfer', label: 'Bank transfer' },
    ]);
  });

  it('lists the days to pick, keeps a number saved from elsewhere, and says each with a real date', () => {
    expect(graceChoices(0).map((c) => c.label)).toEqual(['None', '1 day', '2 days', '3 days', '5 days', '7 days', '10 days', '14 days', '21 days', '30 days', '45 days', '60 days']);
    expect(graceChoices(9).map((c) => c.value)).toEqual([0, 1, 2, 3, 5, 7, 9, 10, 14, 21, 30, 45, 60]);
    // Due on its due day and through the days of grace; Overdue from the day after.
    expect(graceExample(0)).toBe("A bill due on 1 March reads Overdue from 2 March if it isn't paid.");
    expect(graceExample(7)).toBe("A bill due on 1 March reads Overdue from 9 March if it isn't paid.");
    expect(graceExample(30)).toBe("A bill due on 1 March reads Overdue from 1 April if it isn't paid.");
  });
});
