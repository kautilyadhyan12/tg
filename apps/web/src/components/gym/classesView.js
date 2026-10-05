import { CLASS_BOOKING_WORDS } from '@app/shared';
import { dayLabel, ordinal, timeText } from './leaderboardView';

// A MEMBER'S CLASSES, IN WORDS (spec Part 3 §13.6; ROADMAP 17d). Pure. A class's day and
// clock time arrive as the gym's own and are printed as they are, never moved to the
// phone's zone.

/** "6:00 am", "1:30 pm": the gym's own clock. */
export function clockText(minute) {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** "1:30 pm · 45 min" */
export function whenText(c) {
  return `${clockText(c.localStartMinute)} · ${c.minutes} min`;
}

const nextDay = (day) => new Date(new Date(`${day}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);

/** "Today · Wed 7 Oct", "Tomorrow · Thu 8 Oct", "Fri 9 Oct". `today` is the gym's own day;
 *  null for a week that does not hold it. */
export function dayHeading(day, today) {
  if (today === null) return dayLabel(day);
  if (day === today) return `Today · ${dayLabel(day)}`;
  if (day === nextDay(today)) return `Tomorrow · ${dayLabel(day)}`;
  return dayLabel(day);
}

/** The classes under their days, in the order they arrived. */
export function byDay(classes) {
  const days = [];
  for (const c of classes) {
    const last = days[days.length - 1];
    if (last !== undefined && last.day === c.localDate) last.classes.push(c);
    else days.push({ day: c.localDate, classes: [c] });
  }
  return days;
}

/** "Wed 7 Oct – Tue 13 Oct" */
export function weekText(list) {
  return `${dayLabel(list.from)} – ${dayLabel(list.to)}`;
}

const clockIn = (at, timeZone) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(new Date(at));

/** The line that says whose clock the times are on, when the phone's differs for any
 *  class listed; null when they agree. */
export function zoneNote(classes, gymName, deviceZone) {
  const differs = classes.some((c) => {
    try {
      return clockIn(c.startsAt, deviceZone) !== clockIn(c.startsAt, c.timezone);
    } catch {
      return true;
    }
  });
  if (!differs) return null;
  const zone = classes[0]?.timezone ?? '';
  return `Times are ${gymName} time (${zone.replaceAll('_', ' ')}), not this device's.`;
}

/** How full the class is. A free place that is the first in line's is not left for
 *  anybody else, so the class reads full to them. */
export function placesText(c) {
  if (c.cancelled) return null;
  if (c.places === null) return null;
  const left = c.places - c.booked;
  const waiting = c.waitlisted === 1 ? '1 on the waitlist' : `${c.waitlisted} on the waitlist`;
  if (left <= 0) return c.waitlisted > 0 ? `Full · ${waiting}` : 'Full';
  const noReason = c.can.why === null || c.can.why === 'waitlist_full';
  const promised = c.waitlisted > 0 && !c.can.book && !c.can.claim && noReason && c.mine?.status !== 'booked';
  if (promised) return `Full · ${waiting} · a free place is going to the first in line`;
  return left === 1 ? '1 place left' : `${left} of ${c.places} places left`;
}

/** The line under a list the server cut short. */
export const MORE_CLASSES = 'These 7 days have more classes than this page shows. The later ones are not listed.';

/** What the person has in the class, or null. Waiting never reads as booked. */
export function mineText(c) {
  if (c.mine === null) return null;
  switch (c.mine.status) {
    case 'booked':
      return c.mine.packCharged ? "You're booked · 1 class used from your pack" : "You're booked";
    case 'waitlisted':
      return c.mine.waitlistPlace === null ? 'On the waitlist, not booked' : `On the waitlist, not booked · ${ordinal(c.mine.waitlistPlace)} in line`;
    case 'attended':
      return 'You came';
    case 'no_show':
      return 'You missed this class';
    case 'late_cancelled':
      return c.mine.packCharged ? 'You cancelled late · the class stays used on your pack' : 'You cancelled late';
    default:
      return null;
  }
}

/** The buttons a class offers this person: at most one to take a place, and one to give it up. */
export function actionsOf(c) {
  const take = c.can.claim
    ? { kind: 'claim', label: 'Claim place', joinWaitlist: false }
    : c.can.book
      ? { kind: 'book', label: 'Book', joinWaitlist: false }
      : c.can.joinWaitlist
        ? { kind: 'waitlist', label: 'Join waitlist', joinWaitlist: true }
        : null;
  const give =
    c.can.cancel === null
      ? null
      : { late: c.can.cancel === 'late', label: c.mine?.status === 'waitlisted' ? 'Leave waitlist' : 'Cancel booking' };
  return { take, give };
}

/** "Wed 7 Oct, 7:30 am": an instant on the gym's clock. */
export function instantText(at, timezone) {
  const day = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: timezone }).format(new Date(at));
  return `${dayLabel(day)}, ${timeText(at, timezone)}`;
}

/** One plain line for a class the person cannot book or wait for, or null. */
export function whyText(c) {
  if (c.cancelled) return CLASS_BOOKING_WORDS.class_cancelled;
  if (c.can.claim) return 'A place is free. The first person on the waitlist to claim it has it.';
  const why = c.can.why;
  if (why === null) return null;
  if (why === 'not_open_yet') return `Booking opens ${instantText(c.opensAt, c.timezone)}.`;
  return CLASS_BOOKING_WORDS[why] ?? null;
}

/** What the box asks before a booking is cancelled or a waitlist left. */
export function cancelAsk(c) {
  const what = `${c.className}, ${dayLabel(c.localDate)} at ${clockText(c.localStartMinute)}`;
  if (c.mine?.status === 'waitlisted') {
    return { title: 'Leave the waitlist?', lines: [what, 'You lose your place in line.'], yes: 'Leave waitlist', no: 'Stay on it' };
  }
  if (c.can.cancel === 'late') {
    return {
      title: 'Cancel late?',
      lines: [what, c.mine?.packCharged ? CLASS_BOOKING_WORDS.late_cancel_pack : CLASS_BOOKING_WORDS.late_cancel],
      yes: 'Cancel booking',
      no: 'Keep it',
    };
  }
  return {
    title: 'Cancel your booking?',
    lines: [
      what,
      c.mine?.packCharged
        ? `Free to cancel until ${instantText(c.freeCancelUntil, c.timezone)}. Your pack gets the class back.`
        : `Free to cancel until ${instantText(c.freeCancelUntil, c.timezone)}.`,
    ],
    yes: 'Cancel booking',
    no: 'Keep it',
  };
}

/** What is said once a cancel has gone through, from the class as the server now has it.
 *  A booking needs no line of its own: the row says "You're booked", or that they wait. */
export function cancelledText(c) {
  return c.mine?.status === 'late_cancelled' ? 'Cancelled late.' : 'Cancelled.';
}
