// What a person's page says about the customers in the gym's Square customer list that Match linked to them, and Unlink
// (ROADMAP 18d-iii-b-ii-c-ii; spec Part 3 §14.8). Pure, so every sentence is tested. "Your Square customer list" is what the gym
// already calls it (Members in Square, Delete permanently); the customer is named as Square names them, asked when Unlink's box
// opens, never kept here.
import { cardName, formatMinor } from '@app/shared';

const count = (n, one, many) => `${String(n)} ${n === 1 ? one : many}`;
const day = (iso, timezone) => new Intl.DateTimeFormat('en-GB', { timeZone: timezone, day: 'numeric', month: 'short' }).format(new Date(iso));

export const SQUARE_LINKS_TITLE = 'Square customer list';

/** One customer Match linked: the payment whose Match linked it, so staff know which, and what linking does. */
export function linkLine(link, timezone) {
  const when = link.from === null ? `on ${day(link.linkedAt, timezone)}` : `when ${formatMinor(link.from.amountMinor, link.from.currency)} paid on ${day(link.from.takenAt, timezone)} was matched`;
  return link.also
    ? `A second customer in your Square customer list, linked ${when}. This customer’s payments in Square Point of Sale also come to this page.`
    : `Linked to a customer in your Square customer list ${when}. This customer’s payments in Square Point of Sale come to this page.`;
}

/** Unlink's box: the question, then what changes and what stays, one sentence each, before anything changes. */
export function unlinkBoxLines(box, personName) {
  const lines = [];
  if (box.customerName !== null) lines.push(`In Square, this customer is ${box.customerName}.`);
  if (box.waiting > 0) {
    lines.push(`${count(box.waiting, 'payment', 'payments')} from this customer waiting on this page ${box.waiting === 1 ? 'goes' : 'go'} back to Payments to match.`);
  }
  if (box.card !== null) {
    lines.push(`${personName}’s card on file, ${cardName(box.card)}, is saved on this customer, so it is removed and stopped in Square. Save their card again to keep charging it.`);
  }
  if (box.matched > 0) {
    lines.push(
      box.matched === 1
        ? '1 payment from this customer already on a bill stays there. To take it off, use Not this bill on that bill.'
        : `${String(box.matched)} payments from this customer already on bills stay there. To take one off, use Not this bill on that bill.`,
    );
  }
  lines.push(`Their next payments in Square Point of Sale wait in Payments to match, and the app won’t link this customer to ${personName} again by itself.`);
  if (box.added) lines.push(`${personName} is then added to your Square customer list again, not as this customer.`);
  return { question: `Unlink this Square customer from ${personName}?`, lines };
}

/** Said where Unlink was pressed, once it is done. */
export function unlinkedLine(done, personName) {
  const who = done.customerName === null || done.customerName === personName ? 'This Square customer’s' : `${done.customerName}’s`;
  const parts = [`Unlinked. ${who} payments in Square Point of Sale no longer come to ${personName}’s page.`];
  if (done.moved > 0) parts.push(`${count(done.moved, 'payment', 'payments')} went back to Payments to match.`);
  if (done.card !== null) parts.push(`Their ${cardName(done.card)} was removed. Save their card again.`);
  return parts.join(' ');
}
