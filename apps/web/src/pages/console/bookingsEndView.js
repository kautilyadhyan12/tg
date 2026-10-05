import {
  CLASS_BOOKING_LIMITS,
  CLASS_HAS_BOOKINGS_ERROR,
  classBookingsEndingSchema,
} from '@app/shared';
import { dayHeading } from './classesView';
import { clockLabel } from './hoursView';

// WHO IS BOOKED, BEFORE A CLASS GOES (spec Part 3 §13.4; ROADMAP 17c-ii-a). Cancelling a
// class, cancelling a time slot, archiving a class or moving a time slot ends the bookings
// of the classes that go. The server answers 409 `class_has_bookings` with who they are
// until the request sends their number back; these are the words of the box that asks.
// And the gym's four booking settings, as Settings shows and saves them.

const people = (n) => (n === 1 ? '1 person' : `${n.toLocaleString('en')} people`);

/** Who the server says a change would end the bookings of; null for any other answer. */
export function bookingsAsked(err) {
  const data = err?.response?.data;
  if (data?.error !== CLASS_HAS_BOOKINGS_ERROR) return null;
  const parsed = classBookingsEndingSchema.safeParse(data?.ending);
  return parsed.success && parsed.data.booked + parsed.data.waiting > 0 ? parsed.data : null;
}

/** The number the request sends back as `confirmBookings`. */
export function endingTotal(ending) {
  return (ending?.booked ?? 0) + (ending?.waiting ?? 0);
}

const count = (n, one, many) => (n === 1 ? `1 ${one}` : `${n.toLocaleString('en')} ${many}`);

/** One class: "6 people are booked and 2 are on the waitlist", since each person has one
 *  booking in it. Several classes: the server counts BOOKINGS, and somebody booked on
 *  three of them is three, so the box says bookings: "12 bookings will end, 2 of them
 *  waitlist places, across 3 classes". */
export function endingTitle(ending) {
  const booked = ending?.booked ?? 0;
  const waiting = ending?.waiting ?? 0;
  const classes = ending?.classes ?? 0;
  if (classes > 1) {
    const across = `across ${classes.toLocaleString('en')} classes`;
    if (booked === 0) return `${count(waiting, 'waitlist place', 'waitlist places')} will end, ${across}`;
    const all = `${count(booked + waiting, 'booking', 'bookings')} will end`;
    return waiting === 0 ? `${all}, ${across}` : `${all}, ${waiting.toLocaleString('en')} of them waitlist places, ${across}`;
  }
  const parts = [];
  if (booked > 0) parts.push(`${people(booked)} ${booked === 1 ? 'is' : 'are'} booked`);
  if (waiting > 0) {
    parts.push(booked > 0 ? `${waiting.toLocaleString('en')} ${waiting === 1 ? 'is' : 'are'} on the waitlist` : `${people(waiting)} ${waiting === 1 ? 'is' : 'are'} on the waitlist`);
  }
  return parts.join(' and ');
}

/** What happens to them, in one line. */
export function endingChangeLine(ending) {
  if ((ending?.classes ?? 0) > 1) {
    return 'Each is listed below; somebody booked on several of these classes is there once for each. A booking that used a class from a pack puts the class back on the pack.';
  }
  return endingTotal(ending) === 1
    ? 'Their booking ends. If it used a class from a pack, the class goes back on the pack.'
    : 'Their bookings end. A booking that used a class from a pack puts the class back on the pack.';
}

/** Who does not change, and why, for each kind of change. */
export function endingKeptLine(kind, fromDay) {
  if (kind === 'move') {
    const when = dayHeading(fromDay ?? '');
    return when === ''
      ? "Bookings for classes before that date don't change."
      : `Bookings for classes before ${when} don't change.`;
  }
  if (kind === 'cancel') return "Nobody else's bookings change.";
  return "Bookings for other classes and time slots don't change.";
}

/** Nothing tells the members yet (the emails are ROADMAP 17c-ii-b). */
export const ENDING_NOT_TOLD = "The app doesn't tell them yet. Let them know yourself.";

/** The button that goes ahead: it names the change and how many bookings end. */
export function endingConfirmLabel(kind, ending) {
  const n = endingTotal(ending);
  const bookings = n === 1 ? '1 booking' : `${n.toLocaleString('en')} bookings`;
  const verb = kind === 'cancel' ? 'Cancel class' : kind === 'slot' ? 'Cancel time slot' : kind === 'class' ? 'Archive class' : 'Move time slot';
  return `${verb} and end ${bookings}`;
}

/** One person in the box: their name, and the class their booking is for. */
export function endingPersonLine(person, clockFormat) {
  const when = [person?.className ?? '', dayHeading(person?.localDate ?? ''), clockLabel(person?.localStartMinute, clockFormat)]
    .filter((part) => typeof part === 'string' && part !== '')
    .join(' · ');
  return {
    name: typeof person?.name === 'string' && person.name !== '' ? person.name : 'No name',
    detail: person?.waiting === true ? `${when} · On the waitlist` : when,
  };
}

/** "and 12 more", for the bookings the box has not listed yet. */
export function endingMore(ending, shown) {
  return Math.max(0, endingTotal(ending) - shown);
}

// ── THE FOUR SETTINGS ──

const UNITS = [
  ['minutes', 1],
  ['hours', 60],
  ['days', 1440],
];
export const BOOKING_TIME_UNITS = UNITS.map(([unit]) => unit);

/** Minutes as the biggest whole unit: 120 → 2 hours, 1,440 → 1 day, 90 → 90 minutes. */
export function minutesAsUnit(minutes) {
  const total = Number.isInteger(minutes) && minutes >= 0 ? minutes : 0;
  if (total === 0) return { amount: '0', unit: 'hours' };
  for (const [unit, size] of [...UNITS].reverse()) {
    if (total % size === 0) return { amount: String(total / size), unit };
  }
  return { amount: String(total), unit: 'minutes' };
}

const unitSize = (unit) => UNITS.find(([name]) => name === unit)?.[1] ?? 1;
const whole = (text) => (/^\d{1,6}$/.test(String(text ?? '').trim()) ? Number(String(text).trim()) : null);

export function bookingSettingsDraft(settings) {
  const free = minutesAsUnit(settings?.freeCancelMinutes);
  const handover = minutesAsUnit(settings?.handoverMinutes);
  return {
    opensDays: String(settings?.opensDays ?? ''),
    freeAmount: free.amount,
    freeUnit: free.unit,
    handoverAmount: handover.amount,
    handoverUnit: handover.unit,
    waitlistMax: String(settings?.waitlistMax ?? ''),
  };
}

/** The body the draft would save, or null while a box does not hold a whole number. */
export function bookingSettingsBody(draft) {
  const opensDays = whole(draft?.opensDays);
  const free = whole(draft?.freeAmount);
  const handover = whole(draft?.handoverAmount);
  const waitlistMax = whole(draft?.waitlistMax);
  if (opensDays === null || free === null || handover === null || waitlistMax === null) return null;
  return {
    opensDays,
    freeCancelMinutes: free * unitSize(draft.freeUnit),
    handoverMinutes: handover * unitSize(draft.handoverUnit),
    waitlistMax,
  };
}

const LABELS = {
  opensDays: 'When booking opens',
  freeCancelMinutes: 'Free cancelling',
  handoverMinutes: 'The waitlist time',
  waitlistMax: 'The waitlist size',
};

const span = (minutes) => {
  const { amount, unit } = minutesAsUnit(minutes);
  return `${amount} ${amount === '1' ? unit.slice(0, -1) : unit}`;
};

/** What stops a save, in words; null when the draft can be saved. */
export function bookingSettingsProblem(draft) {
  const body = bookingSettingsBody(draft);
  if (body === null) return 'Type a whole number in each box.';
  for (const key of Object.keys(LABELS)) {
    const [min, max] = CLASS_BOOKING_LIMITS[key];
    if (body[key] < min || body[key] > max) {
      const range =
        key === 'opensDays'
          ? `${min} to ${max} days`
          : key === 'waitlistMax'
            ? `${min} to ${max} people`
            : `${min === 0 ? '0' : span(min)} to ${span(max)}`;
      return `${LABELS[key]}: pick ${range}.`;
    }
  }
  return null;
}

export function bookingSettingsChanged(draft, settings) {
  const body = bookingSettingsBody(draft);
  if (body === null) return true;
  return Object.keys(LABELS).some((key) => body[key] !== settings?.[key]);
}

/** The closed section's one line: the settings as they stand. */
export function bookingSettingsSummary(settings) {
  if (settings === null || settings === undefined) return 'When members can book and cancel, and how the waitlist works';
  const opens = `Opens ${settings.opensDays} ${settings.opensDays === 1 ? 'day' : 'days'} before`;
  const free = settings.freeCancelMinutes === 0 ? 'free to cancel until the start' : `free to cancel until ${span(settings.freeCancelMinutes)} before`;
  const waitlist = settings.waitlistMax === 0 ? 'no waitlist' : `waitlist of ${settings.waitlistMax}`;
  return `${opens} · ${free} · ${waitlist}`;
}

/** What a save says once it is done: a shorter waitlist time can book waiting people. */
export function bookingSettingsSavedLine(movedIn) {
  if (!Number.isInteger(movedIn) || movedIn <= 0) return 'Saved.';
  return movedIn === 1 ? 'Saved. 1 person moved in from a waitlist.' : `Saved. ${movedIn.toLocaleString('en')} people moved in from waitlists.`;
}
