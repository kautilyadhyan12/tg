import {
  MEMBER_PAYMENT_METHOD_WORDS,
  REFUND_VOID_REASONS,
  REFUND_VOID_REASON_WORDS,
  SALE_REFUND_REASONS,
  SALE_REFUND_REASON_WORDS,
  currencyDecimals,
  formatMinor,
  minorToPriceText,
  priceToMinor,
} from '@app/shared';
import { shortDay, voidedLine } from './memberBillsView';

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
  return { requestKey: newKey(), amount: minorToPriceText(refundableMinor(sale), sale.currency), method: sale.method, reason: '', restock: '0', tried: false };
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

/** A sale's refunds, those that stand and those voided, in the order they were noted. */
export function saleRefundLines(sale) {
  return (sale.refunds ?? []).map((r) => ({
    id: r.id,
    receiptNumber: r.receiptNumber,
    amount: `${formatMinor(r.amountMinor, sale.currency)} refunded`,
    money: formatMinor(r.amountMinor, sale.currency),
    detail: joined([
      methodWords(r.method),
      shortDay(r.refundedOn),
      SALE_REFUND_REASON_WORDS[r.reason] ?? null,
      r.restocked > 0 ? `${String(r.restocked)} back on the shelf` : null,
      r.by === null ? null : `by ${r.by}`,
    ]),
    voided: r.voided === null ? null : voidedLine(r.voided, REFUND_VOID_REASON_WORDS),
  }));
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
