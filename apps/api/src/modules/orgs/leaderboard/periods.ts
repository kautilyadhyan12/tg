// A board's dates (spec Part 3 §15.5). Pure calendar arithmetic on the gym's own "today",
// which the database works out in the gym's time zone. Weeks are ISO weeks, Monday to
// Sunday, as `date_trunc('week')` and the console's calendar.
import type { LeaderboardPeriod } from "@app/shared";

const toDate = (day: string): Date => new Date(`${day}T00:00:00Z`);
const toDay = (date: Date): string => date.toISOString().slice(0, 10);

export function addDays(day: string, days: number): string {
  const date = toDate(day);
  date.setUTCDate(date.getUTCDate() + days);
  return toDay(date);
}

/** The Monday of the day's week. */
export function mondayOf(day: string): string {
  const weekday = (toDate(day).getUTCDay() + 6) % 7; // Monday 0 … Sunday 6
  return addDays(day, -weekday);
}

function monthStart(day: string, back: number): string {
  const date = toDate(day);
  return toDay(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - back, 1)));
}

/** The period's first and last day; `from` null for all time. */
export function periodRange(today: string, period: LeaderboardPeriod): { from: string | null; to: string } {
  switch (period) {
    case "this_week": {
      const from = mondayOf(today);
      return { from, to: addDays(from, 6) };
    }
    case "last_week": {
      const from = addDays(mondayOf(today), -7);
      return { from, to: addDays(from, 6) };
    }
    case "this_month": {
      const from = monthStart(today, 0);
      return { from, to: addDays(monthStart(today, -1), -1) };
    }
    case "last_month":
      return { from: monthStart(today, 1), to: addDays(monthStart(today, 0), -1) };
    case "all_time":
      return { from: null, to: today };
  }
}

export const isWeek = (period: LeaderboardPeriod): boolean => period === "this_week" || period === "last_week";

/** The seven days of a week view, Monday first. */
export function weekDays(from: string): string[] {
  return [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(from, i));
}

/** The Streak's seven weeks: six before this one, then this one. */
export function streakWeeks(today: string): string[] {
  const monday = mondayOf(today);
  return [6, 5, 4, 3, 2, 1, 0].map((i) => addDays(monday, -7 * i));
}
