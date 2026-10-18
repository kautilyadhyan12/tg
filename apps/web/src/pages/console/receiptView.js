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

/** Said at the top of a receipt staff voided: its number stands, and it no longer counts. */
export function cancelledLine(receipt) {
  if (!receipt.cancelled) return null;
  if (receipt.kind === 'sale') return 'Voided. This sale no longer counts.';
  if (receipt.kind === 'refund') return 'Voided. This refund no longer counts.';
  return 'Voided. This payment no longer counts.';
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
  if (receipt.kind === 'sale' && receipt.lines.length > 1) return basketLines(receipt, money);
  const amounts = receipt.kind === 'sale' ? receipt.lines[0].amounts : receipt.amounts;
  if (receipt.kind === 'sale') {
    lines.push(productLine(receipt.lines[0], money));
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

const productLine = (line, money) => {
  const each = line.quantity > 1 ? ` at ${money(line.unitPriceMinor)} each` : '';
  return { label: `${String(line.quantity)} × ${line.name}${each}`, amount: money(line.amounts.listedMinor) };
};

/** A sale of several products (18q), as a till's slip: each product with its discount under
 *  it, what they come to and each tax added on top by its rate, the total, each tax inside
 *  the prices, and how it was paid. */
function basketLines(receipt, money) {
  const lines = [];
  const taxes = new Map();
  let subtotal = 0;
  for (const line of receipt.lines) {
    const { amounts } = line;
    lines.push(productLine(line, money));
    if (amounts.discount !== null) lines.push({ label: `Discount: ${amounts.discount.name}`, amount: `−${money(amounts.discount.minor)}` });
    subtotal += amounts.tax !== null && !amounts.tax.included ? amounts.totalMinor - amounts.tax.minor : amounts.totalMinor;
    if (amounts.tax !== null) {
      const key = `${amounts.tax.included ? 'in' : 'on'} ${tax(amounts.tax)}`;
      taxes.set(key, { tax: amounts.tax, minor: (taxes.get(key)?.minor ?? 0) + amounts.tax.minor });
    }
  }
  const onTop = [...taxes.values()].filter((t) => !t.tax.included);
  const inside = [...taxes.values()].filter((t) => t.tax.included);
  if (onTop.length > 0) {
    lines.push({ label: 'Subtotal', amount: money(subtotal) });
    for (const t of onTop) lines.push({ label: tax(t.tax), amount: money(t.minor) });
  }
  lines.push({ label: 'Total', amount: money(receipt.totalMinor), total: true });
  for (const t of inside) lines.push({ label: `Includes ${tax(t.tax)}`, amount: money(t.minor) });
  lines.push({ label: `Paid by ${lower(methodWords(receipt.method))}`, amount: money(receipt.totalMinor), strong: true });
  return lines;
}

/** The notes under the lines: the refunds noted against a payment or a sale (18p), and who took it. */
export function receiptNotes(receipt) {
  const money = (minor) => formatMinor(minor, receipt.currency);
  const notes = [];
  if (receipt.kind === 'payment' || receipt.kind === 'sale') {
    for (const r of receipt.refunds ?? []) {
      const what = typeof r.item === 'string' ? ` for ${r.item}` : '';
      notes.push(`${money(r.amountMinor)} given back${what} on ${shortDay(r.on)} (refund receipt #${String(r.number)}).`);
    }
  }
  if (receipt.by !== null) notes.push(`${receipt.kind === 'refund' ? 'Given back' : 'Taken'} by ${receipt.by}.`);
  return notes;
}

/** Who it is for: their name, a walk-in, or somebody whose record was deleted for good. */
export function receiptPerson(receipt) {
  if (receipt.person !== null) return receipt.person;
  return receipt.personDeleted ? 'A deleted member' : 'Walk-in';
}

/** Who paid, where somebody else on the gym's list pays for this person (18i): "Paid by
 *  Priya Sharma", or on a refund "Given back to Priya Sharma". Null where they paid for
 *  themselves, and on a sale. */
export function receiptPayer(receipt) {
  const label = receipt.kind === 'refund' ? 'Given back to' : 'Paid by';
  if (receipt.paidByDeleted === true) return { label, name: 'A deleted member' };
  if (receipt.paidBy === null || receipt.paidBy === undefined) return null;
  const name = receipt.paidBy.trim() === '' ? 'No name on their record' : receipt.paidBy;
  return { label, name };
}

/** "15 Oct 2026". */
export function receiptDay(receipt) {
  return shortDay(receipt.on);
}

/** Said where the gym has typed no postal address: a receipt is printed without one. */
export function noAddressLine(words) {
  return `Your ${words.it}'s address is not on its receipts yet.`;
}

// ── The receipt on paper ─────────────────────────────────────────────────────

const escapeHtml = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** The paper's own stylesheet: a receipt as a front desk prints it, on A4, Letter or a
 *  receipt printer's roll alike. Nothing of the console's is used, so neither look reaches it. */
const PAPER_CSS = `
@page { margin: 14mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #111; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; line-height: 1.35; }
.r { max-width: 110mm; margin: 0 auto; }
.head { text-align: center; padding-bottom: 8pt; border-bottom: 1.5pt solid #111; }
.gym { font-size: 16pt; font-weight: 700; }
.addr { margin-top: 2pt; font-size: 9.5pt; color: #333; white-space: pre-line; }
.kind { margin-top: 8pt; font-size: 11pt; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }
.cancel { margin-top: 8pt; padding: 5pt 6pt; border: 1.5pt solid #111; text-align: center; font-weight: 700; }
table { width: 100%; border-collapse: collapse; }
.meta { margin: 8pt 0 10pt; font-size: 10pt; }
.meta td { padding: 1.5pt 0; vertical-align: top; }
.meta td + td { text-align: right; }
.items th { padding: 0 0 4pt; border-bottom: 1pt solid #111; font-size: 8.5pt; font-weight: 700; letter-spacing: 0.06em; text-align: left; text-transform: uppercase; }
.items td { padding: 4pt 0; vertical-align: top; }
.items .amt { padding-left: 10pt; text-align: right; white-space: nowrap; }
.items tr.total td { padding-top: 6pt; border-top: 1pt solid #111; font-size: 12.5pt; font-weight: 700; }
.items tr.strong td { font-weight: 700; }
.items tr.plain td { padding-top: 1pt; padding-bottom: 1pt; font-size: 9.5pt; color: #333; }
.notes { margin-top: 10pt; padding-top: 6pt; border-top: 0.75pt solid #bbb; font-size: 9.5pt; color: #333; }
.notes p { margin: 0 0 2pt; }
.foot { margin-top: 14pt; padding-top: 6pt; border-top: 0.75pt dashed #999; font-size: 9.5pt; color: #333; text-align: center; }
`;

/** The receipt as a page of its own, to print or save as a PDF: the gym at the top, the
 *  receipt's number, day and who it is for, its lines with their amounts, then its notes.
 *  The same lines the box on screen draws (`receiptLines`), so the two never differ. */
export function receiptPrintHtml(receipt) {
  const e = escapeHtml;
  const rows = receiptLines(receipt)
    .map((line) => {
      if (line.amount === null) return `<tr class="plain"><td colspan="2">${e(line.label)}</td></tr>`;
      const kind = line.total ? 'total' : line.strong ? 'strong' : /^Includes /.test(line.label) ? 'plain' : '';
      return `<tr${kind === '' ? '' : ` class="${kind}"`}><td>${e(line.label)}</td><td class="amt">${e(line.amount)}</td></tr>`;
    })
    .join('');
  const cancelled = cancelledLine(receipt);
  const notes = receiptNotes(receipt);
  const payer = receiptPayer(receipt);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${e(`${receiptTitle(receipt)} · ${receipt.gym.name}`)}</title><style>${PAPER_CSS}</style></head><body><div class="r">
<div class="head"><div class="gym">${e(receipt.gym.name)}</div>${receipt.gym.address === null ? '' : `<div class="addr">${e(receipt.gym.address)}</div>`}<div class="kind">${receipt.kind === 'refund' ? 'Refund receipt' : 'Receipt'}</div></div>
${cancelled === null ? '' : `<div class="cancel">${e(cancelled)}</div>`}
<table class="meta"><tr><td>Receipt no.</td><td>${e(String(receipt.number))}</td></tr><tr><td>Date</td><td>${e(receiptDay(receipt))}</td></tr><tr><td>For</td><td>${e(receiptPerson(receipt))}</td></tr>${payer === null ? '' : `<tr><td>${e(payer.label)}</td><td>${e(payer.name)}</td></tr>`}</table>
<table class="items"><thead><tr><th>Description</th><th class="amt">Amount</th></tr></thead><tbody>${rows}</tbody></table>
${notes.length === 0 ? '' : `<div class="notes">${notes.map((n) => `<p>${e(n)}</p>`).join('')}</div>`}
<div class="foot">Thank you.</div>
</div></body></html>`;
}
