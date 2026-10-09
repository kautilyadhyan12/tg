// The words of a class's list of people (ROADMAP 17c-iii).
import { describe, expect, it } from 'vitest';
import { MARK_HELP, bookedHeading, bookingRow, lateHeading, listRefusal, markRow, waitlistHeading } from './classBookingsListView';

// (Which names open a person's page is the screen's test: classWeek.render.test.jsx.)
const people = (n) => Array.from({ length: n }, (_, i) => ({ bookingId: String(i) }));

describe('the headings count what is under them', () => {
  it('booked: of the places, of one place, and with no limit', () => {
    expect(bookedHeading({ places: 12, booked: people(3) })).toBe('Booked · 3 of 12 places');
    expect(bookedHeading({ places: 1, booked: people(1) })).toBe('Booked · 1 of 1 place');
    expect(bookedHeading({ places: null, booked: people(1200) })).toBe('Booked · 1,200');
    expect(bookedHeading({ places: 12, booked: [] })).toBe('Booked · 0 of 12 places');
  });

  it('the waitlist, and late cancels with the whole count where the names stop at a hundred', () => {
    expect(waitlistHeading({ waitlisted: people(2) })).toBe('Waitlist · 2');
    expect(lateHeading({ lateCancelled: people(1), lateCancelledTotal: 1 })).toBe('Cancelled late · 1');
    expect(lateHeading({ lateCancelled: people(100), lateCancelledTotal: 130 })).toBe('Cancelled late · 130 (the first 100 are listed)');
  });
});

describe('one person on the list', () => {
  it('says what they booked with only where the server sent it, and never a blank name', () => {
    expect(bookingRow({ name: 'Maya Shah', membership: 'Gold Monthly', packCharged: false })).toEqual({ name: 'Maya Shah', detail: 'Gold Monthly' });
    expect(bookingRow({ name: 'Leo Grant', membership: '10 classes', packCharged: true })).toEqual({ name: 'Leo Grant', detail: '10 classes · 1 class used from this pack' });
    // A coach's list: the server sends neither.
    expect(bookingRow({ name: 'Maya Shah', membership: null, packCharged: null })).toEqual({ name: 'Maya Shah', detail: '' });
    expect(bookingRow({ name: null, membership: null, packCharged: null })).toEqual({ name: 'No name', detail: '' });
  });
});

describe('a list that could not be read', () => {
  it('tells staff the server refused who can see it; anything else is the usual sentence', () => {
    expect(listRefusal({ response: { status: 403, data: { message: "Your role doesn't allow that." } } })).toBe('Only this class’s coach and staff who can change classes see who is booked.');
    expect(listRefusal({ response: { status: 500, data: {} } })).toBe("We couldn't load who is booked.");
    expect(listRefusal(new Error('offline'))).toBe("Couldn't reach the server. Check your connection and try again.");
  });
});

// CAME OR NO-SHOW (17f). The worst these words could do: call somebody who came a
// no-show, or offer a mark the server will refuse.
describe('came or no-show for one place', () => {
  const started = { canMark: true };
  const coming = { canMark: false };
  const labels = (row) => row?.actions.map((a) => [a.status, a.label, a.aria]);

  it('before the class starts nobody can be marked, and a check-in reads as checked in', () => {
    expect(markRow({ name: 'Maya Shah', status: 'booked' }, coming)).toBeNull();
    expect(markRow({ name: 'Maya Shah', status: 'attended' }, coming)).toEqual({ tag: { label: 'Checked in', tone: 'good' }, note: '', actions: [] });
    // A list from a server that says nothing about marking is one that cannot be marked.
    expect(markRow({ name: 'Maya Shah', status: 'booked' }, {})).toBeNull();
  });

  it('once it has started: not marked yet with both buttons, then the mark with one button to change it', () => {
    const open = markRow({ name: 'Maya Shah', status: 'booked' }, started);
    expect(open?.tag).toBeNull();
    expect(open?.note).toBe('Not marked yet');
    expect(labels(open)).toEqual([
      ['attended', 'Came', 'Mark that Maya Shah came'],
      ['no_show', 'No-show', 'Mark Maya Shah as a no-show'],
    ]);
    const came = markRow({ name: 'Maya Shah', status: 'attended' }, started);
    expect(came?.tag).toEqual({ label: 'Came', tone: 'good' });
    expect(labels(came)).toEqual([['no_show', 'Change to no-show', 'Change Maya Shah to no-show']]);
    const missed = markRow({ name: null, status: 'no_show', packCharged: false }, started);
    expect(missed?.tag).toEqual({ label: 'No-show', tone: 'warn' });
    expect(missed?.note).toBe('');
    expect(labels(missed)).toEqual([['attended', 'Change to came', 'Change this person to came']]);
  });

  it('a no-show on a pack says the class stays used; a coach is not sent what paid, and is told nothing about it', () => {
    expect(markRow({ name: 'Leo Grant', status: 'no_show', packCharged: true }, started)?.note).toBe('The class stays used on their pack.');
    expect(markRow({ name: 'Leo Grant', status: 'no_show', packCharged: null }, started)?.note).toBe('');
  });

  it('nobody waiting or cancelled is marked', () => {
    for (const status of ['waitlisted', 'cancelled', 'late_cancelled', undefined]) {
      expect(markRow({ name: 'Tom Reed', status }, started), String(status)).toBeNull();
    }
  });

  it('the line under Booked says the hour before, the 15 minutes after, and that staff can change it', () => {
    expect(MARK_HELP).toContain('1 hour before the class');
    expect(MARK_HELP).toContain('15 minutes after it ends');
    expect(MARK_HELP).toContain('You can change any of them here.');
  });
});
