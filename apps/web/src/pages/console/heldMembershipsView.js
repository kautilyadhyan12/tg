// A PERSON'S MEMBERSHIPS, their words (spec Part 3 §13.2; ROADMAP 17a-ii). Pure, so the
// tests read every state without a browser. The server works out each date and what can
// be done (`heldMembershipView` in `@app/shared`); this file only puts them into words.
// The one thing worked out here is the Add form's line under the start date, by the same
// shared rule the server gives the membership with.
import {
  HELD_STATUS_WORDS,
  HELD_START_AHEAD_DAYS,
  HELD_START_MIN,
  MEMBERSHIP_HAS_BOOKINGS_ERROR,
  addDays,
  classBookingsEndingSchema,
  dayOfMonthWords,
  daysBetween,
  formatMinor,
  fullFromOf,
  giveHeldMembership,
  heldMembershipView,
  isDayPass,
  partPeriod,
  periodIndex,
  shownRenewal,
} from '@app/shared';
import { dayHeading } from './classesView';
import { clockLabel } from './hoursView';
import { dayWords } from './memberListView';

const TONES = { upcoming: 'plain', active: 'green', frozen: 'orange', ended: 'plain', cancelled: 'plain' };

/** The word beside a membership's name. A past member's memberships are kept and not in
 *  use, so one that would be running says so instead of "Active". */
export function statusTag(m, past = false) {
  if (past && isLive(m)) return { tag: 'Not in use', tone: 'plain' };
  // Cancelled because it was changed for another one (18x): said as what happened.
  if (m.view.status === 'cancelled' && m.changedTo !== null && m.changedTo !== undefined) return { tag: 'Changed', tone: 'plain' };
  // The list's rows say each state in the same words (`HELD_STATUS_WORDS`).
  return { tag: HELD_STATUS_WORDS[m.view.status] ?? '', tone: TONES[m.view.status] ?? 'plain' };
}

/** Still in use or still to start: drawn open, with its buttons. */
export function isLive(m) {
  return m.view.status === 'active' || m.view.status === 'frozen' || m.view.status === 'upcoming';
}

/** When it runs: "Started 4 Oct 2026 · Renews 4 Nov 2026". One taken from the gym's list
 *  kept the list's renewal or end day, and its start day was worked back from that: it
 *  is not printed as the day the person started. */
export function datesLine(m) {
  const { status, endsOn, renewsOn } = m.view;
  if (m.fromList === true) return listDatesLine(m);
  const start = dayWords(m.startsOn);
  if (status === 'cancelled') {
    // Cancelled before its start day: it never started.
    const first = endsOn !== null && endsOn < m.startsOn ? `Was to start ${start}` : `Started ${start}`;
    return `${first} · Cancelled ${endsOn === null ? '' : dayWords(endsOn)}`.trim();
  }
  if (status === 'ended') return endsOn === null || endsOn === m.startsOn ? start : `${start} to ${dayWords(endsOn)}`;
  if (status === 'frozen') return `Started ${start} · Frozen since ${m.frozenOn === null ? '' : dayWords(m.frozenOn)}`.trim();
  const first = status === 'upcoming' ? `Starts ${start}` : `Started ${start}`;
  if (renewsOn !== null) return `${first} · Renews ${dayWords(renewsOn)}`;
  if (endsOn === null) return first;
  if (endsOn === m.startsOn) return `For ${start} only`;
  // A repeating membership with an end day was cancelled at the end of what is paid.
  return m.kind === 'recurring' ? `${first} · Ends ${dayWords(endsOn)}, won't renew` : `${first} · Ends ${dayWords(endsOn)}`;
}

function listDatesLine(m) {
  const { status, endsOn } = m.view;
  // The list's own day, also for somebody paid further ahead than one period. A free
  // repeating one has nothing paid up to that day, so the rule's next renewal is not
  // the list's day: none is printed.
  const renewsOn = m.kind === 'recurring' && m.priceMinor === 0 ? null : shownRenewal(m.view);
  const from = 'From your list';
  if (status === 'cancelled') return `${from} · Cancelled ${endsOn === null ? '' : dayWords(endsOn)}`.trim();
  if (status === 'ended') return endsOn === null ? from : `${from} · Ended ${dayWords(endsOn)}`;
  if (status === 'frozen') return `${from} · Frozen since ${m.frozenOn === null ? '' : dayWords(m.frozenOn)}`.trim();
  if (renewsOn !== null) return `${from} · Renews ${dayWords(renewsOn)}`;
  if (endsOn === null) return from;
  return m.kind === 'recurring' ? `${from} · Ends ${dayWords(endsOn)}, won't renew` : `${from} · Ends ${dayWords(endsOn)}`;
}

/** What the member list says this person's membership is, as a row of the Memberships
 *  box (17a-iii), so the box never reads "No membership yet" beside a list that names one.
 *  Null where the list says nothing, or the person has, or has had, the type that name
 *  is: then their own membership's row says it. `name` is the person. */
export function listedRow(listed, name, managesTypes = true) {
  if (listed === null || listed === undefined) return null;
  if (listed.type !== null && listed.held) return null;
  const who = `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  const day = listed.endsOn === null ? null : `${listed.endsOnKind === 'renews' ? 'Renews' : 'Ends'} ${dayWords(listed.endsOn)}`;
  const withDay = (text) => (day === null ? text : `${text} · ${day}`);
  if (listed.type === null) {
    return {
      title: listed.word,
      tag: 'Not set up',
      from: withDay('From your member list'),
      note: managesTypes
        ? `This membership has no price here yet. Set it up in Memberships, and ${name} gets it.`
        : `This membership has no price here yet. Once the owner sets it up, ${name} gets it.`,
      // The note names the Memberships page: the screen puts a button to it underneath.
      toMemberships: managesTypes,
    };
  }
  return {
    title: listed.type.name,
    tag: 'Not added',
    from: withDay(listed.ownName ? 'From your member list' : `Your member list says “${listed.word}”`),
    note: managesTypes
      ? `${who} doesn't have it here yet. Add it with Add membership, or go to Memberships to give it to everyone on your list who is missing it.`
      : `${who} doesn't have it here yet. Add it with Add membership.`,
    toMemberships: managesTypes,
  };
}

/** A pack's classes: "7 of 10 classes left"; null for any other kind, for a day pass, and
 *  for a pack that is over. */
export function classesLine(m) {
  if (m.kind !== 'pack' || m.classesLeft === null || isDayPass(m) || !isLive(m)) return null;
  return `${String(m.classesLeft)} of ${String(m.packClasses)} ${m.packClasses === 1 ? 'class' : 'classes'} left`;
}

/** What is paid or owed, and whether it needs staff's eye; null where there is nothing
 *  to pay or the membership is over. `today` is the gym's own day. */
export function paymentLine(m, today) {
  const p = m.view.payment;
  if (p === null) return null;
  if (p.state === 'paid') {
    // The newest month was let off by a cancelled bill, not paid (18a-ii): never "Paid".
    if (m.notCharged === true) {
      if (p.until === null) return { text: 'Nothing to pay', due: false };
      return { text: m.view.renewsOn === null ? 'Nothing more to pay' : `Nothing to pay now · next payment due ${dayWords(p.until)}`, due: false };
    }
    // Everything paid for the newest month was given back (18a-ii): the days are kept,
    // and the line says what happened to the money.
    if (m.refundedInFull === true) {
      const word = m.refundPending === true ? 'Refund pending' : 'Refunded';
      return { text: p.until === null || m.view.renewsOn === null ? word : `${word} · next payment due ${dayWords(p.until)}`, due: false };
    }
    if (p.until === null) return { text: 'Paid', due: false };
    return { text: m.view.renewsOn === null ? 'Paid to the end' : `Paid · next payment due ${dayWords(p.until)}`, due: false };
  }
  // What is owed is a late cancel or no-show fee alone (18h-i): said so to staff who read the
  // fees, so the line does not sit over a paid bill saying a payment is due.
  const feeOnly = m.billing !== null && m.billing !== undefined && m.billing.pay === null && (m.billing.fees ?? []).some((f) => f.state === 'due' || f.state === 'overdue');
  // The bill a payment is taken for reads Overdue (17i-ii): the line says it in the same red,
  // as the Members list does, by that bill and never by a month whose bill is not opened yet.
  // Only staff who read the bills are sent them.
  const late = feeOnly ? undefined : m.billing?.bills?.find((bill) => bill.periodIndex === m.billing.pay?.periodIndex && bill.state === 'overdue');
  if (late !== undefined) return { text: `Overdue since ${dayWords(late.dueOn)}`, due: true, overdue: true };
  const owed = feeOnly ? 'Fee due' : 'Payment due';
  if (p.since === null) return { text: owed, due: true };
  if (p.since > today) return { text: `${owed} on ${dayWords(p.since)}`, due: false };
  return { text: p.since === today ? `${owed} today` : `${owed} since ${dayWords(p.since)}`, due: true };
}

/** What the type costs once: "£49.99", or "Free". */
export function priceWords(m) {
  return m.priceMinor === 0 ? 'Free' : formatMinor(m.priceMinor, m.currency);
}

/** The question each button asks before it acts, and what it says will happen. `name`
 *  is the person; `today` the gym's own day. */
export function askWords(what, m, name, today) {
  const whose = `${name}'s ${m.typeName}`;
  switch (what) {
    case 'freeze':
      return {
        question: `Freeze ${whose}?`,
        detail: `It is put on hold from today. When you unfreeze it, every day it was frozen is added back, so ${name} loses no days.`,
        button: 'Freeze',
      };
    case 'unfreeze': {
      const days = m.frozenOn === null ? 0 : Math.max(0, daysBetween(m.frozenOn, today));
      const back = days === 0 ? 'It was frozen today, so its dates stay as they were.' : `${days === 1 ? 'The 1 day' : `The ${String(days)} days`} it was frozen ${days === 1 ? 'is' : 'are'} added back.`;
      return { question: `Unfreeze ${whose}?`, detail: `It runs again from today. ${back}`, button: 'Unfreeze' };
    }
    case 'cancel': {
      const last = m.view.can.cancelAtPeriodEnd;
      // Cancelled before it starts, a change on the next payment date is undone (18x).
      const back = m.view.status === 'upcoming' && m.changedFrom?.stopped === true ? ` ${m.changedFrom.typeName} renews again, as it did before the change.` : '';
      return {
        question: `Cancel ${whose}?`,
        detail:
          last === null
            ? `It stops today.${back} This can't be undone, but you can add a membership again.`
            : `${name} has paid up to ${dayWords(last)}. Cancel it on that day and they keep it until then, with no more payments; or stop it today. This can't be undone, but you can add a membership again.`,
        button: 'Cancel today',
        laterButton: last === null ? null : `Cancel on ${dayWords(last)}`,
      };
    }
    default:
      return null;
  }
}

/** The classes the server says a cancel would end the bookings of (409
 *  `membership_has_bookings`); null for any other answer. */
export function membershipBookingsAsked(err) {
  const data = err?.response?.data;
  if (data?.error !== MEMBERSHIP_HAS_BOOKINGS_ERROR) return null;
  const parsed = classBookingsEndingSchema.safeParse(data?.ending);
  // Classes booked on it, personal training sessions booked on it (17e-iv-a), or both.
  return parsed.success && (parsed.data.booked > 0 || parsed.data.ptSessions !== undefined) ? parsed.data : null;
}

/** What a cancel sends back once its box has been read: the classes' number and the
 *  sessions' mark, each only where the box named some. */
export function endingConfirm(ending) {
  return {
    ...((ending?.booked ?? 0) > 0 && typeof ending.mark === 'string' ? { confirmBookings: ending.mark } : {}),
    ...(ending?.ptSessions ? { confirmPtSessions: ending.ptSessions.mark } : {}),
  };
}

/** Said in the box when the classes are not the ones it listed a moment ago: the person
 *  booked or cancelled one between the box and its button, and the press ended nothing. */
export const ENDING_MOVED = 'The classes changed while this was open. Check them and press again.';

/** The same, for a box that also names personal training sessions (17e-iv-a). */
export const ENDING_MOVED_WITH_SESSIONS = 'What is booked changed while this was open. Check it and press again.';

/** How many of the classes the box lists before "See all". */
export const ENDING_CLASSES_SHOWN = 3;

/** The box that asks before a cancel ends the classes booked on the membership: who
 *  changes, what happens, and what does not change. `later`: it is cancelled on its
 *  last paid day (`m.view.can.cancelAtPeriodEnd`), so only classes after that day end. */
export function endingWords(ending, m, name, later, clockFormat) {
  const n = ending?.booked ?? 0;
  const classes = n === 1 ? '1 class' : `${n.toLocaleString('en')} classes`;
  const bookings = n === 1 ? '1 booking' : `${n.toLocaleString('en')} bookings`;
  const last = later ? (m.view.can.cancelAtPeriodEnd ?? null) : null;
  const rows = (Array.isArray(ending?.people) ? ending.people : []).map((row) => ({
    id: row.id,
    line: [row.className, dayHeading(row.localDate), clockLabel(row.localStartMinute, clockFormat)].filter((part) => part !== '').join(' · '),
  }));
  return {
    title: last === null ? `${name} has ${classes} booked with ${m.typeName}` : `${name} has ${classes} booked with ${m.typeName} after ${dayWords(last)}`,
    // What the server does with a freed place (spec §13.4): handed to the next in line, or
    // inside the gym's waitlist time left for the first of them to claim. Never "X gets it".
    change:
      n === 1
        ? `That booking ends and ${name}'s place is free again. If people are waiting, it goes to the next person on the waitlist; close to the class's start, to the first of them to claim it.`
        : `Those bookings end and ${name}'s place in each class is free again. Where people are waiting, it goes to the next person on the waitlist; close to a class's start, to the first of them to claim it.`,
    rows,
    // The server lists a hundred at most; the count is whole.
    unlisted: Math.max(0, n - rows.length),
    kept:
      last === null
        ? `Classes booked with ${m.kind === 'pack' ? 'another pack or a membership' : 'another membership or a pack'} stay booked. So does a class that has already started.`
        : `Classes up to ${dayWords(last)} stay booked. So do classes booked with another membership or a pack.`,
    button: `${last === null ? 'Cancel today' : `Cancel on ${dayWords(last)}`} and end ${endingThings(n, bookings, ending?.ptSessions?.count ?? 0)}`,
    /** The sessions' own lines, for a membership with no class booked on it. */
    ptTitle:
      last === null
        ? `${name} has personal training booked with ${m.typeName}`
        : `${name} has personal training booked with ${m.typeName} after ${dayWords(last)}`,
    ptKept:
      last === null
        ? `Sessions booked with ${m.kind === 'pack' ? 'another pack or a membership' : 'another membership or a pack'} stay booked.`
        : `Sessions up to ${dayWords(last)} stay booked. So do sessions booked with another membership or a pack.`,
  };
}

/** "2 bookings", "3 sessions", "2 bookings and 3 sessions". */
function endingThings(n, bookings, sessions) {
  const pt = sessions === 1 ? '1 session' : `${sessions.toLocaleString('en')} sessions`;
  if (sessions === 0) return bookings;
  return n === 0 ? pt : `${bookings} and ${pt}`;
}

/** The freeze fee a Freeze box offers (18z), or null where none is charged: its line and the
 *  tick's words. `m.freezeFeeFirstOn` is the server's: today, or a month on where a fee of an earlier
 *  freeze still covers today. The months after are counted from today's day of the month, and a
 *  shorter month takes its last day (frozen on the 31st: 28 Feb, then 31 Mar). */
export function freezeFeeAsk(m, name, today) {
  if (m.view.status === 'frozen' || !(m.freezeFeeMinor > 0) || !m.freezeFeeFirstOn) return null;
  const amount = formatMinor(m.freezeFeeMinor, m.currency);
  const day = Number(today.slice(8, 10));
  const each = `on the ${dayOfMonthWords(day)} of each month${day > 28 ? ' (the last day of shorter months)' : ''}`;
  const line =
    m.freezeFeeFirstOn === today
      ? `Freeze fee: ${amount} today, then ${amount} ${each} until it is unfrozen.`
      : `No freeze fee today: this month's is already on ${name}'s bills. Then ${amount} from ${dayWords(m.freezeFeeFirstOn)}, ${each} until it is unfrozen.`;
  return { line, tick: `Charge ${name} the freeze fee` };
}

/** What a freeze said once done, read from the server's answer: a fee is said only where one was
 *  opened today, never from the tick alone. Staff without the payments tick are sent no bills, so for
 *  them it is the fee they sent where the box said the first one is today (re-check, Low). */
export function freezeDoneWords(answer, m, name, today, sentMinor = 0) {
  const after = answer?.memberships?.find((x) => x.id === m.id) ?? null;
  const said = (minor) => `${m.typeName} is frozen. The ${formatMinor(minor, m.currency)} freeze fee is on ${name}'s bills, due today.`;
  if (after !== null && after.billing === null) return sentMinor > 0 && m.freezeFeeFirstOn === today ? said(sentMinor) : `${m.typeName} is frozen.`;
  const fee = (after?.billing?.fees ?? []).find((f) => f.fee === 'freeze' && f.on === today && (f.state === 'due' || f.state === 'overdue'));
  if (fee !== undefined) return said(fee.amountMinor);
  return `${m.typeName} is frozen.`;
}

/** For staff who cannot freeze without the fee: who can. */
export const FREEZE_FEE_WHO = 'Only staff who record payments can freeze without the fee.';

/** A frozen membership's freeze fee (18z), or null where it was frozen with none. */
export function freezeFeeLine(m) {
  if (m.view.status !== 'frozen' || !(m.freezeFeeMinor > 0)) return null;
  return `Freeze fee ${formatMinor(m.freezeFeeMinor, m.currency)} each month while frozen.`;
}

/** What each press did, said back in one line. */
export function doneWords(what, m) {
  switch (what) {
    case 'give':
      return 'Membership added.';
    case 'freeze':
      return `${m.typeName} is frozen.`;
    case 'unfreeze':
      return `${m.typeName} is running again.`;
    case 'cancelLater':
      return `${m.typeName} will end and won't renew.`;
    case 'cancel':
      return `${m.typeName} is cancelled.`;
    case 'change':
      return `${m.typeName} is changed.`;
    default:
      return 'Saved.';
  }
}

/** The Add form's start-day range, around the gym's own day: what the server takes. */
export function startRange(today) {
  return { min: HELD_START_MIN, max: addDays(today, HELD_START_AHEAD_DAYS) };
}

/** The Add form, worked out as staff choose: the line under the start date, and the
 *  words of the "paid" tick. `problem` is why it cannot be added as it stands. */
export function givePreview(type, startsOn, paid, today, paidMinor = null) {
  if (type === null || startsOn === '') return { line: null, paidLabel: null, problem: null };
  const made = giveHeldMembership(type, startsOn, paid, today, type.billDay ?? null);
  if (!made.ok) {
    return {
      line: null,
      paidLabel: null,
      problem:
        made.reason === 'already_over'
          ? 'With that start date this membership would already be over. Pick a later start date.'
          : 'Pick a start date no more than a year from today.',
    };
  }
  const view = heldMembershipView(made.membership, today);
  const held = { ...type, startsOn, frozenOn: null, classesLeft: made.membership.classesLeft, view };
  const line = [datesLine(held), classesLine(held)].filter((part) => part !== null).join(' · ');
  if (type.priceMinor === 0) return { line, paidLabel: null, problem: null };
  // What the tick would mean, said with its date for a repeating membership.
  const ifPaid = giveHeldMembership(type, startsOn, true, today, type.billDay ?? null);
  const until = ifPaid.ok ? heldMembershipView(ifPaid.membership, today).payment : null;
  // With a discount the tick says what they pay, the Total under it (18b-ii-b).
  const price = formatMinor(paidMinor ?? type.priceMinor, type.currency);
  const paidLabel =
    type.kind === 'recurring' && until !== null && until.state === 'paid' && until.until !== null
      ? `They have paid up to ${dayWords(until.until)}`
      : `They have paid the ${price}`;
  return { line, paidLabel, problem: null };
}

/** THE PART MONTH a new membership's first bill is for, where the gym bills everyone on one
 *  day of the month (18y; `type.billDay`): its days, the days of a whole period ending on that
 *  day, and the day full payments start. Null where its first bill is a whole period: no day,
 *  not a monthly or yearly membership, starting on the day, or a start so far back that the
 *  part month is over. The same rule the server gives it with. */
export function firstBillPart(type, startsOn, today) {
  if (type === null || type === undefined || startsOn === '') return null;
  const made = giveHeldMembership(type, startsOn, false, today, type.billDay ?? null);
  if (!made.ok || made.membership.fullFrom === null || periodIndex(made.membership, today) !== 0) return null;
  const part = partPeriod(made.membership);
  if (part === null) return null;
  return { ...part, from: startsOn, to: addDays(made.membership.fullFrom, -1), fullFrom: made.membership.fullFrom };
}

/** What a choice of membership comes to: the type, the line under the date, the words of
 *  the paid tick, and why it cannot be given. `value` is { typeId, startsOn, paid, method }.
 *  `methodNeeded`: it is ticked as paid and how they paid is not picked yet. */
export function membershipChoice(types, value, today, paidMinor = null) {
  const type = types.find((t) => t.id === value.typeId) ?? null;
  const preview = givePreview(type, value.startsOn, value.paid, today, paidMinor);
  const pays = type !== null && type.priceMinor > 0 && value.paid === true;
  return { type, ...preview, methodNeeded: pays && preview.problem === null && (value.method ?? '') === '' };
}

/** Said where a form is sent with the paid tick on and no way of paying picked. */
export const METHOD_NEEDED = 'Choose a payment method.';

/** What the server is sent for a choice. `requestKey` is made once a form. A paid one
 *  says how it was paid: the server records the payment with the membership. */
export function giveBody(requestKey, type, value, discount = null, summary = null, memberGift = null, joiningFeeMinor = 0) {
  const paid = type.priceMinor === 0 ? false : value.paid;
  const body = { requestKey, typeId: type.id, startsOn: value.startsOn, paid, ...(paid ? { method: value.method } : {}) };
  // The screen says the price, the joining fee it charges (18t) and what the first bill
  // comes to, tax in (18b-iii): the server gives nothing where any is no longer so.
  const shown = {
    ...body,
    priceMinor: type.priceMinor,
    // Said for every type with a fee, 0 where it was unticked: the server sends back a screen
    // that said nothing of a fee the type has.
    ...(type.joiningFeeMinor > 0 ? { joiningFeeMinor } : {}),
    ...(summary === null ? {} : { totalMinor: summary.totalMinor }),
    // The day its full payments start where the gym bills everyone on one day (18y): the
    // server gives nothing where the gym's day now says otherwise.
    fullFrom: value.startsOn === '' ? null : fullFromOf(type, value.startsOn, type.billDay ?? null),
  };
  // The person's own Refer a friend gift, and what it takes off (20e-ii-b-ii-a).
  const gifted = memberGift === null || summary === null || !(summary.giftOffMinor > 0) ? shown : { ...shown, memberGiftId: memberGift.id, memberGiftMinor: summary.giftOffMinor };
  // With a discount, what comes off too (18b-ii-b).
  if (discount === null || summary === null || summary.offMinor === null) return gifted;
  return { ...gifted, discountId: discount.id, discountMinor: summary.offMinor };
}

/** The joining fee a membership is given with (18t): the type's own, on its first bill.
 *  Staff who take payments may untick it; `choice` is 'auto' until they press the tick,
 *  then 'charge' or 'waive'. Left to itself it is ticked, unless the person already has a
 *  membership here. `tick` is whether the tick is shown; `note` says why it starts unticked. */
export function joiningFeeFor(type, choice, canBill, alreadyMember) {
  const fee = type !== null && type !== undefined && type.joiningFeeMinor > 0 ? type.joiningFeeMinor : 0;
  if (fee === 0) return { feeMinor: 0, tick: false, note: null };
  if (!canBill) return { feeMinor: fee, tick: false, note: null };
  const charged = choice === 'charge' || (choice !== 'waive' && !alreadyMember);
  const note = choice !== 'charge' && choice !== 'waive' && alreadyMember ? 'Left unticked because they already have a membership here.' : null;
  return { feeMinor: charged ? fee : 0, tick: true, note };
}

/** A price-list type with the tax its bills charge, as the Add form reads it (18b-iii). */
export function typeWithTax(type, list) {
  const rate = (list?.taxRates ?? []).find((r) => r.id === type.taxRateId);
  // With the gym's day of the month it bills everyone on (18y), for the first bill's part month.
  return { ...type, tax: rate === undefined ? null : { name: rate.name, bp: rate.bp }, billDay: list?.billDay ?? null };
}

/** A key the server takes one membership for, however often the request arrives. */
export function newRequestKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const hex = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`;
}
