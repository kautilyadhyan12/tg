// A PERSON'S BILLS AND PAYMENTS, their words (spec Part 3 §14.2; ROADMAP 18a-i, 18a-ii).
// Pure, so the tests read every state without a browser. The server works out what each
// bill reads, which payment can be recorded or taken back, which bill can be cancelled and
// what can still be refunded (`memberBillRules.ts` in `@app/shared`); this file only puts
// them into words.
import {
  addDays,
  bpToTaxRateText,
  BILL_DAY_MAX,
  BILL_CANCEL_REASONS,
  BILL_CANCEL_REASON_WORDS,
  BILL_OVERDUE_DAYS_MAX,
  CARD_DECLINE_WORDS,
  CARD_RETRY_WORDS,
  cardName,
  MEMBER_FEE_WORDS,
  MEMBER_PAYMENT_BY_HAND,
  MEMBER_PAYMENT_METHOD_WORDS,
  paymentMethodsByHand,
  PAYMENT_VOID_REASONS,
  PAYMENT_VOID_REASON_WORDS,
  REFUND_REASONS,
  REFUND_REASON_WORDS,
  REFUND_VOID_REASONS,
  REFUND_VOID_REASON_WORDS,
  CARD_REFUND_LATE_LINE,
  CARD_REFUND_WORDS,
  currencyDecimals,
  dayOfMonthWords,
  formatMinor,
  fullFromOf,
  memberGiftBillLine,
  minorToPriceText,
  paidThroughSquare,
  priceToMinor,
} from '@app/shared';
import { dayWords } from './memberListView';
import { cardRefundOpenLine } from './cardRefundView';

/** The tick that lets a member of staff record what a member paid. */
export function canRecordPayments(privileges) {
  return Array.isArray(privileges) && privileges.includes('billing.members');
}

/** Said to staff who can open a person's page and cannot record a payment. */
export const NO_PAYMENTS_LINE = "You can't record payments. Ask the owner to turn on \"Record members' payments\" for you.";

/** The ways staff record a payment by hand at a gym in this country, for a list to pick from:
 *  UPI in India alone (18r). */
export const paymentMethodsFor = (country) => paymentMethodsByHand(country ?? null).map((value) => ({ value, label: MEMBER_PAYMENT_METHOD_WORDS[value] }));

/** Each state has a colour of its own, so a column of bills is read at a glance: paid
 *  green, owed yellow, overdue red, money given back orange, cancelled grey. */
const STATE_TAGS = {
  paid: { tag: 'Paid', tone: 'green' },
  due: { tag: 'Due', tone: 'orange' },
  overdue: { tag: 'Overdue', tone: 'red' },
  void: { tag: 'Voided', tone: 'plain' },
  refunded: { tag: 'Refunded', tone: 'soft' },
};

/** How many of a membership's bills are drawn before "Show all". */
export const BILLS_FOLDED = 2;

const methodWords = (method) => MEMBER_PAYMENT_METHOD_WORDS[method] ?? 'Paid';

/** A bill or fee whose newest charge to the card on file was declined (18d-iii-i): why, what the
 *  app does next or why it won't, and whether the cardholder was emailed (18d-iii-ii-a). */
export function cardDeclinedLine(declined) {
  const next =
    declined.next !== null && declined.next !== undefined
      ? ` The payment will be retried automatically on ${shortDay(declined.next, false)}.`
      : declined.stop !== null && declined.stop !== undefined
        ? ` ${CARD_RETRY_WORDS[declined.stop]}`
        : '';
  return `${cardName(declined)} was declined on ${shortDay(declined.on, false)}. ${CARD_DECLINE_WORDS[declined.reason] ?? CARD_DECLINE_WORDS.declined}${next}${cardNoticeLine(declined.notice)}`;
}

/** The email telling the cardholder, after the decline. */
function cardNoticeLine(notice) {
  if (notice === null || notice === undefined) return '';
  switch (notice.state) {
    case 'emailed':
      return ` The cardholder was emailed on ${shortDay(notice.on, false)}.`;
    case 'sending':
      return ' An email to the cardholder is being sent.';
    case 'no_email':
      return ' The cardholder was not emailed because there is no email address on file. Please contact them directly.';
    default:
      return ' The email to the cardholder could not be sent. Please contact them directly.';
  }
}

/** A bill or fee whose charge to the card on file Square never answered: the money may be taken. */
export function cardUncheckedLine(unchecked) {
  return `Square didn't say whether it charged ${cardName(unchecked)} on ${shortDay(unchecked.on, false)}. Check your Square Dashboard before taking payment another way.`;
}

/** A bill or fee whose charge to the card on file Square has not answered yet. */
export const CARD_CHARGING_LINE = "Charging the card on file: waiting for Square's answer.";

/** Its decline, and its charge on its way, for a bill's or a fee's box. */
const cardLines = (b) => ({
  declined:
    b.cardDeclined !== null && b.cardDeclined !== undefined
      ? cardDeclinedLine(b.cardDeclined)
      : b.cardUnchecked !== null && b.cardUnchecked !== undefined
        ? cardUncheckedLine(b.cardUnchecked)
        : null,
  charging: b.charging === true ? CARD_CHARGING_LINE : null,
});
const byWords = (by) => (by === null ? null : `by ${by}`);
const joined = (parts) => parts.filter((part) => part !== null).join(' · ');

/** Why a bill was cancelled, and why money was given back, for a list to pick from. */
export const CANCEL_REASONS = BILL_CANCEL_REASONS.map((value) => ({ value, label: BILL_CANCEL_REASON_WORDS[value] }));
export const REFUND_REASON_CHOICES = REFUND_REASONS.map((value) => ({ value, label: REFUND_REASON_WORDS[value] }));

/** Why a payment or a refund was voided, for a list to pick from (18o). */
export const PAYMENT_VOID_CHOICES = PAYMENT_VOID_REASONS.map((value) => ({ value, label: PAYMENT_VOID_REASON_WORDS[value] }));
export const REFUND_VOID_CHOICES = REFUND_VOID_REASONS.map((value) => ({ value, label: REFUND_VOID_REASON_WORDS[value] }));

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-01" → "1 Oct 2026", or "1 Oct" without its year: a bill's row is narrow. */
export function shortDay(day, withYear = true) {
  const [y, m, d] = day.split('-').map(Number);
  return `${String(d)} ${SHORT_MONTHS[m - 1]}${withYear ? ` ${String(y)}` : ''}`;
}

/** The days a bill is for, "1 Oct – 31 Oct 2026"; a bill for a whole membership says so,
 *  and a fee says its one day. */
export function billDays(covers) {
  if (covers === null) return 'Whole membership';
  if (covers.from === covers.to) return shortDay(covers.from);
  const sameYear = covers.from.slice(0, 4) === covers.to.slice(0, 4);
  return `${shortDay(covers.from, !sameYear)} – ${shortDay(covers.to)}`;
}

/** The bills a membership's box draws: the newest `BILLS_FOLDED`, or all of them; and
 *  always the one a payment can be taken for, so what is owed is never folded away, and
 *  the one holding the payment that can be voided, whose ⋯ offers it. */
export function billsToDraw(billing, all) {
  const newest = all ? billing.bills : billing.bills.slice(0, BILLS_FOLDED);
  const owed = billing.pay === null ? undefined : billing.bills.find((b) => b.periodIndex === billing.pay.periodIndex);
  const undo = billing.undo?.kind === 'payment' ? billing.undo.paymentId : null;
  const voidable = undo === null ? undefined : billing.bills.find((b) => b.payments.some((p) => p.id === undo));
  const bills = [...newest];
  for (const extra of [owed, voidable]) if (extra !== undefined && !bills.includes(extra)) bills.push(extra);
  return { bills, hidden: billing.bills.length - bills.length };
}

/** The tax in a bill, in one line (18b-iii): "$45.00 plus $8.10 GST 18%", or "Includes $7.63
 *  GST 18%" where the price held it; null for none. */
export function billTaxLine(bill, currency) {
  const t = bill.tax;
  if (t === null || t === undefined) return null;
  const label = `${t.name} ${bpToTaxRateText(t.bp)}%`;
  if (t.included) return `Includes ${formatMinor(t.minor, currency)} ${label}`;
  return `${formatMinor(bill.amountMinor - t.minor, currency)} plus ${formatMinor(t.minor, currency)} ${label}`;
}

/** "Voided 15 Oct 2026 by Priya Desk · Wrong amount": who voided a payment, a refund or a
 *  sale, and why. One voided before reasons were kept has none. */
export function voidedLine(voided, reasonWords) {
  const who = voided.by === null ? '' : ` by ${voided.by}`;
  // Square took a refund to the card up, then said it failed (18d-iv-a): nobody voided it.
  if (voided.reason === 'square_failed') return CARD_REFUND_WORDS.failed;
  // Taken off with Not this bill (18d-iii-b-i): nothing was voided, the money is still in Square.
  if (voided.reason === 'not_this_bill') return `Taken off this bill ${dayWords(voided.on)}${who}. The money is still in Square.`;
  const why = voided.reason === null ? null : (reasonWords[voided.reason] ?? null);
  return joined([`Voided ${dayWords(voided.on)}${who}`, why]);
}

const refundLine = (r, currency) => {
  // Sent to the card through Square (18d-iv-a): which card, whether Square has finished, and never voided here.
  const square = r.square ?? null;
  const pending = square?.state === 'pending';
  return {
    id: r.id,
    receiptNumber: r.receiptNumber,
    amount: `${formatMinor(r.amountMinor, currency)} ${pending ? 'refund pending' : 'refunded'}`,
    money: formatMinor(r.amountMinor, currency),
    detail: joined([
      square?.card === null || square?.card === undefined ? methodWords(r.method) : `${methodWords(r.method)}, ${cardName(square.card)}`,
      shortDay(r.refundedOn),
      REFUND_REASON_WORDS[r.reason] ?? null,
      byWords(r.by),
    ]),
    note: square?.late === true ? CARD_REFUND_LATE_LINE : null,
    toCard: square !== null,
    voided: null,
  };
};

/** A payment's refunds, those that stand and those voided, in the order they were noted. */
const refundLines = (p, currency) =>
  [
    ...(p.refunds ?? []).map((r) => refundLine(r, currency)),
    ...(p.voidedRefunds ?? []).map((r) => ({ ...refundLine(r, currency), voided: voidedLine(r.voided, REFUND_VOID_REASON_WORDS) })),
  ].sort((a, b) => a.receiptNumber - b.receiptNumber);

/** One bill as a box: the days it is for, its amount and tag, its tax, when it is or was
 *  due, who cancelled it, and each payment in columns with the refunds noted against it.
 *  A payment or refund staff voided stays in its place, struck through, saying who and why. */
export function billRow(bill, currency, today) {
  const amount = formatMinor(bill.amountMinor, currency);
  // Some of what was paid has been given back, and not all: still paid, and said so.
  const partRefunded = bill.state === 'paid' && bill.refundedMinor > 0;
  const state = partRefunded ? { tag: 'Part refunded', tone: 'soft' } : (STATE_TAGS[bill.state] ?? STATE_TAGS.due);
  let cancelled = null;
  if (bill.state === 'void') {
    cancelled = bill.cancelled === null ? 'Voided when the membership was cancelled' : voidedLine(bill.cancelled, BILL_CANCEL_REASON_WORDS);
  }
  const open = bill.state === 'due' || bill.state === 'overdue';
  const left = bill.amountMinor - bill.paidMinor;
  let when = null;
  if (bill.state === 'overdue') when = `Was due ${dayWords(bill.dueOn)}`;
  else if (bill.state === 'due') when = bill.dueOn === today ? 'Due today' : `Due ${dayWords(bill.dueOn)}`;
  return {
    id: bill.id,
    periodIndex: bill.periodIndex,
    // The first bill of one billed on the gym's day of the month: the days before it (18y).
    days: bill.part === true ? `${billDays(bill.covers)} · Part month` : billDays(bill.covers),
    amount,
    tag: state.tag,
    tone: state.tone,
    tax: billTaxLine(bill, currency),
    // The joining fee on the first bill (18t).
    joiningFee: bill.joiningFeeMinor > 0 ? `Includes the joining fee of ${formatMinor(bill.joiningFeeMinor, currency)}` : null,
    // A member's Refer a friend gift taken off it (20e-ii-b-ii-a).
    gift: bill.gift === null || bill.gift === undefined ? null : memberGiftBillLine(bill.gift.offMinor, bill.gift.currency, bill.gift.friendName ?? null),
    when,
    // Part paid: what is still owed, said in money.
    left: open && bill.paidMinor > 0 ? `${formatMinor(bill.paidMinor, currency)} paid · ${formatMinor(left, currency)} left` : null,
    cancelled,
    ...cardLines(bill),
    payments: paymentLines(bill.payments, bill.voidedPayments ?? [], currency),
  };
}

/** The payments of a bill or a fee, those that stand and those voided, in the order they were taken. */
const paymentLines = (payments, voided, currency) =>
  [
    ...payments.map((p) => ({
      ...paymentLine(p, currency),
      refundable: p.refundableMinor > 0,
      // A payment taken through Square goes back through Square (18d-iv-a).
      toCard: p.refundableMinor > 0 && paidThroughSquare(p.method),
      cardRefund: p.cardRefund === null || p.cardRefund === undefined ? null : cardRefundOpenLine(p.cardRefund, currency),
      voided: null,
    })),
    ...voided.map((p) => ({ ...paymentLine(p, currency), refundable: false, toCard: false, cardRefund: null, voided: voidedLine(p.voided, PAYMENT_VOID_REASON_WORDS) })),
  ].sort((a, b) => a.receiptNumber - b.receiptNumber);

const paymentLine = (p, currency) => ({
  id: p.id,
  method: p.method,
  amount: formatMinor(p.amountMinor, currency),
  // Charged to the card on file (18d-iii-i): which card.
  detail: joined([p.card === null || p.card === undefined ? methodWords(p.method) : `${methodWords(p.method)}, ${cardName(p.card)}`, shortDay(p.paidOn), byWords(p.by)]),
  receiptNumber: p.receiptNumber,
  refunds: refundLines(p, currency),
});

const capital = (name) => `${name.charAt(0).toUpperCase()}${name.slice(1)}`;

// ── A late cancel or no-show fee (18h-i) ──

const FEE_TAGS = { ...STATE_TAGS, waived: { tag: 'Waived', tone: 'plain' }, removed: { tag: 'Taken off', tone: 'plain' } };

/** Why a fee no longer counts: a class's can be marked Came or not run; a personal
 *  training session's (18h-ii) can only be marked Came; a freeze fee's month (18z) began on or after
 *  the day the membership was unfrozen or cancelled. */
const whyNotOwed = (fee) =>
  fee.of === 'membership' ? 'the membership was unfrozen or cancelled by the day this month began' : fee.of === 'pt' ? 'they were marked Came' : 'they were marked Came, or the class was cancelled';

/** What a fee is for: "Yoga on 3 October", or a freeze fee's month (18z): "Gold Monthly, frozen 22 Oct – 21 Nov 2026". */
export function feeForWords(fee) {
  if (fee.fee === 'freeze' && fee.to) return `${fee.forName}, frozen ${billDays({ from: fee.on, to: fee.to })}`;
  return `${fee.forName} on ${dayWords(fee.on)}`;
}

/** A fee paid, or taken off, after its booking stopped counting (18h-i, round one). */
const noLongerOwed = (fee) => `No longer owed: ${whyNotOwed(fee)}.`;

/** One fee as a box: what it is and what it was for, its amount and tag, when it is due,
 *  who waived it, and its payment, a voided one struck through. */
export function feeRow(fee, currency, today) {
  // Some of it has been given back, and not all: still paid, and said so, as on a bill.
  const partRefunded = fee.state === 'paid' && (fee.refundedMinor ?? 0) > 0;
  const state = partRefunded ? { tag: 'Part refunded', tone: 'soft' } : (FEE_TAGS[fee.state] ?? STATE_TAGS.due);
  let when = null;
  if (fee.state === 'overdue') when = `Was due ${dayWords(fee.dueOn)}`;
  else if (fee.state === 'due') when = fee.dueOn === today ? 'Due today' : `Due ${dayWords(fee.dueOn)}`;
  return {
    id: fee.id,
    title: MEMBER_FEE_WORDS[fee.fee] ?? 'Fee',
    about:
      fee.fee === 'freeze' && fee.to
        ? `Monthly fee while frozen · ${fee.forName}, ${billDays({ from: fee.on, to: fee.to })}`
        : `One-time fee · ${fee.forName}, ${dayWords(fee.on)}`,
    amount: formatMinor(fee.amountMinor, currency),
    tag: state.tag,
    tone: state.tone,
    tax: billTaxLine(fee, currency),
    when,
    waived:
      fee.waived !== null
        ? `Waived ${dayWords(fee.waived.on)}${fee.waived.by === null ? '' : ` by ${fee.waived.by}`}`
        : fee.state === 'removed'
          ? noLongerOwed(fee)
          : fee.state === 'paid' && fee.stillOwed === false
            ? // Paid on the Terminal or from the card on file: it goes back through Square, and Void payment
              // is not offered (18d-vi-b-i, 18d-iii-i, 18d-iv-b-i).
              fee.payments.some((p) => paidThroughSquare(p.method))
              ? `${noLongerOwed(fee)} To give ${partRefunded ? 'the rest' : 'the money'} back, press ⋯ on the payment, then Refund to card.`
              : `${noLongerOwed(fee)} If you gave the money back, void the payment.`
            : null,
    payments: paymentLines(fee.payments, fee.voidedPayments, currency),
    ...cardLines(fee),
    canPay: fee.can.pay,
    canWaive: fee.can.waive,
    voidPaymentId: fee.can.voidPaymentId,
  };
}

/** A membership's fees that are still owed. */
export function feesOwed(m) {
  return (m.billing?.fees ?? []).filter((f) => f.state === 'due' || f.state === 'overdue');
}

/** The Record payment form of a fee: it is paid all at once, so only how is asked. */
export function feePayDraft(fee, newKey) {
  return { billId: fee.id, requestKey: newKey(), method: '' };
}

/** Why a fee's payment cannot be sent as it stands, or null; and the body it sends. */
export function feePayBody(draft, fee) {
  if (draft === null || fee === undefined || fee === null) return { problem: 'Open the form again.', body: null };
  if (!MEMBER_PAYMENT_BY_HAND.includes(draft.method)) return { problem: 'Choose a payment method.', body: null };
  return { problem: null, body: { requestKey: draft.requestKey, amountMinor: fee.amountMinor, method: draft.method } };
}

const feeName = (fee) => (MEMBER_FEE_WORDS[fee.fee] ?? 'fee').toLowerCase();

/** A fee as a refund's box names it: "no-show fee", and what it was for. */
export const feeRefundWords = (fee) => ({ name: feeName(fee), about: feeForWords(fee) });

/** A fee's Record payment box when the Terminal takes the money (18d-vi-b-i): its title, and
 *  what the fee is for. */
export function feeTakeWords(fee, currency) {
  return {
    title: `Take ${formatMinor(fee.amountMinor, currency)} for the ${feeName(fee)}`,
    about: `It is for ${feeForWords(fee)}.`,
  };
}

/** Said once a fee's payment is recorded. */
export function feePaidWords(fee, currency) {
  return `${formatMinor(fee.amountMinor, currency)} recorded for the ${feeName(fee)}. Its receipt is under the fee.`;
}

/** The box Waive fee opens: whose fee, what stops being owed, and what stays. */
export function waiveFeeWords(fee, currency, name) {
  const amount = formatMinor(fee.amountMinor, currency);
  return {
    question: `Waive ${name}'s ${feeName(fee)} of ${amount}?`,
    detail: `It is for ${feeForWords(fee)}. ${capital(name)} will owe nothing for it. The fee stays on this page, marked Waived, with who waived it. This can't be undone.`,
    button: 'Waive fee',
    done: `Fee waived. ${capital(name)} owes nothing for it.`,
  };
}

/** The box Void payment opens on a fee. Where the booking no longer counts (marked came, or
 *  the class did not run) the fee is taken off with it, and nothing is owed again. */
export function voidFeePaymentWords(fee, currency, name) {
  const amount = formatMinor(fee.amountMinor, currency);
  if (fee.stillOwed === false) {
    return {
      question: `Void this ${amount} payment for ${name}'s ${feeName(fee)}?`,
      detail: `${capital(name)} no longer owes this fee: ${whyNotOwed(fee)}. Voiding the payment takes the fee off too, so nothing is owed. Do it if you gave the money back. The payment stays on this page, crossed out, with who voided it and why.`,
      label: 'Why are you voiding it?',
      button: 'Void payment',
      done: `Payment voided. ${capital(name)} owes nothing for this fee.`,
    };
  }
  return {
    question: `Void this ${amount} payment for ${name}'s ${feeName(fee)}?`,
    detail: `Only do this if it was recorded by mistake. The fee will be owed again. The payment stays on this page, crossed out, with who voided it and why.`,
    label: 'Why are you voiding it?',
    button: 'Void payment',
    done: `Payment voided. ${capital(name)} owes the ${amount} ${feeName(fee)} again. If they paid, record it.`,
  };
}

/** The bill staff can cancel now, or null: the server says which. */
export function billToCancel(m) {
  const id = m.billing?.cancel?.billId ?? null;
  return id === null ? null : (m.billing.bills.find((b) => b.id === id) ?? null);
}

/** The box Void bill opens (the server's "cancel" of a bill): whose bill, what stops being
 *  owed and what stays as it is. `live`: the membership is in use. */
export function cancelBillWords(m, name, live) {
  const bill = billToCancel(m);
  const amount = formatMinor(bill.amountMinor, m.currency);
  const days = bill.covers === null ? '' : ` for ${dayWords(bill.covers.from)} to ${dayWords(bill.covers.to)}`;
  const keeps = live ? ` ${capital(name)} keeps the membership and its dates.` : '';
  return {
    question: `Void this ${amount} bill for ${name}'s ${m.typeName}?`,
    detail: `It is the bill${days}. ${capital(name)} will owe nothing for it.${keeps} The bill stays on this page, marked Voided, with who voided it and why. This can't be undone.`,
    button: 'Void bill',
    done: `That ${amount} bill was voided. Nothing is owed for it.`,
  };
}

/** Why the void of a bill cannot be sent as it stands, or null; and the body it sends. */
export function cancelBillBody(draft) {
  return voidBody(draft);
}

/** What each ⋯ list offers, in a name and one line that says what it does (18o). */
export const MENU_WORDS = {
  cardRefund: { label: 'Refund to card', hint: 'Square sends the money back to the card that paid.' },
  refund: { label: 'Note a refund', hint: 'You gave some or all of it back.' },
  refundElsewhere: { label: 'Note a refund', hint: 'You gave it back another way, such as cash.' },
  voidPayment: { label: 'Void payment', hint: 'It was recorded by mistake. The bill is owed again.' },
  voidRefund: { label: 'Void refund', hint: 'It was noted by mistake. It will no longer count.' },
  voidBill: { label: 'Void bill', hint: 'Nothing is owed for these days.' },
};

/** Said where the payment was, once it is voided: who owes what again, and what to press
 *  next. `after` is the membership as the server sent it back; `billId` the bill it was on. */
export function paymentVoidedWords(after, name, billId) {
  const bill = after?.billing?.bills.find((b) => b.id === billId) ?? null;
  // Nothing is owed on it as the answer reads it: nothing more is said.
  if (bill === null || bill.amountMinor - bill.paidMinor <= 0) return 'Payment voided.';
  const left = formatMinor(bill.amountMinor - bill.paidMinor, after.currency);
  const what = bill.covers === null ? after.typeName : billDays(bill.covers);
  const voidable = after.billing.cancel?.billId === billId ? ' If they owe nothing, void the bill.' : '';
  return `Payment voided. ${capital(name)} owes ${left} for ${what} again. If they paid, record the right amount.${voidable}`;
}

/** The bill a payment is on, by the payment's id, or null. */
export function billOfPayment(m, paymentId) {
  return m.billing?.bills.find((b) => b.payments.some((p) => p.id === paymentId)) ?? null;
}

/** One payment of a membership by its id, a period's or a fee's, or null. */
export function paymentOf(m, paymentId) {
  return [...(m.billing?.bills ?? []), ...(m.billing?.fees ?? [])].flatMap((b) => b.payments).find((p) => p.id === paymentId) ?? null;
}

/** The fee a payment paid, by the payment's id, or null. */
export function feeOfPayment(m, paymentId) {
  return (m.billing?.fees ?? []).find((f) => f.payments.some((p) => p.id === paymentId)) ?? null;
}

/** The form "Note a refund" opens: the amount starts at what can still be refunded. */
export function refundDraft(m, payment, newKey) {
  return { paymentId: payment.id, requestKey: newKey(), amount: minorToPriceText(payment.refundableMinor, m.currency), method: '', reason: '' };
}

/** What the form says above its fields. `live`: the membership is in use. */
export function refundWords(m, name, payment, live) {
  const fee = feeOfPayment(m, payment.id);
  const paid = `${formatMinor(payment.amountMinor, m.currency)} paid on ${dayWords(payment.paidOn)}${fee === null ? '' : ` for ${feeForWords(fee)}`}`;
  const left = formatMinor(payment.refundableMinor, m.currency);
  // Money a change of membership moved to the new one (18x) paid for that one: never refunded here.
  const bill = (m.billing?.bills ?? []).find((b) => b.payments.some((p) => p.id === payment.id));
  const moved = bill !== undefined && bill.movedMinor > 0 ? ` ${formatMinor(bill.movedMinor, m.currency)} of this bill paid for ${m.changedTo?.typeName ?? 'the new membership'} when the membership was changed.` : '';
  const some = payment.refundableMinor < payment.amountMinor ? ` ${left} of it can still be refunded.${moved}` : '';
  const keeps = live && fee === null
    ? ` ${capital(name)} keeps the membership and its dates: to end it, use Cancel membership.`
    : '';
  return {
    title: `Note a refund for ${name}'s ${fee === null ? m.typeName : feeName(fee)}`,
    // A card paid through Square has Refund to card (18d-iv-a): this box may record one Square has made.
    detail: `This is for the ${paid}.${some} It only writes the refund in your records${paidThroughSquare(payment.method) ? '.' : ': give the money back yourself.'}${keeps}`,
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

/** The box "Void refund" opens, for one refund noted against one payment. */
export function voidRefundWords(m, name, paymentId, refundId) {
  const refunds = paymentOf(m, paymentId)?.refunds ?? [];
  const refund = refunds.find((r) => r.id === refundId) ?? null;
  const what = refund === null ? 'this refund' : `the ${formatMinor(refund.amountMinor, m.currency)} refund noted on ${dayWords(refund.refundedOn)}`;
  // Another refund may still stand on the same payment: then the payment does not count in full.
  const others = refunds.filter((r) => r.id !== refundId).length;
  const after =
    others === 0
      ? 'The payment counts in full again.'
      : `It no longer counts. The other ${others === 1 ? 'refund' : `${String(others)} refunds`} on this payment still ${others === 1 ? 'counts' : 'count'}.`;
  const fee = feeOfPayment(m, paymentId);
  return {
    question: `Void ${what} for ${name}'s ${fee === null ? m.typeName : feeName(fee)}?`,
    detail: `Use this when a refund was noted by mistake. ${after} The refund stays on this page, crossed out, with who voided it and why.`,
    label: 'Why are you voiding it?',
    button: 'Void refund',
    done: 'That refund was voided.',
  };
}

/** Why a void cannot be sent as it stands, or null; and the body it sends. */
export function voidBody(draft) {
  return draft.reason === '' ? { problem: 'Pick why you are voiding it.', body: null } : { problem: null, body: { reason: draft.reason } };
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
 *  due where that day is still to come. `today` is the gym's own day. `left` is that part
 *  alone, for the box when the Terminal takes the money (18d-vi-a). */
export function paymentWords(m, name, today) {
  const pay = m.billing.pay;
  const left = formatMinor(pay.leftMinor, m.currency);
  const what = pay.covers === null ? '' : ` for ${dayWords(pay.covers.from)} to ${dayWords(pay.covers.to)}`;
  const early = paysEarly(m, today) ? ` It is not due until ${dayWords(pay.dueOn)}.` : '';
  const leftWords = `${left} is left to pay${what}.${early}`;
  return {
    title: `Record a payment for ${name}'s ${m.typeName}`,
    detail: `${leftWords} This only writes it in your records: no money is taken.`,
    takeTitle: `Take a payment for ${name}'s ${m.typeName}`,
    left: leftWords,
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
  if (draft.method === '') return { problem: 'Choose a payment method.', body: null };
  return { problem: null, body: { requestKey: draft.requestKey, periodIndex: pay.periodIndex, amountMinor, method: draft.method } };
}

/** What a recorded payment says back: that bill is paid, or what is still owed on it.
 *  Never that the membership is paid: another of its bills may still be owed. */
export function paidWords(m, amountMinor) {
  const left = m.billing.pay.leftMinor - amountMinor;
  const amount = formatMinor(amountMinor, m.currency);
  return left > 0 ? `${amount} recorded. ${formatMinor(left, m.currency)} is still left to pay.` : `${amount} recorded. That bill is paid.`;
}

/** The box the Void payment button opens, and the question Undo mark paid asks for an
 *  older mark with no payment behind it. */
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
  const what = payment === null ? 'the last payment' : `the ${formatMinor(payment.amountMinor, m.currency)} payment recorded on ${dayWords(payment.paidOn)}`;
  return {
    link: 'Void payment',
    question: `Void ${what} for ${name}'s ${m.typeName}?`,
    detail:
      'Use this when a payment was recorded by mistake. The bill is owed again. The payment stays on this page, crossed out, with who voided it and why. No money moves: to give money back, use Note a refund instead.',
    label: 'Why are you voiding it?',
    button: 'Void payment',
    done: `The payment for ${m.typeName} was voided. That bill is owed again.`,
  };
}


// ── When an unpaid bill reads Overdue (the gym's own number) ─────────────────

const GRACE_CHOICES = [0, 1, 2, 3, 5, 7, 10, 14, 21, 30, 45, BILL_OVERDUE_DAYS_MAX];

/** The days of grace to pick from; a number saved from elsewhere is added so it is never lost. */
export function graceChoices(current) {
  const days = GRACE_CHOICES.includes(current) ? GRACE_CHOICES : [...GRACE_CHOICES, current].sort((a, b) => a - b);
  return days.map((value) => ({ value, label: value === 0 ? 'None' : value === 1 ? '1 day' : `${String(value)} days` }));
}

/** The billing day's choices (18y): each member billed from the day they start, or every new
 *  monthly or yearly membership on one day of the month, the 1st to the 28th. */
export function billDayChoices() {
  return [{ value: '', label: 'The day each membership starts' }, ...Array.from({ length: BILL_DAY_MAX }, (_, i) => ({ value: String(i + 1), label: `The ${dayOfMonthWords(i + 1)} of each month` }))];
}

/** The billing day said with a real date: what somebody who joins that month pays first. */
export function billDayExample(billDay) {
  if (billDay === null || billDay === undefined) return 'Each membership is billed on the day of the month it started.';
  const startsOn = billDay < 20 ? '2026-03-20' : '2026-03-05';
  const fullFrom = fullFromOf({ kind: 'recurring', termUnit: 'month' }, startsOn, billDay);
  const to = shortDay(addDays(fullFrom, -1), false);
  return `Somebody who joins on ${shortDay(startsOn, false)} pays for ${shortDay(startsOn, false)} to ${to} first, then the full price on the ${dayOfMonthWords(billDay)}: each month for a monthly membership, each year for a yearly one. Members who already have a membership keep their own billing day.`;
}

/** The freeze fee's box as it starts: "0" for none, else the amount. */
export function freezeFeeText(minor, currency) {
  return !Number.isInteger(minor) || minor === 0 || !currency ? '0' : minorToPriceText(minor, currency);
}

/** The freeze fee as typed, in minor units; null where it is not an amount. */
export function freezeFeeFromText(text, currency) {
  const trimmed = String(text ?? '').trim();
  if (trimmed === '' || /^0+([.,]0*)?$/.test(trimmed)) return 0;
  if (!currency) return null;
  const value = priceToMinor(trimmed, currency);
  return value === null || value < 0 || value > 99_999_999 ? null : value;
}

/** The freeze fee's box, said plainly (18z): when it is charged, and on whom. */
export function freezeFeeHint(minor, currency) {
  if (minor === null || minor === 0 || !currency) {
    return 'Charged each month a membership is frozen: the first on the day it is frozen, then on that day each month until it is unfrozen. 0 means no fee.';
  }
  return `A member frozen on 5 March is charged ${formatMinor(minor, currency)} that day, then on 5 April, and so on until they are unfrozen. Only memberships that renew by themselves are charged; when freezing, you can untick the fee for one member. Members already frozen keep the fee they were frozen with.`;
}

/** The setting said with a real date: a bill stays Due on its due date and for the days
 *  of grace after it, and reads Overdue from the next day. */
export function graceExample(days) {
  const from = new Date(Date.UTC(2026, 2, 1 + days + 1));
  const day = `${String(from.getUTCDate())} ${from.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })}`;
  return `A bill due on 1 March reads Overdue from ${day} if it isn't paid.`;
}
