// A PERSON'S BILLS AND PAYMENTS, their words (spec Part 3 §14.2; ROADMAP 18a-i, 18a-ii).
// Pure, so the tests read every state without a browser. The server works out what each
// bill reads, which payment can be recorded or taken back, which bill can be cancelled and
// what can still be refunded (`memberBillRules.ts` in `@app/shared`); this file only puts
// them into words.
import {
  BILL_CANCEL_REASONS,
  BILL_CANCEL_REASON_WORDS,
  BILL_OVERDUE_DAYS_MAX,
  MEMBER_PAYMENT_BY_HAND,
  MEMBER_PAYMENT_METHOD_WORDS,
  REFUND_REASONS,
  REFUND_REASON_WORDS,
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
const byWords = (by) => (by === null ? null : `by ${by}`);
const joined = (parts) => parts.filter((part) => part !== null).join(' · ');

/** Why a bill was cancelled, and why money was given back, for a list to pick from. */
export const CANCEL_REASONS = BILL_CANCEL_REASONS.map((value) => ({ value, label: BILL_CANCEL_REASON_WORDS[value] }));
export const REFUND_REASON_CHOICES = REFUND_REASONS.map((value) => ({ value, label: REFUND_REASON_WORDS[value] }));

/** One bill as a row: what it is for, its tag, when it is or was due, who cancelled it,
 *  and each payment with the refunds noted against it. */
export function billRow(bill, currency, today) {
  const amount = formatMinor(bill.amountMinor, currency);
  // Some of what was paid has been given back, and not all: still paid, and said so.
  const partRefunded = bill.state === 'paid' && bill.refundedMinor > 0;
  const state = partRefunded ? { tag: 'Part refunded', tone: 'plain' } : (STATE_TAGS[bill.state] ?? STATE_TAGS.due);
  let cancelled = null;
  if (bill.state === 'void') {
    cancelled =
      bill.cancelled === null
        ? 'Cancelled with the membership'
        : joined([`Cancelled ${dayWords(bill.cancelled.on)}`, BILL_CANCEL_REASON_WORDS[bill.cancelled.reason] ?? null, byWords(bill.cancelled.by)]);
  }
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
    cancelled,
    payments: bill.payments.map((p) => ({
      id: p.id,
      line: joined([formatMinor(p.amountMinor, currency), methodWords(p.method), dayWords(p.paidOn), byWords(p.by)]),
      refundable: p.refundableMinor > 0,
      refunds: p.refunds.map((r) => ({
        id: r.id,
        line: joined([
          `${formatMinor(r.amountMinor, currency)} refunded`,
          methodWords(r.method),
          dayWords(r.refundedOn),
          REFUND_REASON_WORDS[r.reason] ?? null,
          byWords(r.by),
        ]),
      })),
    })),
  };
}

const capital = (name) => `${name.charAt(0).toUpperCase()}${name.slice(1)}`;

/** The bill staff can cancel now, or null: the server says which. */
export function billToCancel(m) {
  const id = m.billing?.cancel?.billId ?? null;
  return id === null ? null : (m.billing.bills.find((b) => b.id === id) ?? null);
}

/** The box a press of "Cancel this bill" opens: whose bill, what stops being owed and
 *  what stays as it is. `live`: the membership is in use. */
export function cancelBillWords(m, name, live) {
  const bill = billToCancel(m);
  const amount = formatMinor(bill.amountMinor, m.currency);
  const days = bill.covers === null ? '' : ` for ${dayWords(bill.covers.from)} to ${dayWords(bill.covers.to)}`;
  const keeps = live ? ` ${capital(name)} keeps the membership and its dates.` : '';
  return {
    question: `Cancel this ${amount} bill for ${name}'s ${m.typeName}?`,
    detail: `It is the bill${days}. ${capital(name)} will owe nothing for it.${keeps} The bill stays in your records, marked Cancelled. This can't be undone.`,
    button: 'Cancel this bill',
    done: `That ${amount} bill was cancelled. Nothing is owed for it.`,
  };
}

/** Why the cancel cannot be sent as it stands, or null; and the body it sends. */
export function cancelBillBody(draft) {
  return draft.reason === '' ? { problem: 'Pick why you are cancelling it.', body: null } : { problem: null, body: { reason: draft.reason } };
}

/** One payment of a membership by its id, or null. */
export function paymentOf(m, paymentId) {
  return m.billing?.bills.flatMap((b) => b.payments).find((p) => p.id === paymentId) ?? null;
}

/** The form "Note a refund" opens: the amount starts at what can still be refunded. */
export function refundDraft(m, payment, newKey) {
  return { paymentId: payment.id, requestKey: newKey(), amount: minorToPriceText(payment.refundableMinor, m.currency), method: '', reason: '' };
}

/** What the form says above its fields. `live`: the membership is in use. */
export function refundWords(m, name, payment, live) {
  const paid = `${formatMinor(payment.amountMinor, m.currency)} paid on ${dayWords(payment.paidOn)}`;
  const left = formatMinor(payment.refundableMinor, m.currency);
  const some = payment.refundableMinor < payment.amountMinor ? ` ${left} of it can still be refunded.` : '';
  const keeps = live
    ? ` ${capital(name)} keeps the membership and its dates: to end it, use Cancel membership.`
    : '';
  return {
    title: `Note a refund for ${name}'s ${m.typeName}`,
    detail: `This is for the ${paid}.${some} It only writes the refund in your records: give the money back yourself.${keeps}`,
  };
}

/** Why the form cannot be sent as it stands, or null; and the body it sends. */
export function refundBody(m, payment, draft) {
  const amountMinor = priceToMinor(draft.amount, m.currency);
  if (amountMinor === null || amountMinor <= 0) {
    const decimals = currencyDecimals(m.currency) ?? 2;
    return { problem: decimals === 0 ? 'Type the amount you gave back, as a whole number.' : 'Type the amount you gave back, like 20 or 20.50.', body: null };
  }
  if (amountMinor > payment.refundableMinor) {
    return { problem: `That is more than can be refunded. ${formatMinor(payment.refundableMinor, m.currency)} is the most.`, body: null };
  }
  if (draft.method === '') return { problem: 'Pick how you gave it back.', body: null };
  if (draft.reason === '') return { problem: 'Pick why it was refunded.', body: null };
  return { problem: null, body: { requestKey: draft.requestKey, amountMinor, method: draft.method, reason: draft.reason } };
}

/** What a noted refund says back. */
export function refundedWords(m, amountMinor) {
  return `${formatMinor(amountMinor, m.currency)} noted as refunded.`;
}

/** The question "Undo refund" asks, for one refund noted against one payment. */
export function undoRefundWords(m, name, paymentId, refundId) {
  const refund = paymentOf(m, paymentId)?.refunds.find((r) => r.id === refundId) ?? null;
  const what = refund === null ? 'this refund' : `the ${formatMinor(refund.amountMinor, m.currency)} refund noted on ${dayWords(refund.refundedOn)}`;
  return {
    question: `Take back ${what} for ${name}'s ${m.typeName}?`,
    detail: 'Use this when a refund was noted by mistake. This only changes your records: no money moves.',
    button: 'Take it back',
    done: 'That refund was taken back.',
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

/** What a recorded payment says back: that bill is paid, or what is still owed on it.
 *  Never that the membership is paid: another of its bills may still be owed. */
export function paidWords(m, amountMinor) {
  const left = m.billing.pay.leftMinor - amountMinor;
  const amount = formatMinor(amountMinor, m.currency);
  return left > 0 ? `${amount} recorded. ${formatMinor(left, m.currency)} is still left to pay.` : `${amount} recorded. That bill is paid.`;
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
