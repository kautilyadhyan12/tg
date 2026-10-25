// PAYMENTS TO MATCH, its words (ROADMAP 18d-iii-b-ii-a): every payment from Square Point of Sale waits for
// one press (Kd, 2026-10-25). Each row in one line: who paid, what it is for (the bill ticked, or why staff
// choose), its one main button and a note only where something needs checking; the amount Match asks for;
// the rows kept in place; the person's page's line.
import { describe, expect, it } from 'vitest';
import { SQUARE_APP_WAIT_REASONS } from '@app/shared';
import {
  ACTION_WORDS,
  amountFor,
  billCannot,
  billDue,
  billFor,
  billLabel,
  enteredLine,
  forWords,
  heldLine,
  keepDone,
  markedLine,
  overviewLine,
  paidLine,
  paidWith,
  pressFor,
  releasesCard,
  rowAction,
  rowAmount,
  rowNote,
  takenWith,
  toMatchHeadline,
  waitingLine,
  waitingNext,
  waitingNote,
  whoNote,
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
  deviceName: null,
  bill: null,
  ...over,
});
const TODAY = '2026-10-25';
const bill = (over = {}) => ({ entryId: 'e-ben', name: 'Ben Ortiz', membershipId: 'm1', typeName: 'Gold Weekly', target: { kind: 'period', periodIndex: 1 }, fee: null, covers: { from: '2026-10-19', to: '2026-10-25' }, dueOn: '2026-10-25', leftMinor: 2500, currency: 'USD', cannot: null, ...over });

describe('every reason a payment waits, unticked: what it is for in a few words, the button that says what to choose, and a note only where needed', () => {
  const nobody = { person: null, suggested: null };
  // [reason, the row, For, the button, the note]
  const said = [
    ['ready', {}, 'Ben Ortiz has no bill of $25.00', 'bill', null],
    ['no_customer', nobody, 'Nobody was picked in Square', 'who', null],
    ['not_linked', { ...nobody, customer: { name: 'Amy Lee', email: 'amy@gmail.com', phone: null } }, 'Not linked to anyone on your list', 'who', null],
    ['several_people', nobody, 'Linked to Ben Ortiz and Benjamin Ortiz', 'who', null],
    ['mixed_sale', {}, 'Sold with shop items', 'bill', null],
    ['sale_unread', {}, "Square didn't say what was sold", 'bill', null],
    ['square_tax', { enteredMinor: null }, 'Square added tax on top', 'bill', null],
    ['no_bill', {}, 'Ben Ortiz has no bill of $25.00', 'bill', null],
    ['too_early', {}, 'Ben Ortiz has no bill of $25.00', 'bill', null],
    ['several_bills', {}, 'More than one bill of $25.00 is due', 'bill', null],
    ['busy', {}, 'A payment for their bill is under way', 'bill', { tone: 'info', text: 'Try again in a minute.' }],
    ['maybe_twice', {}, 'Ben Ortiz has no bill of $25.00', 'bill', null],
    ['other_location', nobody, 'Taken at another of your Square locations', 'who', null],
    ['several_gyms', nobody, 'No bill of $25.00', 'who', null],
    ['not_this_bill', {}, "Taken off Ben Ortiz's bill", 'bill', null],
    ['refunded', {}, '$10.00 refunded in Square', null, { tone: 'info', text: 'Choose Not for a bill.' }],
    ['shop_items', { enteredMinor: null }, 'Sold as shop items in Square', 'bill', { tone: 'info', text: 'If it paid their membership, choose the bill. If not, choose Not for a bill.' }],
  ];
  it('every reason the server can send is here', () => {
    expect(said.map(([reason]) => reason).sort()).toEqual([...SQUARE_APP_WAIT_REASONS].sort());
  });
  it.each(said)('%s', (reason, over, words, action, note) => {
    const r = row({ reason, amountMinor: 2706, enteredMinor: 2500, refundedMinor: 1000, linkedNames: ['Ben Ortiz', 'Benjamin Ortiz'], ...over });
    expect(forWords(r, TODAY)).toBe(words);
    expect(rowAction(r)).toBe(action);
    expect(rowNote(r)).toEqual(note);
  });
  it('where Square did not say how much was refunded or who it is linked to, nothing is made up', () => {
    expect(forWords(row({ reason: 'refunded', refundedMinor: 0 }), TODAY)).toBe('Refunded in Square');
    expect(forWords(row({ reason: 'several_people', person: null, linkedNames: [] }), TODAY)).toBe('Linked to more than one person on your list');
    expect(forWords(row({ reason: 'not_this_bill', person: null }), TODAY)).toBe('Taken off a bill');
  });
  it('the buttons say what they do', () => {
    expect(ACTION_WORDS).toEqual({ match: 'Match', who: 'Choose who paid', bill: 'Choose the bill', other: 'Other bill', notBill: 'Not for a bill' });
  });
});

describe('a payment whose bill is ticked: one press of Match', () => {
  it.each([
    ['due today', row({ reason: 'ready', bill: bill() }), 'Gold Weekly · due today'],
    ['due later in the week', row({ reason: 'ready', bill: bill({ dueOn: '2026-10-30' }) }), 'Gold Weekly · due 30 Oct'],
    ['paid early, more than a week ahead', row({ reason: 'too_early', bill: bill({ dueOn: '2026-11-08' }) }), 'Gold Weekly · due 8 Nov'],
    ['overdue', row({ reason: 'ready', bill: bill({ dueOn: '2026-10-18' }) }), 'Gold Weekly · was due 18 Oct'],
    ['somebody they pay for', row({ reason: 'ready', bill: bill({ entryId: 'e-kai', name: 'Kai Ortiz' }) }), 'Kai Ortiz: Gold Weekly · due today'],
    ['a fee', row({ reason: 'ready', bill: bill({ fee: { kind: 'late_cancel', forName: 'Spin on 3 Oct' }, covers: null }) }), 'Late cancel fee · Spin on 3 Oct · due today'],
  ])('%s: For says the bill, and the button is Match', (_name, r, words) => {
    expect(forWords(r, TODAY)).toBe(words);
    expect(rowAction(r)).toBe('match');
  });
  it('a note only where something needs checking or saying', () => {
    expect(rowNote(row({ reason: 'ready', bill: bill() }))).toBeNull();
    expect(rowNote(row({ reason: 'ready', bill: bill(), amountMinor: 2706, enteredMinor: 2500 }))).toEqual({ tone: 'info', text: '$25.00 goes on the bill. Square added $2.06 on top.' });
    expect(rowNote(row({ reason: 'maybe_twice', bill: bill() }))).toEqual({ tone: 'warn', text: "Ben Ortiz's last bill was paid less than 2 days ago. Check they didn't pay twice." });
  });
  it('one press sends the bill ticked, the amount it is left owing, and its own key', () => {
    expect(pressFor(bill(), 'k1')).toEqual({ requestKey: 'k1', entryId: 'e-ben', membershipId: 'm1', target: { kind: 'period', periodIndex: 1 }, amountMinor: 2500 });
  });
});

describe('who paid, and on which device', () => {
  it.each([
    [row(), 'Ben Ortiz', null],
    [row({ person: null, customer: { name: 'Amy Lee', email: null, phone: null } }), 'Amy Lee', 'Name from Square'],
    [row({ person: null, customer: { name: null, email: 'x@y.z', phone: null } }), 'Unknown', null],
    [row({ person: null, customer: null, reason: 'no_customer' }), 'Unknown', null],
  ])('who: %#', (r, who, note) => {
    expect(whoWords(r)).toBe(who);
    expect(whoNote(r)).toBe(note);
  });
  it('the device the gym named in Square, then how it was paid', () => {
    expect(takenWith(row({ deviceName: 'Front desk 1' }))).toBe('Front desk 1 · Visa ending 4242');
    expect(takenWith(row())).toBe('Visa ending 4242');
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
  it('the page says once why a payment left here matters', () => {
    expect(heldLine({ person: 'member' })).toBe("A member's card on file isn't charged while their payment waits here.");
    expect(heldLine({ person: 'client' })).toBe("A client's card on file isn't charged while their payment waits here.");
  });
  it('the person page names the bill as the row does', () => {
    expect(billFor(bill(), 'e-ben', TODAY)).toBe('Gold Weekly · due today');
  });
});

describe("Match's box", () => {
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
    expect(markedLine('other')).toBe('Marked as not for a bill.');
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
  const w = (over = {}) => ({
    id: 'w',
    amountMinor: 2706,
    currency: 'USD',
    takenOn: '2026-10-22',
    takenAt: '2026-10-22T15:14:00.000Z',
    deviceName: null,
    byName: null,
    holdsCard: true,
    enteredMinor: null,
    maybeTwice: false,
    bill: null,
    ...over,
  });
  it.each([
    [w(), 'Paid $27.06 in Square Point of Sale at 10:14 AM on 22 Oct.'],
    [w({ deviceName: 'Front desk 2' }), 'Paid $27.06 in Square Point of Sale at 10:14 AM on 22 Oct on Front desk 2.'],
    [w({ amountMinor: 5000, byName: 'Ann Ortiz' }), 'Ann Ortiz, who pays for them, paid $50.00 in Square Point of Sale at 10:14 AM on 22 Oct.'],
  ])('who paid, how much, when and where: %#', (waiting, words) => {
    expect(waitingLine(waiting, 'America/Chicago', 'US')).toBe(words);
  });
  it('a bill ticked is pressed there; otherwise it says where it waits', () => {
    expect(waitingNext(w())).toBe('It is waiting in Payments to match.');
    expect(waitingNext(w({ bill: bill() }))).toBeNull();
  });
  it('the note beside a bill ticked, as the list says it', () => {
    expect(waitingNote(w({ bill: bill(), enteredMinor: 2500 }))).toEqual({ tone: 'info', text: '$25.00 goes on the bill. Square added $2.06 on top.' });
    expect(waitingNote(w({ bill: bill(), maybeTwice: true }))).toEqual({ tone: 'warn', text: "Their last bill was paid less than 2 days ago. Check they didn't pay twice." });
    expect(waitingNote(w({ enteredMinor: 2500 }))).toBeNull();
    expect(waitingNote(w({ bill: bill() }))).toBeNull();
  });
});
