// A person's bills and payments, their words (spec Part 3 §14.2; ROADMAP 18a-i and 18a-ii).
//
// The worst these words could do: read "Overdue" about a bill that is paid, or send an
// amount the person did not pay. So the first tests: each state the server sends has its
// own word and no other, and the amount typed is the amount sent, to the penny.
import { describe, expect, it } from 'vitest';
import {
  CANCEL_REASONS,
  NO_PAYMENTS_LINE,
  PAYMENT_METHODS,
  REFUND_REASON_CHOICES,
  billDays,
  billRow,
  billToCancel,
  billsToDraw,
  canRecordPayments,
  cancelBillBody,
  cancelBillWords,
  graceChoices,
  graceExample,
  paidWords,
  payLabel,
  paymentBody,
  paymentDraft,
  paymentOf,
  paymentWords,
  refundBody,
  refundDraft,
  refundWords,
  refundedWords,
  shortDay,
  undoRefundWords,
  undoWords,
} from './memberBillsView';
import { paymentLine } from './heldMembershipsView';

const TODAY = '2026-10-20';
const bill = (over = {}) => ({
  id: '55555555-5555-4555-8555-000000000001',
  periodIndex: 0,
  covers: { from: '2026-10-04', to: '2026-11-03' },
  amountMinor: 4999,
  paidMinor: 0,
  dueOn: '2026-10-04',
  state: 'due',
  refundedMinor: 0,
  cancelled: null,
  payments: [],
  ...over,
});
const payment = (over = {}) => ({ id: '66666666-6666-4666-8666-000000000001', amountMinor: 4999, method: 'cash', paidOn: '2026-10-04', by: 'Sam Owner', refunds: [], refundableMinor: 4999, ...over });
const membership = (over = {}, billing = {}) => ({
  id: '44444444-4444-4444-8444-000000000001',
  typeName: 'Gold Monthly',
  currency: 'GBP',
  billing: { bills: [bill()], billsNotShown: 0, pay: { periodIndex: 0, covers: bill().covers, leftMinor: 4999, dueOn: '2026-10-04', state: 'due' }, cancel: null, undo: null, ...billing },
  ...over,
});

describe('each state the server sends has its own word, and no other', () => {
  it('Paid is Paid, with no due day beside it', () => {
    const row = billRow(bill({ state: 'paid', paidMinor: 4999, payments: [payment()] }), 'GBP', TODAY);
    expect(row).toMatchObject({ tag: 'Paid', tone: 'green', when: null, left: null });
    expect([row.days, row.amount]).toEqual(['4 Oct – 3 Nov 2026', '£49.99']);
    expect(row.payments).toEqual([{ id: payment().id, amount: '£49.99', detail: 'Cash · 4 Oct 2026 · by Sam Owner', refundable: true, refunds: [] }]);
  });

  it('Due says when, and Overdue says when it was due', () => {
    expect(billRow(bill({ dueOn: '2026-11-04' }), 'GBP', TODAY)).toMatchObject({ tag: 'Due', tone: 'orange', when: 'Due 4 November 2026' });
    expect(billRow(bill({ dueOn: TODAY }), 'GBP', TODAY)).toMatchObject({ tag: 'Due', when: 'Due today' });
    expect(billRow(bill({ state: 'overdue' }), 'GBP', TODAY)).toMatchObject({ tag: 'Overdue', tone: 'red', when: 'Was due 4 October 2026' });
  });

  it('a part-paid bill says what was paid and what is left, in money', () => {
    const part = billRow(bill({ state: 'overdue', paidMinor: 2000, payments: [payment({ amountMinor: 2000, method: 'card_at_desk', by: null })] }), 'GBP', TODAY);
    expect(part.left).toBe('£20.00 paid · £29.99 left');
    expect(part.payments[0]).toMatchObject({ amount: '£20.00', detail: 'Card at the desk · 4 Oct 2026' });
  });

  it('a bill for the whole of a membership says so, days across a new year keep both years, and a state from later reads as its word', () => {
    expect(billRow(bill({ covers: null, amountMinor: 9000 }), 'GBP', TODAY)).toMatchObject({ days: 'Whole membership', amount: '£90.00' });
    expect(billDays({ from: '2026-12-15', to: '2027-01-14' })).toBe('15 Dec 2026 – 14 Jan 2027');
    expect(billDays({ from: '2028-02-01', to: '2028-02-29' })).toBe('1 Feb – 29 Feb 2028');
    expect([shortDay('2026-10-01'), shortDay('2026-10-01', false)]).toEqual(['1 Oct 2026', '1 Oct']);
    expect(billRow(bill({ state: 'void' }), 'GBP', TODAY)).toMatchObject({ tag: 'Cancelled', tone: 'plain', when: null });
    expect(billRow(bill({ state: 'refunded' }), 'GBP', TODAY)).toMatchObject({ tag: 'Refunded', tone: 'soft', when: null });
    // No two states that can stand side by side share a colour.
    const tones = ['paid', 'due', 'overdue', 'void', 'refunded'].map((state) => billRow(bill({ state }), 'GBP', TODAY).tone);
    expect(new Set(tones).size).toBe(5);
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
    // Never "Gold Monthly is paid": another of its bills may still be owed.
    expect(paidWords(m, 4999)).toBe('£49.99 recorded. That bill is paid.');
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

// ── 18a-ii: a bill staff cancelled, and refunds ─────────────────────────────
//
// The worst these words could do: say "Paid" of a month nobody paid for, or send a
// refund for more than was paid, or for a payment other than the one on screen.

describe('a cancelled bill and a refunded one say what happened, in their own words', () => {
  it('a bill staff cancelled says when, why and who; one cancelled with its membership says that', () => {
    const cancelled = billRow(bill({ state: 'void', cancelled: { reason: 'not_charging', on: '2026-10-12', by: 'Sam Owner' } }), 'GBP', TODAY);
    expect([cancelled.tag, cancelled.cancelled]).toEqual(['Cancelled', 'Cancelled 12 October 2026 · Not charging for this one · by Sam Owner']);
    expect(billRow(bill({ state: 'void', cancelled: { reason: 'mistake', on: '2026-10-12', by: null } }), 'GBP', TODAY).cancelled).toBe('Cancelled 12 October 2026 · Billed by mistake');
    expect(billRow(bill({ state: 'void' }), 'GBP', TODAY).cancelled).toBe('Cancelled with the membership');
    for (const state of ['paid', 'due', 'overdue', 'refunded']) expect(billRow(bill({ state }), 'GBP', TODAY).cancelled, state).toBeNull();
  });

  it('Refunded only when all of it went back; part of it is "Part refunded", with each refund on its own line', () => {
    const refund = { id: 'r1', amountMinor: 2000, method: 'bank_transfer', refundedOn: '2026-10-12', reason: 'charged_too_much', by: 'Sam Owner' };
    const part = billRow(bill({ state: 'paid', paidMinor: 4999, refundedMinor: 2000, payments: [payment({ refunds: [refund], refundableMinor: 2999 })] }), 'GBP', TODAY);
    expect(part.tag).toBe('Part refunded');
    expect(part.payments[0]).toMatchObject({ refundable: true, refunds: [{ id: 'r1', amount: '£20.00 refunded', detail: 'Bank transfer · 12 Oct 2026 · Charged too much · by Sam Owner' }] });
    const all = billRow(bill({ state: 'refunded', paidMinor: 4999, refundedMinor: 4999, payments: [payment({ refunds: [{ ...refund, amountMinor: 4999 }], refundableMinor: 0 })] }), 'GBP', TODAY);
    expect([all.tag, all.payments[0].refundable]).toEqual(['Refunded', false]);
    const none = billRow(bill({ state: 'paid', paidMinor: 4999, payments: [payment()] }), 'GBP', TODAY);
    expect([none.tag, none.payments[0].refundable, none.payments[0].refunds]).toEqual(['Paid', true, []]);
  });

  it('a month let off by a cancelled bill never reads Paid on the membership line', () => {
    const m = (payment, renewsOn, notCharged) => ({ notCharged, view: { renewsOn, payment } });
    expect(paymentLine(m({ state: 'paid', until: '2026-11-04' }, '2026-11-04', true), TODAY)).toEqual({ text: 'Nothing to pay now · next payment due 4 November 2026', due: false });
    expect(paymentLine(m({ state: 'paid', until: '2026-11-04' }, null, true), TODAY).text).toBe('Nothing more to pay');
    expect(paymentLine(m({ state: 'paid', until: null }, null, true), TODAY).text).toBe('Nothing to pay');
    // Paid for by a payment: as before.
    expect(paymentLine(m({ state: 'paid', until: '2026-11-04' }, '2026-11-04', false), TODAY).text).toBe('Paid · next payment due 4 November 2026');
    // Owing again the month after: owing is said, whatever became of the month before.
    expect(paymentLine(m({ state: 'due', since: '2026-10-04' }, '2026-11-04', true), TODAY).text).toBe('Payment due since 4 October 2026');
  });
});

describe('which bills are drawn', () => {
  const b = (periodIndex, state) => bill({ id: `bill-${String(periodIndex)}`, periodIndex, state });
  const pay = (periodIndex) => ({ periodIndex, covers: null, leftMinor: 4999, dueOn: '2026-07-04', state: 'overdue' });

  it('the two newest, and the rest behind Show all', () => {
    const bills = [b(3, 'paid'), b(2, 'paid'), b(1, 'paid'), b(0, 'paid')];
    expect(billsToDraw({ bills, pay: null }, false)).toEqual({ bills: [bills[0], bills[1]], hidden: 2 });
    expect(billsToDraw({ bills, pay: null }, true)).toEqual({ bills, hidden: 0 });
  });

  it('the bill a payment can be taken for is never folded away, however old it is', () => {
    const bills = [b(3, 'overdue'), b(2, 'overdue'), b(1, 'overdue'), b(0, 'overdue')];
    expect(billsToDraw({ bills, pay: pay(0) }, false)).toEqual({ bills: [bills[0], bills[1], bills[3]], hidden: 1 });
    // Already among the newest: drawn once.
    expect(billsToDraw({ bills, pay: pay(3) }, false)).toEqual({ bills: [bills[0], bills[1]], hidden: 2 });
    // A payment for a period with no bill yet adds nothing.
    expect(billsToDraw({ bills, pay: pay(4) }, false).bills).toHaveLength(2);
  });
});

describe('Cancel this bill', () => {
  const owing = membership({}, { cancel: { billId: bill().id } });

  it('is offered for the bill the server names, and for no other', () => {
    expect(billToCancel(owing)).toMatchObject({ id: bill().id });
    expect(billToCancel(membership())).toBeNull();
    expect(billToCancel(membership({}, { cancel: { billId: 'not-on-the-page' } }))).toBeNull();
    expect(billToCancel({ billing: null })).toBeNull();
  });

  it('names the person, the amount and the days, what stops being owed and what stays', () => {
    expect(cancelBillWords(owing, 'Ada Lovelace', true)).toEqual({
      question: "Cancel this £49.99 bill for Ada Lovelace's Gold Monthly?",
      detail:
        "It is the bill for 4 October 2026 to 3 November 2026. Ada Lovelace will owe nothing for it. Ada Lovelace keeps the membership and its dates. The bill stays in your records, marked Cancelled. This can't be undone.",
      button: 'Cancel this bill',
      done: 'That £49.99 bill was cancelled. Nothing is owed for it.',
    });
    // A membership that is over, or a fixed term with no days on its bill: nothing said that is not so.
    const over = membership({}, { bills: [bill({ covers: null })], cancel: { billId: bill().id } });
    expect(cancelBillWords(over, 'this person', false).detail).toBe("It is the bill. This person will owe nothing for it. The bill stays in your records, marked Cancelled. This can't be undone.");
  });

  it('wants a reason picked, and sends only that', () => {
    expect(cancelBillBody({ reason: '' })).toEqual({ problem: 'Pick why you are cancelling it.', body: null });
    expect(cancelBillBody({ reason: 'mistake' })).toEqual({ problem: null, body: { reason: 'mistake' } });
    expect(CANCEL_REASONS.map((r) => r.label)).toEqual(['Billed by mistake', 'Not charging for this one', 'Something else']);
  });
});

describe('Note a refund', () => {
  const paid = payment({ refunds: [], refundableMinor: 4999 });
  const m = membership({}, { bills: [bill({ state: 'paid', paidMinor: 4999, payments: [paid] })], pay: null });
  const key = () => '99999999-9999-4999-8999-999999999999';

  it('starts at what can still be refunded, for the payment pressed', () => {
    expect(refundDraft(m, paid, key)).toEqual({ paymentId: paid.id, requestKey: key(), amount: '49.99', method: '', reason: '' });
    expect(refundDraft(m, { ...paid, refundableMinor: 2999 }, key).amount).toBe('29.99');
    expect(paymentOf(m, paid.id)).toBe(paid);
    expect(paymentOf(m, 'another')).toBeNull();
  });

  it('says which payment, that no money moves, and that the membership is kept', () => {
    expect(refundWords(m, 'Ada Lovelace', paid, true)).toEqual({
      title: "Note a refund for Ada Lovelace's Gold Monthly",
      detail:
        'This is for the £49.99 paid on 4 October 2026. It only writes the refund in your records: give the money back yourself. Ada Lovelace keeps the membership and its dates: to end it, use Cancel membership.',
    });
    const some = refundWords(m, 'Ada Lovelace', { ...paid, refundableMinor: 2999 }, false).detail;
    expect(some).toBe('This is for the £49.99 paid on 4 October 2026. £29.99 of it can still be refunded. It only writes the refund in your records: give the money back yourself.');
  });

  it('sends the amount typed, to the penny, and never more than can be refunded', () => {
    const draft = (over) => ({ ...refundDraft(m, paid, key), method: 'cash', reason: 'paid_twice', ...over });
    expect(refundBody(m, paid, draft({}))).toEqual({ problem: null, body: { requestKey: key(), amountMinor: 4999, method: 'cash', reason: 'paid_twice' } });
    expect(refundBody(m, paid, draft({ amount: '20' })).body?.amountMinor).toBe(2000);
    expect(refundBody(m, paid, draft({ amount: '0.01' })).body?.amountMinor).toBe(1);
    expect(refundBody(m, paid, draft({ amount: '50.00' }))).toEqual({ problem: 'That is more than can be refunded. £49.99 is the most.', body: null });
    expect(refundBody(m, { ...paid, refundableMinor: 2999 }, draft({ amount: '30' })).problem).toBe('That is more than can be refunded. £29.99 is the most.');
    for (const amount of ['', '0', '-5', 'abc', '1.999']) expect(refundBody(m, paid, draft({ amount })).body, amount).toBeNull();
    expect(refundBody(m, paid, draft({ method: '' })).problem).toBe('Pick how you gave it back.');
    expect(refundBody(m, paid, draft({ reason: '' })).problem).toBe('Pick why it was refunded.');
    expect(refundedWords(m, 2000)).toBe('£20.00 noted as refunded.');
    expect(REFUND_REASON_CHOICES.map((r) => r.label)).toEqual(['Paid twice', 'Charged too much', 'Leaving or cancelled', 'Something else']);
  });

  it('Undo refund names the refund it takes back', () => {
    const refund = { id: 'r1', amountMinor: 2000, method: 'cash', refundedOn: '2026-10-12', reason: 'other', by: null };
    const with1 = membership({}, { bills: [bill({ state: 'paid', paidMinor: 4999, refundedMinor: 2000, payments: [{ ...paid, refunds: [refund] }] })] });
    expect(undoRefundWords(with1, 'Ada Lovelace', paid.id, 'r1')).toMatchObject({
      question: "Take back the £20.00 refund noted on 12 October 2026 for Ada Lovelace's Gold Monthly?",
      button: 'Take it back',
      done: 'That refund was taken back.',
    });
    expect(undoRefundWords(with1, 'Ada Lovelace', paid.id, 'gone').question).toBe("Take back this refund for Ada Lovelace's Gold Monthly?");
  });
});
