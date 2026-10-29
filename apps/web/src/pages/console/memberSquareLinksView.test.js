// What a person's page says about the customers in Square that Match linked to them, and Unlink's box (ROADMAP 18d-iii-b-ii-c-ii):
// every sentence, read as somebody who has never opened the app would read it.
import { describe, expect, it } from 'vitest';
import { linkLine, linkedOn, linksTitle, unlinkBoxLines, unlinkedLine } from './memberSquareLinksView';

const LINK = { customerId: 'CPAT', customerName: 'Pat Smith', also: false, linkedAt: '2026-10-29T18:30:00.000Z', from: null };
const BOX = {
  customerName: 'Pat Smith',
  also: false,
  waiting: 1,
  waitingMinor: 700,
  currency: 'USD',
  shopItems: 0,
  shopItemsMinor: 0,
  notBill: 0,
  matched: 1,
  card: { brand: 'VISA', last4: '1111' },
  added: false,
};

describe('the box on their page', () => {
  it('names who is linked, and what that does, in two short sentences', () => {
    expect(linksTitle([LINK])).toBe('Linked Square customer');
    expect(linksTitle([])).toBe('Square customer');
    expect(linksTitle([LINK, { ...LINK, customerId: 'C2' }])).toBe('Linked Square customers');
    expect(linkLine(LINK, 'Sam Smith')).toBe('Pat Smith in Square is linked to Sam Smith. Square payments made under Pat Smith show on this page.');
    // Late on 29 Oct in Chicago is already 30 Oct in London: the gym's own day.
    expect(linkedOn({ ...LINK, linkedAt: '2026-10-30T03:00:00.000Z' }, 'America/Chicago')).toBe('Linked on 29 Oct.');
  });

  it('never reads "Amy Lee in Square is linked to Amy Lee", and reads whole when Square did not say', () => {
    expect(linkLine({ ...LINK, customerName: 'Amy Lee' }, 'Amy Lee')).toBe('Amy Lee in Square is linked to this page. Square payments made under Amy Lee show here.');
    expect(linkLine({ ...LINK, customerName: null }, 'Sam Smith')).toBe(
      'A customer in Square is linked to Sam Smith. Square payments made under that customer show on this page.',
    );
  });
});

describe("Unlink's box", () => {
  it('THE WORST THING it must say before anything changes: whose payment moves, that the card is removed, and that nothing comes here again', () => {
    expect(unlinkBoxLines(BOX, 'Sam Smith')).toEqual({
      question: 'Unlink Pat Smith from Sam Smith?',
      lines: [
        'The $7.00 payment from Pat Smith moves to Payments to match.',
        'Sam Smith’s card (Visa ending 1111) is removed, because it was saved under Pat Smith in Square. Add the card again.',
        'Payments already recorded stay as they are.',
        'Pat Smith’s future Square payments won’t show here.',
      ],
    });
  });

  it('says only what applies: several payments, no card, nothing recorded, Square not answering, and Members in Square adding them', () => {
    expect(unlinkBoxLines({ ...BOX, customerName: null, waiting: 3, waitingMinor: 6000, matched: 0, card: null, added: true }, 'John Smith')).toEqual({
      question: 'Unlink this Square customer from John Smith?',
      lines: [
        'The 3 payments from this customer waiting here ($60.00 in all) move to Payments to match.',
        'This customer’s future Square payments won’t show here.',
        'John Smith will be added to Square as a customer of their own.',
      ],
    });
    expect(unlinkBoxLines({ ...BOX, customerName: 'Amy Lee', waiting: 0, waitingMinor: 0, currency: null, card: null }, 'Amy Lee')).toEqual({
      question: 'Unlink this Square customer from Amy Lee?',
      lines: ['Payments already recorded stay as they are.', 'This customer’s future Square payments won’t show here.'],
    });
  });
});

describe("Unlink's box: what else the press does (round one, Low 2)", () => {
  it('a sale of shop items from them becomes a shop sale, and a payment marked Not for a bill stays marked', () => {
    expect(unlinkBoxLines({ ...BOX, waiting: 0, waitingMinor: 0, shopItems: 1, shopItemsMinor: 3000, notBill: 1, matched: 0, card: null }, 'Sam Smith').lines).toEqual([
      'The $30.00 sale of shop items from Pat Smith becomes a shop sale and leaves this page.',
      'The payment from Pat Smith marked Not for a bill stays marked and leaves this page.',
      'Pat Smith’s future Square payments won’t show here.',
    ]);
    expect(unlinkBoxLines({ ...BOX, waiting: 0, waitingMinor: 0, shopItems: 2, shopItemsMinor: 5000, notBill: 3, matched: 0, card: null }, 'Sam Smith').lines.slice(0, 2)).toEqual([
      'The 2 sales of shop items from Pat Smith ($50.00 in all) become shop sales and leave this page.',
      'The 3 payments from Pat Smith marked Not for a bill stay marked and leave this page.',
    ]);
  });
});

describe('after the press', () => {
  it('says what was done, and what to do next, in short sentences', () => {
    expect(unlinkedLine({ customerName: 'Pat Smith', moved: 1, card: { brand: 'VISA', last4: '1111' }, added: false }, 'Sam Smith')).toBe(
      'Unlinked. Pat Smith’s Square payments no longer show on this page. The payment is in Payments to match. Add Sam Smith’s card again.',
    );
    expect(unlinkedLine({ customerName: null, moved: 2, card: null, added: true }, 'Amy Lee')).toBe(
      'Unlinked. This customer’s Square payments no longer show on this page. The 2 payments are in Payments to match.',
    );
    expect(unlinkedLine({ customerName: 'Amy Lee', moved: 0, card: null, added: false }, 'Amy Lee')).toBe('Unlinked. This customer’s Square payments no longer show on this page.');
  });
});
