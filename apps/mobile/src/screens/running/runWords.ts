// The words and numbers a run is shown with (ROADMAP Stage 5 item 37a), in the person's own units.
import type { Units } from "@app/shared";

export const METRES_PER_MILE = 1609.344;

const two = (n: number): string => String(n).padStart(2, "0");

/** "12:47" under an hour, "1:02:05" past it. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${String(h)}:${two(m)}:${two(s % 60)}` : `${String(m)}:${two(s % 60)}`;
}

export const unitWord = (units: Units): string => (units === "imperial" ? "mi" : "km");
export const paceWord = (units: Units): string => (units === "imperial" ? "/mi" : "/km");
const metresPer = (units: Units): number => (units === "imperial" ? METRES_PER_MILE : 1000);

/** "5.12": two places, never rounded up past what was run. */
export function distance(metres: number, units: Units): string {
  const hundredths = Math.floor((Math.max(0, metres) / metresPer(units)) * 100);
  return (hundredths / 100).toFixed(2);
}

/** "5:36" a kilometre or a mile; "--:--" with no distance or a pace nobody walks (over an hour a unit). */
export function pace(seconds: number, metres: number, units: Units): string {
  if (metres <= 0 || seconds <= 0) return "--:--";
  const each = Math.round((seconds / metres) * metresPer(units));
  if (each >= 3600) return "--:--";
  return `${String(Math.floor(each / 60))}:${two(each % 60)}`;
}

/** A split's label: "1", "2", … for a whole one, its own distance for the last part ("0.12"). */
export function splitLabel(index: number, metres: number, units: Units): string {
  const whole = metresPer(units);
  return Math.abs(metres - whole) < 1 ? String(index + 1) : distance(metres, units);
}

/** "Morning Run", by the hour the run began, in the phone's own time. */
export function runName(startedAt: Date): string {
  const hour = startedAt.getHours();
  if (hour >= 5 && hour < 12) return "Morning Run";
  if (hour >= 12 && hour < 17) return "Afternoon Run";
  if (hour >= 17 && hour < 21) return "Evening Run";
  return "Night Run";
}

/** The line under a run with a stretch left out (a car, a bus, a train). */
export function leftOutLine(metres: number, units: Units): string {
  return `${distance(metres, units)} ${unitWord(units)} isn't counted: it was faster than anyone has ever run.`;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "Tue 4 Nov · 7:12 am", in the phone's own time. */
export function runWhen(at: Date): string {
  const h = at.getHours();
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${DAYS[at.getDay()] ?? ""} ${String(at.getDate())} ${MONTHS[at.getMonth()] ?? ""} · ${String(hour)}:${two(at.getMinutes())} ${h < 12 ? "am" : "pm"}`;
}

/** How a run felt, 1 to 10: the scale's two ends, as Strava's Perceived Exertion names them. */
export const EFFORT_ENDS = ["Easy", "Max effort"] as const;
