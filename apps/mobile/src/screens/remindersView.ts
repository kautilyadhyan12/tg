import type { Reminder } from "@app/shared";

// The words and the time box's sums for Your training's reminders (ROADMAP Stage 5 item 19e-i), apart
// from the screen so they are tested without one.

const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** "6:30 PM", as the person's clock reads in the US, Canada and India. */
export function clockWords(time: string): string {
  const hour = Number(time.slice(0, 2));
  const minute = time.slice(3, 5);
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${String(twelve)}:${minute} ${hour < 12 ? "AM" : "PM"}`;
}

/** "Mon, Wed and Fri", "Every day", "Weekdays", "Weekends". */
export function daysWords(days: readonly number[]): string {
  const sorted = [...new Set(days)].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b);
  if (sorted.length === 7 || sorted.length === 0) return "Every day";
  if (sorted.join() === "1,2,3,4,5") return "Weekdays";
  if (sorted.join() === "6,7") return "Weekends";
  const names = sorted.map((d) => DAY_SHORT[d - 1] ?? "");
  return names.length === 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

/** The line under a reminder's name; a pause is said in its own box under it. The time and its AM or PM
 *  never break onto two lines. */
export function reminderLine(reminder: Reminder): string {
  if (!reminder.on) return "Off.";
  const at = clockWords(reminder.time).replace(" ", "\u00a0");
  if (reminder.kind === "workout") return `${daysWords(reminder.days)} at ${at}.`;
  return `Every day at ${at}.`;
}

export const PAUSED_LINE = "Paused because you haven’t opened the app in a week.";
export const DONE_LINE = "Not sent on a day you have already trained or logged that meal.";

export const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

/** "18:30" from the three wheels: the hour's place (12, 1 … 11), the minute's (0, 5 … 55), AM 0 or PM 1. */
export function wheelTime(hourIndex: number, minuteIndex: number, half: number): string {
  const hour = (hourIndex % 12) + (half === 1 ? 12 : 0);
  const minute = MINUTES[minuteIndex] ?? 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** The three wheels' places for "18:30". */
export function timeWheels(time: string): { hour: number; minute: number; half: number } {
  const hour = Number(time.slice(0, 2));
  const minute = Number(time.slice(3, 5));
  return { hour: hour % 12, minute: Math.max(0, Math.min(11, Math.round(minute / 5))), half: hour >= 12 ? 1 : 0 };
}
