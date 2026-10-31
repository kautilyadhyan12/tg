import {
  CARD_REFUND_LATE_LINE,
  CARD_REFUND_WORDS,
  MEMBER_PAYMENT_METHOD_WORDS,
  REFUND_VOID_REASONS,
  REFUND_VOID_REASON_WORDS,
  SALE_REFUND_REASONS,
  SALE_REFUND_REASON_WORDS,
  cardName,
  currencyDecimals,
  formatMinor,
  minorToPriceText,
  priceToMinor,
} from '@app/shared';
import { cardRefundOpenLine, cardRefundSaidNow } from './cardRefundView';
import { MENU_WORDS, shortDay, voidedLine } from './memberBillsView';

// REFUND A SALE AT THE DESK (spec Part 3 §14.3; ROADMAP 18p): every sentence the Refund sale
// box, a sale's refund lines and Void refund say, made from what the server sent. The server
// refuses a refund of more than is left, whatever this file says.

const joined = (parts) => parts.filter((part) => part !== null && part !== '').join(' · ');
const methodWords = (method) => MEMBER_PAYMENT_METHOD_WORDS[method] ?? 'Paid';

/** Why money was given back, and why a refund was voided: picked from a list. */
export const SALE_REFUND_CHOICES = SALE_REFUND_REASONS.map((value) => ({ value, label: SALE_REFUND_REASON_WORDS[value] }));
export const SALE_REFUND_VOID_CHOICES = REFUND_VOID_REASONS.map((value) => ({ value, label: REFUND_VOID_REASON_WORDS[value] }));

/** The ⋯ list's items for a sale, each with the one line that says what it does. */
export const SALE_MENU_WORDS = {
  refund: { label: 'Refund sale', hint: 'You gave some or all of the money back.' },
  cardRefund: MENU_WORDS.cardRefund,
  noteRefund: MENU_WORDS.refundElsewhere,
  voidSale: { label: 'Void sale', hint: 'It was recorded by mistake. It will no longer count.' },
  voidRefund: { label: 'Void refund', hint: 'It was noted by mistake. It will no longer count.' },
};

/** What is left of a sale to give back. */
export const refundableMinor = (sale) => Math.max(0, sale.totalMinor - (sale.refundedMinor ?? 0));

/** How many of what was sold have not gone back on the shelf. */
export function restockLeft(sale) {
  const back = (sale.refunds ?? []).filter((r) => r.voided === null).reduce((n, r) => n + r.restocked, 0);
  return Math.max(0, sale.quantity - back);
}

/** "Refunded" once all of it went back, "Part refunded" while some did; null for none. */
export function saleRefundTag(sale) {
  const back = sale.refundedMinor ?? 0;
  if (sale.undone || back <= 0) return null;
  return back >= sale.totalMinor ? 'Refunded' : 'Part refunded';
}

/** A fresh Refund sale box: all that is left, given back the way it was paid. */
export function saleRefundDraft(sale, newKey) {
  // Noted on a sale paid on the Terminal: the money went back another way, and staff pick how.
  return { requestKey: newKey(), amount: minorToPriceText(refundableMinor(sale), sale.currency), method: sale.method === 'terminal' ? '' : sale.method, reason: '', restock: '0', tried: false };
}

/** Whether the box asks how many went back on the shelf: only where the sale took from a count. */
export const asksRestock = (sale) => sale.stockCounted === true && restockLeft(sale) > 0;

/** The choices for how many go back on the shelf: none, or up to what is left. */
export function restockChoices(sale) {
  const left = restockLeft(sale);
  return [{ value: '0', label: 'None' }, ...Array.from({ length: left }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))];
}

/** What the box says above its fields. `who` is the buyer's name, or null for a walk-in. */
export function saleRefundWords(sale, who) {
  const to = who === null ? 'to a walk-in' : `to ${who}`;
  const left = refundableMinor(sale);
  const some = left < sale.totalMinor ? ` ${formatMinor(left, sale.currency)} of it can still be refunded.` : '';
  return {
    title: `Refund sale: ${String(sale.quantity)} × ${sale.itemName}`,
    detail: `Sold on ${shortDay(sale.soldOn)} ${to} for ${formatMinor(sale.totalMinor, sale.currency)}.${some} This only writes the refund in your records: give the money back yourself.`,
  };
}

/** What is left of a sale of several products, to refund at once. */
export const wholeLeftMinor = (lines) => lines.reduce((n, line) => n + refundableMinor(line), 0);

/** The list's first choice on a sale of several products (18d-iv-b-ii). */
export const wholeRefundOption = (lines) => `All products · ${formatMinor(wholeLeftMinor(lines), lines[0]?.currency ?? 'USD')} can be refunded`;

/** What all of a sale asks about the shelf: a question for each product whose stock is counted. */
export const wholeShelves = (lines) => lines.filter(asksRestock).map((line) => ({ key: line.id, label: `${line.itemName}: how many went back on the shelf`, choices: restockChoices(line) }));

/** The box's choices, as the server takes them. */
export const shelfBody = (lines, shelf) => lines.map((line) => ({ saleId: line.id, count: Number(shelf?.[line.id] ?? '0') })).filter((s) => s.count > 0);

const wholeDetail = (basket, lines, who) => {
  const first = basket.first;
  const to = who === null ? 'to a walk-in' : `to ${who}`;
  const left = wholeLeftMinor(lines);
  const some = left < basket.totalMinor ? ` ${formatMinor(left, first.currency)} of it can still be refunded.` : '';
  return `Sold on ${shortDay(first.soldOn)} ${to} for ${formatMinor(basket.totalMinor, first.currency)}.${some}`;
};

/** What the Refund to card box says on all of a sale, from what Square said. */
export function wholeCardRefundWords(basket, lines, who, check) {
  return {
    title: 'Refund all of this sale to the card',
    detail: `${wholeDetail(basket, lines, who)} ${CARD_REFUND_WORDS.fee} ${CARD_REFUND_WORDS.days}`,
    inSquare: check.refundedInSquareMinor > 0 ? `Square shows ${formatMinor(check.refundedInSquareMinor, basket.first.currency)} of this sale was already refunded there. Note that refund here so your records match.` : null,
  };
}

/** What the Note a refund box says on all of a sale. */
export const wholeNoteWords = (basket, lines, who) => ({ title: 'Refund all of this sale', detail: `${wholeDetail(basket, lines, who)} This only writes the refund in your records: give the money back yourself.` });

/** Why that box cannot be sent as it stands, or null; and the body it sends. */
export function wholeNoteBody(lines, draft) {
  if (draft.method === '') return { problem: 'Pick how you gave it back.', body: null };
  if (draft.reason === '') return { problem: 'Pick why it was refunded.', body: null };
  return { problem: null, body: { requestKey: draft.requestKey, totalMinor: wholeLeftMinor(lines), method: draft.method, reason: draft.reason, shelf: shelfBody(lines, draft.shelf) } };
}

/** Said in the sale's own place once all of it is noted. */
export function wholeNotedWords(lines, receiptNumbers) {
  const numbers = receiptNumbers.map((n) => `#${String(n)}`);
  const receipts = numbers.length === 1 ? `Its receipt is ${numbers[0]}` : `Its receipts are ${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}`;
  return `Refund noted: ${formatMinor(wholeLeftMinor(lines), lines[0]?.currency ?? 'USD')} back on all of this sale. ${receipts}.`;
}

/** What the Refund to card box says above its fields (18d-iv-b-ii), from what Square said. */
export function saleCardRefundWords(sale, who, check) {
  const to = who === null ? 'to a walk-in' : `to ${who}`;
  const some = check.leftMinor < sale.totalMinor ? ` ${formatMinor(check.leftMinor, sale.currency)} of it can still be refunded.` : '';
  return {
    title: `Refund ${String(sale.quantity)} × ${sale.itemName} to the card`,
    detail: `Sold on ${shortDay(sale.soldOn)} ${to} for ${formatMinor(sale.totalMinor, sale.currency)}.${some} ${CARD_REFUND_WORDS.fee} ${CARD_REFUND_WORDS.days}`,
    inSquare: check.refundedInSquareMinor > 0 ? `Square shows ${formatMinor(check.refundedInSquareMinor, sale.currency)} of this sale was already refunded there. Note that refund here so your records match.` : null,
  };
}

/** Why the box cannot be sent as it stands, or null; and the body it sends. */
export function saleRefundBody(sale, draft) {
  const amountMinor = priceToMinor(draft.amount, sale.currency);
  if (amountMinor === null || amountMinor <= 0) {
    const decimals = currencyDecimals(sale.currency) ?? 2;
    return { problem: decimals === 0 ? 'Type the amount you gave back, as a whole number.' : 'Type the amount you gave back, like 20 or 20.50.', body: null };
  }
  const left = refundableMinor(sale);
  if (amountMinor > left) return { problem: `That is more than can be refunded. ${formatMinor(left, sale.currency)} is the most.`, body: null };
  if (draft.method === '') return { problem: 'Pick how you gave it back.', body: null };
  if (draft.reason === '') return { problem: 'Pick why it was refunded.', body: null };
  const restock = asksRestock(sale) ? Number(draft.restock) : 0;
  return { problem: null, body: { requestKey: draft.requestKey, amountMinor, method: draft.method, reason: draft.reason, restock } };
}

/** Said in the sale's own place once the refund is noted. */
export function saleRefundedWords(sale, body, receiptNumber) {
  const shelf = body.restock > 0 ? ` ${String(body.restock)} went back on the shelf.` : '';
  return `Refund noted: ${formatMinor(body.amountMinor, sale.currency)} back on the sale of ${String(sale.quantity)} × ${sale.itemName}.${shelf} Its receipt is #${String(receiptNumber)}.`;
}

/** A product of a sale of several (18q), as Refund sale offers it: what is left to refund on it. */
export function refundLineOption(sale) {
  return `${String(sale.quantity)} × ${sale.itemName} · ${formatMinor(refundableMinor(sale), sale.currency)} can be refunded`;
}

/** A sale's refunds, those that stand and those voided, in the order they were noted. `named`:
 *  the sale has several products, so each refund says which it was for (18q). */
export function saleRefundLines(sale, named = false) {
  return (sale.refunds ?? []).map((r) => ({
    id: r.id,
    receiptNumber: r.receiptNumber,
    amount: `${formatMinor(r.amountMinor, sale.currency)} ${r.square?.state === 'pending' && r.voided === null ? 'refund pending' : 'refunded'}`,
    money: formatMinor(r.amountMinor, sale.currency),
    // Sent to the card through Square: never voided here.
    toCard: r.method === 'terminal',
    note: r.square?.late === true ? CARD_REFUND_LATE_LINE : null,
    detail: joined([
      named ? sale.itemName : null,
      r.square?.card === null || r.square?.card === undefined ? methodWords(r.method) : `${methodWords(r.method)}, ${cardName(r.square.card)}`,
      shortDay(r.refundedOn),
      SALE_REFUND_REASON_WORDS[r.reason] ?? null,
      r.restocked > 0 ? `${String(r.restocked)} back on the shelf` : null,
      r.by === null ? null : `by ${r.by}`,
    ]),
    voided: r.voided === null ? null : voidedLine(r.voided, REFUND_VOID_REASON_WORDS),
  }));
}

/** Said under a sale while a refund to its card has no answer, or never had one. */
export const saleOpenLine = (sale) => (sale.cardRefund === null || sale.cardRefund === undefined ? null : cardRefundOpenLine(sale.cardRefund, sale.currency));

/** Whether anything on this list is waiting on Square: a refund it has not answered or not finished. */
export function salesWaitOnSquare(sales) {
  return (sales ?? []).some((s) => (s.cardRefund !== null && s.cardRefund !== undefined && !s.cardRefund.lost) || (s.refunds ?? []).some((r) => r.voided === null && r.square?.state === 'pending'));
}

/** What the sentence under a sale says now: it follows the refund it is about, by that press, as Square moves it on. */
export function saleSaidNow(done, basket, readSince) {
  const sent = done.sent ?? null;
  if (sent === null) return done.words;
  // Its lines share one Square payment, and one press can be on all of them.
  const lines = basket?.lines ?? [];
  const refunds = lines.flatMap((l) => l.refunds ?? []);
  const payment = { refunds: refunds.filter((r) => r.voided === null), voidedRefunds: refunds.filter((r) => r.voided !== null), cardRefund: lines.find((l) => (l.cardRefund ?? null) !== null)?.cardRefund ?? null };
  return cardRefundSaidNow(sent, payment, done.words, readSince);
}

/** The Void refund box: what is voided, what changes, and its done line. */
export function voidSaleRefundWords(sale, refundId) {
  const refund = (sale.refunds ?? []).find((r) => r.id === refundId) ?? null;
  const what = refund === null ? 'this refund' : `the ${formatMinor(refund.amountMinor, sale.currency)} refund noted on ${shortDay(refund.refundedOn)}`;
  const shelf = refund !== null && refund.restocked > 0 ? ` ${String(refund.restocked)} will come off the shelf count again.` : '';
  return {
    question: `Void ${what}? It will no longer count, and the sale counts that much again.${shelf} It stays in the list crossed out.`,
    done: `Refund voided. The sale counts ${refund === null ? 'it' : formatMinor(refund.amountMinor, sale.currency)} again.`,
  };
}
