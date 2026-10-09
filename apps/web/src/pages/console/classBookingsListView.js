import { errorStatus, errorText } from '../../api/orgsApi';

// WHO IS BOOKED ON A CLASS (spec Part 3 §13.6; ROADMAP 17c-iii): the words of the list a
// class on the Calendar opens. Staff who manage classes read it with what each person
// booked with; the class's own coach reads the names alone (the server sends no more).
// A name opens the person's page for staff the server sent their record to.

const count = (n) => (Number.isInteger(n) ? n.toLocaleString('en') : '0');

/** "Booked · 3 of 12 places", or "Booked · 3" for a class with no limit. */
export function bookedHeading(list) {
  const n = Array.isArray(list?.booked) ? list.booked.length : 0;
  if (!Number.isInteger(list?.places)) return `Booked · ${count(n)}`;
  return `Booked · ${count(n)} of ${list.places === 1 ? '1 place' : `${count(list.places)} places`}`;
}

export function waitlistHeading(list) {
  return `Waitlist · ${count(Array.isArray(list?.waitlisted) ? list.waitlisted.length : 0)}`;
}

/** Late cancels: the count is whole, the names the first hundred. */
export function lateHeading(list) {
  const total = Number.isInteger(list?.lateCancelledTotal) ? list.lateCancelledTotal : 0;
  const shown = Array.isArray(list?.lateCancelled) ? list.lateCancelled.length : 0;
  return total > shown ? `Cancelled late · ${count(total)} (the first ${count(shown)} are listed)` : `Cancelled late · ${count(total)}`;
}

/** One person: their name, and what they booked with where the server says. */
export function bookingRow(booking) {
  const name = typeof booking?.name === 'string' && booking.name !== '' ? booking.name : 'No name';
  const membership = typeof booking?.membership === 'string' ? booking.membership : '';
  if (membership === '') return { name, detail: '' };
  return { name, detail: booking.packCharged === true ? `${membership} · 1 class used from this pack` : membership };
}

export const NOBODY_BOOKED = 'Nobody has booked this class yet.';

/** Came or no-show for one person's place (17f); null where there is nothing to say or
 *  do. What it is marked now (`tag`), what that means for the person (`note`), and the
 *  buttons, each `status` what the server is sent. Before the class starts
 *  (`list.canMark` false) a check-in at the gym shows as "Checked in" and nothing can be
 *  changed. */
export function markRow(booking, list) {
  const status = booking?.status;
  const canMark = list?.canMark === true;
  const name = typeof booking?.name === 'string' && booking.name !== '' ? booking.name : 'this person';
  if (status === 'attended') {
    return {
      tag: { label: canMark ? 'Came' : 'Checked in', tone: 'good' },
      note: '',
      actions: canMark ? [{ status: 'no_show', label: 'Change to no-show', aria: `Change ${name} to no-show` }] : [],
    };
  }
  if (status === 'no_show') {
    return {
      tag: { label: 'No-show', tone: 'warn' },
      note: booking.packCharged === true ? 'The class stays used on their pack.' : '',
      actions: canMark ? [{ status: 'attended', label: 'Change to came', aria: `Change ${name} to came` }] : [],
    };
  }
  if (status !== 'booked' || !canMark) return null;
  return {
    tag: null,
    note: 'Not marked yet',
    actions: [
      { status: 'attended', label: 'Came', aria: `Mark that ${name} came` },
      { status: 'no_show', label: 'No-show', aria: `Mark ${name} as a no-show` },
    ],
  };
}

/** Under "Booked", once the class has started: how the marks get there by themselves. */
export const MARK_HELP =
  'Anyone who checks in at the gym from 1 hour before the class is marked Came. 15 minutes after it ends, everyone else is marked No-show, if the gym was checking people in at that time. You can change any of them here.';

/** The same place, for an online class: nobody checks in at the gym for it. */
export const MARK_HELP_ONLINE = 'This is an online class, so the app marks nobody by itself. Mark each person Came or No-show here.';

/** Staff take one person off a class before it starts (17g); null where they cannot: the
 *  class has started or is cancelled (`list.canRemove` false), or the place is not one
 *  that is held or waited for. The button, and the box that asks first: what happens to
 *  this person, and who is not touched. */
export function removeAsk(booking, list) {
  if (list?.canRemove !== true) return null;
  const status = booking?.status;
  if (status !== 'booked' && status !== 'waitlisted' && status !== 'attended') return null;
  const name = typeof booking?.name === 'string' && booking.name !== '' ? booking.name : 'this person';
  const className = typeof list?.className === 'string' && list.className !== '' ? list.className : 'this class';
  const waiting = status === 'waitlisted';
  const lines = [];
  if (waiting) {
    lines.push('They leave the waitlist. Nobody else moves.');
  } else {
    lines.push('Their place is cancelled. It is not counted as a late cancel.');
    if (booking.packCharged === true) lines.push('The class goes back on their pack.');
    if (Array.isArray(list?.waitlisted) && list.waitlisted.length > 0) {
      lines.push('The free place goes to the waitlist, by your booking rules.');
    }
    if (list?.online === true) lines.push('They stop seeing the link to this online class.');
  }
  lines.push('Nobody else in this class is changed.');
  lines.push("The app doesn't tell them yet. Tell them yourself.");
  return {
    button: { label: waiting ? 'Remove from waitlist' : 'Remove from class', aria: `Remove ${name} from ${waiting ? 'the waitlist' : className}` },
    title: waiting ? `Remove ${name} from the waitlist of ${className}?` : `Remove ${name} from ${className}?`,
    lines,
    yes: waiting ? 'Yes, remove from waitlist' : 'Yes, remove from class',
    no: 'Keep them',
  };
}

/** What staff read when a removal is refused and the server says no more. */
export const REMOVE_FAILED = "We couldn't remove them. Please try again.";

/** What staff read when a mark is refused and the server says no more. */
export const MARK_FAILED = "We couldn't save that. Please try again.";

/** Why the list could not be read: staff who neither manage classes nor coach this one
 *  are told who can; anything else is the usual sentence. */
export function listRefusal(err) {
  if (errorStatus(err) === 403) return 'Only this class’s coach and staff who can change classes see who is booked.';
  return errorText(err, "We couldn't load who is booked.");
}
