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
  daysBetween,
  formatMinor,
  giveHeldMembership,
  heldMembershipView,
  isDayPass,
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
export function listedRow(listed, name) {
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
      note: `This membership has no price here yet. Set it up in Settings, under Memberships, and ${name} gets it.`,
    };
  }
  return {
    title: listed.type.name,
    tag: 'Not added',
    from: withDay(listed.ownName ? 'From your member list' : `Your member list says “${listed.word}”`),
    note: `${who} doesn't have it here yet. Add it with Add membership, or give it to everyone on your list who is missing it in Settings, under Memberships.`,
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
    if (p.until === null) return { text: 'Paid', due: false };
    return { text: m.view.renewsOn === null ? 'Paid to the end' : `Paid · next payment due ${dayWords(p.until)}`, due: false };
  }
  if (p.since === null) return { text: 'Payment due', due: true };
  if (p.since > today) return { text: `Payment due on ${dayWords(p.since)}`, due: false };
  return { text: p.since === today ? 'Payment due today' : `Payment due since ${dayWords(p.since)}`, due: true };
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
    case 'paid': {
      const p = m.view.payment;
      const from = p === null ? null : p.state === 'paid' ? p.until : p.since;
      const until = m.view.can.markPaid?.until ?? null;
      const period =
        m.kind === 'recurring' && from !== null && until !== null
          ? ` for ${dayWords(from)} up to ${dayWords(until)}. Their next payment is then due ${dayWords(until)}`
          : '';
      return {
        question: `Mark ${whose} as paid?`,
        detail: `This notes that ${name} paid ${priceWords(m)}${period}. It only notes it here: no money is taken.`,
        button: 'Mark paid',
      };
    }
    case 'undoPaid':
      return {
        question: `Take back the last payment noted for ${whose}?`,
        detail: 'Use this when Mark paid was pressed by mistake. Nothing is refunded: this only changes the note.',
        button: 'Take it back',
      };
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
      return {
        question: `Cancel ${whose}?`,
        detail:
          last === null
            ? `It stops today. This can't be undone, but you can add a membership again.`
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
  return parsed.success && parsed.data.booked > 0 ? parsed.data : null;
}

/** Said in the box when the classes are not the ones it listed a moment ago: the person
 *  booked or cancelled one between the box and its button, and the press ended nothing. */
export const ENDING_MOVED = 'The classes changed while this was open. Check them and press again.';

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
    button: `${last === null ? 'Cancel today' : `Cancel on ${dayWords(last)}`} and end ${bookings}`,
  };
}

/** What each press did, said back in one line. */
export function doneWords(what, m) {
  switch (what) {
    case 'give':
      return 'Membership added.';
    case 'paid':
      return `${m.typeName} marked paid.`;
    case 'undoPaid':
      return `The last payment noted for ${m.typeName} was taken back.`;
    case 'freeze':
      return `${m.typeName} is frozen.`;
    case 'unfreeze':
      return `${m.typeName} is running again.`;
    case 'cancelLater':
      return `${m.typeName} will end and won't renew.`;
    case 'cancel':
      return `${m.typeName} is cancelled.`;
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
export function givePreview(type, startsOn, paid, today) {
  if (type === null || startsOn === '') return { line: null, paidLabel: null, problem: null };
  const made = giveHeldMembership(type, startsOn, paid, today);
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
  const ifPaid = giveHeldMembership(type, startsOn, true, today);
  const until = ifPaid.ok ? heldMembershipView(ifPaid.membership, today).payment : null;
  const price = formatMinor(type.priceMinor, type.currency);
  const paidLabel =
    type.kind === 'recurring' && until !== null && until.state === 'paid' && until.until !== null
      ? `They have paid up to ${dayWords(until.until)}`
      : `They have paid the ${price}`;
  return { line, paidLabel, problem: null };
}

/** What a choice of membership comes to: the type, the line under the date, the words of
 *  the paid tick, and why it cannot be given. `value` is { typeId, startsOn, paid }. */
export function membershipChoice(types, value, today) {
  const type = types.find((t) => t.id === value.typeId) ?? null;
  return { type, ...givePreview(type, value.startsOn, value.paid, today) };
}

/** What the server is sent for a choice. `requestKey` is made once a form. */
export function giveBody(requestKey, type, value) {
  return { requestKey, typeId: type.id, startsOn: value.startsOn, paid: type.priceMinor === 0 ? false : value.paid };
}

/** A key the server takes one membership for, however often the request arrives. */
export function newRequestKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const hex = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`;
}
