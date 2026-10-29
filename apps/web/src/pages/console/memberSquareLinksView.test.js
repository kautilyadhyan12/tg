// What a person's page says about the customers Match linked to them, and Unlink's box (ROADMAP 18d-iii-b-ii-c-ii): every
// sentence, read as somebody who has never opened the app would read it.
import { describe, expect, it } from 'vitest';
import { linkLine, unlinkBoxLines, unlinkedLine } from './memberSquareLinksView';

const LINK = { customerId: 'CPAT', also: false, linkedAt: '2026-10-29T18:30:00.000Z', from: { amountMinor: 2000, currency: 'USD', takenAt: '2026-10-29T18:29:00.000Z' } };
const BOX = { customerName: 'Pat Smith', also: false, waiting: 1, matched: 1, card: { brand: 'VISA', last4: '1111' }, added: false };

describe('the line on their page', () => {
  it('names the payment whose Match linked it, on the day the gym had then', () => {
    expect(linkLine(LINK, 'America/Chicago')).toBe(
      'Linked to a customer in your Square customer list when $20.00 paid on 29 Oct was matched. This customer’s payments in Square Point of Sale come to this page.',
    );
    // Late in the evening in Chicago is already the next day in London.
    expect(linkLine({ ...LINK, from: { ...LINK.from, takenAt: '2026-10-30T03:00:00.000Z' } }, 'America/Chicago')).toMatch(/paid on 29 Oct/);
  });

  it('a second customer of theirs says so; a link whose payment is gone says the day', () => {
    expect(linkLine({ ...LINK, also: true }, 'America/Chicago')).toBe(
      'A second customer in your Square customer list, linked when $20.00 paid on 29 Oct was matched. This customer’s payments in Square Point of Sale also come to this page.',
    );
    expect(linkLine({ ...LINK, from: null }, 'America/Chicago')).toBe(
      'Linked to a customer in your Square customer list on 29 Oct. This customer’s payments in Square Point of Sale come to this page.',
    );
  });
});

describe("Unlink's box", () => {
  it('THE WORST THING it must say before anything changes: who it is in Square, what goes back, the card that is stopped, and that nothing links it again', () => {
    expect(unlinkBoxLines(BOX, 'Sam Smith')).toEqual({
      question: 'Unlink this Square customer from Sam Smith?',
      lines: [
        'In Square, this customer is Pat Smith.',
        '1 payment from this customer waiting on this page goes back to Payments to match.',
        'Sam Smith’s card on file, Visa ending 1111, is saved on this customer, so it is removed and stopped in Square. Save their card again to keep charging it.',
        '1 payment from this customer already on a bill stays there. To take it off, use Not this bill on that bill.',
        'Their next payments in Square Point of Sale wait in Payments to match, and the app won’t link this customer to Sam Smith again by itself.',
      ],
    });
  });

  it('says only what applies: several payments, no card, nothing matched, Square not answering, and Members in Square adding them', () => {
    expect(unlinkBoxLines({ customerName: null, also: false, waiting: 3, matched: 0, card: null, added: true }, 'John Smith').lines).toEqual([
      '3 payments from this customer waiting on this page go back to Payments to match.',
      'Their next payments in Square Point of Sale wait in Payments to match, and the app won’t link this customer to John Smith again by itself.',
      'John Smith is then added to your Square customer list as a customer of their own.',
    ]);
    expect(unlinkBoxLines({ ...BOX, waiting: 0, matched: 2, card: null }, 'Amy Lee').lines).toEqual([
      'In Square, this customer is Pat Smith.',
      '2 payments from this customer already on bills stay there. To take one off, use Not this bill on that bill.',
      'Their next payments in Square Point of Sale wait in Payments to match, and the app won’t link this customer to Amy Lee again by itself.',
    ]);
  });
});

describe('after the press', () => {
  it('says what was done in one place: whose payments no longer come, what went back, the card removed', () => {
    expect(unlinkedLine({ customerName: 'Pat Smith', moved: 1, card: { brand: 'VISA', last4: '1111' }, added: false }, 'Sam Smith')).toBe(
      'Unlinked. Pat Smith’s payments in Square Point of Sale no longer come to Sam Smith’s page. 1 payment went back to Payments to match. Their Visa ending 1111 was removed. Save their card again.',
    );
  });

  it('never reads "Amy Lee’s payments no longer come to Amy Lee’s page", and reads whole without Square’s name', () => {
    expect(unlinkedLine({ customerName: 'Amy Lee', moved: 0, card: null, added: false }, 'Amy Lee')).toBe(
      'Unlinked. This Square customer’s payments in Square Point of Sale no longer come to Amy Lee’s page.',
    );
    expect(unlinkedLine({ customerName: null, moved: 2, card: null, added: true }, 'Amy Lee')).toBe(
      'Unlinked. This Square customer’s payments in Square Point of Sale no longer come to Amy Lee’s page. 2 payments went back to Payments to match.',
    );
  });
});
