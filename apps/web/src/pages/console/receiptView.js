import { MEMBER_PAYMENT_METHOD_WORDS, bpToTaxRateText, formatMinor } from '@app/shared';
import { billDays, shortDay } from './memberBillsView';

// A RECEIPT'S WORDS (spec Part 3 §14.3; ROADMAP 18g-i). Every line a receipt prints is made
// here from what the server sent; the box only draws them. A receipt is what a front desk
// hands over: the gym, its number and day, who it is for, what was bought and what it came
// to, how it was paid and who took it.

const methodWords = (method) => MEMBER_PAYMENT_METHOD_WORDS[method] ?? String(method);
const lower = (words) => `${words.charAt(0).toLowerCase()}${words.slice(1)}`;

/** "Receipt #12", or "Refund receipt #13". */
export function receiptTitle(receipt) {
  return `${receipt.kind === 'refund' ? 'Refund receipt' : 'Receipt'} #${String(receipt.number)}`;
}

/** What the button that opens one says, and who it is for, for a screen reader. */
export const RECEIPT_BUTTON = 'View receipt';
export function receiptButtonLabel(number, what) {
  return `View receipt #${String(number)}${what ? ` for ${what}` : ''}`;
}

/** Said at the top of a receipt staff took back: its number stands, and nothing is owed on it. */
export function cancelledLine(receipt) {
  if (!receipt.cancelled) return null;
  if (receipt.kind === 'sale') return 'Cancelled. This sale was undone, so nothing was paid on it.';
  if (receipt.kind === 'refund') return 'Cancelled. This refund was taken back, so nothing was given back on it.';
  return 'Cancelled. This payment was taken back, so nothing was paid on it.';
}

/** "Gold Monthly, 15 Oct – 14 Nov 2026": the membership type by its own name (which may
 *  already say "membership"), and the days paid for; a membership of one period has none. */
const membershipLabel = (item) => (item.covers === null ? item.name : `${item.name}, ${billDays(item.covers)}`);

const tax = (t) => `${t.name ?? 'Tax'} ${bpToTaxRateText(t.bp)}%`;

/** The lines of a receipt, top to bottom: each a label and, where it has one, an amount.
 *  `strong` is the line that says what was paid or given back. */
export function receiptLines(receipt) {
  const money = (minor) => formatMinor(minor, receipt.currency);
  const lines = [];
  if (receipt.kind === 'refund') {
    lines.push({ label: `Refund for receipt #${String(receipt.forReceipt)}`, amount: null });
    lines.push({ label: membershipLabel(receipt.item), amount: null });
    lines.push({ label: `Given back by ${lower(methodWords(receipt.method))}`, amount: money(receipt.refundedMinor), strong: true });
    return lines;
  }
  const { amounts } = receipt;
  if (receipt.kind === 'sale') {
    const each = receipt.item.quantity > 1 ? ` at ${money(receipt.item.unitPriceMinor)} each` : '';
    lines.push({ label: `${String(receipt.item.quantity)} × ${receipt.item.name}${each}`, amount: money(amounts.listedMinor) });
  } else {
    lines.push({ label: membershipLabel(receipt.item), amount: money(amounts.listedMinor) });
  }
  if (amounts.discount !== null) lines.push({ label: `Discount: ${amounts.discount.name}`, amount: `−${money(amounts.discount.minor)}` });
  if (amounts.tax !== null && !amounts.tax.included) lines.push({ label: tax(amounts.tax), amount: money(amounts.tax.minor) });
  lines.push({ label: receipt.kind === 'payment' && receipt.balance !== null ? 'Bill total' : 'Total', amount: money(amounts.totalMinor), total: true });
  if (amounts.tax !== null && amounts.tax.included) lines.push({ label: `Includes ${tax(amounts.tax)}`, amount: money(amounts.tax.minor) });
  if (receipt.kind === 'sale') {
    lines.push({ label: `Paid by ${lower(methodWords(receipt.method))}`, amount: money(amounts.totalMinor), strong: true });
    return lines;
  }
  if (receipt.balance !== null && receipt.balance.paidBeforeMinor > 0) lines.push({ label: 'Paid before', amount: money(receipt.balance.paidBeforeMinor) });
  lines.push({ label: `Paid by ${lower(methodWords(receipt.method))}`, amount: money(receipt.paidMinor), strong: true });
  if (receipt.balance !== null) lines.push({ label: 'Left to pay', amount: money(receipt.balance.leftMinor) });
  return lines;
}

/** The notes under the lines: the refunds noted against a payment, and who took it. */
export function receiptNotes(receipt) {
  const money = (minor) => formatMinor(minor, receipt.currency);
  const notes = [];
  if (receipt.kind === 'payment') {
    for (const r of receipt.refunds) notes.push(`${money(r.amountMinor)} given back on ${shortDay(r.on)} (refund receipt #${String(r.number)}).`);
  }
  if (receipt.by !== null) notes.push(`${receipt.kind === 'refund' ? 'Given back' : 'Taken'} by ${receipt.by}.`);
  return notes;
}

/** Who it is for: their name, or a walk-in. */
export function receiptPerson(receipt) {
  return receipt.person === null ? 'Walk-in' : receipt.person;
}

/** "15 Oct 2026". */
export function receiptDay(receipt) {
  return shortDay(receipt.on);
}

/** Said where the gym has typed no postal address: a receipt is printed without one. */
export function noAddressLine(words) {
  return `Your ${words.it}'s address is not on its receipts yet.`;
}
