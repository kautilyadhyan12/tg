import { describe, expect, it } from 'vitest';
import { orgWords } from '@app/shared';
import { cancelledLine, noAddressLine, receiptButtonLabel, receiptDay, receiptLines, receiptNotes, receiptPayer, receiptPerson, receiptPrintHtml, receiptTitle } from './receiptView';

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
  lines: [{ name: 'Water', quantity: 2, unitPriceMinor: 250, amounts: { listedMinor: 500, discount: { name: 'Staff 20', minor: 100 }, tax: { name: 'Sales tax', bp: 825, included: false, minor: 33 }, totalMinor: 433 } }],
  totalMinor: 433,
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
    expect(drawn({ ...gst, method: 'upi' }).at(-1)).toBe('Paid by UPI | ₹2,000.00');
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
    expect(drawn(sale({ lines: [{ name: 'Water', quantity: 1, unitPriceMinor: 250, amounts: { listedMinor: 250, discount: null, tax: null, totalMinor: 250 } }], totalMinor: 250, method: 'cash' }))).toEqual([
      '1 × Water | $2.50',
      'Total | $2.50',
      'Paid by cash | $2.50',
    ]);
  });

  it('a refund: which receipt it gives back for, and how much', () => {
    expect(drawn(refund())).toEqual(['Refund for receipt #12', 'Gold Monthly, 15 Oct – 14 Nov 2026', 'Given back by bank transfer | $10.00']);
  });

  it("a refund of a sale at the desk (18p): the sale's receipt and the product", () => {
    expect(drawn(refund({ forReceipt: 41, item: { name: 'Protein tub', covers: null }, method: 'cash', refundedMinor: 2500 }))).toEqual(['Refund for receipt #41', 'Protein tub', 'Given back by cash | $25.00']);
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
    expect(cancelledLine(payment({ cancelled: true }))).toBe('Voided. This payment no longer counts.');
    expect(cancelledLine(sale({ cancelled: true }))).toBe('Voided. This sale no longer counts.');
    expect(cancelledLine(refund({ cancelled: true }))).toBe('Voided. This refund no longer counts.');
  });

  it('the notes: refunds against a payment, and who took it', () => {
    expect(receiptNotes(payment({ refunds: [{ number: 13, on: '2026-10-16', amountMinor: 1000 }] }))).toEqual(['$10.00 given back on 16 Oct 2026 (refund receipt #13).', 'Taken by Sam.']);
    expect(receiptNotes(refund())).toEqual(['Given back by Sam.']);
    expect(receiptNotes(sale({ by: null }))).toEqual([]);
    expect(receiptNotes(sale({ by: null, refunds: [{ number: 44, on: '2026-10-16', amountMinor: 250 }] }))).toEqual(['$2.50 given back on 16 Oct 2026 (refund receipt #44).']);
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
    expect(receiptPrintHtml(sale({ cancelled: true }))).toContain('<div class="cancel">Voided. This sale no longer counts.</div>');
  });

  it("what staff or a member typed is printed as words, never as the page's own markup", () => {
    const html = receiptPrintHtml(sale({ person: '<img src=x onerror=alert(1)>', gym: { name: 'Tom & Jerry\'s "Gym"', address: '<b>1</b>' }, lines: [{ name: '</td><script>x</script>', quantity: 1, unitPriceMinor: 250, amounts: { listedMinor: 250, discount: null, tax: null, totalMinor: 250 } }], totalMinor: 250 }));
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>1</b>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('Tom &amp; Jerry&#39;s &quot;Gym&quot;');
  });
});

describe('a sale of several products (18q)', () => {
  const tax = (minor, included = false, name = 'Sales tax', bp = 825) => ({ name, bp, included, minor });
  // Two waters at $2.50 with Staff 20 ($1.00 off) and 8.25% on $4.00 ($0.33); a towel at $5.00
  // with 8.25% ($0.41); a bar at $2.50 with County tax 1% ($0.03). By hand: $4.00 + $5.00 + $2.50
  // = $11.50, tax $0.74 + $0.03, total $12.27.
  const lines = [
    { name: 'Water', quantity: 2, unitPriceMinor: 250, amounts: { listedMinor: 500, discount: { name: 'Staff 20', minor: 100 }, tax: tax(33), totalMinor: 433 } },
    { name: 'Towel', quantity: 1, unitPriceMinor: 500, amounts: { listedMinor: 500, discount: null, tax: tax(41), totalMinor: 541 } },
    { name: 'Protein bar', quantity: 1, unitPriceMinor: 250, amounts: { listedMinor: 250, discount: null, tax: tax(3, false, 'County tax', 100), totalMinor: 253 } },
  ];

  it('prints each product with its discount under it, what they come to, each tax by its rate, one total and how it was paid', () => {
    expect(drawn(sale({ lines, totalMinor: 1227, method: 'cash' }))).toEqual([
      '2 × Water at $2.50 each | $5.00',
      'Discount: Staff 20 | −$1.00',
      '1 × Towel | $5.00',
      '1 × Protein bar | $2.50',
      'Subtotal | $11.50',
      'Sales tax 8.25% | $0.74',
      'County tax 1% | $0.03',
      'Total | $12.27',
      'Paid by cash | $12.27',
    ]);
  });

  it('where the prices hold the tax, says it inside the total, by rate', () => {
    const inside = [
      { name: 'Water', quantity: 1, unitPriceMinor: 200, amounts: { listedMinor: 200, discount: null, tax: tax(15, true, 'VAT', 800), totalMinor: 200 } },
      { name: 'Towel', quantity: 1, unitPriceMinor: 540, amounts: { listedMinor: 540, discount: null, tax: tax(40, true, 'VAT', 800), totalMinor: 540 } },
    ];
    expect(drawn(sale({ lines: inside, totalMinor: 740, method: 'card_at_desk' }))).toEqual(['1 × Water | $2.00', '1 × Towel | $5.40', 'Total | $7.40', 'Includes VAT 8% | $0.55', 'Paid by card at the desk | $7.40']);
  });

  it('a refund names the product it was for', () => {
    const refunded = sale({ lines, totalMinor: 1227, refunds: [{ number: 52, on: '2026-10-16', amountMinor: 541, item: 'Towel' }] });
    expect(receiptNotes(refunded)[0]).toBe('$5.41 given back for Towel on 16 Oct 2026 (refund receipt #52).');
  });
});

describe('who paid, where somebody else pays for the person (18i)', () => {
  it('a payment says Paid by, a refund Given back to, a sale and a person paying for themselves say neither', () => {
    expect(receiptPayer(payment({ paidBy: 'Priya Sharma' }))).toEqual({ label: 'Paid by', name: 'Priya Sharma' });
    expect(receiptPayer(refund({ paidBy: 'Priya Sharma' }))).toEqual({ label: 'Given back to', name: 'Priya Sharma' });
    expect(receiptPayer(payment({ paidBy: '  ' }))).toEqual({ label: 'Paid by', name: 'No name on their record' });
    expect(receiptPayer(payment({ paidBy: null, paidByDeleted: true }))).toEqual({ label: 'Paid by', name: 'A deleted member' });
    expect(receiptPayer(refund({ paidBy: null, paidByDeleted: true }))).toEqual({ label: 'Given back to', name: 'A deleted member' });
    expect(receiptPayer(payment({ paidBy: null }))).toBeNull();
    expect(receiptPayer(payment())).toBeNull();
    expect(receiptPayer(sale({ paidBy: null }))).toBeNull();
  });

  it('the paper names the payer under who it is for, as words', () => {
    const html = receiptPrintHtml(payment({ paidBy: '<b>Priya</b>' }));
    expect(html).toContain('<tr><td>For</td><td>Maya Patel</td></tr><tr><td>Paid by</td><td>&lt;b&gt;Priya&lt;/b&gt;</td></tr></table>');
    expect(receiptPrintHtml(payment())).not.toContain('Paid by</td>');
  });
});
