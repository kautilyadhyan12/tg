// REFUND TO CARD (ROADMAP 18d-iv-a; spec Part 3 §14.8): what the box under a payment says and sends. The money goes
// back through Square to the card that paid; the server decides again whether it can.
import { CARD_REFUND_WORDS, REFUND_REASONS, REFUND_REASON_WORDS, cardName, currencyDecimals, formatMinor, minorToPriceText, priceToMinor } from '@app/shared';
import { dayWords } from './memberListView';

export const CARD_REFUND_REASONS = REFUND_REASONS.map((value) => ({ value, label: REFUND_REASON_WORDS[value] }));

/** Why a refund goes back. Nobody leaves over a fee (18d-iv-b-i). */
export const refundReasonsFor = (fee, reasons = CARD_REFUND_REASONS) => (fee === null ? reasons : reasons.filter((r) => r.value !== 'leaving'));

/** What stops a refund, said in the box. */
export const cardRefundBlockLine = (block) => CARD_REFUND_WORDS[block] ?? CARD_REFUND_WORDS.differs;

/** Where the money has to be given back another way, so the box offers Note a refund. */
export const blockNotes = (block) => block === 'too_old' || block === 'card_present' || block === 'other_account';

/** The box's first state: all that can go back, and no reason picked. */
export const cardRefundDraft = (check, currency, newKey) => ({ requestKey: newKey(), amount: minorToPriceText(check.leftMinor, currency), reason: '', tried: false });

const capital = (name) => `${name.charAt(0).toUpperCase()}${name.slice(1)}`;

/** What Square gave back with no note here (the app shows it by itself from 18d-iv-d). */
export function inSquareLine(m, check) {
  return check.refundedInSquareMinor > 0 ? `Square shows ${formatMinor(check.refundedInSquareMinor, m.currency)} of this payment was already refunded there. Note that refund here so your records match.` : null;
}

/** The box's words. `live`: the membership is in use. `fee`: the fee it paid (`feeRefundWords`), or null for a period. */
export function cardRefundBoxWords(m, name, payment, check, live, fee = null) {
  const some = check.leftMinor < payment.amountMinor ? ` ${formatMinor(check.leftMinor, m.currency)} of it can still be refunded.` : '';
  const keeps = live && fee === null ? ` ${capital(name)} keeps the membership and its dates: to end it, use Cancel membership.` : '';
  const forWhat = fee === null ? '' : ` for ${fee.about}`;
  return {
    title: `Refund ${name}'s ${fee === null ? m.typeName : fee.name} to the card`,
    detail: `This is for the ${formatMinor(payment.amountMinor, m.currency)} paid on ${dayWords(payment.paidOn)}${forWhat}.${some} ${CARD_REFUND_WORDS.fee} ${CARD_REFUND_WORDS.days}${keeps}`,
    inSquare: inSquareLine(m, check),
  };
}

/** Why the box cannot be sent as it stands, or null; and the body it sends. */
export function cardRefundBody(m, check, draft) {
  const amountMinor = priceToMinor(draft.amount, m.currency);
  if (amountMinor === null || amountMinor <= 0) {
    const decimals = currencyDecimals(m.currency) ?? 2;
    return { problem: decimals === 0 ? 'Type the amount to refund, as a whole number.' : 'Type the amount to refund, like 20 or 20.50.', body: null };
  }
  if (amountMinor > check.leftMinor) return { problem: `That is more than can be refunded. ${formatMinor(check.leftMinor, m.currency)} is the most.`, body: null };
  if (draft.reason === '') return { problem: 'Pick why it is being refunded.', body: null };
  return { problem: null, body: { requestKey: draft.requestKey, amountMinor, reason: draft.reason } };
}

/** The button says what it does and to which card. */
export function cardRefundButton(m, check, draft) {
  const to = check.card === null ? 'the card' : cardName(check.card);
  const amountMinor = priceToMinor(draft.amount, m.currency);
  return amountMinor === null || amountMinor <= 0 ? `Refund to ${to}` : `Refund ${formatMinor(amountMinor, m.currency)} to ${to}`;
}

/** Said under a payment while a refund to its card has no answer, or never had one. */
export function cardRefundOpenLine(open, currency) {
  const money = formatMinor(open.amountMinor, currency);
  return open.lost
    ? `We don't know whether Square took the ${money} refund of ${dayWords(open.on)}. Check your Square Dashboard. If it went through, note the refund here.`
    : `A refund of ${money} is waiting for Square's answer.`;
}

/** Whether anything on this person's page is waiting on Square: a refund it has not answered or not finished. */
export function waitsOnSquare(memberships) {
  return (memberships ?? []).some((m) =>
    [...(m.billing?.bills ?? []), ...(m.billing?.fees ?? [])].some((b) => b.payments.some((p) => (p.cardRefund !== null && p.cardRefund !== undefined && !p.cardRefund.lost) || p.refunds.some((r) => r.square?.state === 'pending'))),
  );
}
