// Charge card on file's words (ROADMAP 18d-iii-i), and the card's lines on a bill and a fee.
import { describe, expect, it } from 'vitest';
import { CARD_DECLINE_REASONS, cardDeclineReasonOf } from '@app/shared';
import { cardChargeOutcome, cardOnFileDetail, cardOnFileLabel } from './cardChargeView';
import { CARD_CHARGING_LINE, billRow, cardDeclinedLine, cardUncheckedLine } from './memberBillsView';

const card = { brand: 'VISA', last4: '1111', expired: false, payerName: null, ref: 'x' };
const charge = (over) => ({ id: 'c', membershipId: 'm', feeBillId: null, amountMinor: 2500, currency: 'USD', card: { brand: 'VISA', last4: '1111' }, step: 'done', outcome: 'paid', reason: null, receiptNumber: 7, ...over });

describe('Record payment: Card on file', () => {
  it('names the card, and whose it is where somebody else pays', () => {
    expect(cardOnFileLabel(card)).toBe('Card on file · Visa ending 1111');
    expect(cardOnFileLabel({ ...card, brand: 'MASTERCARD', last4: '4444', payerName: 'Priya Sharma' })).toBe("Card on file · Mastercard ending 4444 (Priya Sharma's)");
  });

  it('says what pressing it does before it is pressed', () => {
    expect(cardOnFileDetail(card, 2500, 'USD', 'Tara Singh')).toBe("$25.00 is charged to Tara Singh's Visa ending 1111 as soon as you press Charge $25.00.");
    expect(cardOnFileDetail(card, null, 'USD', 'Tara Singh')).toBe("The amount is charged to Tara Singh's Visa ending 1111 as soon as you press Charge card.");
  });

  it('says each way a press can end', () => {
    expect(cardChargeOutcome(charge({}), 'Tara Singh')).toEqual({ good: true, line: 'Charged $25.00 to Visa ending 1111. Receipt 7.' });
    expect(cardChargeOutcome(charge({ step: 'charging', outcome: null, receiptNumber: null }), 'Tara Singh').good).toBe(true);
    for (const reason of CARD_DECLINE_REASONS) {
      const said = cardChargeOutcome(charge({ outcome: 'declined', reason, receiptNumber: null }), 'Tara Singh');
      expect(said.good).toBe(false);
      expect(said.line).toMatch(/^Visa ending 1111 was declined\. .+\. Nothing was charged: ask Tara Singh for another card or another way to pay\.$/);
    }
    expect(cardChargeOutcome(charge({ outcome: 'refused', receiptNumber: null }), 'Tara Singh').line).toBe(
      "Square wouldn't charge Visa ending 1111. Nothing was charged: check the card on file, or record the payment another way.",
    );
    expect(cardChargeOutcome(charge({ outcome: 'not_recorded', receiptNumber: null }), 'Tara Singh').line).toContain('Check it in your Square Dashboard');
    expect(cardChargeOutcome(charge({ outcome: 'gone', receiptNumber: null }), 'Tara Singh').line).toContain('Check your Square Dashboard before taking payment another way');
  });
});

describe("a decline's reason, from Square's own codes", () => {
  // Square's ErrorCode list, read 2026-10-23, including codes the list does not name: a code this
  // build has never heard of is a decline with no reason given, never another reason.
  it.each([
    ['INSUFFICIENT_FUNDS', 'insufficient_funds'],
    ['CARD_EXPIRED', 'expired'],
    ['EXPIRATION_FAILURE', 'expired'],
    ['INVALID_EXPIRATION', 'expired'],
    ['CARD_DECLINED_CALL_ISSUER', 'call_bank'],
    ['CARD_DECLINED_VERIFICATION_REQUIRED', 'call_bank'],
    ['TRANSACTION_LIMIT', 'call_bank'],
    ['INVALID_ACCOUNT', 'closed'],
    ['ACCOUNT_UNUSABLE', 'closed'],
    ['GENERIC_DECLINE', 'declined'],
    ['CARD_DECLINED', 'declined'],
    ['CVV_FAILURE', 'declined'],
    ['ADDRESS_VERIFICATION_FAILURE', 'declined'],
    ['SOME_NEW_CODE', 'declined'],
    ['insufficient_funds', 'declined'],
  ])('%s reads as %s', (code, reason) => {
    expect(cardDeclineReasonOf(code)).toBe(reason);
  });
});

describe("a bill's card lines", () => {
  const bill = {
    id: 'b',
    periodIndex: 1,
    covers: { from: '2026-10-20', to: '2026-11-19' },
    part: false,
    amountMinor: 2500,
    tax: null,
    joiningFeeMinor: 0,
    changeCreditMinor: 0,
    movedMinor: 0,
    paidMinor: 0,
    dueOn: '2026-10-20',
    state: 'due',
    refundedMinor: 0,
    cancelled: null,
    gift: null,
    payments: [],
    voidedPayments: [],
    cardDeclined: null,
    charging: false,
  };

  it('a decline, on the day, with its reason', () => {
    const declined = { brand: 'VISA', last4: '1111', on: '2026-10-20', reason: 'insufficient_funds' };
    expect(cardDeclinedLine(declined)).toBe("Visa ending 1111 was declined on 20 Oct. There wasn't enough money on the card.");
    expect(billRow({ ...bill, cardDeclined: declined }, 'USD', '2026-10-20').declined).toBe("Visa ending 1111 was declined on 20 Oct. There wasn't enough money on the card.");
    expect(billRow(bill, 'USD', '2026-10-20').declined).toBeNull();
  });

  it('a charge Square never answered: check Square before taking payment another way', () => {
    const unchecked = { brand: 'VISA', last4: '1111', on: '2026-10-20' };
    expect(cardUncheckedLine(unchecked)).toBe("Square didn't say whether it charged Visa ending 1111 on 20 Oct. Check your Square Dashboard before taking payment another way.");
    expect(billRow({ ...bill, cardUnchecked: unchecked }, 'USD', '2026-10-20').declined).toBe(cardUncheckedLine(unchecked));
  });

  it('a charge on its way', () => {
    expect(billRow({ ...bill, charging: true }, 'USD', '2026-10-20').charging).toBe(CARD_CHARGING_LINE);
    expect(billRow(bill, 'USD', '2026-10-20').charging).toBeNull();
  });

  it('a payment from the card on file names the card', () => {
    const paid = {
      ...bill,
      state: 'paid',
      paidMinor: 2500,
      payments: [{ id: 'p', amountMinor: 2500, method: 'company', paidOn: '2026-10-20', by: null, refunds: [], voidedRefunds: [], refundableMinor: 2500, receiptNumber: 3, card: { brand: 'VISA', last4: '1111' } }],
    };
    expect(billRow(paid, 'USD', '2026-10-20').payments[0].detail).toBe('Card on file, Visa ending 1111 · 20 Oct 2026');
  });
});
