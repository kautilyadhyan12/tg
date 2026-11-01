// A chargeback's words (ROADMAP 18d-iv-e-i): every state and reason Square has, and those it has not told us about yet.
import { describe, expect, it } from 'vitest';
import { CHARGEBACK_REASONS, CHARGEBACK_STATES } from '@app/shared';
import { CHARGEBACK_REASON_WORDS, chargebackLine, chargebackRowDetail, chargebacksHeadline } from './chargebackView';

const c = (over = {}) => ({ id: 'x', amountMinor: 2000, currency: 'USD', state: 'EVIDENCE_REQUIRED', reason: 'NO_KNOWLEDGE', dueOn: '2026-11-14', duePassed: false, card: { brand: 'VISA', last4: '1111' }, stops: true, ...over });

describe('chargebackLine', () => {
  it('reads as gym staff should read it, with Square\'s date', () => {
    expect(chargebackLine(c())).toEqual({
      id: 'x',
      title: 'Chargeback · $20.00 · Visa ending 1111',
      detail: 'The cardholder says they did not make this payment. Square may hold this money until the bank decides. Respond in Square by 14 November 2026.',
      button: 'Respond in Square',
      over: false,
    });
  });

  it.each([
    ['PROCESSING', 'Under review by the bank.'],
    ['WON', 'Won.'],
    ['LOST', 'The money went back to the card.'],
    ['ACCEPTED', 'The money went back to the card.'],
    ['INQUIRY_EVIDENCE_REQUIRED', 'The bank is asking about this payment.'],
    ['INQUIRY_PROCESSING', 'Under review by the bank.'],
    ['INQUIRY_CLOSED', 'The bank closed its inquiry.'],
    ['UNKNOWN', 'Check it in Square.'],
  ])('%s says so', (state, words) => {
    expect(chargebackLine(c({ state })).detail).toContain(words);
  });

  it('every state Square has is placed', () => {
    for (const state of CHARGEBACK_STATES) expect(chargebackLine(c({ state })).detail.length).toBeGreaterThan(0);
  });

  it('every reason Square has has words, and one nobody has placed says nothing', () => {
    for (const reason of CHARGEBACK_REASONS) expect(CHARGEBACK_REASON_WORDS[reason]).toBeTruthy();
    expect(chargebackLine(c({ reason: null })).detail).toMatch(/^Square may hold/);
  });

  it('never tells staff to answer by a date that has gone', () => {
    const line = chargebackLine(c({ duePassed: true }));
    expect(line.detail).toContain('The date to respond has passed, so Square challenges it for you.');
    expect(line.detail).not.toContain('Respond in Square by');
    expect(line.button).toBe('Open in Square');
  });

  it('with no date it asks for an answer but names none', () => {
    expect(chargebackLine(c({ dueOn: null })).detail).toContain('Respond in Square.');
  });

  it("says the card is not charged only where that is true", () => {
    const words = "The app won't charge this card by itself.";
    expect(chargebackLine(c(), true).detail).toContain(words);
    expect(chargebackLine(c({ state: 'LOST' }), true).detail).toContain(words);
    expect(chargebackLine(c()).detail).not.toContain(words);
    expect(chargebackLine(c({ state: 'WON', stops: false }), true).detail).not.toContain(words);
    expect(chargebackLine(c({ state: 'INQUIRY_CLOSED', stops: false }), true).detail).not.toContain(words);
    // In a Square account the gym has left it reads as unplaced, and the card is charged.
    expect(chargebackLine(c({ state: 'UNKNOWN', stops: false }), true).detail).not.toContain(words);
    expect(chargebackLine(c({ state: 'UNKNOWN', stops: true }), true).detail).toContain(words);
  });

  it('a card Square gave no number for is left out', () => {
    expect(chargebackLine(c({ card: null })).title).toBe('Chargeback · $20.00');
  });
});

describe('Overview', () => {
  it('counts in words, and says nothing of none', () => {
    expect(chargebacksHeadline(0)).toBeNull();
    expect(chargebacksHeadline(1)).toBe('1 chargeback needs a response');
    expect(chargebacksHeadline(3)).toBe('3 chargebacks need a response');
  });
  it("a row names Square's date", () => {
    expect(chargebackRowDetail(c())).toBe('The cardholder says they did not make this payment. Respond in Square by 14 November 2026.');
  });
});
