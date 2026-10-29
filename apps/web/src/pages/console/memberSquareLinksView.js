// What a person's page says about the customers in Square that Match linked to them, and Unlink (ROADMAP 18d-iii-b-ii-c-ii;
// spec Part 3 §14.8). Pure, so every sentence is tested. Short whole sentences that name who: the Square customer as Square names
// them (asked when the page reads them, never kept), the person by their name here. Kd's click-through: the first words, which
// named the payment that linked it and "your Square customer list", could not be understood.
import { cardName, formatMinor } from '@app/shared';

const day = (iso, timezone) => new Intl.DateTimeFormat('en-GB', { timeZone: timezone, day: 'numeric', month: 'short' }).format(new Date(iso));

/** The Square customer by their name in Square, where it says something the person's own name doesn't. */
const named = (customerName, personName) => (customerName === null || customerName === personName ? null : customerName);

/** The heading: once Unlink took the last one, nothing here is linked any more. */
export const linksTitle = (links) => (links.length === 0 ? 'Square customer' : links.length > 1 ? 'Linked Square customers' : 'Linked Square customer');

/** One linked customer: who, and what linking does. */
export function linkLine(link, personName) {
  const name = named(link.customerName, personName);
  if (name !== null) return `${name} in Square is linked to ${personName}. Square payments made under ${name} show on this page.`;
  if (link.customerName !== null) return `${personName} in Square is linked to this page. Square payments made under ${personName} show here.`;
  return `A customer in Square is linked to ${personName}. Square payments made under that customer show on this page.`;
}

/** When it was linked, said small under the line. */
export const linkedOn = (link, timezone) => `Linked on ${day(link.linkedAt, timezone)}.`;

/** Unlink's box: the question, then what changes, one short sentence each, before anything changes. */
export function unlinkBoxLines(box, personName) {
  const name = named(box.customerName, personName);
  const them = name ?? 'this customer';
  const lines = [];
  if (box.waiting === 1 && box.currency !== null) lines.push(`The ${formatMinor(box.waitingMinor, box.currency)} payment from ${them} moves to Payments to match.`);
  else if (box.waiting > 1 && box.currency !== null) {
    lines.push(`The ${String(box.waiting)} payments from ${them} waiting here (${formatMinor(box.waitingMinor, box.currency)} in all) move to Payments to match.`);
  }
  if (box.shopItems === 1 && box.currency !== null) lines.push(`The ${formatMinor(box.shopItemsMinor, box.currency)} sale of shop items from ${them} becomes a shop sale and leaves this page.`);
  else if (box.shopItems > 1 && box.currency !== null) {
    lines.push(`The ${String(box.shopItems)} sales of shop items from ${them} (${formatMinor(box.shopItemsMinor, box.currency)} in all) become shop sales and leave this page.`);
  }
  if (box.notBill > 0) lines.push(`${box.notBill === 1 ? 'The payment' : `The ${String(box.notBill)} payments`} from ${them} marked Not for a bill ${box.notBill === 1 ? 'stays' : 'stay'} marked.`);
  if (box.card !== null) lines.push(`${personName}’s card (${cardName(box.card)}) is removed, because it was saved under ${them} in Square. Add the card again.`);
  if (box.matched > 0) lines.push('Payments already recorded stay as they are.');
  lines.push(`${name === null ? 'This customer’s' : `${name}’s`} future Square payments won’t show here.`);
  if (box.added) lines.push(`${personName} will be added to Square as a customer of their own.`);
  return { question: name === null ? `Unlink this Square customer from ${personName}?` : `Unlink ${name} from ${personName}?`, lines };
}

/** Said where Unlink was pressed, once it is done. */
export function unlinkedLine(done, personName) {
  const name = named(done.customerName, personName);
  const parts = [`Unlinked. ${name === null ? 'This customer’s' : `${name}’s`} Square payments no longer show on this page.`];
  if (done.moved === 1) parts.push('The payment is in Payments to match.');
  if (done.moved > 1) parts.push(`The ${String(done.moved)} payments are in Payments to match.`);
  if (done.card !== null) parts.push(`Add ${personName}’s card again.`);
  return parts.join(' ');
}
