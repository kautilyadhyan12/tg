// PAYMENTS TO MATCH, its words (ROADMAP 18d-iii-b-ii-a): every reason a payment waits, as a row says it
// and what to do next; the amount Match asks for; the rows kept in place; the person's page's line.
import { describe, expect, it } from 'vitest';
import { SQUARE_APP_WAIT_REASONS } from '@app/shared';
import {
  amountFor,
  billCannot,
  billDue,
  billLabel,
  enteredLine,
  keepDone,
  markedLine,
  nextStepWords,
  overviewLine,
  paidLine,
  paidWith,
  reasonWords,
  releasesCard,
  rowAmount,
  rowFacts,
  toMatchHeadline,
  waitingLine,
  whoWords,
} from './paymentsToMatchView';

const BEN = { entryId: 'e-ben', name: 'Ben Ortiz', memberNumber: null, email: null, past: false };
const row = (over = {}) => ({
  id: 'r1',
  takenAt: '2026-10-22T15:14:00.000Z',
  amountMinor: 2500,
  tipMinor: 0,
  currency: 'USD',
  enteredMinor: 2500,
  refundedMinor: 0,
  card: { brand: 'VISA', last4: '4242' },
  source: null,
  customer: null,
  person: BEN,
  linkedNames: [],
  suggested: BEN,
  reason: 'no_bill',
  holdsCard: false,
  ...over,
});

describe('why it waits, and what to do, for every reason Square Point of Sale gives', () => {
  const said = {
    no_customer: ['No customer was added to the sale in Square Point of Sale.', 'Match it to the bill of the person who paid.'],
    not_linked: ["This customer in Square isn't linked to anyone on your list yet.", 'Match it to the bill of the person who paid.'],
    several_people: ['This customer in Square is linked to Ben Ortiz and Benjamin Ortiz.', "Match it to the right person's bill."],
    mixed_sale: ['The sale also had items from your Square item list.', 'Match asks how much of it was for the bill.'],
    sale_unread: ["Square didn't show what was sold.", 'Match it to the bill it was for.'],
    square_tax: ['Square added $2.06 of tax on top of the $25.00 entered.', 'Match puts the $25.00 entered on the bill.'],
    no_bill: ['Ben Ortiz has no bill of $27.06.', 'Match it to the bill it was for, or choose Not a bill payment for a shop sale.'],
    too_early: ["Ben Ortiz's bill of $27.06 isn't due in the next week.", 'Match puts it on that bill now, paid early.'],
    several_bills: ['Ben Ortiz has more than one bill of $27.06 due.', 'Match it to the bill it was for.'],
    busy: ["A payment for Ben Ortiz's bill was being taken on the Square Terminal or the card on file at the same time.", 'Match it once that payment has finished.'],
    maybe_twice: [
      "Ben Ortiz's last bill was paid less than 2 days before this. They may have paid twice.",
      'If they paid twice, refund it in your Square Dashboard, then choose Not a bill payment. Otherwise match it to their next bill.',
    ],
    other_location: ['It was taken at another location of your Square account.', 'Match it if it was for a bill here. Otherwise choose Not a bill payment.'],
    several_gyms: ['It was taken at a location another gym here also uses, with no customer added.', 'Match it to the bill it was for.'],
    not_this_bill: ["It was taken off Ben Ortiz's bill with Not this bill.", 'Match it to the bill it was for.'],
    refunded: ['Square has refunded $10.00 of it.', 'Choose Not a bill payment.'],
  };
  it('every reason the server can send has its words', () => {
    expect(Object.keys(said).sort()).toEqual([...SQUARE_APP_WAIT_REASONS].sort());
  });
  it.each(Object.entries(said))('%s', (reason, [why, next]) => {
    const r = row({ reason, amountMinor: 2706, enteredMinor: 2500, refundedMinor: 1000, linkedNames: ['Ben Ortiz', 'Benjamin Ortiz'] });
    expect(reasonWords(r)).toBe(why);
    expect(nextStepWords(r)).toBe(next);
  });
  it('where Square did not say how much was entered or refunded, nothing is made up', () => {
    expect(reasonWords(row({ reason: 'square_tax', enteredMinor: null }))).toBe('Square added tax on top of the amount entered.');
    expect(nextStepWords(row({ reason: 'square_tax', enteredMinor: null }))).toBe('Match asks how much of it was for the bill.');
    expect(reasonWords(row({ reason: 'refunded', refundedMinor: 0 }))).toBe('Square has refunded some or all of it.');
    expect(reasonWords(row({ reason: 'several_people', linkedNames: [] }))).toBe('This customer in Square is linked to more than one person on your list.');
  });
});

describe("a row's facts", () => {
  it('when, what with, Square’s details, why, what next, and the card on file held', () => {
    const facts = rowFacts(row({ reason: 'not_linked', person: null, suggested: null, customer: { name: 'Amy Lee', email: 'amy@gmail.com', phone: null }, card: null, source: 'CASH' }), 'America/Chicago', 'US');
    expect(facts.map((f) => [f.label, f.value])).toEqual([
      ['Taken', '10:14 AM on 22 Oct'],
      ['Paid with', 'Cash'],
      ['In Square', 'Amy Lee · amy@gmail.com'],
      ['Why it’s here', "This customer in Square isn't linked to anyone on your list yet."],
      ['Next step', 'Match it to the bill of the person who paid.'],
    ]);
    expect(rowFacts(row({ holdsCard: true }), 'America/Chicago', 'US').at(-1)).toEqual({ label: 'Card on file', value: 'Not charged for Ben Ortiz while this waits' });
  });
  it.each([
    [row(), 'Ben Ortiz'],
    [row({ person: null, customer: { name: 'Amy Lee', email: null, phone: null } }), 'Amy Lee (in Square)'],
    [row({ person: null, customer: { name: null, email: 'x@y.z', phone: null } }), 'A customer in Square'],
    [row({ person: null, customer: null, reason: 'no_customer' }), 'No customer added'],
    [row({ person: null, customer: null, reason: 'several_people' }), 'A customer in Square'],
  ])('who: %#', (r, who) => {
    expect(whoWords(r)).toBe(who);
  });
  it.each([
    [{ card: { brand: 'MASTERCARD', last4: '4444' }, source: 'CARD' }, 'Mastercard ending 4444'],
    [{ card: null, source: 'CASH' }, 'Cash'],
    [{ card: null, source: 'WALLET' }, 'Digital wallet'],
    [{ card: null, source: 'BANK_ACCOUNT' }, 'Bank account'],
    [{ card: null, source: 'EXTERNAL' }, 'Another payment method, noted in Square'],
    [{ card: null, source: 'SOMETHING_NEW' }, 'Another payment method'],
    [{ card: null, source: null }, 'Not said by Square'],
  ])('paid with %#', (over, words) => {
    expect(paidWith(row(over))).toBe(words);
  });
  it('a tip is said beside the amount, and is never a bill’s', () => {
    expect(rowAmount(row({ tipMinor: 300 }))).toBe('$25.00 + $3.00 tip');
    expect(rowAmount(row())).toBe('$25.00');
  });
});

describe("Match's box", () => {
  const bill = (over = {}) => ({ entryId: 'e-ben', name: 'Ben Ortiz', membershipId: 'm1', typeName: 'Gold Weekly', target: { kind: 'period', periodIndex: 1 }, fee: null, covers: { from: '2026-10-19', to: '2026-10-25' }, dueOn: '2026-10-25', leftMinor: 2500, currency: 'USD', cannot: null, ...over });
  it('names each bill, and whose it is where it is somebody they pay for', () => {
    expect(billLabel(bill(), 'e-ben')).toBe('Gold Weekly · 19 Oct – 25 Oct 2026');
    expect(billLabel(bill({ entryId: 'e-kai', name: 'Kai Ortiz' }), 'e-ben')).toBe('Kai Ortiz: Gold Weekly · 19 Oct – 25 Oct 2026');
    expect(billLabel(bill({ fee: { kind: 'late_cancel', forName: 'Spin on 3 Oct' }, covers: null }), 'e-ben')).toBe('Late cancel fee · Spin on 3 Oct');
  });
  it.each([
    ['2026-10-25', '$25.00 left · Due today'],
    ['2026-10-24', '$25.00 left · Due 25 Oct'],
    ['2026-10-27', '$25.00 left · Was due 25 Oct'],
  ])('on %s it says %s', (today, words) => {
    expect(billDue(bill(), today)).toBe(words);
  });
  it.each([
    ['too_little', 'Only $25.00 is left on this bill, less than $30.00.'],
    ['fee_whole', 'A fee is paid all at once, and this fee is $25.00.'],
    ['busy', 'A payment for this is being taken on the Square Terminal or the card on file.'],
    ['currency', 'This bill is in another currency.'],
    [null, null],
  ])('a bill that can’t take it says why: %s', (cannot, words) => {
    expect(billCannot(bill({ cannot }), 3000, 'USD')).toBe(words);
  });
  it('the amount, where Square didn’t say it, is checked against the payment and the bill', () => {
    const r = row({ amountMinor: 1500, enteredMinor: null });
    expect(amountFor('', r, bill()).problem).toBe('Type the amount for this bill, like 20 or 20.50.');
    expect(amountFor('abc', r, bill()).problem).toBe('Type the amount for this bill, like 20 or 20.50.');
    expect(amountFor('15.01', r, bill()).problem).toBe('That is more than this payment. It is $15.00.');
    expect(amountFor('12', r, bill({ leftMinor: 1000 })).problem).toBe('That is more than is left on this bill. $10.00 is left.');
    expect(amountFor('10', r, bill({ leftMinor: 1200, fee: { kind: 'no_show', forName: 'Spin' } })).problem).toBe('A fee is paid all at once: $12.00.');
    expect(amountFor('12.50', r, bill())).toEqual({ problem: null, minor: 1250 });
  });
  it('says what goes on the bill where Square added more, and nothing otherwise', () => {
    expect(enteredLine(row({ amountMinor: 2706, enteredMinor: 2500 }))).toBe('$25.00 goes on the bill. Square added $2.06 on top.');
    expect(enteredLine(row())).toBeNull();
    expect(enteredLine(row({ enteredMinor: null }))).toBeNull();
  });
  it('a payment already on a bill is shown as it stands', () => {
    expect(paidLine({ amountMinor: 2500, currency: 'USD', paidOn: '2026-10-18', method: 'card_at_desk', forName: null })).toBe('$25.00 · Card at the desk · 18 Oct');
    expect(paidLine({ amountMinor: 2500, currency: 'USD', paidOn: '2026-10-18', method: 'square_app', forName: 'Kai Ortiz' })).toBe('$25.00 · Square Point of Sale · 18 Oct · for Kai Ortiz');
  });
});

describe('after a press', () => {
  it('a row done here stays where it was when the list is read again; another person’s press takes theirs away', () => {
    const [a, b, c] = [row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })];
    expect(keepDone([a, b, c], [a, c], new Set(['b'])).map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(keepDone([a, b, c], [c], new Set(['a'])).map((r) => r.id)).toEqual(['a', 'c']);
    expect(keepDone([a, b, c], [a, b, c], new Set(['b'])).map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(keepDone([], [a], new Set(['x'])).map((r) => r.id)).toEqual(['a']);
  });
  it('says what was marked, and whose card is freed by it', () => {
    expect(markedLine('other')).toBe('Marked as not a bill payment.');
    expect(markedLine('by_hand')).toBe('Marked as already recorded on a bill by hand.');
    expect(releasesCard(row({ holdsCard: true }))).toBe("Ben Ortiz's card on file can then be charged for their bills again.");
    expect(releasesCard(row())).toBeNull();
  });
  it('Overview and the heading count them', () => {
    expect(toMatchHeadline({ count: 0, totals: [] })).toBeNull();
    expect(toMatchHeadline({ count: 1, totals: [{ currency: 'USD', minor: 2500 }] })).toBe('1 payment to match · $25.00');
    expect(overviewLine({ count: 3, totals: [{ currency: 'USD', minor: 7500 }, { currency: 'CAD', minor: 1000 }] })).toEqual({ value: '3 payments from Square Point of Sale to match.', total: '$75.00 + CA$10.00 in all' });
  });
});

describe("the person's page", () => {
  it.each([
    [{ id: 'w', amountMinor: 2706, currency: 'USD', takenOn: '2026-10-22', byName: null, holdsCard: true }, "A payment of $27.06 taken in Square Point of Sale on 22 Oct is waiting to be matched. While it waits, the card on file isn't charged."],
    [{ id: 'w', amountMinor: 2706, currency: 'USD', takenOn: '2026-10-22', byName: null, holdsCard: false }, 'A payment of $27.06 taken in Square Point of Sale on 22 Oct is waiting to be matched.'],
    [{ id: 'w', amountMinor: 5000, currency: 'USD', takenOn: '2026-10-22', byName: 'Ann Ortiz', holdsCard: true }, "A payment of $50.00 by Ann Ortiz, who pays for them, taken in Square Point of Sale on 22 Oct, is waiting to be matched. While it waits, the card on file isn't charged."],
  ])('%#', (waiting, words) => {
    expect(waitingLine(waiting)).toBe(words);
  });
});
