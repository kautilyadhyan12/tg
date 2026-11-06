import { PRICE_RAISE_NOTICE_DAYS, formatMinor, priceToMinor } from '@app/shared';
import { shortDay } from './memberBillsView';

// RAISE THE PRICE FOR MEMBERS ALREADY ON A LINE (ROADMAP 18w): the question under a higher price, the box of who goes
// up and who won't, what Save sends, and a person's page line, from the server's answers.

/** The notice choices, as the form lists them. */
export const RAISE_NOTICE_OPTIONS = PRICE_RAISE_NOTICE_DAYS.map((d) => ({ value: String(d), label: `${String(d)} days before` }));

/** The names shown before See all. */
export const RAISE_FEW = 3;

/** The draft's own fields for the question; a new draft and a changed one start with them. */
export const RAISE_DRAFT = { savedPriceMinor: null, raiseChoice: '', raiseNotice: '30', raiseOffer: null, raiseUnticked: [] };

/** The new price in minor units, where the form asks about members already on it: a repeating line already saved,
 *  its price now higher than the one saved. Null otherwise. */
export function raisedPriceMinor(draft, currency) {
  if (draft.id === null || draft.choice !== 'recurring' || draft.savedPriceMinor === null || draft.savedPriceMinor === undefined) return null;
  const minor = priceToMinor(draft.price, currency);
  return minor !== null && minor > draft.savedPriceMinor ? minor : null;
}

/** What the box is asked for, or null: the new price and the notice. */
export function raiseAsk(draft, currency) {
  const priceMinor = raisedPriceMinor(draft, currency);
  return priceMinor === null ? null : { priceMinor, noticeDays: Number(draft.raiseNotice), key: `${String(priceMinor)}|${draft.raiseNotice}` };
}

/** The box's answer for what the form asks now; null while it loads or after it failed. */
function offerNow(draft, currency) {
  const ask = raiseAsk(draft, currency);
  const offer = draft.raiseOffer;
  return ask === null || offer === null || offer === undefined || offer.key !== ask.key ? null : offer;
}

const WRITABLE = ['will_send', 'after_freeze'];

/** The memberships Save raises: everybody the box says goes up, but those staff unticked. */
export function raiseIds(draft, currency) {
  const offer = offerNow(draft, currency);
  if (offer === null || offer.failed) return [];
  return offer.people.filter((p) => WRITABLE.includes(p.status.state) && !draft.raiseUnticked.includes(p.membershipId)).map((p) => p.membershipId);
}

/** Whether the form asks the question at all: somebody holds the line now. */
export function raiseAsked(draft, currency) {
  const offer = offerNow(draft, currency);
  return offer !== null && !offer.failed && offer.people.length > 0;
}

/** What is wrong with the answer, or null. */
export function raiseProblem(draft, currency) {
  const ask = raiseAsk(draft, currency);
  if (ask === null) return null;
  const offer = offerNow(draft, currency);
  if (offer === null) return draft.raiseChoice === 'raise' ? 'Wait a moment: the list of members on it is still loading.' : null;
  if (offer.failed) return draft.raiseChoice === 'raise' ? "We couldn't load who is on it. Choose Keep their price, or try again." : null;
  if (offer.people.length === 0) return null;
  if (draft.raiseChoice === '') return 'Choose what the members already on it pay.';
  if (draft.raiseChoice === 'raise' && raiseIds(draft, currency).length === 0) return 'Tick at least one member, or choose Keep their price.';
  return null;
}

/** What Save sends for it, or nothing. */
export function raiseBody(draft, currency) {
  if (draft.raiseChoice !== 'raise' || raiseAsk(draft, currency) === null) return {};
  const ids = raiseIds(draft, currency);
  return ids.length === 0 ? {} : { raise: { noticeDays: Number(draft.raiseNotice), membershipIds: ids } };
}

const GROUPS = [
  ['goes_up', 'Pays the new price'],
  ['not_renewing', "Won't change: their membership won't renew"],
  ['raise_waiting', "Won't change: already told of a new price"],
  ['not_higher', "Won't change: they already pay this or more"],
  ['no_email', "Won't change: no email address to send the notice to"],
  ['address_blocked', "Won't change: their email address could not be delivered to"],
  ['former_payer', "Won't change: whoever pays for them is a past member"],
  ['billed_elsewhere', "Won't change: paid in your other software"],
];

/** One person's line in the box. */
function personLine(p, currency) {
  const name = p.name || 'Somebody on your list';
  const who = p.paidBy === null ? name : `${name}, paid by ${p.paidBy || 'somebody on your list'}`;
  const s = p.status;
  const from = formatMinor(s.fromMinor, currency);
  const to = formatMinor(s.toMinor, currency);
  if (s.state === 'will_send' && s.startsOn !== null && s.on !== null) return `${who} · ${from} to ${to} from ${shortDay(s.startsOn, false)} · emailed ${shortDay(s.on, false)}`;
  if (s.state === 'after_freeze') return `${who} · ${from} to ${to} once back from their freeze, emailed first`;
  if (s.state === 'raise_waiting' && s.startsOn !== null) return `${who} · ${to} from ${shortDay(s.startsOn, false)}`;
  return who;
}

/** What the box lists: who pays the new price, each with a tick, and who won't with the reason. */
export function raiseBox(draft, currency) {
  const ask = raiseAsk(draft, currency);
  if (ask === null) return null;
  const offer = offerNow(draft, currency);
  if (offer === null) return { loading: true, failed: false, groups: [] };
  if (offer.failed) return { loading: false, failed: true, groups: [] };
  const groups = GROUPS.map(([key, title]) => {
    const people = offer.people
      .filter((p) => (key === 'goes_up' ? WRITABLE.includes(p.status.state) : p.status.state === key))
      .map((p) => ({ membershipId: p.membershipId, line: personLine(p, offer.currency), ticked: key === 'goes_up' ? !draft.raiseUnticked.includes(p.membershipId) : null }));
    return { key, title: `${title} (${String(people.length)})`, people };
  }).filter((g) => g.people.length > 0);
  return { loading: false, failed: false, groups };
}

/** What a done Save says of it, beside the line: how many go up, and when they hear. */
export function raisedNote(count, noticeDays) {
  if (count === undefined || count === null) return null;
  if (count === 0) return 'Saved. Nobody already on it pays the new price.';
  const who = count === 1 ? '1 member pays' : `${String(count)} members pay`;
  return `Saved. ${who} the new price from their first payment at least ${String(noticeDays)} days away, and each is emailed ${String(noticeDays)} days before it.`;
}

/** A person's page, under a membership whose price was raised: what happens to it. */
export function priceRaiseLine(status, currency) {
  if (status === null || status === undefined) return null;
  const from = formatMinor(status.fromMinor, currency);
  const to = formatMinor(status.toMinor, currency);
  const starts = status.startsOn === null ? null : shortDay(status.startsOn, false);
  switch (status.state) {
    case 'will_send':
      return starts === null || status.on === null ? null : `Price goes up to ${to} from the payment on ${starts}. The notice is emailed on ${shortDay(status.on, false)}.`;
    case 'after_freeze':
      return `Price goes up to ${to} once it is back from its freeze. The notice is emailed first.`;
    case 'sending':
      return starts === null ? `Price goes up to ${to}. The notice is being emailed.` : `Price goes up to ${to} from the payment on ${starts}. The notice is being emailed.`;
    case 'sent':
      return starts === null || status.on === null ? null : `Price goes up to ${to} from the payment on ${starts}. Notice emailed on ${shortDay(status.on, false)}.`;
    case 'not_renewing':
      return `Price stays ${from}: it won't renew before the new price would start.`;
    case 'no_email':
      return `Price stays ${from} until whoever pays has an email address, so the notice can be sent.`;
    case 'address_blocked':
      return `Price stays ${from}: the notice could not be delivered to their email address.`;
    case 'not_sent':
      return `Price stays ${from}: the notice could not be delivered.`;
    case 'former_payer':
      return `Price stays ${from}: whoever pays for it is a past member.`;
    case 'billed_elsewhere':
      return `Price stays ${from}: it is paid in your other software.`;
    default:
      return null;
  }
}

/** Keep the old price's button, and what it says once done. */
export function keepPriceWords(status, currency) {
  const from = formatMinor(status.fromMinor, currency);
  return { button: `Keep ${from}`, done: `Kept at ${from}. Nothing more is charged.` };
}
