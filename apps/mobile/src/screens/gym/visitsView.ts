// Attendance: the month of a person's visits at one place, on the place's own clock. The browser's
// rules (apps/web/src/components/gym/attendanceView.js), the same days. Pure, so tested alone.
//
// Every date here is the gym's: a visit's `day` was stamped in the gym's zone, and the server's window
// filters that column. A month and a day are strings, never a Date, so nothing is moved into the
// phone's own zone.
import type { GymAttendanceVisit } from "@app/shared";

export type ClockFormat = "12h" | "24h";

/** The words on a visit staff added later: its time is when it was added, never when the person came. */
export const ADDED_LATER = "Added by staff";

/** Monday first, as the browser and the gym's opening hours. */
export const WEEK_HEADS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** The `YYYY-MM-DD` it is now in `zone`, or null for a zone this phone cannot read. */
export function dayIn(zone: string, now: Date): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const day = `${part("year")}-${part("month")}-${part("day")}`;
    return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
  } catch {
    return null;
  }
}

/** The `YYYY-MM` a day belongs to, or null. */
export function monthOfDay(day: string | null): string | null {
  return day !== null && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day.slice(0, 7) : null;
}

function parseMonth(key: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (m === null) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (year < 1 || month < 1 || month > 12) return null;
  return { year, month };
}

/** A month moved by whole months, as a string; the same key back for one that cannot be read. */
export function shiftMonth(key: string, step: number): string {
  const parsed = parseMonth(key);
  if (parsed === null) return key;
  const total = parsed.year * 12 + (parsed.month - 1) + step;
  if (total < 12) return key;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

/** What the server is asked for: the 1st of the month, up to and not including the 1st of the next. */
export function monthWindow(key: string): { from: string; to: string } | null {
  if (parseMonth(key) === null) return null;
  return { from: `${key}-01`, to: `${shiftMonth(key, 1)}-01` };
}

/** The months, short, for the month picker. */
export const MONTHS_SHORT = MONTH_SHORT;

/** "October", or "October 2025" when it is not this year's. */
export function monthName(key: string, thisMonth: string | null): string {
  const parsed = parseMonth(key);
  if (parsed === null) return "";
  const name = MONTH_NAMES[parsed.month - 1] ?? "";
  return thisMonth !== null && thisMonth.slice(0, 4) === key.slice(0, 4) ? name : `${name} ${String(parsed.year)}`;
}

/** 1 Monday to 7 Sunday, for a real day, or null. */
function weekday(day: string): number | null {
  const parsed = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return null;
  const js = parsed.getUTCDay();
  return js === 0 ? 7 : js;
}

/** "Tue 27 Oct 2026". */
export function dayLabel(day: string): string {
  const iso = weekday(day);
  if (iso === null) return day;
  return `${WEEK_HEADS[iso - 1] ?? ""} ${String(Number(day.slice(8, 10)))} ${MONTH_SHORT[Number(day.slice(5, 7)) - 1] ?? ""} ${day.slice(0, 4)}`;
}

/** "6:02 PM" or "18:02", on the gym's clock; "" when the time or the zone cannot be read, so no time
 *  is shown rather than one in the phone's own zone. */
export function visitTime(markedAt: string, zone: string, clock: ClockFormat): string {
  const at = new Date(markedAt);
  if (Number.isNaN(at.getTime())) return "";
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  } catch {
    return "";
  }
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  const minute = Number(parts.find((p) => p.type === "minute")?.value);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23) return "";
  const mm = String(minute).padStart(2, "0");
  if (clock === "24h") return `${String(hour).padStart(2, "0")}:${mm}`;
  return `${String(hour % 12 === 0 ? 12 : hour % 12)}:${mm} ${hour < 12 ? "AM" : "PM"}`;
}

export interface DayCell {
  day: number;
  date: string;
  came: boolean;
  /** The times of that day's visits, in the answer's order. */
  times: string[];
  today: boolean;
  future: boolean;
}

export interface MonthGrid {
  key: string;
  /** Blanks before the 1st, so it sits under its weekday. */
  leading: number;
  cells: DayCell[];
}

/** One month as days, with the days somebody came marked. `today` is the gym's, or null: nothing is
 *  then dimmed or ringed. A visit outside the month is not drawn in it. */
export function monthGrid(key: string, visits: readonly GymAttendanceVisit[], zone: string, clock: ClockFormat, today: string | null): MonthGrid | null {
  const parsed = parseMonth(key);
  if (parsed === null) return null;
  const byDay = new Map<string, string[]>();
  for (const visit of visits) {
    const times = byDay.get(visit.day) ?? [];
    const time = visit.hoursStatus === "added_later" ? ADDED_LATER : visitTime(visit.markedAt, zone, clock);
    if (time !== "") times.push(time);
    byDay.set(visit.day, times);
  }
  const leap = (parsed.year % 4 === 0 && parsed.year % 100 !== 0) || parsed.year % 400 === 0;
  const length = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][parsed.month - 1] ?? 30;
  const cells: DayCell[] = [];
  for (let d = 1; d <= length; d += 1) {
    const date = `${key}-${String(d).padStart(2, "0")}`;
    const times = byDay.get(date);
    cells.push({ day: d, date, came: times !== undefined, times: times ?? [], today: date === today, future: today !== null && date > today });
  }
  return { key, leading: (weekday(`${key}-01`) ?? 1) - 1, cells };
}

/** What an empty month says: about that month, never about ever. */
export function emptyMonthNote(key: string, thisMonth: string | null): string {
  return key === thisMonth ? "No check-ins yet this month." : `No check-ins in ${monthName(key, null)}.`;
}
