// A PERSON'S BILLS AND PAYMENTS, their words (spec Part 3 §14.2; ROADMAP 18a-i). Pure, so
// the tests read every state without a browser. The server works out what each bill reads
// and which payment can be recorded or taken back (`memberBillRules.ts` in `@app/shared`);
// this file only puts them into words.
import {
  BILL_OVERDUE_DAYS_MAX,
  MEMBER_PAYMENT_BY_HAND,
  MEMBER_PAYMENT_METHOD_WORDS,
  currencyDecimals,
  formatMinor,
  minorToPriceText,
  priceToMinor,
} from '@app/shared';
import { dayWords } from './memberListView';

/** The tick that lets a member of staff record what a member paid. */
export function canRecordPayments(privileges) {
  return Array.isArray(privileges) && privileges.includes('billing.members');
}

/** Said to staff who can open a person's page and cannot record a payment. */
export const NO_PAYMENTS_LINE = "You can't record payments. Ask the owner to turn on \"Record members' payments\" for you.";

/** The ways staff record a payment by hand, for a list to pick from. */
export const PAYMENT_METHODS = MEMBER_PAYMENT_BY_HAND.map((value) => ({ value, label: MEMBER_PAYMENT_METHOD_WORDS[value] }));

const STATE_TAGS = {
  paid: { tag: 'Paid', tone: 'green' },
  due: { tag: 'Due', tone: 'plain' },
  overdue: { tag: 'Overdue', tone: 'orange' },
  void: { tag: 'Cancelled', tone: 'plain' },
  refunded: { tag: 'Refunded', tone: 'plain' },
};

const methodWords = (method) => MEMBER_PAYMENT_METHOD_WORDS[method] ?? 'Paid';

/** One bill as a row: what it is for, its tag, when it is or was due, and each payment. */
export function billRow(bill, currency, today) {
  const amount = formatMinor(bill.amountMinor, currency);
  const state = STATE_TAGS[bill.state] ?? STATE_TAGS.due;
  const open = bill.state === 'due' || bill.state === 'overdue';
  const left = bill.amountMinor - bill.paidMinor;
  let when = null;
  if (bill.state === 'overdue') when = `Was due ${dayWords(bill.dueOn)}`;
  else if (bill.state === 'due') when = bill.dueOn === today ? 'Due today' : `Due ${dayWords(bill.dueOn)}`;
  return {
    id: bill.id,
    title: bill.covers === null ? amount : `${dayWords(bill.covers.from)} to ${dayWords(bill.covers.to)} · ${amount}`,
    tag: state.tag,
    tone: state.tone,
    when,
    // Part paid: what is still owed, said in money.
    left: open && bill.paidMinor > 0 ? `${formatMinor(bill.paidMinor, currency)} paid · ${formatMinor(left, currency)} left` : null,
    payments: bill.payments.map((p) => ({
      id: p.id,
      line: [formatMinor(p.amountMinor, currency), methodWords(p.method), dayWords(p.paidOn), p.by === null ? null : `by ${p.by}`]
        .filter((part) => part !== null)
        .join(' · '),
    })),
  };
}

/** The form a press of Record payment opens: the amount starts at what is left. */
export function paymentDraft(m, newKey) {
  return { requestKey: newKey(), amount: minorToPriceText(m.billing.pay.leftMinor, m.currency), method: '' };
}

/** Whether the payment that can be recorded is for a period not due yet. */
export function paysEarly(m, today) {
  return m.billing.pay.dueOn > today;
}

/** The button that opens the form: it says so where nothing is due yet. */
export function payLabel(m, today) {
  return paysEarly(m, today) ? 'Record payment early' : 'Record payment';
}

/** What the form says above its fields: what is left, for which days, and when it is
 *  due where that day is still to come. `today` is the gym's own day. */
export function paymentWords(m, name, today) {
  const pay = m.billing.pay;
  const left = formatMinor(pay.leftMinor, m.currency);
  const what = pay.covers === null ? '' : ` for ${dayWords(pay.covers.from)} to ${dayWords(pay.covers.to)}`;
  const early = paysEarly(m, today) ? ` It is not due until ${dayWords(pay.dueOn)}.` : '';
  return {
    title: `Record a payment for ${name}'s ${m.typeName}`,
    detail: `${left} is left to pay${what}.${early} This only writes it in your records: no money is taken.`,
  };
}

/** Why the form cannot be sent as it stands, or null; and the body it sends. */
export function paymentBody(m, draft) {
  const pay = m.billing.pay;
  const amountMinor = priceToMinor(draft.amount, m.currency);
  if (amountMinor === null || amountMinor <= 0) {
    const decimals = currencyDecimals(m.currency) ?? 2;
    return { problem: decimals === 0 ? 'Type the amount they paid, as a whole number.' : 'Type the amount they paid, like 20 or 20.50.', body: null };
  }
  if (amountMinor > pay.leftMinor) {
    return { problem: `That is more than is left to pay. ${formatMinor(pay.leftMinor, m.currency)} is left.`, body: null };
  }
  if (draft.method === '') return { problem: 'Pick how they paid.', body: null };
  return { problem: null, body: { requestKey: draft.requestKey, periodIndex: pay.periodIndex, amountMinor, method: draft.method } };
}

/** What a recorded payment says back: all of it, or what is still owed. */
export function paidWords(m, amountMinor) {
  const left = m.billing.pay.leftMinor - amountMinor;
  const amount = formatMinor(amountMinor, m.currency);
  return left > 0 ? `${amount} recorded. ${formatMinor(left, m.currency)} is still left to pay.` : `${amount} recorded. ${m.typeName} is paid.`;
}

/** The question the Undo button asks, for a recorded payment and for an older mark. */
export function undoWords(m, name) {
  const undo = m.billing.undo;
  if (undo.kind === 'mark') {
    return {
      link: 'Undo mark paid',
      question: `Take back the last payment noted for ${name}'s ${m.typeName}?`,
      detail: 'Use this when it was marked paid by mistake. Nothing is refunded: this only changes your records.',
      button: 'Take it back',
      done: `The last payment noted for ${m.typeName} was taken back.`,
    };
  }
  const payment = m.billing.bills.flatMap((b) => b.payments).find((p) => p.id === undo.paymentId) ?? null;
  const what = payment === null ? 'the last payment' : `the ${formatMinor(payment.amountMinor, m.currency)} recorded on ${dayWords(payment.paidOn)}`;
  return {
    link: 'Undo last payment',
    question: `Take back ${what} for ${name}'s ${m.typeName}?`,
    detail: 'Use this when a payment was recorded by mistake. Nothing is refunded: this only changes your records, and the bill is owed again.',
    button: 'Take it back',
    done: `The last payment for ${m.typeName} was taken back.`,
  };
}

/** How many of a membership's bills are drawn before "Show all". */
export const BILLS_FOLDED = 2;

// ── When an unpaid bill reads Overdue (the gym's own number) ─────────────────

const GRACE_CHOICES = [0, 1, 2, 3, 5, 7, 10, 14, 21, 30, 45, BILL_OVERDUE_DAYS_MAX];

/** The days of grace to pick from; a number saved from elsewhere is added so it is never lost. */
export function graceChoices(current) {
  const days = GRACE_CHOICES.includes(current) ? GRACE_CHOICES : [...GRACE_CHOICES, current].sort((a, b) => a - b);
  return days.map((value) => ({ value, label: value === 0 ? 'None' : value === 1 ? '1 day' : `${String(value)} days` }));
}

/** The setting said with a real date: a bill stays Due on its due date and for the days
 *  of grace after it, and reads Overdue from the next day. */
export function graceExample(days) {
  const from = new Date(Date.UTC(2026, 2, 1 + days + 1));
  const day = `${String(from.getUTCDate())} ${from.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })}`;
  return `A bill due on 1 March reads Overdue from ${day} if it isn't paid.`;
}
