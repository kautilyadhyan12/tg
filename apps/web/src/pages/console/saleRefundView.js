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

const wholeSold = (basket, who) => {
  const first = basket.first;
  return `Sold on ${shortDay(first.soldOn)} ${who === null ? 'to a walk-in' : `to ${who}`} for ${formatMinor(basket.totalMinor, first.currency)}.`;
};

/** What the Refund to card box says on all of a sale. Money refunded inside Square never reaches it: the server stops that first. */
export function wholeCardRefundWords(basket, lines, who) {
  const left = wholeLeftMinor(lines);
  const some = left < basket.totalMinor ? ` ${formatMinor(left, basket.first.currency)} of it can still be refunded.` : '';
  return { title: 'Refund all of this sale to the card', detail: `${wholeSold(basket, who)}${some} ${CARD_REFUND_WORDS.fee} ${CARD_REFUND_WORDS.days}`, inSquare: null };
}

/** What the Note a refund box says on all of a sale: it has no amount to type, so it says the amount. */
export const wholeNoteWords = (basket, lines, who) => ({
  title: 'Refund all of this sale',
  detail: `${wholeSold(basket, who)} ${formatMinor(wholeLeftMinor(lines), basket.first.currency)} will be noted as refunded. This only writes the refund in your records: give the money back yourself.`,
});

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
    inSquare: check.refundedInSquareMinor > 0 ? `Square shows ${formatMinor(check.refundedInSquareMinor, sale.currency)} of this sale was already refunded there. It will appear here by itself within the hour.` : null,
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

export const IN_SQUARE_STOCK_LINE = 'Square does not say whether this product came back. If it did, change its stock count.';

/** What is waiting on staff on a sale: refunds made in Square with no product said. */
export const placeLines = (basket) => (basket?.lines ?? []).flatMap((line) => line.toPlace ?? []);

/** Said on the sale, and on Overview: the money has gone, and which product is the one thing the app cannot know. */
export const placeLine = (amountMinor, currency) => `Square refunded ${formatMinor(amountMinor, currency)} of this sale. Which product was it for? It counts in your reports once you choose.`;

/** The products that can take all of it on their own. */
export const placeChoices = (lines, amountMinor) => lines.filter((line) => line.undone !== true && refundableMinor(line) >= amountMinor);

export const SEVERAL = 'several';

/** Why the Choose product box cannot be sent as it stands, or null; and the body it sends. */
export function placeBody(lines, amountMinor, currency, draft) {
  const shelf = (id) => Number(draft.shelf[id] ?? '0');
  if (draft.pick !== SEVERAL) {
    if (draft.pick === '') return { problem: 'Pick the product.', body: null };
    return { problem: null, body: { parts: [{ saleId: draft.pick, amountMinor, restock: shelf(draft.pick) }] } };
  }
  const parts = [];
  for (const line of lines) {
    const typed = (draft.amounts[line.id] ?? '').trim();
    if (typed === '') continue;
    const minor = priceToMinor(typed, currency);
    if (minor === null || minor < 0) return { problem: `Type the amount for ${line.itemName}, like 20 or 20.50.`, body: null };
    if (minor > 0) parts.push({ saleId: line.id, amountMinor: minor, restock: shelf(line.id) });
  }
  const total = parts.reduce((n, p) => n + p.amountMinor, 0);
  if (total !== amountMinor) return { problem: `The amounts must add up to ${formatMinor(amountMinor, currency)}. They add up to ${formatMinor(total, currency)}.`, body: null };
  return { problem: null, body: { parts } };
}

/** Said in the sale's own place once it is chosen. */
export function placedWords(lines, body, currency, receiptNumbers) {
  const money = formatMinor(body.parts.reduce((n, p) => n + p.amountMinor, 0), currency);
  const numbers = receiptNumbers.map((n) => `#${String(n)}`);
  const receipts = numbers.length === 1 ? `Its receipt is ${numbers[0]}` : `Its receipts are ${numbers.join(', ')}`;
  const [only] = body.parts;
  const name = body.parts.length === 1 ? (lines.find((l) => l.id === only.saleId)?.itemName ?? 'that product') : `${String(body.parts.length)} products`;
  return `The ${money} refund is now on ${name}. ${receipts}.`;
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
    // Square cannot say whether the product came back.
    stockNote: r.square?.inSquare === true && r.voided === null && sale.stockCounted === true && r.restocked === 0 ? IN_SQUARE_STOCK_LINE : null,
    // Made inside Square: Square says neither why nor who.
    detail: r.square?.inSquare === true ? joined([
      named ? sale.itemName : null,
      r.square.card === null ? 'Refunded in Square' : `Refunded in Square to ${cardName(r.square.card)}`,
      shortDay(r.refundedOn),
      r.restocked > 0 ? `${String(r.restocked)} back on the shelf` : null,
    ]) : joined([
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
