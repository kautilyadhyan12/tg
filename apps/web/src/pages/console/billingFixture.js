// A membership's bills as the server sends them, for tests (ROADMAP 18a-i): built with
// the server's own shared rules, so a test's page is one the server could have sent.
import {
  billCovers,
  billsToOpen,
  memberBillState,
  memberPayTarget,
  memberUndoTarget,
  periodStart,
} from '@app/shared';

/** The same bills on a past member's page: only a bill left owing can be paid, and
 *  nothing is taken back. */
export function asPast(billing) {
  if (billing === null) return null;
  const owed = [...billing.bills].filter((b) => b.state === 'due' || b.state === 'overdue').sort((a, b) => a.periodIndex - b.periodIndex)[0];
  return {
    ...billing,
    pay: owed === undefined ? null : { periodIndex: owed.periodIndex, covers: owed.covers, leftMinor: owed.amountMinor - owed.paidMinor, dueOn: owed.dueOn, state: owed.state },
    undo: null,
  };
}

const billId = (n, i) => `55555555-5555-4555-8555-${String(n).padStart(6, '0')}${String(i).padStart(6, '0')}`;
const paymentId = (n, i) => `66666666-6666-4666-8666-${String(n).padStart(6, '0')}${String(i).padStart(6, '0')}`;

/** `given` is the membership as it was given, `m` as it is now: a bill opened when it was
 *  given stays after a cancel. Every period counted paid has a settled bill with one cash
 *  payment by `by`. `n` keeps ids apart between memberships. */
export function billingFor(n, given, m, priceMinor, today, by = 'Sam Owner') {
  if (m.free) return { bills: [], billsNotShown: 0, pay: null, undo: null };
  const dueOf = (i) => (m.kind === 'recurring' ? periodStart(m, i) : m.startsOn);
  const facts = [];
  const payments = [];
  for (let i = m.paidFloor; i < m.paidPeriods; i += 1) {
    facts.push({ periodIndex: i, status: 'paid', amountMinor: priceMinor, paidMinor: priceMinor, dueOn: dueOf(i), covers: billCovers(given, i) });
    payments.push({ id: paymentId(n, i), periodIndex: i, seq: i + 1 });
  }
  const have = () => new Set(facts.map((f) => f.periodIndex));
  for (const source of [[given, given.startsOn], [m, today]]) {
    for (const due of billsToOpen(source[0], source[1], have())) {
      if (due.periodIndex >= m.paidPeriods) facts.push({ periodIndex: due.periodIndex, status: 'open', amountMinor: priceMinor, paidMinor: 0, dueOn: due.dueOn, covers: due.covers });
    }
  }
  const pay = memberPayTarget(m, priceMinor, today, facts);
  const undo = memberUndoTarget(m, today, facts, payments);
  return {
    bills: [...facts]
      .sort((a, b) => b.periodIndex - a.periodIndex)
      .map((f) => ({
        id: billId(n, f.periodIndex),
        periodIndex: f.periodIndex,
        // The days it was opened for: a freeze since has not moved them.
        covers: f.covers,
        amountMinor: f.amountMinor,
        paidMinor: f.paidMinor,
        dueOn: f.dueOn,
        state: memberBillState(f, today, 0),
        payments: f.status === 'paid' ? [{ id: paymentId(n, f.periodIndex), amountMinor: f.amountMinor, method: 'cash', paidOn: f.dueOn, by }] : [],
      })),
    billsNotShown: 0,
    pay:
      pay === null
        ? null
        : { periodIndex: pay.periodIndex, covers: pay.covers, leftMinor: pay.leftMinor, dueOn: pay.dueOn, state: memberBillState({ status: 'open', dueOn: pay.dueOn }, today, 0) === 'overdue' ? 'overdue' : 'due' },
    undo: undo === null ? null : { kind: 'payment', paymentId: undo.paymentId },
  };
}
