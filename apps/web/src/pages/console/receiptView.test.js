import { describe, expect, it } from 'vitest';
import { orgWords } from '@app/shared';
import { cancelledLine, noAddressLine, receiptButtonLabel, receiptDay, receiptLines, receiptNotes, receiptPerson, receiptPrintHtml, receiptTitle } from './receiptView';

// A RECEIPT'S WORDS (ROADMAP 18g-i): every line a printed receipt says, from what the
// server sends. Amounts are worked by hand: Texas's 8.25% on $50.00 is $4.13; India's GST
// of 18% inside ₹2,000.00 is ₹305.08 of it.

const common = { number: 12, gym: { name: 'Iron Works', address: '12 High Street' }, on: '2026-10-15', person: 'Maya Patel', personDeleted: false, by: 'Sam', currency: 'USD', cancelled: false };
const payment = (over = {}) => ({
  ...common,
  kind: 'payment',
  item: { name: 'Gold Monthly', covers: { from: '2026-10-15', to: '2026-11-14' } },
  amounts: { listedMinor: 5000, discount: null, tax: { name: 'Sales tax', bp: 825, included: false, minor: 413 }, totalMinor: 5413 },
  paidMinor: 5413,
  method: 'cash',
  balance: null,
  refunds: [],
  ...over,
});
const sale = (over = {}) => ({
  ...common,
  kind: 'sale',
  person: null,
  item: { name: 'Water', quantity: 2, unitPriceMinor: 250 },
  amounts: { listedMinor: 500, discount: { name: 'Staff 20', minor: 100 }, tax: { name: 'Sales tax', bp: 825, included: false, minor: 33 }, totalMinor: 433 },
  method: 'card_at_desk',
  ...over,
});
const refund = (over = {}) => ({
  ...common,
  number: 13,
  kind: 'refund',
  forReceipt: 12,
  item: { name: 'Gold Monthly', covers: { from: '2026-10-15', to: '2026-11-14' } },
  refundedMinor: 1000,
  method: 'bank_transfer',
  ...over,
});
const drawn = (receipt) => receiptLines(receipt).map((l) => (l.amount === null ? l.label : `${l.label} | ${l.amount}`));

describe('receiptLines', () => {
  it('a membership sold with a discount: its full price, the discount, the tax on what was left', () => {
    const off = payment({ amounts: { listedMinor: 5000, discount: { name: 'First month 20', minor: 1000 }, tax: { name: 'Sales tax', bp: 825, included: false, minor: 330 }, totalMinor: 4330 }, paidMinor: 4330 });
    expect(drawn(off)).toEqual([
      'Gold Monthly, 15 Oct – 14 Nov 2026 | $50.00',
      'Discount: First month 20 | −$10.00',
      'Sales tax 8.25% | $3.30',
      'Total | $43.30',
      'Paid by cash | $43.30',
    ]);
  });

  it('a membership paid in full, tax added on top: the price, the tax, the total and how it was paid', () => {
    expect(drawn(payment())).toEqual([
      'Gold Monthly, 15 Oct – 14 Nov 2026 | $50.00',
      'Sales tax 8.25% | $4.13',
      'Total | $54.13',
      'Paid by cash | $54.13',
    ]);
  });

  it('tax inside the price is said under the total, never added to it', () => {
    const gst = payment({
      currency: 'INR',
      amounts: { listedMinor: 200000, discount: null, tax: { name: 'GST', bp: 1800, included: true, minor: 30508 }, totalMinor: 200000 },
      paidMinor: 200000,
      method: 'bank_transfer',
    });
    expect(drawn(gst)).toEqual([
      'Gold Monthly, 15 Oct – 14 Nov 2026 | ₹2,000.00',
      'Total | ₹2,000.00',
      'Includes GST 18% | ₹305.08',
      'Paid by bank transfer | ₹2,000.00',
    ]);
  });

  it('a bill paid in parts says what was paid before and what is left', () => {
    const first = payment({ amounts: { listedMinor: 6000, discount: null, tax: null, totalMinor: 6000 }, paidMinor: 2000, balance: { paidBeforeMinor: 0, leftMinor: 4000 } });
    expect(drawn(first)).toEqual(['Gold Monthly, 15 Oct – 14 Nov 2026 | $60.00', 'Bill total | $60.00', 'Paid by cash | $20.00', 'Left to pay | $40.00']);
    const last = payment({ amounts: { listedMinor: 6000, discount: null, tax: null, totalMinor: 6000 }, paidMinor: 4000, balance: { paidBeforeMinor: 2000, leftMinor: 0 } });
    expect(drawn(last)).toEqual(['Gold Monthly, 15 Oct – 14 Nov 2026 | $60.00', 'Bill total | $60.00', 'Paid before | $20.00', 'Paid by cash | $40.00', 'Left to pay | $0.00']);
  });

  it('a membership of one period says so', () => {
    expect(drawn(payment({ item: { name: 'Day pass', covers: null } }))[0]).toBe('Day pass | $50.00');
  });

  it('a sale: how many at what each, the discount, the tax, the total and how it was paid', () => {
    expect(drawn(sale())).toEqual([
      '2 × Water at $2.50 each | $5.00',
      'Discount: Staff 20 | −$1.00',
      'Sales tax 8.25% | $0.33',
      'Total | $4.33',
      'Paid by card at the desk | $4.33',
    ]);
    expect(drawn(sale({ item: { name: 'Water', quantity: 1, unitPriceMinor: 250 }, amounts: { listedMinor: 250, discount: null, tax: null, totalMinor: 250 }, method: 'cash' }))).toEqual([
      '1 × Water | $2.50',
      'Total | $2.50',
      'Paid by cash | $2.50',
    ]);
  });

  it('a refund: which receipt it gives back for, and how much', () => {
    expect(drawn(refund())).toEqual(['Refund for receipt #12', 'Gold Monthly, 15 Oct – 14 Nov 2026', 'Given back by bank transfer | $10.00']);
  });
});

describe('the rest of a receipt', () => {
  it('its title, day and who it is for', () => {
    expect(receiptTitle(payment())).toBe('Receipt #12');
    expect(receiptTitle(refund())).toBe('Refund receipt #13');
    expect(receiptDay(payment())).toBe('15 Oct 2026');
    expect(receiptPerson(payment())).toBe('Maya Patel');
    expect(receiptPerson(sale())).toBe('Walk-in');
    // Sold to somebody whose record was deleted for good: theirs, never a walk-in's.
    expect(receiptPerson(sale({ personDeleted: true }))).toBe('A deleted member');
  });

  it('a receipt voided says Voided, in words for what it was', () => {
    expect(cancelledLine(payment())).toBeNull();
    expect(cancelledLine(payment({ cancelled: true }))).toBe('Voided. This payment was voided, so nothing was paid on it.');
    expect(cancelledLine(sale({ cancelled: true }))).toBe('Voided. This sale was voided, so nothing was paid on it.');
    expect(cancelledLine(refund({ cancelled: true }))).toBe('Voided. This refund was voided, so nothing was given back on it.');
  });

  it('the notes: refunds against a payment, and who took it', () => {
    expect(receiptNotes(payment({ refunds: [{ number: 13, on: '2026-10-16', amountMinor: 1000 }] }))).toEqual(['$10.00 given back on 16 Oct 2026 (refund receipt #13).', 'Taken by Sam.']);
    expect(receiptNotes(refund())).toEqual(['Given back by Sam.']);
    expect(receiptNotes(sale({ by: null }))).toEqual([]);
  });

  it("the button says what it opens and whose it is; a gym with no address is told in its own word", () => {
    expect(receiptButtonLabel(12, '2 × Water')).toBe('View receipt #12 for 2 × Water');
    expect(noAddressLine(orgWords('gym'))).toBe("Your gym's address is not on its receipts yet.");
    expect(noAddressLine(orgWords('studio'))).toBe("Your studio's address is not on its receipts yet.");
  });
});

describe('the receipt on paper', () => {
  it('is a page of its own: the gym, the number, the day, who for, the lines with their amounts, the notes', () => {
    const html = receiptPrintHtml(payment({ refunds: [{ number: 13, on: '2026-10-16', amountMinor: 1000 }] }));
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>Receipt #12 · Iron Works</title>');
    expect(html).toContain('<div class="gym">Iron Works</div><div class="addr">12 High Street</div><div class="kind">Receipt</div>');
    expect(html).toContain('<tr><td>Receipt no.</td><td>12</td></tr><tr><td>Date</td><td>15 Oct 2026</td></tr><tr><td>For</td><td>Maya Patel</td></tr>');
    expect(html).toContain(
      '<tbody><tr><td>Gold Monthly, 15 Oct – 14 Nov 2026</td><td class="amt">$50.00</td></tr><tr><td>Sales tax 8.25%</td><td class="amt">$4.13</td></tr><tr class="total"><td>Total</td><td class="amt">$54.13</td></tr><tr class="strong"><td>Paid by cash</td><td class="amt">$54.13</td></tr></tbody>',
    );
    expect(html).toContain('<div class="notes"><p>$10.00 given back on 16 Oct 2026 (refund receipt #13).</p><p>Taken by Sam.</p></div>');
    expect(html).not.toContain('class="cancel"');
  });

  it('a refund is headed Refund receipt; a gym with no address prints none; tax in the price is a quiet line', () => {
    const html = receiptPrintHtml(refund({ gym: { name: 'Iron Works', address: null } }));
    expect(html).toContain('<div class="gym">Iron Works</div><div class="kind">Refund receipt</div>');
    expect(html).toContain('<tr class="plain"><td colspan="2">Refund for receipt #12</td></tr>');
    const gst = receiptPrintHtml(
      payment({ amounts: { listedMinor: 5000, discount: null, tax: { name: 'GST', bp: 1800, included: true, minor: 763 }, totalMinor: 5000 }, paidMinor: 5000 }),
    );
    expect(gst).toContain('<tr class="plain"><td>Includes GST 18%</td><td class="amt">$7.63</td></tr>');
  });

  it('a receipt voided says so at the top', () => {
    expect(receiptPrintHtml(sale({ cancelled: true }))).toContain('<div class="cancel">Voided. This sale was voided, so nothing was paid on it.</div>');
  });

  it("what staff or a member typed is printed as words, never as the page's own markup", () => {
    const html = receiptPrintHtml(sale({ person: '<img src=x onerror=alert(1)>', gym: { name: 'Tom & Jerry\'s "Gym"', address: '<b>1</b>' }, item: { name: '</td><script>x</script>', quantity: 1, unitPriceMinor: 250 } }));
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>1</b>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('Tom &amp; Jerry&#39;s &quot;Gym&quot;');
  });
});
