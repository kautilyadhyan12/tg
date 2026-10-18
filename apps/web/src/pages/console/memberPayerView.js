// WHO PAYS, ON A PERSON'S PAGE (spec Part 3 §14.2; ROADMAP 18i): the box's words. Pure, so
// the tests read every state without a browser. The server decides who may pay for whom
// (`apps/api/src/modules/orgs/payers`); this file only puts it into words.
import { MEMBER_FEE_WORDS, formatMinor } from '@app/shared';
import { billDays, feesOwed, shortDay } from './memberBillsView';

const nameOf = (name) => (typeof name === 'string' && name.trim() !== '' ? name : 'No name on their record');

/** The line at the top of the box: who pays for this person, whom they pay for, or neither. */
export function payerLine(answer, name) {
  const who = nameOf(name);
  if (answer.paidBy !== null) return `${nameOf(answer.paidBy.name)} pays for ${who}.`;
  if (answer.paysFor.length > 0) return `${who} pays for ${answer.paysFor.length === 1 ? '1 person' : `${String(answer.paysFor.length)} people`}.`;
  return `${who} pays their own bills.`;
}

/** Who is told in the app when a payment is overdue: the payer where their record has one app
 *  account of its own, and otherwise nobody, the person paid for included (round one, High 3). */
const toldLine = (payer, inApp) =>
  inApp ? `${payer} is told in the app when a payment is overdue.` : `Neither of them is told in the app when a payment is overdue: ${payer} has no app account of their own.`;

/** What it means, said once under the line where somebody else pays. */
export function payerMeans(answer, name) {
  if (answer.paidBy === null) return null;
  const payer = nameOf(answer.paidBy.name);
  return `Take the money from ${payer}, and receipts name them. ${toldLine(payer, answer.paidBy.inApp)} ${nameOf(name)} keeps their own memberships, bookings and pass.`;
}

/** Said to staff who may not change it, so the box is never a dead end. */
export const PAYER_ASK_LINE = 'Only staff who record payments can change who pays.';

/** The box Save opens, naming who changes and who does not, before anything is written. */
export function setPayerWords(payerName, personName, payerInApp) {
  const payer = nameOf(payerName);
  const person = nameOf(personName);
  return {
    question: `${payer} pays for ${person}?`,
    detail: `From now on, ${person}'s bills and receipts go to ${payer}. ${toldLine(payer, payerInApp)} ${person} keeps their own memberships, bookings and pass.`,
    button: 'Save',
    done: `${payer} now pays for ${person}.`,
  };
}

/** The box Remove opens. */
export function removePayerWords(payerName, personName) {
  const payer = nameOf(payerName);
  const person = nameOf(personName);
  return {
    question: `Stop ${payer} paying for ${person}?`,
    detail: `${person} pays their own bills from now on, including any still unpaid. Payments already recorded keep ${payer}'s name.`,
    button: 'Remove',
    done: `${person} now pays their own bills.`,
  };
}

/** The search box's label, for each way it is opened. */
export function findLabel(mode) {
  return mode === 'payer' ? 'Find who pays, by name or member number' : 'Find who they pay for, by name or member number';
}

/** What one person somebody pays for owes now, as the payer's box lists it: each
 *  membership's bill that is due or overdue today, then each fee still owed. `today` is the
 *  gym's own day. A bill not due yet is left to the person's own page. */
export function owedItems(held, today) {
  const items = [];
  for (const m of held.memberships) {
    const pay = m.billing?.pay ?? null;
    if (pay !== null && pay.dueOn <= today) {
      items.push({
        key: `bill-${m.id}`,
        kind: 'bill',
        membership: m,
        title: pay.covers === null ? m.typeName : `${m.typeName} · ${billDays(pay.covers)}`,
        amount: `${formatMinor(pay.leftMinor, m.currency)} left`,
        tag: pay.state === 'overdue' ? 'Overdue' : 'Payment due',
        overdue: pay.state === 'overdue',
      });
    }
    for (const fee of feesOwed(m)) {
      items.push({
        key: `fee-${fee.id}`,
        kind: 'fee',
        membership: m,
        fee,
        title: `${MEMBER_FEE_WORDS[fee.fee] ?? 'Fee'} · ${fee.forName} · ${shortDay(fee.on, false)}`,
        amount: formatMinor(fee.amountMinor, m.currency),
        tag: fee.state === 'overdue' ? 'Overdue' : 'Payment due',
        overdue: fee.state === 'overdue',
      });
    }
  }
  return items;
}

/** Said once a payment for somebody they pay for is recorded, where it was pressed. */
export function familyPaidWords(amountMinor, currency, payerName, personName) {
  return `${formatMinor(amountMinor, currency)} recorded from ${nameOf(payerName)} for ${nameOf(personName)}.`;
}

/** The newest receipt on a membership's bills and fees: the payment just recorded. */
export function newestReceipt(m) {
  const numbers = [...(m.billing?.bills ?? []).flatMap((b) => b.payments), ...(m.billing?.fees ?? []).flatMap((f) => f.payments)].map((p) => p.receiptNumber);
  return numbers.length === 0 ? null : Math.max(...numbers);
}
