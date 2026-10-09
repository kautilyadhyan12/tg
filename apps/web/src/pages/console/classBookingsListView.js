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

/** What staff read when a mark is refused and the server says no more. */
export const MARK_FAILED = "We couldn't save that. Please try again.";

/** Why the list could not be read: staff who neither manage classes nor coach this one
 *  are told who can; anything else is the usual sentence. */
export function listRefusal(err) {
  if (errorStatus(err) === 403) return 'Only this class’s coach and staff who can change classes see who is booked.';
  return errorText(err, "We couldn't load who is booked.");
}
