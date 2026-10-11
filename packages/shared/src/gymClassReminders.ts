// A REMINDER BEFORE A BOOKED CLASS OR PERSONAL TRAINING SESSION (spec Part 3 §16.2;
// ROADMAP 20b-iii).
//
// The worst thing this could do to a real person: remind somebody of a class they
// cancelled, were only on the waitlist for, or that the gym cancelled or moved, or remind
// them twice. `classReminderDue` is the ONE rule that decides, and it is pure: the sender
// gathers the facts and writes what this returns, one row an occasion.
//
// Every time here is the gym's own clock: a calendar day and the minute of that day.
import { GYM_MESSAGE_DAY_ENDS_HOUR, GYM_MESSAGE_DAY_STARTS_HOUR, gymMessageDayNumber } from "./gymMessages.js";
import type { GymClockFormat } from "./orgs.js";

/** How long before it starts a reminder goes, in hours: picked, never typed. */
export const GYM_MESSAGE_REMINDER_HOURS_CHOICES = [1, 2, 3, 12, 24] as const;
/** A reminder whose time falls in the night goes from this hour of the evening before. */
export const GYM_MESSAGE_REMINDER_EVENING_HOUR = 18;
/** How far ahead the sender reads bookings, in hours: the longest notice, and the night
 *  and the evening a reminder can be brought forward by. */
export const GYM_MESSAGE_REMINDER_LOOK_AHEAD_HOURS = 48;

export type ClassReminderWhat = "class" | "session";

/** Everything the rule reads about one booking. */
export interface ClassReminderFacts {
  gym: {
    /** Not closed. */
    open: boolean;
    /** On a plan (a trial counts). */
    live: boolean;
    /** The gym's switch for the reminder. */
    on: boolean;
    /** The gym's number: this many hours before the start. */
    hours: number;
    /** Now, on the gym's clock. */
    today: string;
    minute: number;
  };
  person: {
    /** A live member of the gym in the app, with an account that is not deleted. */
    member: boolean;
    /** Their record on the gym's list is a former one. */
    former: boolean;
    /** They switched the reminder off at this gym. */
    off: boolean;
  };
  booking: {
    what: ClassReminderWhat;
    id: string;
    /** The booking's own status as the table keeps it. Only `booked` holds a place that is
     *  still to come: not waiting, not cancelled, not already marked came or missed. */
    status: string;
    /** The class's own status; `scheduled` for a session, which has none apart from its
     *  booking's. Anything else, a word this rule has never heard among them, is no class. */
    classStatus: string;
    /** When it starts, and when the person got their place. */
    day: string;
    startMinute: number;
    bookedDay: string | null;
    bookedMinute: number | null;
  };
  /** The occasions this person was already reminded of. */
  sent: readonly string[];
}

/** Why a booking is not reminded of now. */
export const CLASS_REMINDER_HELD_REASONS = [
  "gym_lapsed",
  "removed",
  "former",
  "gym_off",
  "person_off",
  "not_booked",
  "class_cancelled",
  "unreadable",
  "started",
  "too_early",
  "booked_late",
  "already_sent",
  "night",
] as const;
export type ClassReminderHeldReason = (typeof CLASS_REMINDER_HELD_REASONS)[number];

export type ClassReminderDue = { send: true; occasion: string } | { send: false; reason: ClassReminderHeldReason };

const DAY_MINUTES = 1440;
const minuteOk = (minute: number | null): minute is number => minute !== null && Number.isInteger(minute) && minute >= 0 && minute < DAY_MINUTES;

/** A day and a minute of it as one count of minutes, or null for anything that is not one. */
function clockMinutes(day: string | null, minute: number | null): number | null {
  const n = gymMessageDayNumber(day);
  return n === null || !minuteOk(minute) ? null : n * DAY_MINUTES + minute;
}

/** One reminder is ever sent for a booking at one start time: a class the gym moves after
 *  its reminder has a new occasion, so the new time is said too. */
export function classReminderOccasion(booking: Pick<ClassReminderFacts["booking"], "what" | "id" | "day" | "startMinute">): string {
  return `${booking.what}:${booking.id}:${booking.day}:${String(booking.startMinute)}`;
}

/** The first minute a reminder may go, as a count of minutes: `hours` before the start, or,
 *  where that falls in the night, the evening before it. Null for a start or a number that
 *  cannot be read. */
export function classReminderFrom(day: string, startMinute: number, hours: number): number | null {
  const start = clockMinutes(day, startMinute);
  if (start === null || !Number.isInteger(hours) || hours < 1 || hours > GYM_MESSAGE_REMINDER_LOOK_AHEAD_HOURS) return null;
  const ideal = start - hours * 60;
  const dayOf = Math.floor(ideal / DAY_MINUTES);
  const minuteOf = ideal - dayOf * DAY_MINUTES;
  const evening = GYM_MESSAGE_REMINDER_EVENING_HOUR * 60;
  if (minuteOf >= GYM_MESSAGE_DAY_ENDS_HOUR * 60) return dayOf * DAY_MINUTES + evening;
  if (minuteOf < GYM_MESSAGE_DAY_STARTS_HOUR * 60) return (dayOf - 1) * DAY_MINUTES + evening;
  return ideal;
}

/** THE RULE: is this booking reminded of now? Run again with what it sent, it sends nothing.
 *  A fact that cannot be read sends nothing. */
export function classReminderDue(facts: ClassReminderFacts): ClassReminderDue {
  const { gym, person, booking } = facts;
  const held = (reason: ClassReminderHeldReason): ClassReminderDue => ({ send: false, reason });
  if (!gym.open || !gym.live) return held("gym_lapsed");
  if (!person.member) return held("removed");
  if (person.former) return held("former");
  if (!gym.on) return held("gym_off");
  if (person.off) return held("person_off");
  if (booking.status !== "booked") return held("not_booked");
  if (booking.classStatus !== "scheduled") return held("class_cancelled");
  const now = clockMinutes(gym.today, gym.minute);
  const start = clockMinutes(booking.day, booking.startMinute);
  const from = classReminderFrom(booking.day, booking.startMinute, gym.hours);
  const bookedAt = clockMinutes(booking.bookedDay, booking.bookedMinute);
  if (now === null || start === null || from === null || bookedAt === null) return held("unreadable");
  if (now >= start) return held("started");
  if (now < from) return held("too_early");
  // Somebody who booked after its reminder's time has only just been told when it is.
  if (bookedAt > from) return held("booked_late");
  const occasion = classReminderOccasion(booking);
  if (facts.sent.includes(occasion)) return held("already_sent");
  if (gym.minute < GYM_MESSAGE_DAY_STARTS_HOUR * 60 || gym.minute >= GYM_MESSAGE_DAY_ENDS_HOUR * 60) return held("night");
  return { send: true, occasion };
}

// ── THE WORDS ──

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A minute of the day on the gym's own clock: "6:00 PM" or "18:00". */
export function reminderClock(minute: number, clock: GymClockFormat): string | null {
  if (!minuteOk(minute)) return null;
  const hour = Math.floor(minute / 60);
  const past = String(minute % 60).padStart(2, "0");
  if (clock === "24h") return `${String(hour).padStart(2, "0")}:${past}`;
  return `${String(hour % 12 === 0 ? 12 : hour % 12)}:${past} ${hour < 12 ? "AM" : "PM"}`;
}

/** When it is, as the message says it: "today at 6:00 PM", "tomorrow at 6:00 PM", or
 *  "on Tuesday 14 October at 6:00 PM". Null for a day or a time that is not one, or a day
 *  that has passed. */
export function reminderWhen(today: string, day: string, minute: number, clock: GymClockFormat): string | null {
  const from = gymMessageDayNumber(today);
  const on = gymMessageDayNumber(day);
  const time = reminderClock(minute, clock);
  if (from === null || on === null || time === null || on < from) return null;
  if (on === from) return `today at ${time}`;
  if (on === from + 1) return `tomorrow at ${time}`;
  // 1 January 1970 was a Thursday.
  const weekday = WEEKDAYS[(((on + 4) % 7) + 7) % 7];
  const month = MONTHS[Number(day.slice(5, 7)) - 1];
  if (weekday === undefined || month === undefined) return null;
  return `on ${weekday} ${String(Number(day.slice(8, 10)))} ${month} at ${time}`;
}
