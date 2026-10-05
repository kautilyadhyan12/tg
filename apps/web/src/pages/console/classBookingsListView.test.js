// The words of a class's list of people (ROADMAP 17c-iii).
import { describe, expect, it } from 'vitest';
import { bookedHeading, bookingRow, lateHeading, listRefusal, waitlistHeading } from './classBookingsListView';

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
