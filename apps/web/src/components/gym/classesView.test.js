// A MEMBER'S CLASSES, IN WORDS (ROADMAP 17d).
import { describe, expect, it } from 'vitest';
import { actionsOf, byDay, cancelAsk, cancelledText, clockText, dayHeading, instantText, mineText, placesText, weekText, whenText, whyText, zoneNote } from './classesView';

const can = (over = {}) => ({ book: false, joinWaitlist: false, claim: false, cancel: null, why: null, ...over });
const klass = (over = {}) => ({
  sessionId: 's1',
  className: 'Spin',
  localDate: '2026-10-08',
  localStartMinute: 13 * 60 + 30,
  timezone: 'Europe/London',
  startsAt: '2026-10-08T12:30:00.000Z',
  minutes: 45,
  cancelled: false,
  places: 5,
  booked: 0,
  waitlisted: 0,
  opensAt: '2026-10-01T12:30:00.000Z',
  freeCancelUntil: '2026-10-08T10:30:00.000Z',
  mine: null,
  can: can({ book: true }),
  ...over,
});
const mine = (status, over = {}) => ({ status, waitlistPlace: null, packCharged: false, ...over });

describe('the time is the gym’s own', () => {
  it('prints the gym’s clock as it arrived', () => {
    expect([0, 30, 6 * 60, 12 * 60, 13 * 60 + 30, 23 * 60 + 59].map(clockText)).toEqual(['12:00 am', '12:30 am', '6:00 am', '12:00 pm', '1:30 pm', '11:59 pm']);
    expect(whenText(klass())).toBe('1:30 pm · 45 min');
  });

  it('says whose clock it is only when the device’s differs', () => {
    const list = [klass()];
    expect(zoneNote(list, 'Iron House', 'Europe/London')).toBeNull();
    // Dublin keeps London's clock.
    expect(zoneNote(list, 'Iron House', 'Europe/Dublin')).toBeNull();
    expect(zoneNote(list, 'Iron House', 'Asia/Kolkata')).toBe("Times are Iron House time (Europe/London), not this device's.");
    expect(zoneNote([klass({ timezone: 'America/New_York' })], 'Iron House', 'Europe/London')).toBe("Times are Iron House time (America/New York), not this device's.");
    expect(zoneNote(list, 'Iron House', 'Not/AZone')).not.toBeNull();
    expect(zoneNote([], 'Iron House', 'Asia/Kolkata')).toBeNull();
  });

  it('names an instant on the gym’s clock, whatever the device’s', () => {
    expect(instantText('2026-10-08T10:30:00.000Z', 'Europe/London')).toBe('Thu 8 Oct, 11:30 am');
    // 23:30 UTC on the 7th is the 8th in Kolkata.
    expect(instantText('2026-10-07T23:30:00.000Z', 'Asia/Kolkata')).toBe('Thu 8 Oct, 5:00 am');
  });

  it('heads each day, and groups classes under theirs', () => {
    expect(dayHeading('2026-10-07', '2026-10-07')).toBe('Today · Wed 7 Oct');
    expect(dayHeading('2026-10-08', '2026-10-07')).toBe('Tomorrow · Thu 8 Oct');
    expect(dayHeading('2026-11-01', '2026-10-31')).toBe('Tomorrow · Sun 1 Nov');
    expect(dayHeading('2026-10-09', '2026-10-07')).toBe('Fri 9 Oct');
    expect(dayHeading('2026-10-14', null)).toBe('Wed 14 Oct');
    const days = byDay([klass({ sessionId: 'a' }), klass({ sessionId: 'b' }), klass({ sessionId: 'c', localDate: '2026-10-09' })]);
    expect(days.map((d) => [d.day, d.classes.map((c) => c.sessionId)])).toEqual([
      ['2026-10-08', ['a', 'b']],
      ['2026-10-09', ['c']],
    ]);
    expect(weekText({ from: '2026-10-07', to: '2026-10-13' })).toBe('Wed 7 Oct – Tue 13 Oct');
  });
});

describe('what a class says', () => {
  it('how full it is', () => {
    expect(placesText(klass())).toBe('5 of 5 places left');
    expect(placesText(klass({ booked: 4 }))).toBe('1 place left');
    expect(placesText(klass({ booked: 5 }))).toBe('Full');
    expect(placesText(klass({ booked: 5, waitlisted: 3 }))).toBe('Full · 3 on the waitlist');
    expect(placesText(klass({ booked: 5, waitlisted: 1 }))).toBe('Full · 1 on the waitlist');
    // A free place that is the first in line's: nobody else is told a place is left.
    const promised = { places: 2, booked: 1, waitlisted: 2 };
    expect(placesText(klass({ ...promised, can: can({ joinWaitlist: true }) }))).toBe('Full · 2 on the waitlist · a free place is going to the first in line');
    expect(placesText(klass({ ...promised, mine: mine('waitlisted', { waitlistPlace: 2 }), can: can({ cancel: 'free' }) }))).toBe(
      'Full · 2 on the waitlist · a free place is going to the first in line',
    );
    // And where the waitlist is at its limit too.
    expect(placesText(klass({ ...promised, can: can({ why: 'waitlist_full' }) }))).toBe('Full · 2 on the waitlist · a free place is going to the first in line');
    // The first in line, somebody booked, and somebody told why they cannot book read the place as it is.
    expect(placesText(klass({ ...promised, mine: mine('waitlisted', { waitlistPlace: 1 }), can: can({ claim: true, cancel: 'free' }) }))).toBe('1 place left');
    expect(placesText(klass({ ...promised, mine: mine('booked'), can: can({ cancel: 'free' }) }))).toBe('1 place left');
    expect(placesText(klass({ ...promised, can: can({ why: 'not_covered' }) }))).toBe('1 place left');
    expect(placesText(klass({ places: null, booked: 40 }))).toBeNull();
    expect(placesText(klass({ cancelled: true }))).toBeNull();
  });

  it('waiting never reads as booked', () => {
    expect(mineText(klass())).toBeNull();
    expect(mineText(klass({ mine: mine('booked') }))).toBe("You're booked");
    expect(mineText(klass({ mine: mine('booked', { packCharged: true }) }))).toBe("You're booked · 1 class used from your pack");
    for (const place of [1, 2, 3, 11, 21]) {
      const text = mineText(klass({ mine: mine('waitlisted', { waitlistPlace: place }) }));
      expect(text).toMatch(/^On the waitlist, not booked · \d+(st|nd|rd|th) in line$/);
      expect(text).not.toMatch(/You're booked/);
    }
    expect(mineText(klass({ mine: mine('waitlisted', { waitlistPlace: 2 }) }))).toBe('On the waitlist, not booked · 2nd in line');
    expect(mineText(klass({ mine: mine('cancelled') }))).toBeNull();
    expect(mineText(klass({ mine: mine('late_cancelled', { packCharged: true }) }))).toBe('You cancelled late · the class stays used on your pack');
    // A check-in at the gym before the class marks it came: the class has not started.
    const before = new Date('2026-10-08T12:00:00.000Z').getTime();
    const after = new Date('2026-10-08T12:30:00.000Z').getTime();
    expect(mineText(klass({ mine: mine('attended') }), before)).toBe("You're checked in for this class");
    expect(mineText(klass({ mine: mine('attended') }), after)).toBe('You came');
    expect(mineText(klass({ mine: mine('no_show') }))).toBe('You missed this class');
  });

  it('offers one button to take a place and one to give it up, as the server allows', () => {
    expect(actionsOf(klass())).toEqual({ take: { kind: 'book', label: 'Book', joinWaitlist: false }, give: null });
    expect(actionsOf(klass({ can: can({ joinWaitlist: true }) })).take).toEqual({ kind: 'waitlist', label: 'Join waitlist', joinWaitlist: true });
    const waiting = klass({ mine: mine('waitlisted', { waitlistPlace: 1 }), can: can({ claim: true, cancel: 'free' }) });
    expect(actionsOf(waiting)).toEqual({ take: { kind: 'claim', label: 'Claim place', joinWaitlist: false }, give: { late: false, label: 'Leave waitlist' } });
    expect(actionsOf(klass({ mine: mine('booked'), can: can({ cancel: 'late' }) }))).toEqual({ take: null, give: { late: true, label: 'Cancel booking' } });
    expect(actionsOf(klass({ can: can({ why: 'not_covered' }) }))).toEqual({ take: null, give: null });
  });

  it('says why not, in one line', () => {
    expect(whyText(klass())).toBeNull();
    expect(whyText(klass({ can: can({ why: 'not_open_yet' }) }))).toBe('Booking opens Thu 1 Oct, 1:30 pm.');
    expect(whyText(klass({ can: can({ why: 'not_covered' }) }))).toBe("Your membership doesn't include this class. Ask at the front desk.");
    expect(whyText(klass({ can: can({ why: 'no_membership' }) }))).toBe('You need a membership to book this class. Ask at the front desk.');
    expect(whyText(klass({ can: can({ why: 'limit_week' }) }))).toBe("You've used all the bookings your membership includes for that week.");
    expect(whyText(klass({ can: can({ why: 'waitlist_full' }) }))).toBe('This class and its waitlist are full.');
    expect(whyText(klass({ cancelled: true, can: can({ why: 'class_cancelled' }) }))).toBe('This class has been cancelled.');
    expect(whyText(klass({ can: can({ claim: true, cancel: 'free' }) }))).toBe('A place is free. The first person on the waitlist to claim it has it.');
  });

  it('asks before a cancel, and says what it costs', () => {
    const booked = klass({ mine: mine('booked'), can: can({ cancel: 'free' }) });
    expect(cancelAsk(booked)).toEqual({
      title: 'Cancel your booking?',
      lines: ['Spin, Thu 8 Oct at 1:30 pm', 'Free to cancel until Thu 8 Oct, 11:30 am.'],
      yes: 'Cancel booking',
      no: 'Keep it',
    });
    expect(cancelAsk(klass({ mine: mine('booked', { packCharged: true }), can: can({ cancel: 'free' }) })).lines[1]).toBe(
      'Free to cancel until Thu 8 Oct, 11:30 am. Your pack gets the class back.',
    );
    const late = cancelAsk(klass({ mine: mine('booked', { packCharged: true }), can: can({ cancel: 'late' }) }));
    expect(late.title).toBe('Cancel late?');
    expect(late.lines[1]).toBe("It's too late to cancel for free. Cancelling now counts as a late cancel, and the class stays used on your pack.");
    expect(cancelAsk(klass({ mine: mine('booked'), can: can({ cancel: 'late' }) })).lines[1]).toBe("It's too late to cancel for free. Cancelling now counts as a late cancel.");
    expect(cancelAsk(klass({ mine: mine('waitlisted', { waitlistPlace: 2 }), can: can({ cancel: 'free' }) }))).toMatchObject({
      title: 'Leave the waitlist?',
      yes: 'Leave waitlist',
      no: 'Stay on it',
    });
  });

  it('says which kind of cancel went through', () => {
    expect(cancelledText(klass({ mine: mine('cancelled') }))).toBe('Cancelled.');
    expect(cancelledText(klass({ mine: mine('late_cancelled') }))).toBe('Cancelled late.');
  });
});
