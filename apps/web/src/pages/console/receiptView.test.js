import { describe, expect, it } from 'vitest';
import { orgWords } from '@app/shared';
import { cancelledLine, noAddressLine, receiptButtonLabel, receiptDay, receiptLines, receiptNotes, receiptPerson, receiptTitle } from './receiptView';

// A RECEIPT'S WORDS (ROADMAP 18g-i): every line a printed receipt says, from what the
// server sends. Amounts are worked by hand: Texas's 8.25% on $50.00 is $4.13; India's GST
// of 18% inside ₹2,000.00 is ₹305.08 of it.

const common = { number: 12, gym: { name: 'Iron Works', address: '12 High Street' }, on: '2026-10-15', person: 'Maya Patel', by: 'Sam', currency: 'USD', cancelled: false };
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
  });

  it('a receipt taken back says Cancelled, in words for what it was', () => {
    expect(cancelledLine(payment())).toBeNull();
    expect(cancelledLine(payment({ cancelled: true }))).toBe('Cancelled. This payment was taken back, so nothing was paid on it.');
    expect(cancelledLine(sale({ cancelled: true }))).toBe('Cancelled. This sale was undone, so nothing was paid on it.');
    expect(cancelledLine(refund({ cancelled: true }))).toBe('Cancelled. This refund was taken back, so nothing was given back on it.');
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
