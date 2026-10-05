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

/** Why the list could not be read: staff who neither manage classes nor coach this one
 *  are told who can; anything else is the usual sentence. */
export function listRefusal(err) {
  if (errorStatus(err) === 403) return 'Only this class’s coach and staff who can change classes see who is booked.';
  return errorText(err, "We couldn't load who is booked.");
}
