// PAYMENTS TO MATCH, its words (ROADMAP 18d-iii-b-ii-a). Pure, so the tests read every row without a
// browser. Every payment taken in Square Point of Sale waits here for one press (Kd, 2026-10-25). A row is
// one line, as a bank feed's "For review" list is in accounting software: when, who paid, how much, and
// what it is for: the bill ticked, with Match, or in a few words what staff choose, with the button that
// says so. A note is added only where something needs checking. Square Point of Sale is Square's own name
// for its app; Match is accounting software's word for putting a payment on its bill.
import { MEMBER_FEE_WORDS, MEMBER_PAYMENT_METHOD_WORDS, cardName, currencyDecimals, formatMinor, minorToPriceText, priceToMinor } from '@app/shared';
import { whenWords } from './failedPaymentsView';
import { billDays, shortDay } from './memberBillsView';

export { canMatchPayments } from './paymentsToMatchAccess';

export const TO_MATCH_INTRO = 'Payments taken in Square Point of Sale. Match each one to the bill it pays.';
/** Said once, under the intro: why a payment left here matters. */
export const heldLine = (words) => `A ${words.person}'s card on file isn't charged while their payment waits here.`;
export const TO_MATCH_NONE = 'No payments to match. Payments taken in Square Point of Sale appear here until they are matched.';
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

/** Who paid: the person here, Square's name for a customer linked to nobody, or Unknown. */
export function whoWords(row) {
  if (row.person !== null) return row.person.name;
  if (row.customer?.name) return row.customer.name;
  return 'Unknown';
}

/** Said small under a name that is Square's, not the gym's list's. */
export const whoNote = (row) => (row.person === null && row.customer?.name ? 'Name from Square' : null);

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

/** "Front desk 1 · Visa ending 4242": the device that took it, so each desk knows its own, and how. */
export const takenWith = (row) => (row.deviceName === null || row.deviceName === undefined ? paidWith(row) : `${row.deviceName} · ${paidWith(row)}`);

/** "A and B", "A, B and C". */
const andList = (names) => (names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** What Square added on top of what staff entered, where Square showed it. */
const addedMinor = (row) => (row.enteredMinor === null ? null : row.amountMinor - row.enteredMinor);

/** "Due today", "due 1 Nov", "was due 18 Oct": against the gym's own day. */
function dueWords(dueOn, today) {
  if (dueOn === today) return 'due today';
  return dueOn < today ? `was due ${shortDay(dueOn, false)}` : `due ${shortDay(dueOn, false)}`;
}

/** The bill a payment is ticked for, as the row and the person's page say it: "Gold Monthly · due 1 Nov",
 *  a fee's kind and what it was for, and whose it is where it is somebody the person pays for. */
export function billFor(bill, personEntryId, today) {
  const what = bill.fee !== null ? `${MEMBER_FEE_WORDS[bill.fee.kind]} · ${bill.fee.forName}` : bill.typeName;
  const whose = bill.entryId === personEntryId ? '' : `${bill.name}: `;
  return `${whose}${what} · ${dueWords(bill.dueOn, today)}`;
}

/** What it is for: the bill ticked, or in a few words why staff choose. */
export function forWords(row, today) {
  if (row.bill !== null) return billFor(row.bill, row.person?.entryId ?? null, today);
  const who = row.person?.name ?? null;
  const amount = money(row.enteredMinor ?? row.amountMinor, row.currency);
  switch (row.reason) {
    case 'no_customer':
      return 'Nobody was picked in Square';
    case 'not_linked':
      return 'Not linked to anyone on your list';
    case 'several_people':
      return row.linkedNames.length > 1 ? `Linked to ${andList(row.linkedNames)}` : 'Linked to more than one person on your list';
    case 'mixed_sale':
      return 'Sold with shop items';
    case 'sale_unread':
      return "Square didn't say what was sold";
    case 'square_tax':
      return 'Square added tax on top';
    case 'several_bills':
      return `More than one bill of ${amount} is due`;
    case 'busy':
      return 'A payment for their bill is under way';
    case 'other_location':
      return 'Taken at another of your Square locations';
    case 'not_this_bill':
      return who === null ? 'Taken off a bill' : `Taken off ${who}'s bill`;
    case 'refunded':
      return row.refundedMinor > 0 ? `${money(row.refundedMinor, row.currency)} refunded in Square` : 'Refunded in Square';
    case 'shop_items':
      return 'Sold as shop items in Square';
    case 'paid_in_parts':
      return 'Paid in parts in Square';
    default:
      // No bill of the amount, or the one it fitted was paid another way since.
      return who === null ? `No bill of ${amount}` : `${who} has no bill of ${amount}`;
  }
}

/** A note under the row, only where something needs checking (`warn`) or the amount needs saying (`info`). */
export function rowNote(row) {
  if (row.reason === 'maybe_twice' && row.bill !== null) {
    const who = row.person?.name ?? 'They';
    return { tone: 'warn', text: `${who}'s last bill was paid less than 2 days ago. Check they didn't pay twice.` };
  }
  if (row.reason === 'busy') return { tone: 'info', text: 'Try again in a minute.' };
  if (row.reason === 'shop_items') return { tone: 'info', text: 'If it paid their membership, choose the bill. If not, choose Not for a bill.' };
  if (row.reason === 'refunded') return { tone: 'info', text: 'Choose Not for a bill.' };
  if (row.bill !== null) return enteredLine(row) === null ? null : { tone: 'info', text: enteredLine(row) };
  return null;
}

/** The row's one main button: Match where a bill is ticked; otherwise what staff choose; none where it
 *  can't go on a bill (refunded). */
export function rowAction(row) {
  if (row.reason === 'refunded') return null;
  if (row.bill !== null) return 'match';
  return row.person === null ? 'who' : 'bill';
}

export const ACTION_WORDS = { match: 'Match', who: 'Choose who paid', bill: 'Choose the bill', other: 'Other bill', notBill: 'Not for a bill' };

/** What one press puts on the ticked bill: the request Match sends. */
export const pressFor = (bill, requestKey) => ({ requestKey, entryId: bill.entryId, membershipId: bill.membershipId, target: bill.target, amountMinor: bill.leftMinor });

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

// ── Linking Square's customer (18d-iii-b-ii-c) ──
// Under "Who paid?", for a payment whose Square customer is linked to nobody here: link them to the person, so that
// customer's next payments come to the person's page by themselves. "Your Square customer list" is what the gym
// already calls it; the tick is on only where the app can tell they are the same person.

/** The Square customer in a sentence: by Square's name where it differs from the person's, else "the Square customer", so
 *  a line never reads "Amy Lee … to Amy Lee". */
const customerWho = (customerName, personName) => (customerName === null || customerName === personName ? 'the Square customer' : customerName);
const upper = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** The tick's own label. The payment's row above it already names the customer. */
export const linkLabel = (personName) => `Link this Square customer to ${personName}`;

/** Under the tick: what linking does, and, where the app can't tell, to tick it only if they are the same person. */
export function linkNote(link, personName) {
  if (link.offer === 'taken') return null;
  const parts = [];
  if (link.offer === 'ask') {
    parts.push(`The app can’t tell they are the same person. Tick this only if ${customerWho(link.customerName, personName)} is ${personName}.`);
  } else {
    parts.push('Their name and contact details match.');
  }
  parts.push(`This customer’s next payments in Square Point of Sale then come to ${personName}’s page, with their bill ticked.`);
  if (link.also) parts.push(`${personName} already has a customer in your Square customer list. This one is linked to them as well.`);
  return parts.join(' ');
}

/** Where the customer can't be linked because somebody else here has it. */
export const linkTakenLine = (link, personName) => `This Square customer is already linked to ${link.byName ?? 'someone else here'}, so it can’t be linked to ${personName}.`;

/** What Match did about the customer, said after the press; empty where nothing was asked. */
export function linkDoneLine(link) {
  if (link === undefined || link.result === 'none') return '';
  const person = link.personName ?? 'them';
  const who = upper(customerWho(link.customerName, person));
  switch (link.result) {
    case 'linked':
    case 'also':
      return ` ${who} is now linked to ${person}. Their next payments come to their page.`;
    case 'taken':
      return ` ${who} wasn’t linked: it is already linked to someone else here.`;
    case 'gone':
      return ` ${who} wasn’t linked: it is no longer in your Square customer list.`;
    case 'merged':
      return ` ${who} wasn’t linked: Square has merged it into another customer.`;
    case 'past':
      return ` ${who} wasn’t linked: ${person} is a past member.`;
    default:
      return ` ${who} wasn’t linked: the app couldn’t check it in Square.`;
  }
}

/** Said in the row once it is matched, and what was done about Square's customer. */
export const matchedLine = (matched) =>
  `Matched: ${money(matched.amountMinor, matched.currency)} on ${matched.name}'s bill. Receipt ${String(matched.receiptNumber)}.${linkDoneLine(matched.link)}`;

// ── Not for a bill ──

export const NOT_A_BILL_CHOICES = [
  { value: 'other', label: 'A shop sale, or something else' },
  { value: 'by_hand', label: 'It’s already recorded on a bill by hand' },
];

export const markedLine = (why) => (why === 'by_hand' ? 'Marked as already recorded on a bill by hand.' : 'Marked as not for a bill.');

/** Said in the box before it is pressed, where the payment holds somebody's card on file. */
export const releasesCard = (row) => (row.holdsCard && row.person !== null ? `${row.person.name}'s card on file can then be charged for their bills again.` : null);

// ── On the person's page ──

/** A payment waiting that holds this person's card on file, as their page says it: who paid, how much,
 *  when and on which device. */
export function waitingLine(w, timezone, country) {
  const amount = money(w.amountMinor, w.currency);
  const when = whenWords(w.takenAt, timezone, country);
  const where = w.deviceName === null ? `at ${when}` : `at ${w.deviceName}, ${when}`;
  return w.byName === null
    ? `Paid ${amount} in Square Point of Sale ${where}.`
    : `${w.byName}, who pays for them, paid ${amount} in Square Point of Sale ${where}.`;
}

/** What follows it: the bill ticked for one press, or where it waits. */
export const waitingNext = (w) => (w.bill === null ? 'It is waiting in Payments to match.' : null);

/** Said where it holds their card. */
export const WAITING_HOLDS = "Their card on file isn't charged until it is matched.";

/** The note beside it, as the list's: Square's tax said, or that they may have paid twice. */
export function waitingNote(w) {
  if (w.maybeTwice && w.bill !== null) return { tone: 'warn', text: "Their last bill was paid less than 2 days ago. Check they didn't pay twice." };
  if (w.enteredMinor !== null && w.bill !== null) {
    return { tone: 'info', text: `${money(w.enteredMinor, w.currency)} goes on the bill. Square added ${money(w.amountMinor - w.enteredMinor, w.currency)} on top.` };
  }
  return null;
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
