import { describe, expect, it } from 'vitest';
import { receiptSchema } from '@app/shared';
import { receiptLines, receiptNotes } from './receiptView';
import { receiptLines as phoneLines, receiptNotes as phoneNotes } from '../../../../mobile/src/screens/gym/membershipView.ts';

// The phone's My membership prints a receipt with its own copy of these rules (Stage 5 item 16c). The two never
// differ: every kind of receipt, read through the server's own shape, gives the same lines and notes on both.

const common = {
  number: 12,
  gym: { name: 'Iron House', address: '12 MG Road, Pune' },
  on: '2026-10-04',
  person: 'Ravi Kumar',
  personDeleted: false,
  paidBy: null,
  paidByDeleted: false,
  by: null,
  currency: 'INR',
  cancelled: false,
};
const amounts = (over = {}) => ({ listedMinor: 150000, discount: null, tax: null, totalMinor: 150000, ...over });
const payment = (over = {}) => ({
  ...common,
  kind: 'payment',
  item: { name: 'Gold Monthly', covers: { from: '2026-10-04', to: '2026-11-03' }, part: false },
  amounts: amounts(),
  joiningFeeMinor: 0,
  changeCredit: null,
  paidMinor: 150000,
  method: 'cash',
  balance: null,
  refunds: [],
  ...over,
});
const line = (name, quantity, unit, over = {}) => ({
  name,
  quantity,
  unitPriceMinor: unit,
  amounts: amounts({ listedMinor: quantity * unit, totalMinor: quantity * unit, ...over }),
});
const sale = (lines, totalMinor, over = {}) => ({ ...common, kind: 'sale', lines, totalMinor, method: 'card_at_desk', refunds: [], ...over });

const CASES = {
  'a whole payment': payment(),
  'a discount, a joining fee and a tax on top': payment({
    amounts: amounts({ listedMinor: 200000, discount: { name: 'October offer', minor: 20000 }, tax: { name: 'GST', bp: 1800, included: false, minor: 32400 }, totalMinor: 212400 }),
    joiningFeeMinor: 50000,
    paidMinor: 212400,
  }),
  'a tax inside, a part month, paid in parts, with a refund': payment({
    item: { name: 'Gold Monthly', covers: { from: '2026-10-20', to: '2026-10-31' }, part: true },
    amounts: amounts({ listedMinor: 60000, tax: { name: null, bp: 500, included: true, minor: 2857 }, totalMinor: 60000 }),
    paidMinor: 20000,
    balance: { paidBeforeMinor: 10000, leftMinor: 30000 },
    refunds: [{ number: 14, on: '2026-10-10', amountMinor: 5000 }],
  }),
  'a change of membership': payment({ amounts: amounts({ listedMinor: 120000, totalMinor: 120000 }), changeCredit: { minor: 30000, fromName: 'Silver Monthly' }, paidMinor: 120000 }),
  'a fee paid': payment({ item: { name: 'Late cancel fee · Spin at 6', covers: { from: '2026-10-20', to: '2026-10-20' }, part: false }, amounts: amounts({ listedMinor: 20000, totalMinor: 20000 }), paidMinor: 20000 }),
  'one product': sale([line('Water bottle', 2, 2500)], 5000),
  'a basket with two taxes and a refund': sale(
    [
      line('Shaker', 1, 50000, { tax: { name: 'GST', bp: 1800, included: false, minor: 9000 }, totalMinor: 59000 }),
      line('Protein bar', 2, 8000, { discount: { name: 'Bar deal', minor: 1000 }, listedMinor: 15000, tax: { name: 'GST', bp: 500, included: true, minor: 714 }, totalMinor: 15000 }),
    ],
    74000,
    { refunds: [{ number: 21, on: '2026-10-23', amountMinor: 8000, item: 'Protein bar' }] },
  ),
  'a refund': {
    ...common,
    kind: 'refund',
    number: 14,
    forReceipt: 12,
    item: { name: 'Gold Monthly', covers: { from: '2026-10-04', to: '2026-11-03' } },
    refundedMinor: 50000,
    method: 'bank_transfer',
  },
};

describe("the phone's receipt lines are the browser's", () => {
  for (const [name, raw] of Object.entries(CASES)) {
    it(name, () => {
      const receipt = receiptSchema.parse(raw);
      expect(phoneLines(receipt)).toEqual(receiptLines(receipt));
      expect(phoneNotes(receipt)).toEqual(receiptNotes(receipt));
    });
  }
});
