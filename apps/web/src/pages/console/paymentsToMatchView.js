// PAYMENTS TO MATCH, its words (ROADMAP 18d-iii-b-ii-a). Pure, so the tests read every row without a
// browser. A row is short facts in a list, as Failed payments shows them: when it was taken, what with,
// who Square says it was, why it waits and what to do, and whether it holds a card on file. The words
// are a payments list's: Match, as accounting software names putting a payment on its invoice; Square
// Point of Sale, Square's own name for its app.
import { MEMBER_FEE_WORDS, MEMBER_PAYMENT_METHOD_WORDS, cardName, currencyDecimals, formatMinor, minorToPriceText, priceToMinor } from '@app/shared';
import { whenWords } from './failedPaymentsView';
import { billDays, shortDay } from './memberBillsView';

export { canMatchPayments } from './paymentsToMatchAccess';

export const TO_MATCH_INTRO = "Payments taken in Square Point of Sale that didn't go on a bill by themselves. Match each one to the bill it was for.";
export const TO_MATCH_NONE = "No payments to match. A payment taken in Square Point of Sale that doesn't go on a bill by itself is listed here.";
export const TO_MATCH_NO_SQUARE = "Square isn't connected right now, so these payments can't be checked with Square before they go on a bill. Reconnect Square to match them.";
export const TO_MATCH_NO_SQUARE_STAFF = "Square isn't connected right now, so these payments can't be checked with Square before they go on a bill. The owner can reconnect Square in Settings.";

const money = (minor, currency) => formatMinor(minor, currency);

/** Payments at this gym's Square location that another gym here uses too, with no customer added: listed
 *  for neither. Null for none. */
export function sharedLocationLine(n) {
  if (n <= 0) return null;
  const many = n === 1 ? '1 payment taken at your Square location isn’t listed here' : `${String(n)} payments taken at your Square location aren’t listed here`;
  return `${many}: another gym in this app uses the same location, and no customer was added to the sale, so they can’t be told apart.`;
}
/** What fixes it: a location of its own for one of the two gyms. Square keeps a connected gym on its
 *  location, so that gym connects Square again and chooses the new one. */
export const SHARED_LOCATION_FIX = 'To match them, give each gym its own location in Square, then in one of the two gyms disconnect Square and connect it again, choosing the new location.';
export const SHARED_LOCATION_STAFF = 'The owner can give each gym its own Square location.';
const totalWords = (totals) => totals.map((t) => money(t.minor, t.currency)).join(' + ');
const count = (n) => (n === 1 ? '1 payment' : `${String(n)} payments`);

/** "3 payments to match · $135.00"; null where there are none. */
export function toMatchHeadline(summary) {
  if (summary.count === 0) return null;
  return `${count(summary.count)} to match · ${totalWords(summary.totals)}`;
}

/** Overview's line: null where there are none. */
export function overviewLine(summary) {
  if (summary.count === 0) return null;
  return { value: `${count(summary.count)} from Square Point of Sale to match.`, total: `${totalWords(summary.totals)} in all` };
}

/** Who the row is: the person here, Square's name for a customer linked to nobody, or nobody picked. */
export function whoWords(row) {
  if (row.person !== null) return row.person.name;
  if (row.customer?.name) return `${row.customer.name} (in Square)`;
  if (row.customer !== null) return 'A customer in Square';
  return row.reason === 'several_people' ? 'A customer in Square' : 'No customer added';
}

/** "$27.06", with its tip where there was one: the tip stays with Square and is no bill's. */
export function rowAmount(row) {
  const amount = money(row.amountMinor, row.currency);
  return row.tipMinor > 0 ? `${amount} + ${money(row.tipMinor, row.currency)} tip` : amount;
}

/** How it was paid, as Square says (its `source_type`). */
const SOURCES = {
  CARD: 'Card',
  CASH: 'Cash',
  WALLET: 'Digital wallet',
  BANK_ACCOUNT: 'Bank account',
  BUY_NOW_PAY_LATER: 'Buy now, pay later',
  SQUARE_ACCOUNT: 'Square account balance',
  EXTERNAL: 'Another payment method, noted in Square',
};

export function paidWith(row) {
  if (row.card !== null) return cardName(row.card);
  return row.source === null ? 'Not said by Square' : (SOURCES[row.source] ?? 'Another payment method');
}

/** "A and B", "A, B and C". */
const andList = (names) => (names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** What Square added on top of what staff entered, where Square showed it. */
const addedMinor = (row) => (row.enteredMinor === null ? null : row.amountMinor - row.enteredMinor);

/** Why it is on the list, in one sentence. */
export function reasonWords(row) {
  const who = row.person?.name ?? 'This person';
  const amount = money(row.amountMinor, row.currency);
  switch (row.reason) {
    case 'no_customer':
      return 'No customer was added to the sale in Square Point of Sale.';
    case 'not_linked':
      return "This customer in Square isn't linked to anyone on your list yet.";
    case 'several_people':
      return row.linkedNames.length > 1 ? `This customer in Square is linked to ${andList(row.linkedNames)}.` : 'This customer in Square is linked to more than one person on your list.';
    case 'mixed_sale':
      return 'The sale also had items from your Square item list.';
    case 'sale_unread':
      return "Square didn't show what was sold.";
    case 'square_tax': {
      const added = addedMinor(row);
      return added === null || added <= 0
        ? 'Square added tax on top of the amount entered.'
        : `Square added ${money(added, row.currency)} of tax on top of the ${money(row.enteredMinor, row.currency)} entered.`;
    }
    case 'no_bill':
      return `${who} has no bill of ${amount}.`;
    case 'too_early':
      return `${who}'s bill of ${amount} isn't due in the next week.`;
    case 'several_bills':
      return `${who} has more than one bill of ${amount} due.`;
    case 'busy':
      return `A payment for ${who}'s bill was being taken on the Square Terminal or the card on file at the same time.`;
    case 'maybe_twice':
      return `${who}'s last bill was paid less than 2 days before this. They may have paid twice.`;
    case 'other_location':
      return 'It was taken at another location of your Square account.';
    case 'several_gyms':
      return 'It was taken at a location another gym here also uses, with no customer added.';
    case 'not_this_bill':
      return `It was taken off ${who === 'This person' ? 'a bill' : `${who}'s bill`} with Not this bill.`;
    case 'refunded':
      return row.refundedMinor > 0 ? `Square has refunded ${money(row.refundedMinor, row.currency)} of it.` : 'Square has refunded some or all of it.';
    default:
      return "It couldn't go on a bill by itself.";
  }
}

/** What staff do about it, in one sentence. */
export function nextStepWords(row) {
  switch (row.reason) {
    case 'no_customer':
    case 'not_linked':
      return 'Match it to the bill of the person who paid.';
    case 'several_people':
      return "Match it to the right person's bill.";
    case 'mixed_sale':
      return 'Match asks how much of it was for the bill.';
    case 'square_tax':
      return row.enteredMinor === null ? 'Match asks how much of it was for the bill.' : `Match puts the ${money(row.enteredMinor, row.currency)} entered on the bill.`;
    case 'no_bill':
      return 'Match it to the bill it was for, or choose Not a bill payment for a shop sale.';
    case 'too_early':
      return 'Match puts it on that bill now, paid early.';
    case 'busy':
      return 'Match it once that payment has finished.';
    case 'maybe_twice':
      return 'If they paid twice, refund it in your Square Dashboard, then choose Not a bill payment. Otherwise match it to their next bill.';
    case 'other_location':
      return 'Match it if it was for a bill here. Otherwise choose Not a bill payment.';
    case 'refunded':
      return 'Choose Not a bill payment.';
    default:
      return 'Match it to the bill it was for.';
  }
}

/** The row's facts, label and value, in the order a payments list shows them. */
export function rowFacts(row, timezone, country) {
  const square = row.customer === null ? null : [row.customer.name, row.customer.email, row.customer.phone].filter((part) => part !== null).join(' · ');
  return [
    { label: 'Taken', value: whenWords(row.takenAt, timezone, country) },
    { label: 'Paid with', value: paidWith(row) },
    ...(square === null || square === '' ? [] : [{ label: 'In Square', value: square }]),
    { label: 'Why it’s here', value: reasonWords(row) },
    { label: 'Next step', value: nextStepWords(row) },
    ...(row.holdsCard && row.person !== null ? [{ label: 'Card on file', value: `Not charged for ${row.person.name} while this waits` }] : []),
  ];
}

/** Square added tax on top, so the gym's own Square settings are worth a look (Settings → Payments). */
export const showsTaxFix = (row) => row.reason === 'square_tax';

// ── Match's box ──

/** What a bill is, as Match lists it: "Gold Weekly · 19 Oct – 25 Oct 2026", a fee's kind and what it
 *  was for, with the name of whoever it is where it is somebody the person pays for. */
export function billLabel(bill, personEntryId) {
  const what = bill.fee !== null ? `${MEMBER_FEE_WORDS[bill.fee.kind]} · ${bill.fee.forName}` : bill.covers === null ? bill.typeName : `${bill.typeName} · ${billDays(bill.covers)}`;
  return bill.entryId === personEntryId ? what : `${bill.name}: ${what}`;
}

/** "$25.00 left · Due 25 Oct", "… · Due today", "… · Was due 18 Oct". */
export function billDue(bill, today) {
  const left = `${money(bill.leftMinor, bill.currency)} left`;
  if (bill.dueOn === today) return `${left} · Due today`;
  return bill.dueOn < today ? `${left} · Was due ${shortDay(bill.dueOn, false)}` : `${left} · Due ${shortDay(bill.dueOn, false)}`;
}

/** Why a bill can't take this payment, or null where it can. */
export function billCannot(bill, amountMinor, currency) {
  switch (bill.cannot) {
    case 'too_little':
      return `Only ${money(bill.leftMinor, bill.currency)} is left on this bill, less than ${money(amountMinor, currency)}.`;
    case 'fee_whole':
      return `A fee is paid all at once, and this fee is ${money(bill.leftMinor, bill.currency)}.`;
    case 'busy':
      return 'A payment for this is being taken on the Square Terminal or the card on file.';
    case 'currency':
      return 'This bill is in another currency.';
    default:
      return null;
  }
}

/** A payment already on one of their bills: "$25.00 · Cash · 19 Oct", for whom where it is not them. */
export function paidLine(p) {
  const base = `${money(p.amountMinor, p.currency)} · ${MEMBER_PAYMENT_METHOD_WORDS[p.method] ?? 'Payment'} · ${shortDay(p.paidOn, false)}`;
  return p.forName === null ? base : `${base} · for ${p.forName}`;
}

/** What goes on the bill, said before Match is pressed: the part entered, where Square added more. */
export function enteredLine(row) {
  const added = addedMinor(row);
  if (row.enteredMinor === null || added === null || added <= 0) return null;
  return `${money(row.enteredMinor, row.currency)} goes on the bill. Square added ${money(added, row.currency)} on top.`;
}

/** The question where Square didn't say how much was for a bill. */
export const amountQuestion = (row) => `How much of the ${money(row.amountMinor, row.currency)} is for this bill?`;

export const matchButton = (minor, currency) => `Match ${money(minor, currency)} to this bill`;

/** Said in the row once it is matched. */
export const matchedLine = (matched) => `Matched: ${money(matched.amountMinor, matched.currency)} on ${matched.name}'s bill. Receipt ${String(matched.receiptNumber)}.`;

// ── Not a bill payment ──

export const NOT_A_BILL_CHOICES = [
  { value: 'other', label: 'A shop sale, or something else' },
  { value: 'by_hand', label: 'It’s already recorded on a bill by hand' },
];

export const markedLine = (why) => (why === 'by_hand' ? 'Marked as already recorded on a bill by hand.' : 'Marked as not a bill payment.');

/** Said in the box before it is pressed, where the payment holds somebody's card on file. */
export const releasesCard = (row) => (row.holdsCard && row.person !== null ? `${row.person.name}'s card on file can then be charged for their bills again.` : null);

// ── On the person's page ──

/** A payment waiting that holds this person's card on file, as their page says it. */
export function waitingLine(w, currency) {
  const amount = money(w.amountMinor, w.currency ?? currency);
  const day = shortDay(w.takenOn, false);
  const lead = w.byName === null ? `A payment of ${amount} taken in Square Point of Sale on ${day} is waiting to be matched.` : `A payment of ${amount} by ${w.byName}, who pays for them, taken in Square Point of Sale on ${day}, is waiting to be matched.`;
  return w.holdsCard ? `${lead} While it waits, the card on file isn't charged.` : lead;
}

// ── The amount Match asks for, where Square didn't say ──

/** Why the amount typed can't go on that bill, or the money it is. */
export function amountFor(text, row, bill) {
  const minor = priceToMinor(text, row.currency);
  if (minor === null || minor <= 0) {
    return { problem: (currencyDecimals(row.currency) ?? 2) === 0 ? 'Type the amount for this bill, as a whole number.' : 'Type the amount for this bill, like 20 or 20.50.', minor: null };
  }
  if (minor > row.amountMinor) return { problem: `That is more than this payment. It is ${money(row.amountMinor, row.currency)}.`, minor: null };
  if (bill.fee !== null && minor !== bill.leftMinor) return { problem: `A fee is paid all at once: ${money(bill.leftMinor, bill.currency)}.`, minor: null };
  if (minor > bill.leftMinor) return { problem: `That is more than is left on this bill. ${money(bill.leftMinor, bill.currency)} is left.`, minor: null };
  return { problem: null, minor };
}

/** What the amount box starts with: all of the payment, or what is left on the bill where that is less. */
export const amountStart = (row, bill) => minorToPriceText(bill === null ? row.amountMinor : Math.min(row.amountMinor, bill.leftMinor), row.currency);

/** The rows on screen after a read: those read now, and each one done here kept where it was, so what
 *  happened is still said in its place (another person's press takes theirs away). */
export function keepDone(previous, fresh, doneIds) {
  const out = [...fresh];
  previous.forEach((row, index) => {
    if (!doneIds.has(row.id) || out.some((r) => r.id === row.id)) return;
    out.splice(Math.min(index, out.length), 0, row);
  });
  return out;
}
