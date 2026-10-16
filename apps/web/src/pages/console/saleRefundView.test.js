import { describe, expect, it } from 'vitest';
import {
  asksRestock,
  refundableMinor,
  restockChoices,
  restockLeft,
  saleRefundBody,
  saleRefundDraft,
  saleRefundLines,
  saleRefundTag,
  saleRefundWords,
  saleRefundedWords,
  voidSaleRefundWords,
} from './saleRefundView';

const refund = (over = {}) => ({ id: 'rf1', amountMinor: 250, method: 'cash', reason: 'returned', restocked: 1, refundedOn: '2026-10-16', by: 'Priya Desk', receiptNumber: 44, voided: null, ...over });
const sale = (over = {}) => ({ id: 's1', itemName: 'Water', quantity: 3, totalMinor: 750, currency: 'USD', method: 'card_at_desk', soldOn: '2026-10-15', undone: false, stockCounted: true, refunds: [], refundedMinor: 0, ...over });

describe('what is left of a sale', () => {
  it.each([
    ['nothing given back', {}, 750, 3, null],
    ['one of three back, on the shelf', { refundedMinor: 250, refunds: [refund()] }, 500, 2, 'Part refunded'],
    ['all of it', { refundedMinor: 750, refunds: [refund({ amountMinor: 750, restocked: 3 })] }, 0, 0, 'Refunded'],
    ['a voided refund puts nothing on the shelf', { refunds: [refund({ voided: { reason: 'mistake', on: '2026-10-16', by: null } })] }, 750, 3, null],
    ['a voided sale reads Voided, never Refunded', { undone: true, refundedMinor: 750 }, 0, 3, null],
  ])('%s', (_name, over, left, shelf, tag) => {
    expect(refundableMinor(sale(over))).toBe(left);
    expect(restockLeft(sale(over))).toBe(shelf);
    expect(saleRefundTag(sale(over))).toBe(tag);
  });
});

describe('the Refund sale box', () => {
  it('starts with all that is left, given back the way it was paid, and none on the shelf', () => {
    expect(saleRefundDraft(sale({ refundedMinor: 250 }), () => 'k1')).toEqual({ requestKey: 'k1', amount: '5.00', method: 'card_at_desk', reason: '', restock: '0', tried: false });
  });

  it('asks about the shelf only where the sale took from a count and some are not back', () => {
    expect(asksRestock(sale())).toBe(true);
    expect(asksRestock(sale({ stockCounted: false }))).toBe(false);
    expect(asksRestock(sale({ refunds: [refund({ restocked: 3 })] }))).toBe(false);
    expect(restockChoices(sale({ refunds: [refund()] })).map((c) => c.label)).toEqual(['None', '1', '2']);
  });

  it('says what it is for, to whom, and that it moves no money', () => {
    expect(saleRefundWords(sale(), null)).toEqual({
      title: 'Refund sale: 3 × Water',
      detail: 'Sold on 15 Oct 2026 to a walk-in for $7.50. This only writes the refund in your records: give the money back yourself.',
    });
    expect(saleRefundWords(sale({ refundedMinor: 250 }), 'Maya Patel').detail).toBe(
      'Sold on 15 Oct 2026 to Maya Patel for $7.50. $5.00 of it can still be refunded. This only writes the refund in your records: give the money back yourself.',
    );
  });

  it.each([
    ['no amount', { amount: '' }, 'Type the amount you gave back, like 20 or 20.50.'],
    ['nothing', { amount: '0' }, 'Type the amount you gave back, like 20 or 20.50.'],
    ['more than is left', { amount: '7.51' }, 'That is more than can be refunded. $7.50 is the most.'],
    ['no way it went back', { method: '' }, 'Pick how you gave it back.'],
    ['no reason', { reason: '' }, 'Pick why it was refunded.'],
  ])('is not sent with %s', (_name, over, problem) => {
    const draft = { ...saleRefundDraft(sale(), () => 'k1'), reason: 'returned', ...over };
    expect(saleRefundBody(sale(), draft)).toEqual({ problem, body: null });
  });

  it('sends the amount, how, why and the shelf; a sale with no count sends none for the shelf', () => {
    const draft = { ...saleRefundDraft(sale(), () => 'k1'), amount: '2.50', reason: 'faulty', restock: '1' };
    expect(saleRefundBody(sale(), draft).body).toEqual({ requestKey: 'k1', amountMinor: 250, method: 'card_at_desk', reason: 'faulty', restock: 1 });
    expect(saleRefundBody(sale({ stockCounted: false }), draft).body).toEqual({ requestKey: 'k1', amountMinor: 250, method: 'card_at_desk', reason: 'faulty', restock: 0 });
    expect(saleRefundedWords(sale(), { amountMinor: 250, restock: 1 }, 44)).toBe('Refund noted: $2.50 back on the sale of 3 × Water. 1 went back on the shelf. Its receipt is #44.');
    expect(saleRefundedWords(sale(), { amountMinor: 750, restock: 0 }, 45)).toBe('Refund noted: $7.50 back on the sale of 3 × Water. Its receipt is #45.');
  });
});

describe('a sale’s refunds', () => {
  it('each with how, when, why, the shelf and who; a voided one says who voided it and why', () => {
    const voided = refund({ id: 'rf2', receiptNumber: 45, restocked: 0, reason: 'charged_too_much', by: null, voided: { reason: 'wrong_amount', on: '2026-10-16', by: 'Sam Owner' } });
    expect(saleRefundLines(sale({ refunds: [refund(), voided] }))).toEqual([
      { id: 'rf1', receiptNumber: 44, amount: '$2.50 refunded', money: '$2.50', detail: 'Cash · 16 Oct 2026 · Brought back · 1 back on the shelf · by Priya Desk', voided: null },
      { id: 'rf2', receiptNumber: 45, amount: '$2.50 refunded', money: '$2.50', detail: 'Cash · 16 Oct 2026 · Charged too much', voided: 'Voided 16 October 2026 by Sam Owner · Wrong amount' },
    ]);
  });

  it('Void refund says what changes, the shelf too', () => {
    expect(voidSaleRefundWords(sale({ refunds: [refund()] }), 'rf1')).toEqual({
      question: 'Void the $2.50 refund noted on 16 Oct 2026? It will no longer count, and the sale counts that much again. 1 will come off the shelf count again. It stays in the list crossed out.',
      done: 'Refund voided. The sale counts $2.50 again.',
    });
  });
});
